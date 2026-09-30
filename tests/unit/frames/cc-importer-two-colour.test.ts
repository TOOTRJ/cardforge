import { describe, expect, it } from "vitest";
import {
  CC_TEMPLATES,
  CROWN_BAND,
  OUT_H,
  OUT_W,
  TWO_COLOR_PAIRS,
  TWO_COLOR_RAMPS,
  builtColors,
  compositeLayers,
  cropRows,
  describeLayer,
  lerpLayers,
  pairMasterLayers,
  rampMask,
  rampName,
  sourceFilesFor,
  toRgba8,
  twoColorRecipe,
} from "@/scripts/lib/cc-frames.mjs";
import { TWO_COLOR_PAIRS as REGISTRY_PAIRS } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// TODO 4.6.0 — the Card Conjurer importer's two-colour and crown additions
// (scripts/lib/cc-frames.mjs), additive: nothing builds with them until
// 4.6a / 4.6b. Design 2026-09-29: every split ramp untilted (the prints
// measure 0.00 ± 0.36 %W; CC's maskRightHalf.png tilts +1.35 %W), a pair is
// a premultiplied lerp (CC's stacking doubles the crown's shadow over the
// art: α 160 against 99), a mixed cost prints gold-split, and the regions
// follow CC's cardFrameProperties.
// ---------------------------------------------------------------------------

/** The ramp's share of the second colour at x (card %), read off a mask row. */
function shareAt(mask: Buffer, width: number, pct: number): number {
  const x = Math.min(width - 1, Math.floor((pct / 100) * width));
  return mask[x * 4 + 3] / 255;
}

/** Where a mask row first reaches `level` (card %). */
function crossing(mask: Buffer, width: number, level: number): number {
  for (let x = 0; x < width; x += 1) if (mask[x * 4 + 3] / 255 >= level) return ((x + 0.5) / width) * 100;
  return 100;
}

function solid(width: number, height: number, [r, g, b, a]: [number, number, number, number]): Buffer {
  const out = Buffer.alloc(width * height * 4);
  for (let o = 0; o < out.length; o += 4) {
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }
  return out;
}

describe("the untilted ramp", () => {
  it.each(Object.entries(TWO_COLOR_RAMPS))("%s: 10/50/90 within ±0.5 %%W of the formula, the same on every row", (_name, ramp) => {
    const [from, to] = ramp as [number, number];
    const mask = rampMask(OUT_W, 8, [from, to]);
    for (const level of [0.1, 0.5, 0.9]) {
      expect(Math.abs(crossing(mask, OUT_W, level) - (from + level * (to - from)))).toBeLessThanOrEqual(0.5);
    }
    // Tilt 0: every row is the first row.
    const row = mask.subarray(0, OUT_W * 4);
    for (let y = 1; y < 8; y += 1) expect(mask.subarray(y * OUT_W * 4, (y + 1) * OUT_W * 4).equals(row)).toBe(true);
    expect(shareAt(mask, OUT_W, from - 1)).toBe(0);
    expect(shareAt(mask, OUT_W, to + 1)).toBe(1);
  });

  it("the design's ramps, measured on the prints", () => {
    expect(TWO_COLOR_RAMPS).toEqual({ pinline: [40, 60], frame: [40, 60], rules: [46, 58], crown: [43, 55] });
    expect(rampName([46, 58])).toBe("procedural:ramp(46→58 %W)");
    expect(() => rampMask(10, 1, [50, 50])).toThrow();
  });
});

describe("the pair layer: a premultiplied lerp", () => {
  const ramp = rampMask(100, 1, [40, 60]);

  it("equals CC's stacking where both colours are opaque", () => {
    const left = solid(100, 1, [200, 30, 30, 255]);
    const right = solid(100, 1, [30, 30, 200, 255]);
    const lerped = lerpLayers(left, right, ramp);
    const stacked = toRgba8(
      compositeLayers([{ data: left }, { data: right, mask: ramp }], 100, 1),
    );
    for (let o = 0; o < lerped.length; o += 1) expect(Math.abs(lerped[o] - stacked[o])).toBeLessThanOrEqual(1);
  });

  it("keeps a translucent edge's alpha, where stacking raises it (the crown's shadow: 99, not 160)", () => {
    const shadow = 99;
    const left = solid(100, 1, [0, 0, 0, shadow]);
    const right = solid(100, 1, [0, 0, 0, shadow]);
    const lerped = lerpLayers(left, right, ramp);
    const stacked = toRgba8(compositeLayers([{ data: left }, { data: right, mask: ramp }], 100, 1));
    for (let x = 0; x < 100; x += 1) expect(lerped[x * 4 + 3]).toBe(shadow);
    expect(stacked[99 * 4 + 3]).toBe(160);
  });
});

describe("a layer through several masks", () => {
  it("multiplies their alphas — CC's intersection — and names them in provenance", () => {
    const data = solid(2, 1, [10, 20, 30, 255]);
    const half = solid(2, 1, [0, 0, 0, 128]);
    const quarter = solid(2, 1, [0, 0, 0, 64]);
    const out = compositeLayers([{ data, mask: [half, quarter] }], 2, 1);
    expect(out[3]).toBeCloseTo((128 / 255) * (64 / 255), 6);
    expect(describeLayer({ src: "img/frames/m15/new/u.png", mask: ["img/frames/m15/new/pinline.png", rampName([40, 60])] })).toBe(
      "img/frames/m15/new/u.png through img/frames/m15/new/pinline.png ∩ procedural:ramp(40→60 %W)",
    );
    // A ramp is no Card Conjurer file.
    const files = sourceFilesFor({
      colors: { m: [{ src: "a.png", mask: ["pinline.png", rampName([40, 60])] }] },
      notes: [],
    } as never);
    expect(files).toEqual(["a.png", "pinline.png"]);
  });
});

describe("twoColorRecipe — CC's cardFrameProperties, corrected", () => {
  it("the pairs are the registry's, first colour on the left", () => {
    expect([...TWO_COLOR_PAIRS]).toEqual([...REGISTRY_PAIRS]);
    for (const pair of TWO_COLOR_PAIRS) {
      const recipe = twoColorRecipe(pair, "split", "m15");
      expect([recipe.pinline.left, recipe.pinline.right]).toEqual(pair.split(""));
    }
    expect(() => twoColorRecipe("uw", "split", "m15")).toThrow();
  });

  it("gold-split: the gold frame and bars, a split pinline, text box and crown, the gold plate", () => {
    expect(twoColorRecipe("ur", "split", "m15")).toEqual({
      frame: { left: "m", right: null },
      pinline: { left: "u", right: "r", ramp: [40, 60] },
      rules: { left: "u", right: "r", ramp: [46, 58] },
      typeTitle: "m",
      pt: "m",
      crown: { left: "u", right: "r", ramp: [43, 55] },
    });
  });

  it("hybrid: the split outer frame, grey bars and the grey plate", () => {
    expect(twoColorRecipe("ur", "hybrid", "m15")).toEqual({
      frame: { left: "u", right: "r", ramp: [40, 60] },
      pinline: { left: "u", right: "r", ramp: [40, 60] },
      rules: { left: "u", right: "r", ramp: [46, 58] },
      typeTitle: "l",
      pt: "c",
      crown: { left: "u", right: "r", ramp: [43, 55] },
    });
  });

  it("a land: the land frame and bars, the split in land tints, no plate", () => {
    expect(twoColorRecipe("wu", "split", "land")).toEqual({
      frame: { left: "l", right: null },
      pinline: { left: "wl", right: "ul", ramp: [40, 60] },
      rules: { left: "wl", right: "ul", ramp: [46, 58] },
      typeTitle: "l",
      pt: null,
      crown: { left: "w", right: "u", ramp: [43, 55] },
    });
  });

  it("an artifact: the artifact frame, gold bars and plate — also for a hybrid cost (no hybrid artifact plate yet)", () => {
    const split = twoColorRecipe("gw", "split", "artifact");
    expect(split).toMatchObject({ frame: { left: "a", right: null }, typeTitle: "m", pt: "m" });
    expect(twoColorRecipe("gw", "hybrid", "artifact")).toEqual(split);
  });
});

describe("the crown band", () => {
  it("is CC's new crowns over the black cover, cropped to the rows the overlay covers", () => {
    expect(CROWN_BAND.rows).toBe(Math.ceil((OUT_H * 19.52) / 100));
    expect(CROWN_BAND.keys).toEqual(["w", "u", "b", "r", "g", "m", "a", "l", "c"]);
    expect(CROWN_BAND.crown).toEqual({ leftPct: 2.19, topPct: 1.88, widthPct: 95.62, heightPct: 17.52 });
    const img = solid(3, 5, [1, 2, 3, 255]);
    expect(cropRows(img, 3, 2).length).toBe(3 * 2 * 4);
  });
});

// ---------------------------------------------------------------------------
// TODO 4.6b — the pair masters the importer builds (pairMasterLayers): each
// template's pair masters are drawn the way its verified masters are, over
// the SAME Card Conjurer files (m15 / m15land: CC's whole image; m15artifact:
// regions only, like its coloured artifacts), each split region's two files
// blended across its untilted ramp.
// ---------------------------------------------------------------------------

const NEW = "img/frames/m15/new";
const PAIR = (l: string, r: string, ramp: [number, number], mask?: string) => ({
  src: `${NEW}/${l}.png`,
  right: `${NEW}/${r}.png`,
  ramp,
  ...(mask ? { mask: `${NEW}/${mask}.png` } : {}),
});
const WHOLE = (k: string, mask?: string) => ({ src: `${NEW}/${k}.png`, ...(mask ? { mask: `${NEW}/${mask}.png` } : {}) });

describe("pairMasterLayers — the pair masters, over the verified masters' files", () => {
  it("m15 gold-split: the whole gold image, the split text box and pinline over it (bars stay gold)", () => {
    expect(pairMasterLayers("ur", "split", "m15")).toEqual([
      WHOLE("m"),
      PAIR("u", "r", [46, 58], "rules"),
      PAIR("u", "r", [40, 60], "pinline"),
    ]);
  });

  it("m15 hybrid: the two colours' whole images across the frame ramp, grey bars, the split box and pinline", () => {
    expect(pairMasterLayers("ur", "hybrid", "m15")).toEqual([
      PAIR("u", "r", [40, 60]),
      PAIR("u", "r", [46, 58], "rules"),
      WHOLE("l", "title"),
      WHOLE("l", "type"),
      PAIR("u", "r", [40, 60], "pinline"),
    ]);
  });

  it("m15land: the land frame whole, the split in the two land tints", () => {
    expect(pairMasterLayers("wu", "split", "land")).toEqual([
      WHOLE("l"),
      PAIR("lw", "lu", [46, 58], "rules"),
      PAIR("lw", "lu", [40, 60], "pinline"),
    ]);
  });

  it("m15artifact: regions only, as its coloured artifacts — artifact frame + border, split box, gold bars, split pinline", () => {
    expect(pairMasterLayers("gw", "split", "artifact")).toEqual([
      WHOLE("a", "border"),
      WHOLE("a", "frame"),
      PAIR("g", "w", [46, 58], "rules"),
      WHOLE("m", "title"),
      WHOLE("m", "type"),
      PAIR("g", "w", [40, 60], "pinline"),
    ]);
    // Its mono coloured artifacts use the same masks in the same order.
    expect(CC_TEMPLATES.m15artifact.colors.g.map((l: { mask?: string }) => l.mask)).toEqual(
      pairMasterLayers("gw", "split", "artifact").map((l: { mask?: string }) => l.mask),
    );
  });

  it("the templates build every pair of every dress their profile declares, in printed order", () => {
    const pairs = [...TWO_COLOR_PAIRS];
    expect(builtColors(CC_TEMPLATES.m15)).toEqual(["w", "u", "b", "r", "g", "c", "m", ...pairs, ...pairs.map((p) => `${p}-h`)]);
    expect(builtColors(CC_TEMPLATES.m15artifact)).toEqual(["w", "u", "b", "r", "g", "c", "m", ...pairs]);
    expect(builtColors(CC_TEMPLATES.m15land)).toEqual(["w", "u", "b", "r", "g", "c", "m", ...pairs]);
    expect(CC_TEMPLATES.m15.colors["gw-h"]).toEqual(pairMasterLayers("gw", "hybrid", "m15"));
    // The mono masters are untouched by the pair recipe.
    expect(CC_TEMPLATES.m15.colors.w).toEqual([WHOLE("w")]);
    // No other template builds a pair (wave 2 is 4.6f).
    for (const [template, def] of Object.entries(CC_TEMPLATES)) {
      if (["m15", "m15artifact", "m15land"].includes(template)) continue;
      expect(Object.keys((def as { colors: object }).colors).filter((k) => k.length > 1), template).toEqual([]);
    }
  });

  it("provenance names both files and the ramp; the ramp is no source file", () => {
    expect(describeLayer(PAIR("u", "r", [40, 60], "pinline"))).toBe(
      `(${NEW}/u.png | ${NEW}/r.png across procedural:ramp(40→60 %W)) through ${NEW}/pinline.png`,
    );
    const files = sourceFilesFor({ colors: { ur: pairMasterLayers("ur", "hybrid", "m15") }, notes: [] } as never);
    expect(files).toEqual([`${NEW}/l.png`, `${NEW}/pinline.png`, `${NEW}/r.png`, `${NEW}/rules.png`, `${NEW}/title.png`, `${NEW}/type.png`, `${NEW}/u.png`]);
  });
});
