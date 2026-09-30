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
  TRANSLUCENT_RIM_PCT,
  artWindowFindings,
  artWindowSlotsOf,
  artWindowVerdict,
  artWindowViolations,
  isKnownArtWindowFailure,
  seeThroughBody,
  seeThroughWindow,
  slotPixelBox,
  slotSeams,
  translucentRegionsUnder,
  type ArtWindowSlot,
} from "@/lib/frames/art-window";
import { applyCardCornerMask } from "@/lib/cards/card-corner";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { FRAME_MASTER_KEYS } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile, underFrameArtRect, underFrameArtSlot } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 7.6 — art-window coverage, for every template × colour master: the
// see-through window (α < 16, flood-filled from each art slot's centre) is
// covered by the (rotated) slot that paints the art there, with ≥ 0.05 % of
// the card to spare, and every translucent frame part (α < 250) the art
// shows through stays inside it (0.2 % rim); on a see-through master (4.17)
// the under-frame art covers the window and the see-through body, the slot
// covers the window too, and the two meet on the frame's opaque outline (or
// are one picture — layout v35).
// lib/frames/art-window.ts holds the check and today's known failures; the
// Card Conjurer importer runs the same check on every master it builds
// (scripts/import-cc-frames.mjs).
//
// Git masters (public/frames) are checked everywhere. Bucket masters (the
// Card Conjurer family, never in git) are checked where a copy at the
// manifest's sha256 is on disk: FRAMES_BUILD_DIR, else <repo>/.frames-build.
// CI fetches every one from production's public bucket
// (scripts/frames-fetch.mjs) and sets FRAMES_BUILD_DIR, and there a missing
// bucket master FAILS instead of skipping. A known failure must STILL fail,
// by no more than its entry's maxMissPx: fixing one turns this red until it
// is struck from the table, and so does a master getting worse behind it.
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
  return artWindowSlotsOf(profile, underFrameArtRect(profile, key), underFrameArtSlot(profile, key));
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
    expect(artWindowViolations(m, W, H, slot(29, 271, 49, 201))).toEqual([
      expect.stringMatching(/: top 49 > 48\.79$/),
      // The α 16 pixel above it isn't window — but it is translucent, 1 px
      // past the slot and the window, over this small card's 0.84 px rim.
      expect.stringMatching(/^artSlot: a translucent part of the frame 30–270 × 48–200 px .*: top 1 px$/),
    ]);
    expect(seeThroughWindow(m, W, H, 150, 48)).toBeNull();
  });

  it("fills a winding window exactly — every run of a serpentine, nothing past a diagonal", () => {
    // A serpentine: rows 100, 104, …, 196 clear from x 40 to 259, joined
    // alternately at the right (x 259) and the left (x 40) by 3-px uprights.
    const m = withWindow(0, 0, 0, 0);
    let clear = 0;
    const open = (x: number, y: number) => {
      if (m[(y * W + x) * 4 + 3] !== 0) clear += 1;
      m[(y * W + x) * 4 + 3] = 0;
    };
    for (let row = 0; row <= 24; row += 1) {
      const y = 100 + row * 4;
      for (let x = 40; x < 260; x += 1) open(x, y);
      if (row < 24) for (let dy = 1; dy <= 3; dy += 1) open(row % 2 ? 40 : 259, y + dy);
    }
    m[(197 * W + 261) * 4 + 3] = 0; // touches the last row's end only diagonally
    expect(seeThroughWindow(m, W, H, 40, 100)).toEqual({ x0: 40, x1: 260, y0: 100, y1: 197, pixels: clear });
    expect(seeThroughWindow(m, W, H, 150, 196)).toEqual({ x0: 40, x1: 260, y0: 100, y1: 197, pixels: clear });
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

describe("translucent frame parts: the art that shows through one must fill all of it", () => {
  const W = 300;
  const H = 420;
  /** An opaque master, a clear window 30–270 × 50–240 and a translucent
   *  (α 135) text box 40–260 × `boxTop`–`boxBottom`. */
  const master = (boxTop: number, boxBottom: number) => {
    const buf = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const win = x >= 30 && x < 270 && y >= 50 && y < 240;
        const box = x >= 40 && x < 260 && y >= boxTop && y < boxBottom;
        buf[(y * W + x) * 4 + 3] = win ? 0 : box ? 135 : 255;
      }
    }
    return buf;
  };
  const slot = (y1: number): ArtWindowSlot[] => [
    { name: "artSlot", rect: { leftPct: (29 / W) * 100, widthPct: (242 / W) * 100, topPct: (49 / H) * 100, heightPct: ((y1 - 49) / H) * 100 } },
  ];

  it("fails a text box the slot ends inside — nyx's seam at 81.2 % (4.17b)", () => {
    const f = artWindowFindings(master(250, 380), W, H, slot(300));
    expect(f).toEqual([
      {
        message: expect.stringMatching(/^artSlot: a translucent part of the frame 40–260 × 250–380 px \(28600 px, α < 250\) runs past the slot .*: bottom 80 px$/),
        missPx: 80,
      },
    ]);
  });

  it(`lets the region run past the slot by its anti-aliased rim (≤ ${TRANSLUCENT_RIM_PCT} % of the card)`, () => {
    // 0.2 % of 420 = 0.84 px down: a box ending 0.8 px past the slot passes, 1 px fails.
    expect(artWindowViolations(master(250, 380), W, H, slot(379.2))).toEqual([]);
    expect(artWindowViolations(master(250, 380), W, H, slot(379))).toEqual([expect.stringMatching(/: bottom 1 px$/)]);
    // A slot that fills the whole box passes.
    expect(artWindowViolations(master(250, 380), W, H, slot(381))).toEqual([]);
  });

  it("leaves a translucent part the art never reaches to the frame (it shows #101015 evenly — 7.7's rings)", () => {
    expect(translucentRegionsUnder(master(250, 380), W, H, slotPixelBox(slot(241)[0].rect, 0, W, H)).map((r) => r.y0)).toEqual([50]);
    expect(artWindowViolations(master(250, 380), W, H, slot(241))).toEqual([]);
  });

  it("counts a pixel as under the slot by its centre, and leaves the corner cut out", () => {
    // The slot ends at 250.4: row 250's centre (250.5) is outside it.
    expect(artWindowViolations(master(250, 380), W, H, slot(250.4))).toEqual([]);
    expect(artWindowViolations(master(250, 380), W, H, slot(250.6))).toHaveLength(1);
    const m = master(250, 380);
    applyCardCornerMask(m, W, H);
    const full = { leftPct: 0, widthPct: 100, topPct: 0, heightPct: 100 };
    const regions = translucentRegionsUnder(m, W, H, slotPixelBox(full, 0, W, H));
    expect(regions.map((r) => [r.y0, r.y1])).toEqual([[50, 240], [250, 380]]);
    // A seed's region comes first, marked.
    const seeded = translucentRegionsUnder(m, W, H, slotPixelBox(full, 0, W, H), SEE_THROUGH_FRAME_ALPHA_MAX, { x: 100, y: 300 });
    expect(seeded.map((r) => [r.y0, r.seeded])).toEqual([[250, true], [50, false]]);
  });
});

describe("artWindowVerdict: the known-failure table", () => {
  const miss = (missPx: number) => [{ message: "artSlot: …", missPx }];

  it("fails every finding of a master the table doesn't list", () => {
    expect(artWindowVerdict("retro", "w", miss(0.2))).toEqual({ fails: ["artSlot: …"], fixed: false });
    expect(artWindowVerdict("retro", "w", [])).toEqual({ fails: [], fixed: false });
  });

  it("passes a listed master within its maxMissPx, and fails one that got worse", () => {
    expect(artWindowVerdict("modern", "w", miss(1.65))).toEqual({ fails: [], fixed: false });
    expect(artWindowVerdict("modern", "w", miss(2.5)).fails).toEqual([expect.stringMatching(/^worse than its known failure \(4\.10\): misses by 2\.5 px > 2: /)]);
    // Per-key bounds: expeditionland b/g's missing ring, u/r's 2.5 px apex.
    expect(artWindowVerdict("expeditionland", "b", miss(300)).fails).toEqual([]);
    expect(artWindowVerdict("expeditionland", "u", miss(300)).fails).toHaveLength(1);
  });

  it("marks a listed master with nothing left to find as fixed", () => {
    expect(artWindowVerdict("modern", "w", [])).toEqual({ fails: [], fixed: true });
  });
});

// 1500 × 2100 synthetic masters: generous timeouts for CI's V8 coverage.
describe("see-through masters (4.17): the under-frame art covers the window and the see-through body", { timeout: 20_000 }, () => {
  const W = 1500;
  const H = 2100;
  const under = { topPct: 4, leftPct: 4, widthPct: 92, heightPct: 92 }; // 60–1440 × 84–2016
  const artSlot = { topPct: 11.25, leftPct: 7.67, widthPct: 84.76, heightPct: 44.33 }; // 115.05–1386.45 × 236.25–1167.18
  /** An opaque black card, the card corner cut, a clear window 116–1384 ×
   *  238–1165 (the CC M15 window) inside m15/c's opaque outline 98–1402 ×
   *  220–1185, and a see-through body (α 26) 62–1438 × `bodyTop`–1938
   *  around it. */
  const master = (bodyTop: number) => {
    const buf = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const window = x >= 116 && x < 1384 && y >= 238 && y < 1165;
        const outline = x >= 98 && x < 1402 && y >= 220 && y < 1185;
        const body = x >= 62 && x < 1438 && y >= bodyTop && y < 1938;
        buf[(y * W + x) * 4 + 3] = window ? 0 : outline ? 255 : body ? 26 : 255;
      }
    }
    applyCardCornerMask(buf, W, H);
    return buf;
  };
  const slots = (u: typeof under | null, slot = artSlot) => artWindowSlotsOf({ artSlot: slot }, u);

  it("passes when the body lies inside the under-frame rect and the slot covers the window, meeting it on the outline", () => {
    expect(artWindowViolations(master(90), W, H, slots(under))).toEqual([]);
    // Without the under-frame art the outline keeps the body out of the
    // slot's translucent regions: it would show #101015 evenly (a ring, 7.7's
    // business) — which is why a see-through master declares underFrameArt.
    expect(artWindowViolations(master(90), W, H, slots(null))).toEqual([]);
  });

  it("fails the 25 px band CC's see-through body leaves above the under-frame rect (4.17a)", () => {
    const v = artWindowViolations(master(59), W, H, slots(under));
    expect(v).toEqual([
      expect.stringMatching(
        new RegExp(`^artSlot: the under-frame art 60–1440 × 84–2016 px doesn't cover the see-through frame 62–1438 × 59–1938 px \\(\\d+ px, α < ${SEE_THROUGH_FRAME_ALPHA_MAX}\\) .*: top 84 > 57\\.95$`),
      ),
    ]);
  });

  it("holds the slot to the window too: the MSE slot's 1–1.6 px hairline shows the under-frame crop, a seam (layout v35)", () => {
    // v24–v34 judged a see-through master by its under-frame art alone, so
    // this slot passed while its hairline showed the other crop of the art.
    const mse = { topPct: 11.4, leftPct: 7.8, widthPct: 84.4, heightPct: 44.0 }; // 117–1383 × 239.4–1163.4
    expect(artWindowFindings(master(90), W, H, slots(under, mse))).toEqual([
      {
        message: expect.stringMatching(
          /^artSlot: the slot 117–1383 × 239\.4–1163\.4 px doesn't cover the window 116–1384 × 238–1165 px .* — a see-through master's window shows the slot's crop, the under-frame art's only beside it: left 117 > 115\.25, right 1383 < 1384\.75, top 239\.4 > 236\.95, bottom 1163\.4 < 1166\.05$/,
        ),
        missPx: expect.closeTo(2.65, 6),
      },
      // Its first pixels outside are the window's own clear pixels.
      {
        message: expect.stringMatching(/^artSlot: the slot .* meets the under-frame art where the frame lets it through .*: left \(column 116\) 924 of 924 px, right \(column 1383\) 924 of 924 px, top \(row 238\) 1266 of 1266 px, bottom \(row 1163\) 1266 of 1266 px$/),
        missPx: 1266,
      },
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

// The see-through slot rules (layout v35 — the correction round's review): on
// a see-through master the window keeps the slot's own crop and the
// under-frame art is cropped separately, so (1) the slot must cover the
// window with the overscan — an m15devoid artSlot override moved inside the
// window passed the gate while the window showed two crops of the art — and
// (2) the two must meet on the frame's OPAQUE outline, or the picture jumps
// where the frame shows it (m15pw/c's slot ended in its translucent silver).
describe("see-through masters: the slot covers the window and meets the under-frame art on the opaque outline", { timeout: 20_000 }, () => {
  const W = 1500;
  const H = 2100;
  const under = { topPct: 2.7, leftPct: 3.7, widthPct: 92.6, heightPct: 93.3 };
  const cc = { topPct: 11.25, leftPct: 7.67, widthPct: 84.76, heightPct: 44.33 };
  /** m15/c as measured (2026-09-29, every see-through CC M15 master): the
   *  window 116–1384 × 238–1165 inside an opaque outline 98–1402 × 220–1185
   *  (cols 98–114 / 1385–1401, rows 220–236 / 1166–1184), the see-through
   *  body (α 26) 58–1443 × 59–1938 round it. `outline: false` = the
   *  walker's case, translucent right up to the window. */
  const master = (outline = true) => {
    const buf = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const window = x >= 116 && x < 1384 && y >= 238 && y < 1165;
        const ring = outline && x >= 98 && x < 1402 && y >= 220 && y < 1185;
        const body = x >= 58 && x < 1443 && y >= 59 && y < 1938;
        buf[(y * W + x) * 4 + 3] = window ? 0 : ring ? 255 : body ? 26 : 255;
      }
    }
    applyCardCornerMask(buf, W, H);
    return buf;
  };
  const m = master();

  it("passes the CC M15 slot on m15/c's outline, and one picture anywhere", () => {
    expect(artWindowViolations(m, W, H, artWindowSlotsOf({ artSlot: cc }, under))).toEqual([]);
    // Its first pixels outside, all round, are the outline's.
    expect(slotSeams(m, W, H, slotPixelBox(cc, 0, W, H))).toEqual([
      { side: "left", at: 114, pixels: 931, seam: 0 },
      { side: "right", at: 1386, pixels: 931, seam: 0 },
      { side: "top", at: 235, pixels: 1271, seam: 0 },
      { side: "bottom", at: 1167, pixels: 1271, seam: 0 },
    ]);
    // A slot that IS the under-frame rect is one picture: nothing meets.
    const flat = master(false);
    expect(artWindowViolations(flat, W, H, artWindowSlotsOf({ artSlot: cc }, under, under))).toEqual([]);
  });

  it("fails a slot that ends in the translucent body — m15pw/c's seam (and the colourless tokens', 4.17c)", () => {
    // 3 px wider and taller than the outline on each side: its edges lie
    // in the α 26 body.
    const wide = { topPct: (216 / H) * 100, leftPct: (94 / W) * 100, widthPct: (1312 / W) * 100, heightPct: (973 / H) * 100 };
    const f = artWindowFindings(m, W, H, artWindowSlotsOf({ artSlot: wide }, under));
    expect(f).toEqual([
      {
        message: expect.stringMatching(
          /^artSlot: the slot 94–1406 × 216–1189 px meets the under-frame art where the frame lets it through \(α < 250\) — a seam .*: left \(column 93\) 973 of 973 px, right \(column 1406\) 973 of 973 px, top \(row 215\) 1312 of 1312 px, bottom \(row 1189\) 1312 of 1312 px$/,
        ),
        missPx: 1312,
      },
    ]);
    // With no outline at all (m15pw/c), even the CC slot seams: the walker
    // draws ONE picture instead.
    expect(artWindowViolations(master(false), W, H, artWindowSlotsOf({ artSlot: cc }, under))).toEqual([expect.stringMatching(/meets the under-frame art/)]);
  });

  it("fails a slot moved inside the window — the save gate's m15devoid hole (the window showed two crops)", () => {
    for (const slot of [
      { ...cc, topPct: 20, heightPct: 20 },
      { ...cc, leftPct: 9, widthPct: 83 },
    ]) {
      const f = artWindowFindings(m, W, H, artWindowSlotsOf({ artSlot: slot }, under));
      expect(f.map((x) => x.message), JSON.stringify(slot)).toEqual([
        expect.stringMatching(/^artSlot: the slot .* doesn't cover the window 116–1384 × 238–1165 px .*a see-through master's window shows the slot's crop/),
        expect.stringMatching(/^artSlot: the slot .* meets the under-frame art where the frame lets it through/),
      ]);
    }
  });

  it("counts a pixel by its centre, and leaves out a side on the card's edge", () => {
    // Left edge at 115.05: column 115 (centre 115.5) is inside, 114 the first outside.
    expect(slotSeams(m, W, H, { x0: 115.05, x1: 1386.45, y0: 236.25, y1: 1167.18 })[0]).toEqual({ side: "left", at: 114, pixels: 931, seam: 0 });
    // …at 115.6 column 115 is outside: the window's AA rim would show.
    const buf = master();
    for (let y = 0; y < H; y += 1) buf[(y * W + 115) * 4 + 3] = 176;
    expect(slotSeams(buf, W, H, { x0: 115.6, x1: 1386.45, y0: 236.25, y1: 1167.18 })[0]).toEqual({ side: "left", at: 115, pixels: 931, seam: 931 });
    // A slot from the card's own edge has no left or top side.
    expect(slotSeams(m, W, H, { x0: 0, x1: 1386.45, y0: 0, y1: 1167.18 }).map((x) => x.side)).toEqual(["right", "bottom"]);
  });
});

// Layout v35 (4.4 (2), 4.17a, 4.17b), on synthetic 1500 × 2100 masters cut to
// the Card Conjurer masters' measured windows and see-through bodies — so the
// profiles are held to them where the bucket masters aren't fetched too.
describe("layout v35 covers the Card Conjurer masters' measured art windows", { timeout: 20_000 }, () => {
  const W = 1500;
  const H = 2100;
  type Box = [x0: number, x1: number, y0: number, y1: number];
  /** Opaque, the card corner cut, a clear window and (optionally) a
   *  see-through body (α 26) around it, kept off the window by an opaque
   *  outline where the master has one — px boxes, x1/y1 exclusive. */
  const master = (window: Box, body: Box | null = null, outline: Box | null = null) => {
    const buf = new Uint8Array(W * H * 4);
    const inside = (b: Box, x: number, y: number) => x >= b[0] && x < b[1] && y >= b[2] && y < b[3];
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        buf[(y * W + x) * 4 + 3] = inside(window, x, y) ? 0 : outline && inside(outline, x, y) ? 255 : body && inside(body, x, y) ? 26 : 255;
      }
    }
    applyCardCornerMask(buf, W, H);
    return buf;
  };
  // Measured 2026-09-29 on every colour of the bucket masters (sha-checked).
  const M15_WINDOW: Box = [116, 1384, 238, 1165];

  it("covers the CC M15 window 116–1384 × 238–1165 on every profile that draws it (was a 1–1.6 px hairline)", () => {
    const m = master(M15_WINDOW);
    for (const template of ["m15", "m15artifact", "m15land", "m15snow", "m15snowland", "m15devoid"]) {
      const slots = slotsFor(template, "w");
      // m15devoid's coloured masters are see-through too: their body below.
      if (template === "m15devoid") continue;
      expect(artWindowViolations(m, W, H, slots), template).toEqual([]);
      expect(slotPixelBox(getFrameProfile(template).artSlot, 0, W, H), template).toEqual({
        x0: expect.closeTo(115.05, 6),
        x1: expect.closeTo(1386.45, 6),
        y0: expect.closeTo(236.25, 6),
        y1: expect.closeTo(1167.18, 6),
      });
    }
    // The inherited MSE slot 7.8/11.4/84.4 × 44.0 (v34) misses it on every side.
    const v34 = [{ name: "artSlot", rect: { topPct: 11.4, leftPct: 7.8, widthPct: 84.4, heightPct: 44.0 } }];
    expect(artWindowViolations(m, W, H, v34)).toEqual([expect.stringMatching(/left 117 > 115\.25, right 1383 < 1384\.75, top 239\.4 > 236\.95, bottom 1163\.4 < 1166\.05$/)]);
    // The MSE-framed adventure keeps M15's own slot (its master is 4.21's).
    expect(getFrameProfile("adventure").artSlot).toEqual({ topPct: 11.4, leftPct: 7.8, widthPct: 84.4, heightPct: 44.0 });
  });

  it("runs the art under every see-through master from the border's inner edge (was a 25 px band above the title bar)", () => {
    // The outlines as measured on the bucket masters (fully opaque columns
    // and rows round the window): m15/c and devoid/c 98–1401 × 220–1184,
    // the coloured devoid 100–1399 × 198–1184. CC's walker has none down
    // its ability box — so it draws one picture (below).
    const cases: [template: string, key: string, window: Box, body: Box, outline: Box | null][] = [
      ["m15", "c", M15_WINDOW, [58, 1443, 59, 1938], [98, 1402, 220, 1185]],
      ["m15devoid", "c", M15_WINDOW, [58, 1443, 59, 1938], [98, 1402, 220, 1185]],
      ["m15devoid", "w", M15_WINDOW, [59, 1441, 89, 1938], [100, 1400, 198, 1185]],
      // 4.17b: CC's colourless planeswalker had no under-frame art at all.
      ["m15pw", "c", [106, 1393, 212, 1159], [60, 1440, 60, 1932], null],
    ];
    for (const [template, key, window, body, outline] of cases) {
      const m = master(window, body, outline);
      expect(underFrameArtRect(getFrameProfile(template), key), `${template}/${key}`).toEqual({ topPct: 2.7, leftPct: 3.7, widthPct: 92.6, heightPct: 93.3 });
      expect(artWindowViolations(m, W, H, slotsFor(template, key)), `${template}/${key}`).toEqual([]);
      // v24's rect 4/4/92 × 92 (60–1440 × 84–2016) left the band (the
      // coloured devoid body starts at 89 px: there, 1–2 px down each side).
      const v34 = artWindowSlotsOf(getFrameProfile(template), { topPct: 4, leftPct: 4, widthPct: 92, heightPct: 92 });
      const band = body[2] < 84 ? /doesn't cover the see-through frame .*top 84 > / : /doesn't cover the see-through frame .*: left 60 > \d/;
      expect(artWindowViolations(m, W, H, v34)[0], `${template}/${key} at v34`).toMatch(band);
    }
    // Only the see-through master of a coloured planeswalker family.
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(underFrameArtRect(getFrameProfile("m15pw"), key), key).toBeNull();
  });

  it("draws m15pw/c as ONE picture: its slot ended in the translucent silver, a seam all round", () => {
    const m = master([106, 1393, 212, 1159], [60, 1440, 60, 1932]);
    const profile = getFrameProfile("m15pw");
    expect(underFrameArtSlot(profile, "c")).toEqual(underFrameArtRect(profile, "c"));
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(underFrameArtSlot(profile, key), key).toBeNull();
    // v35 as first built: M15PW's slot 100.5–1396.5 × 207.9–1923.6 over a
    // separately cropped under-frame layer.
    const twoLayers = artWindowSlotsOf(profile, underFrameArtRect(profile, "c"));
    expect(artWindowFindings(m, W, H, twoLayers)).toEqual([
      {
        message: expect.stringMatching(/^artSlot: the slot 100\.5–1396\.5 × 207\.9–1923\.6 px meets the under-frame art where the frame lets it through .*: left \(column 99\) 1716 of 1716 px, right \(column 1397\) 1716 of 1716 px, top \(row 207\) 1297 of 1297 px, bottom \(row 1924\) 1297 of 1297 px$/),
        missPx: 1716,
      },
    ]);
    expect(artWindowFindings(m, W, H, slotsFor("m15pw", "c"))).toEqual([]);
  });

  it("finds the colourless tokens' seam in their translucent silver (4.17c, there since v34) — a known failure, no worse", () => {
    // The token window inside an outline 100–1399 (the silver runs on
    // outside it, α 89 on the masters); the shared token slot 97.5–1402.5
    // ends 2.5 px short of it.
    for (const [template, window] of [
      ["m15token", [111, 1389, 259, 1709]],
      ["m15tokentext", [111, 1389, 259, 1409]],
    ] as const) {
      const m = master([...window], [59, 1441, 59, 1949], [100, 1400, 248, window[3] + 11]);
      expect(underFrameArtSlot(getFrameProfile(template), "c"), template).toBeNull();
      const f = artWindowFindings(m, W, H, slotsFor(template, "c"));
      expect(f.map((x) => x.message).join(" | "), template).toMatch(/meets the under-frame art where the frame lets it through .*: left \(column 96\) \d+ of \d+ px, right \(column 1402\)/);
      expect(artWindowVerdict(template, "c", f).fails, template).toEqual([]);
    }
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
      // A bound per entry, or one per key it lists (every key, no other).
      // (A key the record misses fails its master's test: artWindowVerdict.)
      if (typeof entry.maxMissPx === "number") expect(entry.maxMissPx, template).toBeGreaterThan(0);
      else {
        const keys = Object.keys(entry.maxMissPx);
        if (entry.keys === "all") for (const key of keys) expect(FRAME_MASTER_KEYS as readonly string[], `${template}/${key}`).toContain(key);
        else expect(keys.sort(), template).toEqual([...entry.keys].sort());
        for (const v of Object.values(entry.maxMissPx)) expect(v, template).toBeGreaterThan(0);
      }
      for (const id of entry.todo) if (!todo.includes(`**${id} [P`)) unknownItems.push(`${template} → ${id}`);
    }
    expect(unknownItems, "TODO.md has no such item").toEqual([]);
  });

  it("lists today's failures — the TODO's list, and what checking every colour of every master found", () => {
    expect(Object.keys(ART_WINDOW_KNOWN_FAILURES).sort()).toEqual(
      [
        // 7.6's list (2026-09-25): split, lotr, flip, battle, lotrscroll and
        // the saga hairline. (The M15 family's windows — then MSE, now CC —
        // were covered by layout v35, 4.4 (2).)
        "split",
        "lotr",
        "flip",
        "battle",
        "lotrscroll",
        "saga",
        // Found on 2026-09-29.
        "adventure",
        "aftermath",
        "alphatoken",
        "avatar",
        "bloomanime",
        "bloomburrow",
        "expeditionland",
        "extendedart",
        "m15fullartland",
        "m15textless",
        "m15textlessland",
        "m15tokenartifact",
        // The see-through slot and seam rules (layout v35) on the
        // colourless tokens: there since v34 (4.17c).
        "m15token",
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
    // Layout v35 struck the CC M15 family (4.4 (2)), the see-through
    // masters (4.17a) and the translucent seams (4.17b) — m15pw/c's by ONE
    // picture; its seam rule lists only the colourless tokens (4.17c).
    for (const template of ["m15", "m15artifact", "m15land", "m15snow", "m15snowland", "m15devoid", "m15pw", "nyx", "fullart"]) {
      expect(ART_WINDOW_KNOWN_FAILURES[template], template).toBeUndefined();
    }
    for (const template of ["m15token", "m15tokentext"]) expect(ART_WINDOW_KNOWN_FAILURES[template].keys, template).toEqual(["c"]);
    expect(isKnownArtWindowFailure("expeditionland", "w")).toBe(false);
    expect(isKnownArtWindowFailure("expeditionland", "b")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The importer runs the same check, with the same slots.
// ---------------------------------------------------------------------------
describe("the Card Conjurer importer runs the art-window check (TODO 7.6)", () => {
  const importer = fs.readFileSync(path.join(ROOT, "scripts/import-cc-frames.mjs"), "utf8");

  it("checks every master it builds after the downscale and the corner cut, holding known failures to their bounds", () => {
    const cut = importer.indexOf("roundCornersRgba8(master");
    const check = importer.indexOf("artWindowFindings(master, OUT_W, OUT_H");
    expect(cut).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(cut);
    expect(importer).toContain("artWindowVerdict(template, key, findings)");
    expect(importer).toContain("artWindowSlotsOf(profile, underFrameArtRect(profile, key), underFrameArtSlot(profile, key))");
    expect(importer).not.toContain("isKnownArtWindowFailure");
  });

  it("reads the frame profiles through the \"@/\" alias hook exactly as vitest does", () => {
    const templates = [...FRAME_TEMPLATE_VALUES];
    const script = [
      'import "./scripts/lib/ts-alias-hooks.mjs";',
      'const { getFrameProfile, underFrameArtRect, underFrameArtSlot } = await import("./lib/cards/template-layout.ts");',
      'const { artWindowSlotsOf } = await import("./lib/frames/art-window.ts");',
      "const out = {};",
      'for (const t of JSON.parse(process.argv[1])) { const p = getFrameProfile(t); out[t] = ["w", "c"].map((k) => artWindowSlotsOf(p, underFrameArtRect(p, k), underFrameArtSlot(p, k))); }',
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
    expect(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8")).toMatch(/^\.frames-cache\/$/m);
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
      const todo = known ? ` — known failure (TODO ${ART_WINDOW_KNOWN_FAILURES[template].todo.join(", ")})` : "";
      // Decode + fills on a 3 Mpx master: a generous timeout for CI's V8 coverage.
      it(`${template}/${m.key}${m.bucket ? " (bucket)" : ""}${todo}`, { timeout: 20_000 }, async () => {
        const { data, width, height } = await rgbaOf(m.file);
        expect([width, height]).toEqual(getFrameProfile(template).orientation === "landscape" ? [2100, 1500] : [1500, 2100]);
        const verdict = artWindowVerdict(template, m.key, artWindowFindings(data, width, height, slotsFor(template, m.key)));
        expect(verdict.fails).toEqual([]);
        expect(verdict.fixed, "it passes now — strike it from ART_WINDOW_KNOWN_FAILURES and close its TODO item").toBe(false);
      });
    }
  }
});
