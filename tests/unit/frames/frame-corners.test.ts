import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CORNER_NORMALISE_TEMPLATES,
  NEVER_NORMALISE,
  REPAINT_DEPTH_MAX,
  cornerDiff,
  lightInsideCorners,
  normaliseCardCorners,
  normaliseMasterCorners,
  normalisedMasterFailures,
  phaseBGateFailures,
  shouldNormalise,
} from "@/scripts/lib/frame-corners.mjs";
import { EDGE_CONTRACTS, cornerViolations, edgeContractViolations } from "@/lib/frames/edge-contract";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 3.26 Phase B (owner decision 2026-09-27): the git MSE masters on the
// allow-list have the light card-stock paper outside their painted corner
// (and its grey anti-aliased fringe) repainted with the border colour, then
// the one card corner cut (scripts/lib/frame-corners.mjs,
// scripts/round-frame-corners.mjs). The showcase families never are. The
// builders run the same pass, so a rebuild can't bring the white back.
// ---------------------------------------------------------------------------

type Report = ReturnType<typeof normaliseCardCorners>;

const W = 1500;
const H = 2100;
const at = (x: number, y: number) => (y * W + x) * 4;

/** An opaque black HD master with `paper` (RGB) outside a `painted`-px
 *  rounded corner — an MSE frame before Phase B — and an optional grey
 *  anti-aliased ramp `ramp` px wide across the painted edge (a 4× upscale
 *  of a 375 px JPEG blurs it over ~4 px). */
function mseMaster({ painted = 74, paper = [255, 255, 255], ramp = 0 }: { painted?: number; paper?: number[]; ramp?: number } = {}) {
  const buf = new Uint8Array(W * H * 4);
  for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    for (let ly = 0; ly < painted; ly += 1) {
      for (let lx = 0; lx < painted; lx += 1) {
        const out = Math.hypot(painted - lx - 0.5, painted - ly - 0.5) - painted; // > 0: paper side
        const t = ramp ? Math.min(1, Math.max(0, (out + ramp / 2) / ramp)) : out > 0 ? 1 : 0;
        if (t <= 0) continue;
        const o = ((fy ? H - 1 - ly : ly) * W + (fx ? W - 1 - lx : lx)) * 4;
        for (let c = 0; c < 3; c += 1) buf[o + c] = Math.round(paper[c] * t);
      }
    }
  }
  return buf;
}

const lumaAt = (buf: Uint8Array, x: number, y: number) => 0.299 * buf[at(x, y)] + 0.587 * buf[at(x, y) + 1] + 0.114 * buf[at(x, y) + 2];
const sum = (report: Report, field: "repainted" | "repaintedLight" | "flooded") => report.reduce((s, c) => s + c[field], 0);

describe("the Phase B allow-list", () => {
  it("is the owner's list: the MSE masters with paper corners, never a showcase family", () => {
    expect(Object.keys(CORNER_NORMALISE_TEMPLATES).sort()).toEqual(
      [
        "aftermath",
        "alphatoken",
        "expeditionland",
        "extendedart",
        "flip",
        "fullart",
        "m15textless",
        "m15textlessland",
        "modern",
        "modernland",
        "retro",
        "retroland",
        "saga",
      ].sort(),
    );
    // expeditionland: only the keys the corner check flags — w u r c m, whose
    // grey paper reaches 1–2 px inside the cut; b and g are 7.7 known
    // failures (a transparent edge band: no border to paint with).
    expect(CORNER_NORMALISE_TEMPLATES.expeditionland).toEqual(["w", "u", "r", "c", "m"]);
    for (const template of Object.keys(CORNER_NORMALISE_TEMPLATES)) {
      expect(FRAME_TEMPLATE_VALUES as readonly string[], template).toContain(template);
      expect(NEVER_NORMALISE.test(template), template).toBe(false);
    }
  });

  it("never normalises the showcase families, Alpha, adventure or the Card Conjurer masters", () => {
    for (const t of ["bloomburrow", "bloomanime", "lotr", "lotrscroll", "tarkirdragon", "tarkirghostfire", "tarkirdraconic", "avatar", "battle"]) {
      expect(NEVER_NORMALISE.test(t), t).toBe(true);
      expect(shouldNormalise(t, "w"), t).toBe(false);
    }
    for (const t of ["agclassic", "alphaland", "adventure", "split", "nyx", "m15", "m15borderless", "fullartland"]) {
      expect(shouldNormalise(t, "w"), t).toBe(false);
    }
    expect(shouldNormalise("retro", "w")).toBe(true);
    expect(shouldNormalise("expeditionland", "w")).toBe(true);
    expect(shouldNormalise("expeditionland", "b")).toBe(false);
    expect(shouldNormalise("expeditionland", "g")).toBe(false);
  });
});

describe("normaliseCardCorners", () => {
  it("paints the paper outside a painted corner with the border and cuts the corner at 64.5 px", () => {
    const m = mseMaster();
    const before = Uint8Array.from(m);
    const lightBefore = lightInsideCorners(before, W, H);
    expect(lightBefore).toBe(916); // a retro-sized crescent (retro: 1,214–1,295)
    const report = normaliseCardCorners(m, W, H);
    // The crescent is gone, the corner is cut, nothing else moved.
    expect(lightInsideCorners(m, W, H)).toBe(0);
    expect(m[at(0, 0) + 3]).toBe(0);
    expect(m[at(60, 0) + 3]).toBe(223); // k 0.875: the bake's own mask
    expect([...m.subarray(at(20, 20), at(20, 20) + 4)]).toEqual([0, 0, 0, 255]); // was paper
    expect(cornerDiff(before, m, W, H).outside).toBe(0);
    expect(cornerViolations(EDGE_CONTRACTS.retro, m, W, H)).toEqual([]);
    expect(edgeContractViolations(EDGE_CONTRACTS.retro, m, W, H)).toEqual([]);
    // The gate: the light it repainted is the light the cut showed.
    expect(sum(report, "repaintedLight")).toBe(lightBefore);
    expect(phaseBGateFailures(report, lightBefore, cornerDiff(before, m, W, H))).toEqual([]);
    for (const c of report) {
      expect(c.border).toEqual([0, 0, 0]);
      expect(c.lightLeft).toBe(0);
      expect(c.deepestPx).toBeLessThanOrEqual(REPAINT_DEPTH_MAX);
    }
  });

  it("leaves no grey hairline: the anti-aliased ramp between paper and border goes too", () => {
    const m = mseMaster({ ramp: 4 });
    normaliseCardCorners(m, W, H);
    let worst = 0;
    for (let ly = 0; ly < 96; ly += 1) {
      for (let lx = 0; lx < 96; lx += 1) {
        if (m[at(lx, ly) + 3] < 255) continue;
        worst = Math.max(worst, lumaAt(m, lx, ly));
      }
    }
    expect(worst).toBeLessThanOrEqual(6);
  });

  it("paints with the border beside the paper, not a lighter edge band", () => {
    const m = mseMaster();
    // A scanned border drifts: lighter along the outer rows past the corner.
    for (let x = 96; x < 200; x += 1) for (let y = 0; y < 8; y += 1) m.set([12, 12, 12], at(x, y));
    const report = normaliseCardCorners(m, W, H);
    expect(report[0].border).toEqual([0, 0, 0]);
  });

  it("is idempotent: a normalised master is left byte for byte", () => {
    const m = mseMaster({ ramp: 4 });
    normaliseCardCorners(m, W, H);
    const once = Uint8Array.from(m);
    const again = normaliseCardCorners(m, W, H);
    expect(again.every((c) => c.alreadyNormalised)).toBe(true);
    expect(Buffer.from(m).equals(Buffer.from(once))).toBe(true);
  });

  it("never paints a light design the dark border encloses", () => {
    const m = mseMaster();
    for (let y = 40; y < 48; y += 1) for (let x = 40; x < 48; x += 1) m.set([250, 250, 250], at(x, y));
    normaliseCardCorners(m, W, H);
    expect([...m.subarray(at(44, 44), at(44, 44) + 4)]).toEqual([250, 250, 250, 255]);
  });

  it("never paints a coloured corner (Bloomburrow's pale blue is design)", () => {
    const m = mseMaster({ paper: [150, 190, 230] });
    const report = normaliseCardCorners(m, W, H);
    expect(sum(report, "flooded")).toBe(0);
    expect([...m.subarray(at(20, 20), at(20, 20) + 3)]).toEqual([150, 190, 230]);
  });

  it("refuses a flood that reaches the guard arc (a leak), and a corner with no dark border", () => {
    const leak = mseMaster();
    for (let i = 0; i < 120; i += 1) for (let d = -2; d <= 2; d += 1) leak.set([255, 255, 255], at(i, Math.max(0, i + d)));
    const report = normaliseCardCorners(Uint8Array.from(leak), W, H);
    expect(report[0].skipped).toMatch(/leak/);
    expect(() => normaliseMasterCorners("retro", "w", leak, W, H)).toThrow(/^retro\/w: corner normalise refused — tl: exterior reaches the guard arc \(leak\)/);
    const white = new Uint8Array(W * H * 4).fill(255);
    expect(() => normaliseMasterCorners("retro", "w", white, W, H)).toThrow(/border band is not opaque and dark/);
    // Off the allow-list the hook does nothing.
    const bloom = mseMaster();
    const copy = Uint8Array.from(bloom);
    expect(normaliseMasterCorners("bloomburrow", "w", bloom, W, H)).toBeNull();
    expect(Buffer.from(bloom).equals(Buffer.from(copy))).toBe(true);
  });

  it("gate: fails a diff outside the corner boxes and a repaint of more light than the cut showed", () => {
    const report = normaliseCardCorners(mseMaster(), W, H);
    expect(phaseBGateFailures(report, 0, { changed: 10, outside: 0 })).toEqual([expect.stringMatching(/^repainted \d+ light px, more than the 0/)]);
    expect(phaseBGateFailures(report, 10_000, { changed: 10, outside: 3 })).toEqual(["3 px changed outside the four 96×96 corner boxes"]);
  });

  it("gate: fails a repaint deeper than REPAINT_DEPTH_MAX or one that lightens a pixel", () => {
    const report = normaliseCardCorners(mseMaster(), W, H);
    const deep = report.map((c, i) => (i === 0 ? { ...c, deepestPx: REPAINT_DEPTH_MAX + 0.5 } : c));
    expect(phaseBGateFailures(deep, 10_000, { changed: 10, outside: 0 })).toEqual([
      `tl: repaint reaches ${(REPAINT_DEPTH_MAX + 0.5).toFixed(1)} px inside (> ${REPAINT_DEPTH_MAX})`,
    ]);
    const lighter = report.map((c, i) => (i === 3 ? { ...c, lightened: 2 } : c));
    expect(phaseBGateFailures(lighter, 10_000, { changed: 10, outside: 0 })).toEqual(["br: 2 repainted px came out lighter"]);
  });

  it("counts the whole repaint — light, grey fringe AND the fringe's dark tail — and stays within the depth bound", () => {
    // A 4 px ramp between paper and border: light, grey and dark steps.
    const m = mseMaster({ ramp: 4 });
    const before = Uint8Array.from(m);
    const report = normaliseCardCorners(m, W, H);
    // Every pixel the cut keeps whose colour changed is in the tally.
    let changedKept = 0;
    const r = 64.5;
    for (let ly = 0; ly < 96; ly += 1) {
      for (let lx = 0; lx < 96; lx += 1) {
        const o = at(lx, ly);
        if (before[o] === m[o] && before[o + 1] === m[o + 1] && before[o + 2] === m[o + 2]) continue;
        const inSquare = lx < r && ly < r;
        if (inSquare && Math.hypot(r - lx - 0.5, r - ly - 0.5) - r > -0.5) continue;
        changedKept += 1;
      }
    }
    const tl = report[0];
    expect(tl.repainted).toBe(changedKept);
    expect(tl.repainted).toBe(tl.repaintedLight + tl.repaintedFringe + tl.repaintedDark);
    expect(tl.repaintedDark).toBeGreaterThan(0);
    expect(tl.deepestPx).toBeLessThanOrEqual(REPAINT_DEPTH_MAX);
    expect(tl.lightened).toBe(0);
  });

  it("paints a scanned border's edge profile, so the repaint meets the untouched edge without a step", () => {
    // retro's border: the outer rows read 16/16/16/13/8/3 before the black,
    // all along the edge — the paper's corner has to take the same profile.
    const PROFILE = [16, 16, 16, 13, 8, 3];
    const m = mseMaster({ ramp: 4 });
    for (let t = 0; t < PROFILE.length; t += 1) {
      for (let a = 0; a < W; a += 1) {
        const top = at(a, t);
        if (m[top] < PROFILE[t]) m.set([PROFILE[t], PROFILE[t], PROFILE[t]], top);
      }
      for (let a = 0; a < H; a += 1) {
        const left = at(t, a);
        if (m[left] < PROFILE[t]) m.set([PROFILE[t], PROFILE[t], PROFILE[t]], left);
      }
    }
    const report = normaliseCardCorners(m, W, H);
    expect(report[0].profile?.horizontal.slice(0, 7)).toEqual([...PROFILE, 0]);
    // Along the top edge, from the arc's end onward: each row reads its
    // profile value — no black run ending in a lighter step.
    for (let t = 0; t < PROFILE.length; t += 1) {
      for (let x = 66; x < 96; x += 1) expect(Math.abs(lumaAt(m, x, t) - PROFILE[t]), `(${x},${t})`).toBeLessThanOrEqual(1);
    }
  });

  it("the builders' hook runs the runner's whole gate and restores the master when it refuses", () => {
    const m = mseMaster();
    const copy = Uint8Array.from(m);
    // A see-through hole in the top border, far from the corners: the edge
    // contract (a border is opaque) refuses the normalised master.
    for (let y = 0; y < 8; y += 1) for (let x = 400; x < 420; x += 1) m[at(x, y) + 3] = 0;
    const withSpot = Uint8Array.from(m);
    expect(() => normaliseMasterCorners("retro", "w", m, W, H)).toThrow(/^retro\/w: corner normalise refused — .*top/);
    expect(Buffer.from(m).equals(Buffer.from(withSpot))).toBe(true);
    // A clean one passes, and the report comes back.
    expect(normaliseMasterCorners("retro", "w", copy, W, H)).toHaveLength(4);
    expect(normalisedMasterFailures("retro", "w", mseMaster(), copy, W, H, normaliseCardCorners(Uint8Array.from(copy), W, H))).toEqual([]);
  });
});

// The builders regenerate masters from Full-Magic-Pack; each one that makes
// an allow-listed template runs the pass before it writes (the white came
// back once because dc65aa5's clear was a one-off over the files).
describe("the MSE builders run the pass", () => {
  const BUILDER_OF: Record<string, string> = {
    retro: "build-era-frames.mjs",
    retroland: "build-era-frames.mjs",
    modern: "build-era-frames.mjs",
    modernland: "build-era-frames.mjs",
    saga: "convert-mse-frame.mjs",
    alphatoken: "convert-mse-frame.mjs",
    aftermath: "build-aftermath-frame.mjs",
    flip: "build-flip-frame.mjs",
    extendedart: "build-variation-frames.mjs",
    fullart: "build-variation-frames.mjs",
    m15textless: "build-variation-frames.mjs",
    m15textlessland: "build-variation-frames.mjs",
    expeditionland: "build-variation-frames.mjs",
  };
  it("names a builder for every allow-listed template, and that builder normalises before it writes", () => {
    expect(Object.keys(BUILDER_OF).sort()).toEqual(Object.keys(CORNER_NORMALISE_TEMPLATES).sort());
    for (const file of new Set(Object.values(BUILDER_OF))) {
      const src = fs.readFileSync(path.join(process.cwd(), "scripts", file), "utf8");
      expect(src, file).toMatch(/import \{ normaliseMasterCorners \} from "\.\/lib\/frame-corners\.mjs";/);
      expect(src, file).toMatch(/normaliseMasterCorners\(path\.basename\(\w+\), \w+, data, W, H\);\s+await sharp\(data/);
    }
  });
});

// The committed masters are normalised: a rebuild that skipped the pass (or
// a new colour) turns this red.
describe("the allow-listed git masters are already normalised", () => {
  const masters = Object.keys(CORNER_NORMALISE_TEMPLATES).flatMap((template) =>
    ["w", "u", "b", "r", "g", "c", "m"]
      .filter((key) => shouldNormalise(template, key))
      .map((key) => ({ template, key, file: path.join(process.cwd(), "public", "frames", template, `${key}.png`) })),
  );
  it("covers all 89 (12 templates × 7 colours, and expeditionland's 5)", () => {
    expect(masters).toHaveLength(89);
    for (const m of masters) expect(fs.existsSync(m.file), m.file).toBe(true);
  });
  for (const { template, key, file } of masters) {
    it(`${template}/${key}`, async () => {
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const report = normaliseCardCorners(Uint8Array.from(data), info.width, info.height);
      expect(report.map((c) => c.alreadyNormalised)).toEqual([true, true, true, true]);
      expect(lightInsideCorners(data, info.width, info.height)).toBeLessThanOrEqual(26); // alphatoken's silver bevel deep in the box
    });
  }
});
