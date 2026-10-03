import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import {
  CC_TEMPLATES,
  SNOW_PAIR_BAR_GOLD_SHARE,
  describeLayer,
  pairMasterLayers,
  snowPairLayers,
  twoColorRecipe,
} from "@/scripts/lib/cc-frames.mjs";
import { PAIR_RAMPS, TWO_COLOR_PAIRS, rampShare } from "@/scripts/lib/pair-ramp.mjs";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6f (wave 2c) — the snow pair masters: m15snow's white-bar pairs and
// m15snowland's dual-land pairs, 4.6b's recipe over Card Conjurer's snow
// pack (`m15/new/snow/<k>.png`, the accurate M15 pack's geometry through the
// same six masks). The recipe, the declared keys, the manifest and
// provenance, and — with a local copy of the published masters at the
// manifest's sha256 (FRAMES_BUILD_DIR, else .frames-build; CI fetches them)
// — the pixels:
//   • inside CC's Pinline mask a pair master IS the two colour masters
//     lerped across the pinline ramp (40→60 %W);
//   • the #449 hairline can't happen here: every ring row of the base frame
//     (snow m / snow l) lies inside the Pinline mask's rows, and no row
//     outside the mask holds the base's pinline colour where the two colour
//     frames don't;
//   • the nonland bars are white — snow/w.png's title and type regions
//     warmed a quarter toward the gold bar's — on the gold snow body; the
//     land pairs keep the snow land frame's bars.
// ---------------------------------------------------------------------------

type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const files = (manifestJson as { files: Record<string, Entry> }).files;
const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")) as Record<
  string,
  { colors: Record<string, string[]>; notes: string[] }
>;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const CC = path.join(process.env.CC_CACHE ?? path.join(process.env.HOME ?? "", ".cache", "pipglyph-cc"), "2fcddba8966156d484cedf54d8214996748dd5e1");

const SNOW = "img/frames/m15/new/snow";
const MASK = (name: string) => `img/frames/m15/new/${name}.png`;
const W = 1500;
const H = 2100;

describe("the recipe (snowPairLayers)", () => {
  it("a nonland pair: the snow gold frame whole, the split box, the white bars warmed a quarter toward gold, the split pinline — through the accurate M15 masks", () => {
    expect(SNOW_PAIR_BAR_GOLD_SHARE).toBe(0.25);
    expect(snowPairLayers("ub", "split", "snow")).toEqual([
      { src: `${SNOW}/m.png` },
      { src: `${SNOW}/u.png`, right: `${SNOW}/b.png`, ramp: [...PAIR_RAMPS.rules], mask: MASK("rules") },
      { src: `${SNOW}/w.png`, mask: MASK("title") },
      { src: `${SNOW}/w.png`, mask: MASK("type") },
      { src: `${SNOW}/m.png`, mask: MASK("title"), opacity: 0.25 },
      { src: `${SNOW}/m.png`, mask: MASK("type"), opacity: 0.25 },
      { src: `${SNOW}/u.png`, right: `${SNOW}/b.png`, ramp: [...PAIR_RAMPS.pinline], mask: MASK("pinline") },
    ]);
    expect(PAIR_RAMPS.pinline).toEqual([40, 60]);
    expect(PAIR_RAMPS.rules).toEqual([45, 57]);
  });

  it("a land pair: 4.6b's land recipe over the snow land files (snow/l.png whole, the box and pinline in the two land tints)", () => {
    expect(snowPairLayers("rw", "split", "snowland")).toEqual([
      { src: `${SNOW}/l.png` },
      { src: `${SNOW}/lr.png`, right: `${SNOW}/lw.png`, ramp: [...PAIR_RAMPS.rules], mask: MASK("rules") },
      { src: `${SNOW}/lr.png`, right: `${SNOW}/lw.png`, ramp: [...PAIR_RAMPS.pinline], mask: MASK("pinline") },
    ]);
    // The same layers as m15land's, with the snow files in place of new/'s.
    const m15land = pairMasterLayers("rw", "split", "land").map((l) => describeLayer(l).replaceAll("img/frames/m15/new/l", `${SNOW}/l`));
    expect(snowPairLayers("rw", "split", "snowland").map(describeLayer)).toEqual(m15land);
    expect(twoColorRecipe("rw", "split", "land").typeTitle).toBe("l");
  });

  it("the split dress only — no hybrid snow print exists — and the first canonical colour on the left", () => {
    expect(() => snowPairLayers("wu", "hybrid", "snow")).toThrow(/split dress only/);
    expect(() => snowPairLayers("wu", "split", "devoid" as never)).toThrow(/unknown kind/);
    for (const pair of TWO_COLOR_PAIRS) {
      const pinline = snowPairLayers(pair, "split", "snow").at(-1) as { src: string; right: string };
      expect(pinline.src).toBe(`${SNOW}/${pair[0]}.png`);
      expect(pinline.right).toBe(`${SNOW}/${pair[1]}.png`);
    }
  });

  it("CC_TEMPLATES builds the ten split pairs of each snow template and nothing else beside the monos; provenance records them", () => {
    for (const [template, kind] of [["m15snow", "snow"], ["m15snowland", "snowland"]] as const) {
      const colors = (CC_TEMPLATES as Record<string, { colors: Record<string, unknown>; notes: string[] }>)[template];
      expect(Object.keys(colors.colors)).toEqual(["w", "u", "b", "r", "g", "c", "m", ...TWO_COLOR_PAIRS]);
      for (const pair of TWO_COLOR_PAIRS) {
        expect(colors.colors[pair]).toEqual(snowPairLayers(pair, "split", kind));
        expect(provenance[template].colors[pair], `${template}/${pair}`).toEqual(snowPairLayers(pair, "split", kind).map(describeLayer));
      }
      expect(provenance[template].notes.join(" ")).toMatch(/wave 2c/);
    }
    expect(provenance.m15snow.notes.join(" ")).toMatch(/WHITE title and type bars/);
    expect(provenance.m15snow.notes.join(" ")).toMatch(/25%/);
    // Devoid builds no pair (owner round 20): every two-colour devoid
    // printing is the uniform gold frame its `m` master already draws.
    expect(Object.keys((CC_TEMPLATES as Record<string, { colors: Record<string, unknown> }>).m15devoid.colors)).toEqual(["w", "u", "b", "r", "g", "c", "m"]);
  });
});

describe("declared and published", () => {
  it("m15snow and m15snowland declare the split dress; a land wears it on the snow land frame only; devoid declares none", () => {
    expect(getFrameProfile("m15snow").twoColorMasters).toEqual(["split"]);
    expect(getFrameProfile("m15snow").twoColorForLands).toBeUndefined();
    expect(getFrameProfile("m15snowland").twoColorMasters).toEqual(["split"]);
    expect(getFrameProfile("m15snowland").twoColorForLands).toBe(true);
    expect(getFrameProfile("m15devoid").twoColorMasters).toBeUndefined();
    // (Its only overlay is the holofoil stamp's notch, 4.9c — no crown band.)
    expect(getFrameProfile("m15devoid").overlays?.filter((slot) => slot.anatomy === "crown")).toEqual([]);
    // Never on a base another profile spreads: nothing else gained a dress.
    const paired = FRAME_TEMPLATE_VALUES.filter((t) => (getFrameProfile(t).twoColorMasters ?? []).length > 0);
    expect(paired).toEqual(["m15", "m15land", "m15artifact", "m15snow", "m15snowland", "m15borderless", "m15borderlessartifact"]);
  });

  it.each(["m15snow", "m15snowland"])("%s: every pair master is in the frames bucket, PNG + WebP, 1500 × 2100; the monos and plates are the same objects as before", (template) => {
    for (const pair of TWO_COLOR_PAIRS) {
      for (const ext of ["png", "webp"]) {
        const entry = files[`${template}/${pair}.${ext}`];
        expect(entry, `${template}/${pair}.${ext}`).toBeDefined();
        expect([entry.width, entry.height]).toEqual([W, H]);
      }
    }
    // The mono masters were rebuilt byte-identical by the same importer run
    // (the manifest keeps their hashes): the snow pack's monos at the sha
    // 4.4 / 4.6b's runs recorded.
    expect(files[`${template}/u.png`].hash).toBe(template === "m15snow" ? "cd64fab932c0" : "d75371a57e0f");
  });
});

// --- the pixels (local build at the manifest's sha) ------------------------

type Raw = { data: Buffer; width: number; height: number };

function local(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!files[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === files[rel].sha256 ? bytes : null;
}

async function raw(bytes: Buffer): Promise<Raw> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function ccMask(name: string): Promise<Raw> {
  const file = path.join(CC, MASK(name));
  const { data, info } = await sharp(file).resize(W, H, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const NEEDED = ["m15snow/m.png", "m15snow/w.png", "m15snow/u.png", "m15snow/b.png", "m15snow/r.png", "m15snow/g.png", "m15snowland/c.png", "m15snowland/r.png", "m15snowland/w.png", ...TWO_COLOR_PAIRS.map((p) => `m15snow/${p}.png`), "m15snowland/rw.png", "m15snowland/ub.png"];
const available = NEEDED.every((rel) => local(rel) !== null) && fs.existsSync(path.join(CC, MASK("pinline")));

/** The horizontal segments of the Pinline mask that span most of the card
 *  (the title ring's two rows, the type bar's, the box's top and bottom):
 *  [first row, last row] of each. */
function segments(mask: Raw): Array<[number, number]> {
  const rows: number[] = [];
  for (let y = 0; y < H; y += 1) {
    let n = 0;
    for (let x = 0; x < W; x += 1) if (mask.data[(y * W + x) * 4 + 3] >= 250) n += 1;
    if (n > W * 0.6) rows.push(y);
  }
  const out: Array<[number, number]> = [];
  for (const y of rows) {
    const last = out.at(-1);
    if (last && y === last[1] + 1) last[1] = y;
    else out.push([y, y]);
  }
  return out;
}

describe.skipIf(!available)("the published snow pair masters' pixels (set FRAMES_BUILD_DIR if skipped)", () => {
  const snow = async (key: string) => raw(local(`m15snow/${key}.png`)!);
  const land = async (key: string) => raw(local(`m15snowland/${key}.png`)!);

  it("CC's Pinline mask has five full-width ring segments, where every ring row of the snow m and snow l frames lies — no ring row outside it (the #449 hairline's cause)", async () => {
    const pin = await ccMask("pinline");
    const segs = segments(pin);
    expect(segs).toEqual([[89, 102], [220, 236], [1166, 1184], [1301, 1313], [1939, 1948]]);
    for (const [base, colours] of [
      [await snow("m"), [await snow("w"), await snow("u"), await snow("g")]],
      [await land("c"), [await land("r"), await land("w")]],
    ] as Array<[Raw, Raw[]]>) {
      for (const [y0, y1] of segs) {
        for (let y = Math.max(0, y0 - 4); y <= Math.min(H - 1, y1 + 4); y += 1) {
          let covered = 0;
          let cols = 0;
          let diff = 0;
          for (let x = 150; x < 1350; x += 1) {
            const o = (y * W + x) * 4;
            cols += 1;
            if (pin.data[o + 3] >= 128) covered += 1;
            for (const c of colours) diff += Math.max(Math.abs(base.data[o] - c.data[o]), Math.abs(base.data[o + 1] - c.data[o + 1]), Math.abs(base.data[o + 2] - c.data[o + 2]));
          }
          const meanDiff = diff / (cols * colours.length);
          // A ring row: the base's pixels differ from the colours' by a lot
          // (their ring colours); it must be inside the mask.
          if (meanDiff > 40) expect(covered / cols, `row ${y}: ring row (Δ ${meanDiff.toFixed(0)}) outside the Pinline mask`).toBeGreaterThan(0.95);
        }
      }
    }
  }, 120_000);

  it.each(TWO_COLOR_PAIRS)("m15snow/%s: inside the Pinline mask it is the two colour masters lerped across 40→60 %W; no base pinline colour outside the mask around the rings", async (pair) => {
    const pin = await ccMask("pinline");
    const [P, M, A, B] = await Promise.all([snow(pair), snow("m"), snow(pair[0]), snow(pair[1])]);
    const segs = segments(pin);
    let checked = 0;
    const errors: number[] = [];
    for (const [y0, y1] of segs) {
      // The base's pinline colour on this segment (median inside the mask).
      const samples: number[][] = [];
      for (let y = y0; y <= y1; y += 1) for (let x = 0; x < W; x += 7) {
        const o = (y * W + x) * 4;
        if (pin.data[o + 3] >= 250) samples.push([M.data[o], M.data[o + 1], M.data[o + 2]]);
      }
      const med = [0, 1, 2].map((c) => samples.map((s) => s[c]).sort((p, q) => p - q)[samples.length >> 1]);
      for (let y = Math.max(0, y0 - 3); y <= Math.min(H - 1, y1 + 3); y += 1) {
        let stray = 0;
        for (let x = 0; x < W; x += 1) {
          const o = (y * W + x) * 4;
          const t = rampShare(((x + 0.5) / W) * 100, [...PAIR_RAMPS.pinline] as [number, number]);
          const lerp = [0, 1, 2].map((c) => A.data[o + c] * (1 - t) + B.data[o + c] * t);
          if (pin.data[o + 3] >= 250 && P.data[o + 3] > 0) {
            // Inside: the lerp — the master's was taken at 2010 × 2814 and
            // downscaled, so the ramp's edge pixels differ by a few levels
            // (judged below; a hairline is 100+ levels on a whole row).
            errors.push(Math.max(...[0, 1, 2].map((c) => Math.abs(P.data[o + c] - lerp[c]))));
            checked += 1;
          } else if (pin.data[o + 3] < 128 && P.data[o + 3] > 200) {
            // Outside: a pixel of the base's pinline colour that the colours'
            // lerp doesn't explain would be the hairline.
            const baseColour = [0, 1, 2].every((c) => Math.abs(P.data[o + c] - med[c]) <= 10);
            const explained = [0, 1, 2].every((c) => Math.abs(P.data[o + c] - lerp[c]) <= 24);
            if (baseColour && !explained) stray += 1;
          }
        }
        expect(stray, `${pair}: row ${y} holds ${stray} px of the base pinline colour outside the mask`).toBeLessThanOrEqual(2);
      }
    }
    expect(checked).toBeGreaterThan(50_000);
    errors.sort((p, q) => p - q);
    const mean = errors.reduce((t, v) => t + v, 0) / errors.length;
    expect(mean, `${pair}: mean |master − lerp| inside the mask`).toBeLessThanOrEqual(2);
    expect(errors[Math.floor(errors.length * 0.99)], `${pair}: 99th percentile`).toBeLessThanOrEqual(12);
    expect(errors.at(-1)!, `${pair}: worst pixel`).toBeLessThanOrEqual(40);
  }, 180_000);

  it("the bars are white — snow/w.png's bar warmed a quarter toward snow/m.png's — on the gold snow body; the box is the two colours' box lerped", async () => {
    const [P, M, Wm, A, B] = await Promise.all([snow("ub"), snow("m"), snow("w"), snow("u"), snow("b")]);
    const [title, type, rules, pin] = await Promise.all([ccMask("title"), ccMask("type"), ccMask("rules"), ccMask("pinline")]);
    const mean = (y0: number, y1: number, x0: number, x1: number, img: Raw, mask?: Raw) => {
      const sum = [0, 0, 0];
      let n = 0;
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
        const o = (y * W + x) * 4;
        if (mask && mask.data[o + 3] < 250) continue;
        if (pin.data[o + 3] > 0) continue;
        for (const c of [0, 1, 2]) sum[c] += img.data[o + c];
        n += 1;
      }
      return sum.map((v) => v / n);
    };
    // The title bar's interior (rows 110–200, x 200–1300) and the type bar's
    // (rows 1190–1290): w's bar + 0.25 × (m's bar − w's bar), ±2 levels.
    for (const [y0, y1, mask] of [[110, 200, title], [1190, 1290, type]] as Array<[number, number, Raw]>) {
      const got = mean(y0, y1, 200, 1300, P, mask);
      const w = mean(y0, y1, 200, 1300, Wm, mask);
      const m = mean(y0, y1, 200, 1300, M, mask);
      for (const c of [0, 1, 2]) expect(Math.abs(got[c] - (w[c] + SNOW_PAIR_BAR_GOLD_SHARE * (m[c] - w[c]))), `bar rows ${y0}–${y1} channel ${c}`).toBeLessThanOrEqual(2);
      // …and not the gold bar as it is (nor the plain white).
      expect(Math.abs(got[2] - m[2])).toBeGreaterThan(10);
    }
    // The frame body beside the text box (x 60–100, rows 1400–1800): the
    // gold body, not either colour's.
    const body = mean(1400, 1800, 60, 100, P);
    const gold = mean(1400, 1800, 60, 100, M);
    const blue = mean(1400, 1800, 60, 100, A);
    expect(Math.max(...body.map((v, c) => Math.abs(v - gold[c])))).toBeLessThanOrEqual(2);
    expect(Math.max(...body.map((v, c) => Math.abs(v - blue[c])))).toBeGreaterThan(20);
    // The text box: left of 45 %W u's box, right of 57 %W b's (rows 1400–1800).
    const left = mean(1400, 1800, 300, 600, P, rules);
    const leftU = mean(1400, 1800, 300, 600, A, rules);
    const right = mean(1400, 1800, 900, 1200, P, rules);
    const rightB = mean(1400, 1800, 900, 1200, B, rules);
    expect(Math.max(...left.map((v, c) => Math.abs(v - leftU[c])))).toBeLessThanOrEqual(2);
    expect(Math.max(...right.map((v, c) => Math.abs(v - rightB[c])))).toBeLessThanOrEqual(2);
  }, 120_000);

  it("a land pair keeps the snow land frame's bars and body, with its box and pinline in the two land tints", async () => {
    const [P, L, R, Wl] = await Promise.all([land("rw"), land("c"), land("r"), land("w")]);
    const [title, rules, pin] = await Promise.all([ccMask("title"), ccMask("rules"), ccMask("pinline")]);
    const mean = (y0: number, y1: number, x0: number, x1: number, img: Raw, mask?: Raw) => {
      const sum = [0, 0, 0];
      let n = 0;
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
        const o = (y * W + x) * 4;
        if (mask && mask.data[o + 3] < 250) continue;
        if (pin.data[o + 3] > 0) continue;
        for (const c of [0, 1, 2]) sum[c] += img.data[o + c];
        n += 1;
      }
      return sum.map((v) => v / n);
    };
    const bar = mean(110, 200, 200, 1300, P, title);
    const barL = mean(110, 200, 200, 1300, L, title);
    expect(Math.max(...bar.map((v, c) => Math.abs(v - barL[c])))).toBeLessThanOrEqual(1);
    const body = mean(1400, 1800, 60, 100, P);
    const bodyL = mean(1400, 1800, 60, 100, L);
    expect(Math.max(...body.map((v, c) => Math.abs(v - bodyL[c])))).toBeLessThanOrEqual(1);
    const left = mean(1400, 1800, 300, 600, P, rules);
    const leftR = mean(1400, 1800, 300, 600, R, rules);
    const right = mean(1400, 1800, 900, 1200, P, rules);
    const rightW = mean(1400, 1800, 900, 1200, Wl, rules);
    expect(Math.max(...left.map((v, c) => Math.abs(v - leftR[c])))).toBeLessThanOrEqual(2);
    expect(Math.max(...right.map((v, c) => Math.abs(v - rightW[c])))).toBeLessThanOrEqual(2);
  }, 120_000);
});
