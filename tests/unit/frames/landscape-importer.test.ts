import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import {
  BATTLE_LOWER_RECUT_PX,
  BATTLE_SHIELD_RECT,
  SPLIT_HALF_DX_PCT,
  SPLIT_RECUT_PX,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { cardCornerRadiusPx } from "@/lib/cards/card-corner";
import {
  BATTLE_LOWER_RECUT,
  BATTLE_SHIELD,
  CC_TEMPLATES,
  COLORS,
  CORNER_RADIUS,
  LANDSCAPE_OUT,
  OUT_H,
  OUT_W,
  SPLIT_HALF_MASKS,
  SPLIT_HALF_RECUT,
  boxMoveOf,
  builtColors,
  describeBlockShift,
  describeHalfMasks,
  describePaintedShield,
  halfMaskFindings,
  outputSizeOf,
  paintedShieldFindings,
  rotateCwRgba8,
  seamInsideSpine,
  shiftBlocksRgba8,
  shiftedLine,
  solidBoxOf,
  sourceFilesFor,
  spineOf,
} from "@/scripts/lib/cc-frames.mjs";
import { bucketMaster, haveBucketMasters } from "@/tests/stubs/bucket-masters";

// ---------------------------------------------------------------------------
// TODO 4.21b — the importer's first LANDSCAPE recipes (scripts/lib/
// cc-frames.mjs CC_TEMPLATES.split / .battle, scripts/import-cc-frames.mjs):
//   • split — Card Conjurer's 'Split' pack is drawn PORTRAIT with its text
//     at −90°: the composite is turned a quarter turn clockwise without a
//     resample (rotateCwRgba8), then its two halves are moved onto the
//     prints through the flat black border and spine (SPLIT_HALF_RECUT);
//   • battle — the 'Battle' pack's 2814 × 2010 canvas is downscaled once,
//     then its lower block is moved 4 px down onto the prints through flat
//     rows (BATTLE_LOWER_RECUT); its defense shield stays in the master
//     (BATTLE_SHIELD: checked, recorded, never cut).
// Both are written 2100 × 1500 and cut at the one card corner. The pure
// helpers are tested on synthetic buffers; the recipes against the profiles
// that ride them; the published masters (the frames bucket: FRAMES_BUILD_DIR,
// else .frames-build; CI fetches them) against what the recipes say.
// ---------------------------------------------------------------------------

type Def = (typeof CC_TEMPLATES)[keyof typeof CC_TEMPLATES] & Record<string, unknown>;
const split = CC_TEMPLATES.split as unknown as Def & { shift: typeof SPLIT_HALF_RECUT; halfMasks: typeof SPLIT_HALF_MASKS };
const battle = CC_TEMPLATES.battle as unknown as Def & { shift: typeof BATTLE_LOWER_RECUT; paintedShield: typeof BATTLE_SHIELD };

/** An RGBA image whose pixel (x, y) is [x, y, x ^ y, 255]. */
function coordinates(width: number, height: number): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) buf.set([x, y, x ^ y, 255], (y * width + x) * 4);
  return buf;
}
const at = (buf: Buffer, width: number, x: number, y: number) => Array.from(buf.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));

describe("a landscape recipe's output", () => {
  it("is 2100 × 1500 — the portrait size turned — for a landscape recipe, 1500 × 2100 for every other", () => {
    expect(LANDSCAPE_OUT).toEqual({ width: OUT_H, height: OUT_W });
    expect([OUT_W, OUT_H]).toEqual([1500, 2100]);
    for (const [template, def] of Object.entries(CC_TEMPLATES) as [string, { orientation?: string }][]) {
      const landscape = template === "split" || template === "battle";
      expect(def.orientation, template).toBe(landscape ? "landscape" : undefined);
      expect(outputSizeOf(def), template).toEqual(landscape ? { width: 2100, height: 1500 } : { width: 1500, height: 2100 });
      // The profile draws the same orientation the recipe writes.
      expect(getFrameProfile(template).orientation === "landscape", template).toBe(landscape);
    }
    // The one card corner is 4.3 % of the SHORT side: the same 64.5 px.
    expect(cardCornerRadiusPx(2100, 1500)).toBe(CORNER_RADIUS);
    expect(cardCornerRadiusPx(1500, 2100)).toBe(CORNER_RADIUS);
  });
});

describe("rotateCwRgba8 — a quarter turn clockwise, no resample", () => {
  it("lands source (x, y) at (height − 1 − y, x) of the height × width result", () => {
    const [w, h] = [5, 3];
    const src = coordinates(w, h);
    const out = rotateCwRgba8(src, w, h);
    expect(out.length).toBe(src.length);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) expect(at(out, h, h - 1 - y, x), `${x},${y}`).toEqual([x, y, x ^ y, 255]);
    // The source's top-left corner is the result's top-RIGHT; its bottom-left
    // the result's top-left (a portrait card's bottom border becomes the
    // landscape card's left border — where the collector line runs).
    expect(at(out, h, h - 1, 0)).toEqual([0, 0, 0, 255]);
    expect(at(out, h, 0, 0)).toEqual([0, h - 1, h - 1, 255]);
  });

  it("is a permutation: every pixel of the source is in the result exactly once, and four turns give the source back", () => {
    const [w, h] = [7, 4];
    const src = coordinates(w, h);
    const once = rotateCwRgba8(src, w, h);
    const key = (buf: Buffer) => Array.from({ length: buf.length / 4 }, (_, i) => buf.subarray(i * 4, i * 4 + 4).join(",")).sort();
    expect(key(once)).toEqual(key(src));
    const twice = rotateCwRgba8(once, h, w);
    const thrice = rotateCwRgba8(twice, w, h);
    expect(rotateCwRgba8(thrice, h, w).equals(src)).toBe(true);
    expect(once.equals(src)).toBe(false);
  });

  it("refuses a buffer that isn't width × height RGBA", () => {
    expect(() => rotateCwRgba8(Buffer.alloc(10), 2, 2)).toThrow(/not 2×2 RGBA/);
  });
});

describe("shiftBlocksRgba8 — whole blocks moved through the flat zones between them", () => {
  /** A 12 × 2 row image: flat zones of `Z` (0–2, 6–7, 10–11), two blocks whose
   *  columns are numbered. */
  const Z = [9, 9, 9, 255];
  function strip(): Buffer {
    const buf = Buffer.alloc(12 * 2 * 4);
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 12; x += 1) {
        const block = (x >= 3 && x < 6) || (x >= 8 && x < 10);
        buf.set(block ? [100 + x, y, 0, 255] : Z, (y * 12 + x) * 4);
      }
    }
    return buf;
  }
  const spec = { axis: "x", blocks: [{ from: 3, to: 6, by: -2 }, { from: 8, to: 10, by: -1 }] };

  it("copies each block byte for byte, `by` px from where it was, and repeats each zone's one line", () => {
    const out = shiftBlocksRgba8(strip(), 12, 2, spec);
    for (let y = 0; y < 2; y += 1) {
      const row = Array.from({ length: 12 }, (_, x) => at(out, 12, x, y)[0]);
      // zone 0–2 → 1 column; block 3–5 at 1–3; zone 6–7 → 3 columns (4–6);
      // block 8–9 at 7–8; zone 10–11 → 3 columns (9–11).
      expect(row).toEqual([9, 103, 104, 105, 9, 9, 9, 108, 109, 9, 9, 9]);
      expect(at(out, 12, 1, y)).toEqual([103, y, 0, 255]);
    }
    // Nothing of a block is lost, nothing resampled: the result's pixels are
    // the source's (the zone pixel repeated).
    expect(out.length).toBe(strip().length);
  });

  it("moves rows the same way (axis y)", () => {
    const [w, h] = [2, 10];
    const buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) buf.set(y >= 4 && y < 7 ? [50 + y, x, 0, 255] : [0, 0, 0, 255], (y * w + x) * 4);
    const out = shiftBlocksRgba8(buf, w, h, { axis: "y", blocks: [{ from: 4, to: 7, by: 2 }] });
    expect(Array.from({ length: h }, (_, y) => at(out, w, 1, y)[0])).toEqual([0, 0, 0, 0, 0, 0, 54, 55, 56, 0]);
    expect(at(out, w, 1, 6)).toEqual([54, 1, 0, 255]);
  });

  it("throws when a zone it would grow or shrink is not flat — a moved block never smears", () => {
    const dirty = strip();
    dirty[(0 * 12 + 7) * 4] = 77; // one pixel of the middle zone
    expect(() => shiftBlocksRgba8(dirty, 12, 2, spec)).toThrow(/the zone 6–8 is not flat: line 7 differs from line 6/);
    // The other axis sees it too: a column that differs anywhere down it.
    const tall = strip();
    tall[(1 * 12 + 1) * 4 + 1] = 3;
    expect(() => shiftBlocksRgba8(tall, 12, 2, spec)).toThrow(/the zone 0–3 is not flat/);
  });

  it("throws when two blocks would meet, a block leaves the image, or the blocks are out of order", () => {
    const img = strip();
    // The first zone (3 lines) can't become 0: the block would touch the edge.
    expect(() => shiftBlocksRgba8(img, 12, 2, { axis: "x", blocks: [{ from: 3, to: 6, by: -3 }] })).toThrow(/can't become 0 lines/);
    // The middle zone can't vanish either.
    expect(() => shiftBlocksRgba8(img, 12, 2, { axis: "x", blocks: [{ from: 3, to: 6, by: 2 }, { from: 8, to: 10, by: 0 }] })).toThrow(/can't become 0 lines/);
    expect(() => shiftBlocksRgba8(img, 12, 2, { axis: "x", blocks: [{ from: 8, to: 10, by: 3 }] })).toThrow(/bad block/);
    // (On a flat image, so the order is the only thing wrong.)
    const flat = Buffer.alloc(12 * 2 * 4, 9);
    expect(() => shiftBlocksRgba8(flat, 12, 2, { axis: "x", blocks: [{ from: 8, to: 10, by: 0 }, { from: 3, to: 6, by: 0 }] })).toThrow(/out of order or overlapping/);
    expect(() => shiftBlocksRgba8(flat, 12, 2, { axis: "x", blocks: [{ from: 3, to: 8, by: 0 }, { from: 6, to: 10, by: 0 }] })).toThrow(/out of order or overlapping/);
    expect(() => shiftBlocksRgba8(img, 12, 2, { axis: "z", blocks: [] } as never)).toThrow(/axis/);
    expect(() => shiftBlocksRgba8(img, 12, 2, { axis: "x", blocks: [] })).toThrow(/no blocks/);
    expect(() => shiftBlocksRgba8(Buffer.alloc(8), 12, 2, spec)).toThrow(/not 12×2 RGBA/);
    // A block that starts at the image's edge has no zone before it: fine
    // while it doesn't move.
    const edge = shiftBlocksRgba8(img, 12, 2, { axis: "x", blocks: [{ from: 0, to: 6, by: 0 }, { from: 8, to: 10, by: -1 }] });
    expect(at(edge, 12, 7, 0)[0]).toBe(108);
  });

  it("says where a line or a box lands (shiftedLine, boxMoveOf) — nowhere for one in a zone or across two blocks", () => {
    expect(shiftedLine(spec, 4)).toBe(2);
    expect(shiftedLine(spec, 9)).toBe(8);
    expect(shiftedLine(spec, 6)).toBeNull();
    expect(boxMoveOf(spec, { x: 3, y: 0, width: 3, height: 2 })).toEqual({ dx: -2, dy: 0 });
    expect(boxMoveOf(spec, { x: 5, y: 0, width: 4, height: 2 })).toBeNull();
    expect(boxMoveOf(undefined, { x: 5, y: 0, width: 4, height: 2 })).toEqual({ dx: 0, dy: 0 });
    expect(boxMoveOf({ axis: "y", blocks: [{ from: 4, to: 9, by: 3 }] }, { x: 0, y: 5, width: 2, height: 3 })).toEqual({ dx: 0, dy: 3 });
  });
});

describe("the split recipe (CC 'Split')", () => {
  it("turns the pack's portrait frames clockwise: w u b r g m from their own file, c the artifact frame as a stand-in", () => {
    expect(split.orientation).toBe("landscape");
    expect(split.transform).toBe("rotate-cw");
    expect(split.pack).toBe("packSplit.js 'Split'");
    expect(builtColors(split as never).sort()).toEqual([...COLORS].sort());
    const colors = split.colors as Record<string, { src: string; mask?: string }[]>;
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(colors[key].map((l) => l.src), key).toEqual([`img/frames/m15/split/${key}.png`]);
    // No colourless split was printed and the pack has no colourless frame:
    // its 'Artifact Frame' keeps the key a master (never offered or ticked).
    expect(colors.c.map((l) => l.src)).toEqual(["img/frames/m15/split/a.png"]);
    for (const layers of Object.values(colors)) for (const l of layers) expect(l.mask).toBeUndefined();
    expect(split.notes.join(" ")).toMatch(/RENDER STAND-IN only/);
    expect(split.transforms).toMatch(/turned a quarter turn CLOCKWISE to 2100x1500 — a pixel permutation, no resample/);
    // No plates, discs, shield or strip: a landscape recipe cuts none.
    for (const key of ["plates", "symbols", "shield", "strip", "ptCut", "recut", "recutUp"]) expect(split[key], key).toBeUndefined();
  });

  it("moves its two halves onto the prints through the flat border and spine: the left 11 px left, the right 3", () => {
    expect(split.shift).toBe(SPLIT_HALF_RECUT);
    expect(SPLIT_HALF_RECUT).toEqual({
      axis: "x",
      blocks: [
        { from: 160, to: 1082, by: -11 },
        { from: 1118, to: 2041, by: -3 },
      ],
      why: expect.stringContaining("147–148"),
    });
    // The collector border ends 149 px in (the prints' 147–148; the pack's
    // 160), the spine is 1071–1114, the right border from 2038.
    const described = describeBlockShift(SPLIT_HALF_RECUT, 2100, 1500);
    expect(described.zones).toEqual([
      "columns 0–159 (flat) → 149 px",
      "columns 1082–1117 (flat) → 44 px",
      "columns 2041–2099 (flat) → 62 px",
    ]);
    expect(described.lossless).toMatch(/byte for byte/);
    expect(spineOf(SPLIT_HALF_RECUT)).toEqual({ pack: { x0: 1082, x1: 1118 }, master: { x0: 1071, x1: 1115 } });
    // The profile's slots are written in the PACK's columns and ride the
    // same moves (as the tokens ride TOKEN_RECUT_PX).
    expect(SPLIT_RECUT_PX).toEqual({ left: SPLIT_HALF_RECUT.blocks[0].by, right: SPLIT_HALF_RECUT.blocks[1].by });
    expect(SPLIT_HALF_DX_PCT * 21).toBeCloseTo(958 + SPLIT_RECUT_PX.right - SPLIT_RECUT_PX.left, 9);
    expect(SPLIT_HALF_DX_PCT * 21).toBeCloseTo(966, 9);
    const profile = getFrameProfile("split");
    const face = profile.secondFace!;
    for (const [name, left, right] of [
      ["title", profile.title.rect, face.title.rect],
      ["type", profile.type.rect, face.type.rect],
      ["rules", profile.rules.rect, face.rules.rect],
    ] as const) {
      expect((right.leftPct - left.leftPct) * 21, name).toBeCloseTo(966, 9);
      expect([right.topPct, right.widthPct, right.heightPct], name).toEqual([left.topPct, left.widthPct, left.heightPct]);
      // Each half's slot lies inside its own block of the master.
      expect(left.leftPct * 21, name).toBeGreaterThan(149);
      expect((left.leftPct + left.widthPct) * 21, name).toBeLessThan(1071);
      expect(right.leftPct * 21, name).toBeGreaterThan(1115);
      expect((right.leftPct + right.widthPct) * 21, name).toBeLessThan(2038);
    }
    // The art slots: the pack's windows (215–1028 and 1174–1986 px), moved,
    // + 0.1 % each side.
    expect(profile.artSlot.leftPct * 21).toBeCloseTo(215 - 11 - 2.1, 6);
    expect((profile.artSlot.leftPct + profile.artSlot.widthPct) * 21).toBeCloseTo(1028 - 11 + 2.1, 6);
    expect(face.artSlot!.leftPct * 21).toBeCloseTo(1174 - 3 - 2.1, 6);
    expect((face.artSlot!.leftPct + face.artSlot!.widthPct) * 21).toBeCloseTo(1986 - 3 + 2.1, 6);
  });

  it("records the pack's two half masks — inputs, never published — and the seam on the master", () => {
    expect(split.halfMasks).toBe(SPLIT_HALF_MASKS);
    // After the turn 'Bottom Half' is the LEFT half, 'Top Half' the right.
    expect(SPLIT_HALF_MASKS).toEqual({
      left: "img/frames/m15/split/bottom.svg",
      right: "img/frames/m15/split/top.svg",
      packSeamX: 1100,
      seamX: 1093,
    });
    expect(seamInsideSpine(SPLIT_HALF_MASKS, SPLIT_HALF_RECUT)).toEqual([]);
    // The master's seam is the middle of its spine.
    const spine = spineOf(SPLIT_HALF_RECUT).master;
    expect(SPLIT_HALF_MASKS.seamX).toBe((spine.x0 + spine.x1) / 2);
    expect(seamInsideSpine({ ...SPLIT_HALF_MASKS, seamX: 1071 }, SPLIT_HALF_RECUT)).toEqual([expect.stringMatching(/master's seam x 1071 is outside its spine 1071–1114/)]);
    expect(seamInsideSpine({ ...SPLIT_HALF_MASKS, packSeamX: 1130 }, SPLIT_HALF_RECUT)).toEqual([expect.stringMatching(/pack's seam x 1130 is outside its spine 1082–1117/)]);
    const described = describeHalfMasks(SPLIT_HALF_MASKS, 2100);
    expect(described.published).toBe(false);
    expect(described.left.covers).toBe("x 0–1099 of the pack's turned 2100 px card, every row");
    expect(described.right.covers).toBe("x 1100–2099, every row");
    expect(described.seam).toMatch(/^x 1093 px \(52\.05 %W\) on the master/);
    // The masks are fetched (and checked), like every pack file the recipe reads.
    const files = sourceFilesFor(split as never);
    expect(files).toEqual(expect.arrayContaining([SPLIT_HALF_MASKS.left, SPLIT_HALF_MASKS.right, "img/frames/m15/split/a.png", "img/frames/m15/split/w.png"]));
    // No per-half colour yet (TODO 4.26): the profile declares no two-colour
    // split, so a two-colour card paints gold on both halves.
    expect(getFrameProfile("split").twoColorMasters).toBeUndefined();
  });

  it("holds a turned half mask to its plain rectangle (halfMaskFindings)", () => {
    const [w, h] = [20, 4];
    const mask = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < 11; x += 1) mask[(y * w + x) * 4 + 3] = 255;
    expect(halfMaskFindings(mask, w, h, { x0: 0, x1: 11 })).toEqual({ x0: 0, x1: 11, failures: [] });
    expect(halfMaskFindings(mask, w, h, { x0: 0, x1: 10 }).failures).toEqual(["4 solid px outside x 0–9"]);
    expect(halfMaskFindings(mask, w, h, { x0: 0, x1: 12 }).failures).toEqual(["4 clear px inside x 0–11"]);
    mask[(1 * w + 15) * 4 + 3] = 120;
    expect(halfMaskFindings(mask, w, h, { x0: 0, x1: 11 }).failures).toEqual(["1 px are neither clear nor solid"]);
  });
});

describe("the battle recipe (CC 'Battle')", () => {
  it("downscales the pack's 2814 × 2010 canvas once: every colour from its own file, c the see-through 'Colorless Frame'", () => {
    expect(battle.orientation).toBe("landscape");
    expect(battle.transform).toBe("downscale");
    expect(battle.pack).toBe("packBattle.js 'Battle'");
    expect(builtColors(battle as never).sort()).toEqual([...COLORS].sort());
    const colors = battle.colors as Record<string, { src: string; mask?: string }[]>;
    for (const key of COLORS) expect(colors[key].map((l) => l.src), key).toEqual([`img/frames/m15/battle/${key}.png`]);
    expect(battle.transforms).toMatch(/downscaled ONCE with Lanczos to 2100x1500/);
    expect(battle.notes.join(" ")).toMatch(/see-through 'Colorless Frame'/);
    for (const key of ["plates", "symbols", "shield", "strip", "ptCut", "recut", "recutUp", "halfMasks"]) expect(battle[key], key).toBeUndefined();
    // The pack's artifact and land frames are not built (none was printed).
    expect(sourceFilesFor(battle as never).some((f: string) => /battle\/(a|l)\.png$/.test(f))).toBe(false);
  });

  it("moves the lower block (type bar, text box, shield) 4 px down onto the prints through flat rows", () => {
    expect(battle.shift).toBe(BATTLE_LOWER_RECUT);
    expect(BATTLE_LOWER_RECUT).toEqual({
      axis: "y",
      blocks: [
        { from: 0, to: 363, by: 0 },
        { from: 842, to: 1468, by: 4 },
      ],
      why: expect.stringContaining("nine MOM prints"),
    });
    expect(describeBlockShift(BATTLE_LOWER_RECUT, 2100, 1500).zones).toEqual(["rows 363–841 (flat) → 483 px", "rows 1468–1499 (flat) → 28 px"]);
    expect(BATTLE_LOWER_RECUT_PX).toBe(BATTLE_LOWER_RECUT.blocks[1].by);
    // The profile's lower slots are the pack's rows + 4 px; the name pill's
    // (above the moved block) the pack's own.
    const p = getFrameProfile("battle");
    expect(p.title.rect.topPct * 15).toBeCloseTo(76, 9);
    expect(p.type.rect.topPct * 15).toBeCloseTo(871 + 4, 9);
    expect(p.rules.rect.topPct * 15).toBeCloseTo(1008 + 4, 9);
    expect((p.symbolRect!.topPct + p.symbolRect!.heightPct / 2) * 15).toBeCloseTo(925 + 4, 9);
    for (const rect of [p.type.rect, p.rules.rect, p.symbolRect!, p.defense!.rect, p.defense!.paintedRect!]) {
      // Each lies inside the moved block of the master (rows 846–1471).
      expect(rect.topPct * 15).toBeGreaterThanOrEqual(846);
      expect((rect.topPct + rect.heightPct) * 15).toBeLessThanOrEqual(1472);
    }
    expect((p.title.rect.topPct + p.title.rect.heightPct) * 15).toBeLessThan(363);
  });

  it("leaves the defense shield in the master and records its box: the pack's Defense mask, moved with the block", () => {
    expect(battle.paintedShield).toBe(BATTLE_SHIELD);
    expect(BATTLE_SHIELD).toEqual({ mask: "img/frames/m15/battle/maskDefense.png", box: { x: 1881, y: 1304, width: 164, height: 166 } });
    expect(sourceFilesFor(battle as never)).toContain(BATTLE_SHIELD.mask);
    expect(describePaintedShield(BATTLE_SHIELD)).toMatchObject({ mask: BATTLE_SHIELD.mask, box: BATTLE_SHIELD.box, published: false });
    // The profile's keep-out is that box, in card percents.
    const { box } = BATTLE_SHIELD;
    expect(BATTLE_SHIELD_RECT.leftPct * 21).toBeCloseTo(box.x, 9);
    expect(BATTLE_SHIELD_RECT.topPct * 15).toBeCloseTo(box.y, 9);
    expect(BATTLE_SHIELD_RECT.widthPct * 21).toBeCloseTo(box.width, 9);
    expect(BATTLE_SHIELD_RECT.heightPct * 15).toBeCloseTo(box.height, 9);
    expect(getFrameProfile("battle").defense!.paintedRect).toBe(BATTLE_SHIELD_RECT);
  });

  it("holds the pack's mask to the recorded box and the master to solid paint under it (paintedShieldFindings)", () => {
    const [w, h] = [40, 30];
    const mask = Buffer.alloc(w * h * 4);
    for (let y = 10; y < 16; y += 1) for (let x = 20; x < 28; x += 1) mask[(y * w + x) * 4 + 3] = 255;
    expect(solidBoxOf(mask, w, h)).toEqual({ x: 20, y: 10, width: 8, height: 6 });
    expect(solidBoxOf(Buffer.alloc(w * h * 4), w, h)).toBeNull();
    const shift = { axis: "y", blocks: [{ from: 0, to: 4, by: 0 }, { from: 8, to: 20, by: 3 }] };
    const spec = { mask: "m.png", box: { x: 20, y: 13, width: 8, height: 6 } };
    const master = Buffer.alloc(w * h * 4, 255);
    expect(paintedShieldFindings(spec, mask, w, h, master, shift)).toEqual({ box: spec.box, failures: [] });
    // The box the recipe records is the MASTER's: without the move it is 3 px off.
    expect(paintedShieldFindings(spec, mask, w, h, master, undefined).failures).toEqual([
      "the mask's solid box lands at 20,10 8×6, the recipe records 20,13 8×6",
    ]);
    // A see-through pixel under the shield (where the master moved it to).
    master[(14 * w + 22) * 4 + 3] = 100;
    expect(paintedShieldFindings(spec, mask, w, h, master, shift).failures).toEqual(["1 px of the master are see-through under the shield"]);
    // A mask that straddles the block's edge has no one place.
    const straddle = { axis: "y", blocks: [{ from: 0, to: 12, by: 0 }, { from: 14, to: 20, by: 3 }] };
    expect(paintedShieldFindings(spec, mask, w, h, master, straddle).failures[0]).toMatch(/is not inside one block of the shift/);
    expect(paintedShieldFindings(spec, Buffer.alloc(w * h * 4), w, h, master, shift).failures).toEqual([
      "the mask's solid box lands at nowhere (it is empty), the recipe records 20,13 8×6",
    ]);
  });
});

describe("provenance (lib/cards/frame-sources.json)", () => {
  const provenance = JSON.parse(readFileSync("lib/cards/frame-sources.json", "utf8"));

  it("records each landscape recipe's size, transform, block move and inputs", () => {
    expect(provenance.split).toMatchObject({
      source: "cardconjurer",
      pack: "packSplit.js 'Split'",
      output: "2100x1500, corners rounded to 64.5px, webp q90",
      orientation: "landscape",
      transform: "rotate-cw",
    });
    expect(provenance.split.shift).toEqual(JSON.parse(JSON.stringify(describeBlockShift(SPLIT_HALF_RECUT, 2100, 1500))));
    expect(provenance.split.halfMasks).toEqual(describeHalfMasks(SPLIT_HALF_MASKS, 2100));
    expect(provenance.split.halfMasks.published).toBe(false);
    expect(provenance.split.colors.c).toEqual([expect.stringContaining("img/frames/m15/split/a.png")]);
    expect(provenance.battle).toMatchObject({
      source: "cardconjurer",
      pack: "packBattle.js 'Battle'",
      output: "2100x1500, corners rounded to 64.5px, webp q90",
      orientation: "landscape",
      transform: "downscale",
    });
    expect(provenance.battle.shift).toEqual(JSON.parse(JSON.stringify(describeBlockShift(BATTLE_LOWER_RECUT, 2100, 1500))));
    expect(provenance.battle.paintedShield).toEqual(describePaintedShield(BATTLE_SHIELD));
    expect(provenance.battle.halfMasks).toBeUndefined();
    // Every substitution and move is written down.
    expect(provenance.split.notes).toEqual(split.notes);
    expect(provenance.battle.notes).toEqual(battle.notes);
    // No portrait recipe records a landscape field.
    for (const [template, entry] of Object.entries(provenance) as [string, Record<string, unknown>][]) {
      if (template === "split" || template === "battle") continue;
      expect(entry.orientation, template).toBeUndefined();
      expect(entry.shift, template).toBeUndefined();
    }
  });
});

describe("published to the frames bucket", () => {
  const manifest = manifestJson as { files: Record<string, { width: number; height: number; sha256: string; hash: string }> };

  it("lists the 14 masters and their WebP siblings at 2100 × 1500 — and no half mask, shield or mask object", () => {
    for (const template of ["split", "battle"]) {
      const keys = Object.keys(manifest.files).filter((key) => key.startsWith(`${template}/`));
      expect(keys.sort(), template).toEqual(COLORS.flatMap((k: string) => [`${template}/${k}.png`, `${template}/${k}.webp`]).sort());
      for (const key of keys) expect([manifest.files[key].width, manifest.files[key].height], key).toEqual([2100, 1500]);
    }
  });

  const SPLIT_KEYS = COLORS.map((k: string) => `split/${k}.png`);
  const BATTLE_KEYS = COLORS.map((k: string) => `battle/${k}.png`);
  const have = haveBucketMasters([...SPLIT_KEYS, ...BATTLE_KEYS]);
  const raw = async (key: string) => {
    const { data, info } = await sharp(bucketMaster(key)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height], key).toEqual([2100, 1500]);
    return { a: (x: number, y: number) => data[(y * 2100 + x) * 4 + 3], px: (x: number, y: number) => Array.from(data.subarray((y * 2100 + x) * 4, (y * 2100 + x) * 4 + 4)) };
  };

  it.skipIf(!have)("split: every colour master has the moved halves — a 149 px collector border, the spine 1071–1114, both windows where the profile paints them (set FRAMES_BUILD_DIR if skipped)", async () => {
    const profile = getFrameProfile("split");
    for (const key of SPLIT_KEYS) {
      const m = await raw(key);
      // The zones are flat border black, clear of the cut corners.
      for (const y of [80, 400, 750, 1100, 1420]) {
        for (const x of [0, 70, 148, 1071, 1093, 1114, 2038, 2099]) expect(m.px(x, y), `${key} ${x},${y}`).toEqual([0, 0, 0, 255]);
      }
      // …and the halves' bodies start right after them (rows clear of the
      // bodies' own rounded corners): the collector border is 149 px, the
      // pack's 160; the right body starts at 1115, the pack's 1118.
      for (const y of [100, 400, 750, 1100]) {
        // (Not the border's flat #000 — the black frame's body is dark too.)
        for (const x of [149, 1070, 1115, 2037]) expect(m.px(x, y).slice(0, 3), `${key} ${x},${y}`).not.toEqual([0, 0, 0]);
      }
      // The windows: clear at the moved place, opaque just outside it.
      for (const [x0, x1] of [[204, 1017], [1171, 1983]] as const) {
        for (const y of [239, 500, 794]) {
          expect(m.a(x0, y), `${key} ${x0},${y}`).toBeLessThan(16);
          expect(m.a(x1 - 1, y), `${key} ${x1 - 1},${y}`).toBeLessThan(16);
          expect(m.a(x0 - 2, y), `${key} ${x0 - 2},${y}`).toBe(255);
          expect(m.a(x1 + 1, y), `${key} ${x1 + 1},${y}`).toBe(255);
        }
        expect(m.a(Math.round((x0 + x1) / 2), 237)).toBe(255);
        expect(m.a(Math.round((x0 + x1) / 2), 796)).toBe(255);
      }
      // The corner is cut at the one radius.
      expect(m.a(0, 0)).toBe(0);
      expect(m.a(60, 0)).toBe(223);
      expect(m.a(2099, 1499)).toBe(0);
    }
    // The profile's art slots cover those windows with 0.1 % to spare.
    expect(profile.artSlot.leftPct * 21).toBeLessThan(204);
    expect((profile.artSlot.leftPct + profile.artSlot.widthPct) * 21).toBeGreaterThan(1017);
    expect(profile.artSlot.topPct * 15).toBeLessThan(239);
    expect((profile.artSlot.topPct + profile.artSlot.heightPct) * 15).toBeGreaterThan(795);
  }, 120_000);

  it.skipIf(!have)("battle: every colour master has the black border, the moved lower block and a solid shield; only `c` is see-through in its bars (set FRAMES_BUILD_DIR if skipped)", async () => {
    for (const key of BATTLE_KEYS) {
      const m = await raw(key);
      // The border: opaque black on all four edges (the MSE master had none).
      for (const [x, y] of [[1000, 5], [1000, 55], [1000, 1450], [1000, 1495], [5, 750], [100, 750], [2045, 750], [2095, 750]] as const) {
        expect(m.px(x, y), `${key} ${x},${y}`).toEqual([0, 0, 0, 255]);
      }
      // The full-art window (x 168–2038 at mid height), and its sliver
      // between the shield and the border.
      expect(m.a(1000, 500), key).toBe(0);
      expect(m.a(168, 600), key).toBe(0);
      expect(m.a(165, 600), key).toBe(255);
      expect(m.a(2038, 600), key).toBe(0);
      expect(m.a(2041, 600), key).toBe(255);
      expect(m.a(2030, 1410), key).toBe(0);
      // The lower block sits 4 px below the pack's rows: the black line over
      // the type bar at 870 px (the pack's 866 — now the rim above it), the
      // bottom border from 1447 (the pack's 1443 — now the rim under the
      // text box).
      const dark = (x: number, y: number) => m.px(x, y).slice(0, 3).every((v) => v < 16);
      expect(dark(1100, 870), key).toBe(true);
      expect(dark(1100, 866), key).toBe(false);
      expect(m.px(1100, 1447), key).toEqual([0, 0, 0, 255]);
      expect(dark(1100, 1443), key).toBe(false);
      // The painted shield: solid on every colour, black inside on the
      // digit's rows.
      const { box } = BATTLE_SHIELD;
      expect(m.a(box.x + 81, box.y + 82), key).toBe(255);
      expect(m.px(box.x + 81, box.y + 82).slice(0, 3).every((v) => v < 30), key).toBe(true);
      // The bars: translucent on the colourless frame (the art shows through
      // them), solid on every other.
      for (const [x, y] of [[1500, 170], [1200, 962], [600, 1400]] as const) {
        if (key === "battle/c.png") {
          expect(m.a(x, y), `${key} ${x},${y}`).toBeGreaterThan(150);
          expect(m.a(x, y), `${key} ${x},${y}`).toBeLessThan(250);
        } else expect(m.a(x, y), `${key} ${x},${y}`).toBe(255);
      }
      expect(m.a(0, 0)).toBe(0);
      expect(m.a(60, 0)).toBe(223);
    }
    // The art rect (one for every colour, and `c`'s under-frame picture)
    // runs from the border's inner edge to the bottom border.
    const p = getFrameProfile("battle");
    expect(p.underFrameArt).toEqual({ rect: p.artSlot, colors: ["c"], artSlot: p.artSlot });
    expect(p.artSlot.leftPct * 21).toBeLessThan(166);
    expect((p.artSlot.leftPct + p.artSlot.widthPct) * 21).toBeGreaterThan(2041);
    expect(p.artSlot.topPct * 15).toBeLessThan(59);
    expect((p.artSlot.topPct + p.artSlot.heightPct) * 15).toBeGreaterThan(1436);
    expect((p.artSlot.topPct + p.artSlot.heightPct) * 15).toBeLessThan(1446);
  }, 120_000);
});
