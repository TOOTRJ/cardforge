import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ART_WINDOW_KNOWN_FAILURES,
  ART_WINDOW_OVERSCAN_PCT,
  SEE_THROUGH_FRAME_ALPHA_MAX,
  artWindowSlotsOf,
  artWindowViolations,
  isKnownArtWindowFailure,
  seeThroughBody,
  seeThroughWindow,
  slotPixelBox,
  type ArtWindowSlot,
} from "@/lib/frames/art-window";
import { applyCardCornerMask } from "@/lib/cards/card-corner";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { FRAME_MASTER_KEYS } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile, underFrameArtRect } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 7.6 — art-window coverage, for every template × colour master: the
// see-through window (α < 16, flood-filled from each art slot's centre) is
// covered by the (rotated) slot that paints the art there, with ≥ 0.05 % of
// the card to spare; on a see-through master (4.17) the under-frame art
// covers the window and the see-through body. lib/frames/art-window.ts
// holds the check and today's known failures; the Card Conjurer importer
// runs the same check on every master it builds (scripts/import-cc-frames.mjs).
//
// Git masters (public/frames) are checked everywhere. Bucket masters (the
// Card Conjurer family, never in git) are checked where a copy at the
// manifest's sha256 is on disk: FRAMES_BUILD_DIR, else <repo>/.frames-build.
// CI fetches every one from production's public bucket
// (scripts/frames-fetch.mjs) and sets FRAMES_BUILD_DIR, and there a missing
// bucket master FAILS instead of skipping. Known failures are it.fails, so
// fixing one turns this red until it is struck from the table.
// ---------------------------------------------------------------------------

const manifest = manifestJson as { files: Record<string, { sha256: string }> };
const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, "public", "frames");
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(ROOT, ".frames-build");
/** CI, with the fetched masters: a bucket master that isn't there is a failure. */
const STRICT = Boolean(process.env.CI && process.env.FRAMES_BUILD_DIR);

type Master = { template: string; key: string; file: string; bucket: boolean };

/** Every master of `template`: git ones from public/frames, bucket ones from
 *  BUILD when their bytes are the manifest's. `missing` lists the bucket
 *  masters the manifest has and BUILD doesn't (at that sha). */
function mastersOf(template: string): { masters: Master[]; missing: string[] } {
  const masters: Master[] = [];
  const missing: string[] = [];
  for (const key of FRAME_MASTER_KEYS) {
    const rel = `${template}/${key}.png`;
    const entry = manifest.files[rel];
    if (entry) {
      const file = path.join(BUILD, rel);
      const ok = fs.existsSync(file) && createHash("sha256").update(fs.readFileSync(file)).digest("hex") === entry.sha256;
      if (ok) masters.push({ template, key, file, bucket: true });
      else missing.push(rel);
      continue;
    }
    const file = path.join(PUBLIC, rel);
    if (fs.existsSync(file)) masters.push({ template, key, file, bucket: false });
  }
  return { masters, missing };
}

async function rgbaOf(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** The slots the renderers paint for this master (the check's input). */
function slotsFor(template: string, key: string): ArtWindowSlot[] {
  const profile = getFrameProfile(template);
  return artWindowSlotsOf(profile, underFrameArtRect(profile, key));
}

// ---------------------------------------------------------------------------
// The check itself, on synthetic masters (300 × 420: the overscan is
// 0.15 px across, 0.21 px down).
// ---------------------------------------------------------------------------
describe("artWindowViolations", () => {
  const W = 300;
  const H = 420;
  /** An opaque master with a clear rectangle x0..x1 × y0..y1 (exclusive). */
  const withWindow = (x0: number, x1: number, y0: number, y1: number, clear = 0) => {
    const buf = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) buf[(y * W + x) * 4 + 3] = x >= x0 && x < x1 && y >= y0 && y < y1 ? clear : 255;
    }
    return buf;
  };
  /** A slot in card percent from px bounds. */
  const pct = (x0: number, x1: number, y0: number, y1: number) => ({
    leftPct: (x0 / W) * 100,
    widthPct: ((x1 - x0) / W) * 100,
    topPct: (y0 / H) * 100,
    heightPct: ((y1 - y0) / H) * 100,
  });
  const slot = (x0: number, x1: number, y0: number, y1: number): ArtWindowSlot[] => [
    { name: "artSlot", rect: pct(x0, x1, y0, y1) },
  ];

  it("passes a slot that overscans the window by a pixel", () => {
    const m = withWindow(30, 270, 50, 200);
    expect(artWindowViolations(m, W, H, slot(29, 271, 49, 201))).toEqual([]);
  });

  it("fails a one-pixel hairline on the side it is on — the M15 family's (4.4 (2))", () => {
    const m = withWindow(30, 270, 50, 200);
    expect(artWindowViolations(m, W, H, slot(31, 271, 49, 201))).toEqual([expect.stringMatching(/^artSlot: the slot .* doesn't cover the window 30–270 × 50–200 px .*: left 31 > 29\.85$/)]);
    const v = artWindowViolations(m, W, H, slot(29, 271, 49, 199));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/: bottom 199 < 200\.21$/);
  });

  it(`asks for ≥ ${ART_WINDOW_OVERSCAN_PCT} % to spare: a slot flush with the window fails (m15tokenartifact's bottom)`, () => {
    const m = withWindow(30, 270, 50, 200);
    const v = artWindowViolations(m, W, H, slot(30, 270, 50, 200));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/left 30 > 29\.85, right 270 < 270\.15, top 50 > 49\.79, bottom 200 < 200\.21$/);
    // 0.1 px short of the overscan still fails (extendedart/m, m15fullartland).
    expect(artWindowViolations(m, W, H, slot(29.9, 271, 49, 201))).toEqual([expect.stringMatching(/left 29\.9 > 29\.85$/)]);
    expect(artWindowViolations(m, W, H, slot(29.85, 271, 49, 201))).toEqual([]);
  });

  it("counts every pixel α < 16 as the window, 4-connected — α 15 joins, α 16 and a diagonal don't", () => {
    const m = withWindow(30, 270, 50, 200);
    const set = (x: number, y: number, a: number) => (m[(y * W + x) * 4 + 3] = a);
    set(150, 49, 15); // joins above the top edge
    set(150, 48, 16); // doesn't
    set(29, 49, 0); // touches the window's corner only diagonally
    expect(seeThroughWindow(m, W, H, 150, 100)).toEqual({ x0: 30, x1: 270, y0: 49, y1: 200, pixels: 240 * 150 + 1 });
    expect(artWindowViolations(m, W, H, slot(29, 271, 49, 201))).toEqual([expect.stringMatching(/: top 49 > 48\.79$/)]);
    expect(seeThroughWindow(m, W, H, 150, 48)).toBeNull();
  });

  it("reports a slot whose centre the frame paints over", () => {
    const m = withWindow(30, 100, 50, 200);
    expect(artWindowViolations(m, W, H, slot(200, 280, 50, 200))).toEqual([
      "artSlot: the frame is α 255 at the slot's centre (240,125) — no see-through window there",
    ]);
  });

  it("lets a window that runs off the card's edge be covered by a slot that reaches it (edge-to-edge art, 7.7's business)", () => {
    const m = withWindow(0, W, 0, 380);
    expect(artWindowViolations(m, W, H, slot(0, W, 0, 381))).toEqual([]);
    // An inset slot over a window that leaks into a transparent ring: the
    // ring shows #101015 (battle, lotrscroll, bloomanime…).
    expect(artWindowViolations(m, W, H, slot(8, 292, 8, 381))).toEqual([expect.stringMatching(/left 8 > 0, right 292 < 300, top 8 > 0$/)]);
  });

  it("rotates a second face's slot in place: aftermath's wide pre-rotation box covers a tall window at 90°", () => {
    // A tall window 60 wide × 200 high, centred at (200, 250).
    const m = withWindow(170, 230, 150, 350);
    // The pre-rotation box is 202 px wide, 62 px high in CARD pixels,
    // centred on the window — the renderers turn it 90° about its centre.
    const wide = { name: "secondFace.artSlot", rect: pct(99, 301, 219, 281), rotation: 90 as const };
    const turned = slotPixelBox(wide.rect, 90, W, H);
    for (const [k, v] of Object.entries({ x0: 169, x1: 231, y0: 149, y1: 351 })) expect(turned[k as keyof typeof turned], k).toBeCloseTo(v, 9);
    expect(artWindowViolations(m, W, H, [wide])).toEqual([]);
    // Unrotated, the same box misses the window's top and bottom.
    expect(artWindowViolations(m, W, H, [{ ...wide, rotation: 0 }])).toEqual([expect.stringMatching(/^secondFace\.artSlot: .*top 219 > 149\.79, bottom 281 < 350\.21$/)]);
    // 180° (flip) and 270° turn the box onto itself / the same swap.
    expect(slotPixelBox(wide.rect, 180, W, H)).toEqual(slotPixelBox(wide.rect, 0, W, H));
    expect(slotPixelBox(wide.rect, 270, W, H)).toEqual(turned);
  });

  it("checks both of split's windows (artSlot and secondFace.artSlot)", () => {
    const m = withWindow(20, 140, 60, 200);
    for (let y = 60; y < 200; y += 1) for (let x = 160; x < 280; x += 1) m[(y * W + x) * 4 + 3] = 0;
    const profile = { artSlot: pct(19, 141, 59, 201), secondFace: { rotation: 0 as const, artSlot: pct(159, 281, 70, 201) } };
    expect(artWindowViolations(m, W, H, artWindowSlotsOf(profile, null))).toEqual([expect.stringMatching(/^secondFace\.artSlot: .*: top 70 > 59\.79$/)]);
  });
});

describe("see-through masters (4.17): the under-frame art covers the window and the see-through body", () => {
  const W = 1500;
  const H = 2100;
  const under = { topPct: 4, leftPct: 4, widthPct: 92, heightPct: 92 }; // 60–1440 × 84–2016
  const artSlot = { topPct: 11.4, leftPct: 7.8, widthPct: 84.4, heightPct: 44.0 }; // 117–1383 × 239.4–1163.4
  /** An opaque black card, the card corner cut, a clear window 116–1384 ×
   *  238–1165 (the M15 window: 1 px outside the art slot) and a see-through
   *  body (α 26) 62–1438 × `bodyTop`–1938 inside the border. */
  const master = (bodyTop: number) => {
    const buf = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const window = x >= 116 && x < 1384 && y >= 238 && y < 1165;
        const body = x >= 62 && x < 1438 && y >= bodyTop && y < 1938;
        buf[(y * W + x) * 4 + 3] = window ? 0 : body ? 26 : 255;
      }
    }
    applyCardCornerMask(buf, W, H);
    return buf;
  };
  const slots = (u: typeof under | null) => artWindowSlotsOf({ artSlot }, u);

  it("passes when the body lies inside the under-frame rect — the art slot's own 1 px hairline is hidden under the art", () => {
    expect(artWindowViolations(master(90), W, H, slots(under))).toEqual([]);
    // Without the under-frame art the same master fails on the hairline.
    expect(artWindowViolations(master(90), W, H, slots(null))).toEqual([expect.stringMatching(/^artSlot: the slot /)]);
  });

  it("fails the 25 px band CC's see-through body leaves above the under-frame rect (4.17a)", () => {
    const v = artWindowViolations(master(59), W, H, slots(under));
    expect(v).toEqual([
      expect.stringMatching(
        new RegExp(`^artSlot: the under-frame art 60–1440 × 84–2016 px doesn't cover the see-through frame 62–1438 × 59–1938 px \\(\\d+ px, α < ${SEE_THROUGH_FRAME_ALPHA_MAX}\\) .*: top 84 > 57\\.95$`),
      ),
    ]);
  });

  it("never counts the card corner's cut as see-through body", () => {
    const m = master(90);
    expect(m[3]).toBe(0); // the corner pixel is cut away
    expect(seeThroughBody(m, W, H)).toMatchObject({ x0: 62, x1: 1438, y0: 90, y1: 1938 });
    // …but a hole in the border beside the corner is.
    m[(10 * W + 700) * 4 + 3] = 100;
    expect(seeThroughBody(m, W, H)).toMatchObject({ y0: 10 });
  });
});

// ---------------------------------------------------------------------------
// The known-failure table.
// ---------------------------------------------------------------------------
describe("the art-window known failures", () => {
  const todo = fs.readFileSync(path.join(ROOT, "TODO.md"), "utf8");

  it("name real templates and master keys, each with a why and a TODO item that exists", () => {
    const unknownItems: string[] = [];
    for (const [template, entry] of Object.entries(ART_WINDOW_KNOWN_FAILURES)) {
      expect(FRAME_TEMPLATE_VALUES as readonly string[], template).toContain(template);
      if (entry.keys !== "all") {
        expect(entry.keys.length, template).toBeGreaterThan(0);
        for (const key of entry.keys) expect(FRAME_MASTER_KEYS as readonly string[], `${template}/${key}`).toContain(key);
      }
      expect(entry.why.length, template).toBeGreaterThan(20);
      expect(entry.todo.length, template).toBeGreaterThan(0);
      for (const id of entry.todo) if (!todo.includes(`**${id} [P`)) unknownItems.push(`${template} → ${id}`);
    }
    expect(unknownItems, "TODO.md has no such item").toEqual([]);
  });

  it("lists today's failures — the TODO's list, and what checking every colour of every master found", () => {
    expect(Object.keys(ART_WINDOW_KNOWN_FAILURES).sort()).toEqual(
      [
        // 7.6's list (2026-09-25): split, lotr, flip, battle, lotrscroll, the
        // saga hairline and the M15 family's (then MSE, now CC) windows.
        "split",
        "lotr",
        "flip",
        "battle",
        "lotrscroll",
        "saga",
        "m15",
        "m15artifact",
        "m15land",
        "m15snow",
        "m15snowland",
        // Found on 2026-09-29.
        "adventure",
        "aftermath",
        "alphatoken",
        "avatar",
        "bloomanime",
        "bloomburrow",
        "expeditionland",
        "extendedart",
        "m15devoid",
        "m15fullartland",
        "m15textless",
        "m15textlessland",
        "m15token",
        "m15tokenartifact",
        "m15tokentext",
        "modern",
        "modernland",
        "tarkirdraconic",
        "tarkirghostfire",
      ].sort(),
    );
    // Two of the TODO's list pass today: alphaland (its window was re-cut
    // with Phase B) and m15token's coloured masters (4.49's re-cut).
    expect(ART_WINDOW_KNOWN_FAILURES.alphaland).toBeUndefined();
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(isKnownArtWindowFailure("m15token", key), key).toBe(false);
    expect(isKnownArtWindowFailure("m15token", "c")).toBe(true);
    expect(isKnownArtWindowFailure("expeditionland", "w")).toBe(false);
    expect(isKnownArtWindowFailure("expeditionland", "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The importer runs the same check, with the same slots.
// ---------------------------------------------------------------------------
describe("the Card Conjurer importer runs the art-window check (TODO 7.6)", () => {
  const importer = fs.readFileSync(path.join(ROOT, "scripts/import-cc-frames.mjs"), "utf8");

  it("checks every master it builds after the downscale and the corner cut, skipping only known failures", () => {
    const cut = importer.indexOf("roundCornersRgba8(master");
    const check = importer.indexOf("artWindowViolations(master, OUT_W, OUT_H");
    expect(cut).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(cut);
    expect(importer).toContain("isKnownArtWindowFailure(template, key)");
    expect(importer).toContain("artWindowSlotsOf(profile, underFrameArtRect(profile, key))");
  });

  it("reads the frame profiles through the \"@/\" alias hook exactly as vitest does", () => {
    const templates = [...FRAME_TEMPLATE_VALUES];
    const script = [
      'import "./scripts/lib/ts-alias-hooks.mjs";',
      'const { getFrameProfile, underFrameArtRect } = await import("./lib/cards/template-layout.ts");',
      'const { artWindowSlotsOf } = await import("./lib/frames/art-window.ts");',
      "const out = {};",
      'for (const t of JSON.parse(process.argv[1])) { const p = getFrameProfile(t); out[t] = ["w", "c"].map((k) => artWindowSlotsOf(p, underFrameArtRect(p, k))); }',
      "console.log(JSON.stringify(out));",
    ].join("\n");
    const stdout = execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script, JSON.stringify(templates)], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const expected = Object.fromEntries(templates.map((t) => [t, ["w", "c"].map((k) => slotsFor(t, k))]));
    expect(JSON.parse(stdout)).toEqual(JSON.parse(JSON.stringify(expected)));
  });
});

// ---------------------------------------------------------------------------
// CI runs this on the bucket masters instead of skipping them.
// ---------------------------------------------------------------------------
describe("CI fetches the bucket masters", () => {
  it("restores, fetches (sha256-checked) and points FRAMES_BUILD_DIR at them before the unit tests", () => {
    const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const fetch = ci.indexOf("node scripts/frames-fetch.mjs --out .frames-cache");
    const unit = ci.indexOf("run: npm run test:coverage");
    expect(fetch).toBeGreaterThan(0);
    expect(unit).toBeGreaterThan(fetch);
    expect(ci.slice(unit, unit + 200)).toMatch(/FRAMES_BUILD_DIR: \.frames-cache/);
    expect(ci).toContain("key: frames-${{ hashFiles('lib/frames/frame-manifest.json') }}");
  });

  it("never commits the fetched frames", () => {
    expect(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8")).toMatch(/^\/\.frames-cache\/$/m);
    const tracked = execFileSync("git", ["ls-files", "--", ".frames-cache"], { cwd: ROOT, encoding: "utf8" }).trim();
    expect(tracked).toBe("");
  });

  if (STRICT) {
    it("has every bucket master at the manifest's sha256 (FRAMES_BUILD_DIR)", () => {
      const missing = FRAME_TEMPLATE_VALUES.flatMap((t) => mastersOf(t).missing);
      expect(missing, `run node scripts/frames-fetch.mjs --out ${BUILD}`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// Every template × colour master.
// ---------------------------------------------------------------------------
describe("every frame master's art window is covered by the art that fills it", () => {
  const bucketTemplates = new Set(Object.keys(manifest.files).map((k) => k.split("/")[0]));
  for (const template of FRAME_TEMPLATE_VALUES) {
    const { masters, missing } = mastersOf(template);
    if (missing.length && !STRICT) {
      // A bucket template without a local copy: CI fetches it; locally run
      // `node scripts/frames-fetch.mjs` and set FRAMES_BUILD_DIR=.frames-cache.
      it.skip(`${template}: ${missing.length} bucket master(s) not available here (set FRAMES_BUILD_DIR)`, () => {});
    }
    if (!bucketTemplates.has(template)) {
      it(`${template}: every colour master is checked (git)`, () => {
        // The expeditionland b/g lesson (2026-09-26): never sample one colour.
        expect(masters.length).toBeGreaterThanOrEqual(7);
      });
    }
    for (const m of masters) {
      const known = isKnownArtWindowFailure(template, m.key);
      const run = known ? it.fails : it;
      const todo = known ? ` — known failure (TODO ${ART_WINDOW_KNOWN_FAILURES[template].todo.join(", ")})` : "";
      run(`${template}/${m.key}${m.bucket ? " (bucket)" : ""}${todo}`, async () => {
        const { data, width, height } = await rgbaOf(m.file);
        expect([width, height]).toEqual(getFrameProfile(template).orientation === "landscape" ? [2100, 1500] : [1500, 2100]);
        expect(artWindowViolations(data, width, height, slotsFor(template, m.key))).toEqual([]);
      });
    }
  }
});
