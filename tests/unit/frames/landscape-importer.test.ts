import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import {
  BATTLE_ART_RECT,
  BATTLE_LOWER_RECUT_PX,
  BATTLE_RIGHT_RECUT_PX,
  BATTLE_SHIELD_RECT,
  BATTLE_TOP_RECUT_PX,
  SPLIT_HALF_DX_PCT,
  SPLIT_RECUT_PX,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { cardCornerRadiusPx } from "@/lib/cards/card-corner";
import {
  BATTLE_BLOCK_RECUT,
  BATTLE_ICON_RECUT,
  BATTLE_PRINT_RECUT,
  BATTLE_RIGHT_RECUT,
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
  describeBattleRecut,
  describeBlockShift,
  describeHalfMasks,
  eraseMaskFootprint,
  describePaintedShield,
  halfMaskFindings,
  outputSizeOf,
  paintedShieldFindings,
  recutBattleOntoPrints,
  recutColumns,
  redrawBattleIcon,
  rotateCwRgba8,
  seamInsideSpine,
  setThroughMask,
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
//     then its lower block is moved 4 px down and its top block 2 px up
//     onto the prints through flat rows (BATTLE_BLOCK_RECUT); TODO 4.21d
//     then re-cuts what no block move reaches (BATTLE_PRINT_RECUT): the
//     bars' paper stretched right, the defense shield — the master's own
//     paint (BATTLE_SHIELD: checked, recorded, never published) — set 12 px
//     right through the pack's mask, the icon's rings redrawn.
// Both are written 2100 × 1500 and cut at the one card corner. The pure
// helpers are tested on synthetic buffers; the recipes against the profiles
// that ride them; the published masters (the frames bucket: FRAMES_BUILD_DIR,
// else .frames-build; CI fetches them) against what the recipes say.
// ---------------------------------------------------------------------------

type Def = (typeof CC_TEMPLATES)[keyof typeof CC_TEMPLATES] & Record<string, unknown>;
const split = CC_TEMPLATES.split as unknown as Def & { shift: typeof SPLIT_HALF_RECUT; halfMasks: typeof SPLIT_HALF_MASKS };
const battle = CC_TEMPLATES.battle as unknown as Def & { shift: typeof BATTLE_BLOCK_RECUT; paintedShield: typeof BATTLE_SHIELD; printRecut: typeof BATTLE_PRINT_RECUT };

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

  it("moves the lower block (type bar, text box, shield) 4 px down and the top block (pill, icon) 2 px up through flat rows", () => {
    expect(battle.shift).toBe(BATTLE_BLOCK_RECUT);
    expect(BATTLE_BLOCK_RECUT).toEqual({
      axis: "y",
      blocks: [
        { from: 57, to: 363, by: -2 },
        { from: 842, to: 1468, by: 4 },
      ],
      why: expect.stringContaining("nine MOM prints"),
    });
    // The top border gives up 2 of its 57 rows, the window gains 6, the
    // bottom border gives up 4.
    expect(describeBlockShift(BATTLE_BLOCK_RECUT, 2100, 1500).zones).toEqual([
      "rows 0–56 (flat) → 55 px",
      "rows 363–841 (flat) → 485 px",
      "rows 1468–1499 (flat) → 28 px",
    ]);
    expect(BATTLE_TOP_RECUT_PX).toBe(BATTLE_BLOCK_RECUT.blocks[0].by);
    expect(BATTLE_LOWER_RECUT_PX).toBe(BATTLE_BLOCK_RECUT.blocks[1].by);
    // The profile's lower slots are the pack's rows + 4 px; the name rides
    // the top block 2 px up, and so does the art rect's top (the window's
    // upper edge is the pill's rim) — its bottom stays.
    const p = getFrameProfile("battle");
    expect(p.title.rect.topPct * 15).toBeCloseTo(76 - 2, 9);
    expect(p.title.rect.heightPct * 15).toBeCloseTo(105.5, 9);
    expect(p.title.dy! * 2100).toBeCloseTo(2, 9);
    expect(BATTLE_ART_RECT.topPct * 15).toBeCloseTo(58.2 - 2, 9);
    expect((BATTLE_ART_RECT.topPct + BATTLE_ART_RECT.heightPct) * 15).toBeCloseTo(58.2 + 91.91 * 15, 9);
    expect(p.artSlot).toBe(BATTLE_ART_RECT);
    // The cost keeps the prints' rows (its discs centred 128.75 px down):
    // costDy gives back exactly what the name's rect moved.
    expect(p.costDy! * 2100).toBeCloseTo(2, 9);
    expect((p.title.rect.topPct + p.title.rect.heightPct / 2) * 15 + p.costDy! * 2100).toBeCloseTo(128.75, 9);
    expect(p.type.rect.topPct * 15).toBeCloseTo(871 + 4, 9);
    expect(p.rules.rect.topPct * 15).toBeCloseTo(1008 + 4, 9);
    expect((p.symbolRect!.topPct + p.symbolRect!.heightPct / 2) * 15).toBeCloseTo(925 + 4, 9);
    for (const rect of [p.type.rect, p.rules.rect, p.symbolRect!, p.defense!.rect, p.defense!.paintedRect!]) {
      // Each lies inside the moved block of the master (rows 846–1471).
      expect(rect.topPct * 15).toBeGreaterThanOrEqual(846);
      expect((rect.topPct + rect.heightPct) * 15).toBeLessThanOrEqual(1472);
    }
    // …and the name inside the top block's (rows 55–360).
    expect(p.title.rect.topPct * 15).toBeGreaterThan(55);
    expect((p.title.rect.topPct + p.title.rect.heightPct) * 15).toBeLessThan(361);
  });

  it("re-cuts the right side onto the prints: the pill's paper 10 px right, the type bar's and text box's 8, the shield 12 (TODO 4.21d)", () => {
    expect(battle.printRecut).toBe(BATTLE_PRINT_RECUT);
    expect(BATTLE_PRINT_RECUT).toEqual({ right: BATTLE_RIGHT_RECUT, icon: BATTLE_ICON_RECUT });
    expect(BATTLE_RIGHT_RECUT).toEqual({
      fromX: 1820,
      blend: 24,
      bands: [
        { name: "name pill", rows: [0, 600], toX: 1998, by: 10, clearTo: 2012 },
        { name: "type bar + text box", rows: [600, 1300], toX: 2010, by: 8, clearTo: 2036 },
        { name: "text box under the shield", rows: [1300, 1472], toX: 2030, by: 8 },
      ],
      erase: { grow: 1, borderX: 2037, boxEndX: 1986, refRow: 1295, tipToRow: 1326, sideToRow: 1425, bottomRow: 1448 },
      why: expect.stringContaining("nine MOM prints"),
    });
    // The bands tile the rows from the top border to the bottom one, in
    // order, and the last one holds the whole shield.
    const bands = BATTLE_RIGHT_RECUT.bands;
    expect(bands[0].rows[0]).toBe(0);
    for (let i = 1; i < bands.length; i += 1) expect(bands[i].rows[0]).toBe(bands[i - 1].rows[1]);
    const packShieldY = BATTLE_SHIELD.box.y;
    expect(bands[2].rows[0]).toBeLessThanOrEqual(packShieldY);
    expect(bands[2].rows[1]).toBeGreaterThanOrEqual(packShieldY + BATTLE_SHIELD.box.height);
    // The profile rides each number (the px it is written in are the pack's).
    expect(BATTLE_RIGHT_RECUT_PX).toEqual({ pill: bands[0].by, bars: bands[1].by, shield: BATTLE_SHIELD.dx });
    expect(bands[2].by).toBe(bands[1].by);
    const p = getFrameProfile("battle");
    const right = (r: { leftPct: number; widthPct: number }) => (r.leftPct + r.widthPct) * 21;
    expect(right(p.title.rect)).toBeCloseTo(1942.3 + 10, 9);
    expect(p.title.rect.leftPct * 21).toBeCloseTo(392, 9);
    expect(right(p.type.rect)).toBeCloseTo(1935 + 8, 9);
    expect(p.type.rect.leftPct * 21).toBeCloseTo(268, 9);
    expect(right(p.symbolRect!)).toBeCloseTo(1942 + 8, 9);
    expect(p.symbolRect!.widthPct * 21).toBeCloseTo(180, 9);
    // The rules box keeps the pack's column: the prints' lines wrap round
    // the shield where ours step the size down, and 8 px wider set four of
    // the nine references' texts 2–6 px smaller than their prints.
    expect(right(p.rules.rect)).toBeCloseTo(1933, 9);
    expect(p.rules.rect.leftPct * 21).toBeCloseTo(272, 9);
    // The value and its ink span sit in the shield, 12 px right with it.
    expect((p.defense!.rect.leftPct + p.defense!.rect.widthPct / 2) * 21).toBeCloseTo(1962 + 12, 9);
    expect(p.defense!.inkSpanPct!.leftPct * 21).toBeCloseTo(1920 + 12, 9);
    expect(p.defense!.inkSpanPct!.rightPct * 21).toBeCloseTo(2007 + 12, 9);
    expect(p.defense!.paintedRect).toBe(BATTLE_SHIELD_RECT);
    // What the importer does is written down, the redraw named as one.
    expect(battle.transforms).toMatch(/the name pill's paper stretched 10 px right, the type bar's and text box's 8 px, the shield lifted through the pack's Defense mask and set 12 px right/);
    expect(battle.notes.join(" ")).toMatch(/REDRAWN, not the pack's pixels/);
    expect(battle.notes.join(" ")).toMatch(/left as the pack has it: the bottom border's edge/);
  });

  it("redraws the icon's rings at the prints' radii about the prints' centre (BATTLE_ICON_RECUT)", () => {
    expect(BATTLE_ICON_RECUT).toEqual({
      rim: { x: 290.5, y: 129.5 },
      centre: { x: 289.1, y: 128.1 },
      disc: 52.0,
      white: 58.5,
      ring: 62.3,
      repaint: 65,
      rimSample: 67,
      triangle: { radius: 40, dx: -1 },
      why: expect.stringContaining("r 52.0"),
    });
    // The rim's centre is the pack's (290.5, 131.5), moved with the top block.
    expect(BATTLE_ICON_RECUT.rim.y).toBe(131.5 + BATTLE_BLOCK_RECUT.blocks[0].by);
    // The rings sit 1.4 px up and left of it, as the prints set the disc.
    expect(BATTLE_ICON_RECUT.rim.x - BATTLE_ICON_RECUT.centre.x).toBeCloseTo(1.4, 9);
    expect(BATTLE_ICON_RECUT.rim.y - BATTLE_ICON_RECUT.centre.y).toBeCloseTo(1.4, 9);
  });

  it("leaves the defense shield in the master and records its box: the pack's Defense mask, moved with the block and set 12 px right", () => {
    expect(battle.paintedShield).toBe(BATTLE_SHIELD);
    expect(BATTLE_SHIELD).toEqual({ mask: "img/frames/m15/battle/maskDefense.png", dx: 12, box: { x: 1893, y: 1304, width: 164, height: 166 } });
    expect(sourceFilesFor(battle as never)).toContain(BATTLE_SHIELD.mask);
    expect(describePaintedShield(BATTLE_SHIELD)).toMatchObject({ mask: BATTLE_SHIELD.mask, dx: 12, box: BATTLE_SHIELD.box, published: false });
    // Its tips end short of the right edge's 42 px band (from x 2058).
    expect(BATTLE_SHIELD.box.x + BATTLE_SHIELD.box.width).toBeLessThanOrEqual(2058);
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
    // A shield the recipe sets aside (`dx`, TODO 4.21d): the box and the
    // paint under it are held `dx` px right of where the block move left them.
    const aside = { mask: "m.png", dx: 5, box: { x: 25, y: 13, width: 8, height: 6 } };
    const solid = Buffer.alloc(w * h * 4, 255);
    expect(paintedShieldFindings(aside, mask, w, h, solid, shift)).toEqual({ box: aside.box, failures: [] });
    expect(paintedShieldFindings({ ...aside, dx: 4 }, mask, w, h, solid, shift).failures).toEqual(["the mask's solid box lands at 24,13 8×6, the recipe records 25,13 8×6"]);
    solid[(14 * w + 22 + 5) * 4 + 3] = 100;
    expect(paintedShieldFindings(aside, mask, w, h, solid, shift).failures).toEqual(["1 px of the master are see-through under the shield"]);
    // …and a see-through pixel where the shield WAS (left of the box now) is
    // no longer under it.
    solid[(14 * w + 22 + 5) * 4 + 3] = 255;
    solid[(14 * w + 21) * 4 + 3] = 100;
    expect(paintedShieldFindings(aside, mask, w, h, solid, shift).failures).toEqual([]);
    // A mask that straddles the block's edge has no one place.
    const straddle = { axis: "y", blocks: [{ from: 0, to: 12, by: 0 }, { from: 14, to: 20, by: 3 }] };
    expect(paintedShieldFindings(spec, mask, w, h, master, straddle).failures[0]).toMatch(/is not inside one block of the shift/);
    expect(paintedShieldFindings(spec, Buffer.alloc(w * h * 4), w, h, master, shift).failures).toEqual([
      "the mask's solid box lands at nowhere (it is empty), the recipe records 20,13 8×6",
    ]);
  });
});

describe("the battle's re-cut helpers (TODO 4.21d)", () => {
  /** A w × h image: pixel (x, y) = [10 + x, 100 + y, 7, 255]. */
  const ramp = (w: number, h: number) => {
    const buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) buf.set([10 + x * 4, 100 + y, 7, 255], (y * w + x) * 4);
    return buf;
  };

  it("recutColumns: the band's columns land `by` px right, the fade gains them, rows outside keep every byte", () => {
    const [w, h] = [40, 4];
    const src = ramp(w, h);
    // The zone that gives up the columns (30–35) is one colour on the band's rows.
    for (let y = 1; y < 3; y += 1) for (let x = 30; x < 40; x += 1) src.set([0, 0, 0, 0], (y * w + x) * 4);
    const band = { rows: [1, 3], fromX: 10, toX: 30, by: 3, blend: 4, clearTo: 36 };
    const out = recutColumns(src, w, h, band);
    for (const y of [0, 3]) expect(out.subarray(y * w * 4, (y + 1) * w * 4).equals(src.subarray(y * w * 4, (y + 1) * w * 4)), `row ${y}`).toBe(true);
    for (const y of [1, 2]) {
      // Left of the band: untouched.
      for (let x = 0; x < 10; x += 1) expect(at(out, w, x, y), `${x},${y}`).toEqual(at(src, w, x, y));
      // The fade: (1 − t)·row[x] + t·row[x − 3], t = 1/5 … 4/5 (a ramp of 4
      // a column: 12 back × t).
      for (let i = 0; i < 4; i += 1) expect(at(out, w, 10 + i, y)[0]).toBe(Math.round(10 + (10 + i) * 4 - 12 * ((i + 1) / 5)));
      // From fromX + blend on: the source 3 px back, byte for byte — the
      // band's last column lands at toX + by − 1.
      for (let x = 14; x < 33; x += 1) expect(at(out, w, x, y), `${x},${y}`).toEqual(at(src, w, x - 3, y));
      // The clear zone gave up 3 columns and nothing else.
      for (let x = 33; x < 40; x += 1) expect(at(out, w, x, y)).toEqual([0, 0, 0, 0]);
    }
    // Monotonic through the seam: no column is doubled, none skipped by more than the ramp.
    const row = Array.from({ length: 33 }, (_, x) => at(out, w, x, 1)[0]);
    for (let x = 1; x < 33; x += 1) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]);
  });

  it("recutColumns: fades premultiplied — a clear pixel lends no colour", () => {
    const [w, h] = [12, 1];
    const src = Buffer.alloc(w * h * 4);
    for (let x = 0; x < w; x += 1) src.set(x < 4 ? [200, 0, 0, 0] : [50, 60, 70, 255], x * 4);
    const out = recutColumns(src, w, h, { rows: [0, 1], fromX: 4, toX: 9, by: 1, blend: 1 });
    // Column 4 = half itself (opaque), half column 3 (clear): its own colour at half alpha.
    expect(at(out, w, 4, 0)).toEqual([50, 60, 70, 128]);
    expect(at(out, w, 5, 0)).toEqual([50, 60, 70, 255]);
    expect(at(out, w, 3, 0)).toEqual([200, 0, 0, 0]);
  });

  it("recutColumns: throws when the zone it covers is not one colour a row, or on a band that leaves the image", () => {
    const [w, h] = [40, 4];
    const src = ramp(w, h);
    expect(() => recutColumns(src, w, h, { rows: [1, 3], fromX: 10, toX: 30, by: 3, blend: 4, clearTo: 36 })).toThrow(/row 1 is not one colour over columns 30–35/);
    expect(() => recutColumns(src, w, h, { rows: [1, 3], fromX: 10, toX: 38, by: 3, blend: 4 })).toThrow(/bad band/);
    expect(() => recutColumns(src, w, h, { rows: [1, 3], fromX: 2, toX: 30, by: 3, blend: 4 })).toThrow(/bad band/);
    expect(() => recutColumns(src, w, h, { rows: [1, 3], fromX: 10, toX: 12, by: 3, blend: 4 })).toThrow(/bad band/);
    expect(() => recutColumns(src, w, h, { rows: [1, 3], fromX: 10, toX: 30, by: 3, blend: 4, clearTo: 31 })).toThrow(/bad band/);
    expect(() => recutColumns(src, w, h, { rows: [3, 5], fromX: 10, toX: 30, by: 3, blend: 4 })).toThrow(/bad band/);
    expect(() => recutColumns(Buffer.alloc(8), w, h, { rows: [1, 3], fromX: 10, toX: 30, by: 3, blend: 4 })).toThrow(/not 40×4 RGBA/);
  });

  const erase = { grow: 1, borderX: 30, boxEndX: 24, refRow: 2, tipToRow: 8, sideToRow: 14, bottomRow: 16 };
  it("eraseMaskFootprint: repaints the footprint (+1 px) by its five rules and nothing outside it", () => {
    const [w, h] = [36, 20];
    const src = ramp(w, h);
    const cover = new Uint8Array(w * h);
    // A footprint over rows 6–17, columns 20–32 (one faint pixel counts).
    for (let y = 6; y <= 17; y += 1) for (let x = 20; x <= 32; x += 1) cover[y * w + x] = 1;
    const out = eraseMaskFootprint(src, w, h, cover, erase);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const inFoot = (y >= 6 && y <= 17 && x >= 19 && x <= 33) || ((y === 5 || y === 18) && x >= 20 && x <= 32);
        if (!inFoot) {
          expect(at(out, w, x, y), `${x},${y} outside`).toEqual(at(src, w, x, y));
          continue;
        }
        let want: number[];
        if (x >= 30) want = y < 14 ? at(src, w, x, 2) : [0, 0, 0, 255];
        else if (y >= 16) want = [0, 0, 0, 255];
        else if (x >= 24 && y < 14) want = at(src, w, x, 2);
        else if (y < 8) {
          // The column mirrored about the footprint's top in it (row 5 for
          // columns 20–32, row 6 for column 19).
          const top = x === 19 ? 6 : 5;
          want = at(src, w, x, top - 1 - (y - top));
        } else {
          // The row mirrored about the footprint's left end in it (column 19).
          want = at(src, w, 19 - 1 - (x - 19), y);
        }
        expect(at(out, w, x, y), `${x},${y}`).toEqual(want);
      }
    }
    expect(() => eraseMaskFootprint(src, w, h, new Uint8Array(3), erase)).toThrow(/not 36×20/);
  });

  it("setThroughMask: draws the source through the mask `dx` px right, source-over — an opaque pixel under an edge stays opaque", () => {
    const [w, h] = [10, 1];
    const src = Buffer.alloc(w * 4);
    const dst = Buffer.alloc(w * 4);
    for (let x = 0; x < w; x += 1) {
      src.set([200, 100, 0, 255], x * 4);
      dst.set(x < 6 ? [0, 0, 50, 255] : [9, 9, 9, 0], x * 4);
    }
    src.set([200, 100, 0, 128], 3 * 4); // an anti-aliased source pixel
    const cover = new Uint8Array(w);
    cover.set([255, 128, 255, 255], 1); // the mask covers source columns 1–4
    const out = setThroughMask(dst, src, cover, w, h, 3);
    expect(at(out, w, 3, 0)).toEqual([0, 0, 50, 255]); // left of the moved shield
    expect(at(out, w, 4, 0)).toEqual([200, 100, 0, 255]); // source column 1, full cover
    // Source column 2 at half cover over opaque blue: still opaque, half and half.
    const half = 128 / 255;
    expect(at(out, w, 5, 0)).toEqual([Math.round(200 * half), Math.round(100 * half), Math.round(50 * (1 - half)), 255]);
    // Source column 3 (α 128) over a CLEAR pixel: its own colour at its own alpha.
    expect(at(out, w, 6, 0)).toEqual([200, 100, 0, 128]);
    expect(at(out, w, 7, 0)).toEqual([200, 100, 0, 255]);
    expect(at(out, w, 8, 0)).toEqual([9, 9, 9, 0]); // right of it: untouched
    expect(() => setThroughMask(dst, src, cover, w, h, -1)).toThrow(/dx/);
  });

  it("redrawBattleIcon: flat rings about `centre` inside `repaint` of the rim's centre, the rim's colour continued, the triangle kept", () => {
    const [w, h] = [160, 160];
    const RIM = [200, 30, 20, 255];
    const src = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i += 1) src.set(RIM, i * 4);
    // A "triangle": a marked block near the rim's centre.
    for (let y = 70; y < 90; y += 1) for (let x = 70; x < 90; x += 1) src.set([1, 2, 3, 255], (y * w + x) * 4);
    // …and old ring paint the redraw must replace.
    for (let y = 20; y < 30; y += 1) for (let x = 60; x < 100; x += 1) src.set([255, 255, 255, 255], (y * w + x) * 4);
    const icon = { rim: { x: 80.5, y: 80.5 }, centre: { x: 79, y: 79 }, disc: 52, white: 58.5, ring: 62.3, repaint: 65, rimSample: 67, triangle: { radius: 40, dx: -1 } };
    const out = redrawBattleIcon(src, w, h, icon);
    const px = (x: number, y: number) => at(out, w, x, y);
    // By distance from `centre` (79, 79), straight up: black disc, white ring, black line, rim.
    expect(px(79, 79 - 45)).toEqual([0, 0, 0, 255]);
    expect(px(79, 79 - 51)).toEqual([0, 0, 0, 255]);
    expect(px(79, 79 - 53)).toEqual([255, 255, 255, 255]);
    expect(px(79, 79 - 57)).toEqual([255, 255, 255, 255]);
    expect(px(79, 79 - 60)).toEqual([0, 0, 0, 255]);
    expect(px(79, 79 - 61)).toEqual([0, 0, 0, 255]);
    expect(px(79, 79 - 64)).toEqual(RIM); // the old white paint at rows 20–29 is gone
    expect(px(79, 79 + 64)).toEqual(RIM);
    // 1 px linear edges: half cover at r = disc.
    expect(px(79, 79 - 52)).toEqual([128, 128, 128, 255]);
    // The triangle: the input's pixels, 1 px left.
    expect(px(69, 75)).toEqual([1, 2, 3, 255]);
    expect(px(88, 75)).toEqual([1, 2, 3, 255]);
    expect(px(89, 75)).toEqual(RIM);
    // Nothing beyond `repaint` of the rim's centre changes.
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (Math.hypot(x - 80.5, y - 80.5) > 65) expect(px(x, y)).toEqual(at(src, w, x, y));
    expect(() => redrawBattleIcon(src, w, h, { ...icon, rim: { x: 20, y: 80 } })).toThrow(/bad icon/);
    expect(() => redrawBattleIcon(src, w, h, { ...icon, white: 50 })).toThrow(/bad icon/);
  });

  it("recutBattleOntoPrints: erases, stretches, sets the shield and redraws the icon — and with nothing to do returns the master's bytes", () => {
    const [w, h] = [60, 40];
    const master = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) master.set(x < 44 ? [180, 170, 160, 255] : x < 52 ? [0, 0, 0, 0] : [0, 0, 0, 255], (y * w + x) * 4);
    // The shield: a marked block at columns 36–43, rows 20–27 of the MASTER;
    // the mask is the pack's, 2 rows higher (the shift's block moved it).
    for (let y = 20; y < 28; y += 1) for (let x = 36; x < 44; x += 1) master.set([20, 30, 40, 255], (y * w + x) * 4);
    const mask = Buffer.alloc(w * h * 4);
    for (let y = 18; y < 26; y += 1) for (let x = 36; x < 44; x += 1) mask[(y * w + x) * 4 + 3] = 255;
    const shift = { axis: "y", blocks: [{ from: 0, to: 8, by: 0 }, { from: 12, to: 36, by: 2 }] };
    const shield = { mask: "m.png", dx: 5, box: { x: 41, y: 20, width: 8, height: 8 } };
    const right = {
      fromX: 20,
      blend: 4,
      bands: [{ name: "all", rows: [0, 40], toX: 44, by: 3, clearTo: 50 }],
      erase: { grow: 1, borderX: 52, boxEndX: 44, refRow: 2, tipToRow: 0, sideToRow: 40, bottomRow: 40 },
    };
    const out = recutBattleOntoPrints(master, mask, w, h, { shift, shield, right });
    const px = (x: number, y: number) => at(out, w, x, y);
    // The paper now ends 3 px further right on every row…
    for (const y of [5, 23, 35]) {
      expect(px(46, y)[3], `row ${y}`).toBe(255);
      if (y !== 23) expect(px(47, y)).toEqual([0, 0, 0, 0]);
    }
    // …the shield sits 5 px right of where it was, over the clear columns,
    // byte for byte, and its old place is paper.
    for (let y = 20; y < 28; y += 1) for (let x = 41; x < 49; x += 1) expect(px(x, y), `${x},${y}`).toEqual([20, 30, 40, 255]);
    for (let y = 20; y < 28; y += 1) for (let x = 36; x < 41; x += 1) expect(px(x, y), `${x},${y}`).toEqual([180, 170, 160, 255]);
    expect(paintedShieldFindings(shield, mask, w, h, out, shift)).toEqual({ box: shield.box, failures: [] });
    // Nothing to do: the input's bytes (a new buffer).
    const same = recutBattleOntoPrints(master, mask, w, h, { shift, shield });
    expect(same.equals(master)).toBe(true);
    expect(same).not.toBe(master);
    // A mask that is empty, or outside the shift's blocks, is refused.
    expect(() => recutBattleOntoPrints(master, Buffer.alloc(w * h * 4), w, h, { shift, shield, right })).toThrow(/Defense mask is empty or not inside one block/);
  });

  it("describeBattleRecut: provenance names every number and says the icon is a redraw", () => {
    const d = describeBattleRecut({ shield: BATTLE_SHIELD, ...BATTLE_PRINT_RECUT });
    expect(d.columns.bands).toEqual(BATTLE_RIGHT_RECUT.bands.map((b: { name: string; rows: readonly number[]; toX: number; by: number; clearTo?: number }) => ({ ...b, rows: [...b.rows] })));
    expect(d.columns).toMatchObject({ fromX: 1820, blend: 24 });
    expect(d.shield).toMatchObject({ mask: BATTLE_SHIELD.mask, dx: 12, erase: BATTLE_RIGHT_RECUT.erase });
    expect(d.icon).toMatchObject({ rim: BATTLE_ICON_RECUT.rim, centre: BATTLE_ICON_RECUT.centre, radii: { disc: 52, white: 58.5, ring: 62.3 }, repaint: 65 });
    expect(d.icon.how).toMatch(/^a REDRAW of flat geometry, not the pack's pixels/);
    expect(d.order).toMatch(/after the block moves, before the corner cut/);
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
    expect(provenance.battle.shift).toEqual(JSON.parse(JSON.stringify(describeBlockShift(BATTLE_BLOCK_RECUT, 2100, 1500))));
    expect(provenance.battle.paintedShield).toEqual(describePaintedShield(BATTLE_SHIELD));
    // The re-cut (TODO 4.21d) is written down number for number.
    expect(provenance.battle.printRecut).toEqual(JSON.parse(JSON.stringify(describeBattleRecut({ shield: BATTLE_SHIELD, ...BATTLE_PRINT_RECUT }))));
    expect(provenance.battle.transforms).toBe(battle.transforms);
    expect(provenance.battle.halfMasks).toBeUndefined();
    // Every substitution and move is written down.
    expect(provenance.split.notes).toEqual(split.notes);
    expect(provenance.battle.notes).toEqual(battle.notes);
    // No portrait recipe records a landscape field.
    for (const [template, entry] of Object.entries(provenance) as [string, Record<string, unknown>][]) {
      if (template === "split" || template === "battle") continue;
      expect(entry.orientation, template).toBeUndefined();
      expect(entry.shift, template).toBeUndefined();
      expect(entry.printRecut, template).toBeUndefined();
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

  it.skipIf(!have)("battle: every colour master is re-cut onto the prints — the bars 10 / 8 px longer, the shield over the border, the top block 2 px up, the icon's rings at the prints' radii (set FRAMES_BUILD_DIR if skipped)", async () => {
    for (const key of BATTLE_KEYS) {
      const m = await raw(key);
      /** The first clear column of a row, from x 1900. */
      const firstClear = (y: number) => {
        for (let x = 1900; x < 2100; x += 1) if (m.a(x, y) < 16) return x;
        return -1;
      };
      // The name pill ended at 1993 (the pack's), the type bar at 1993, the
      // text box's rim at 1971: 10, 8 and 8 px further now.
      expect(firstClear(127), `${key} pill`).toBe(2004);
      expect(firstClear(925), `${key} type bar`).toBe(2002);
      expect(firstClear(1200), `${key} text box`).toBe(1980);
      // The top border is 55 rows (the pack's 57): the block moved 2 px up.
      for (const y of [0, 30, 54]) expect(m.px(1200, y), `${key} 1200,${y}`).toEqual([0, 0, 0, 255]);
      if (key !== "battle/b.png") expect(m.px(1200, 55).slice(0, 3), `${key} 1200,55`).not.toEqual([0, 0, 0]);
      // The bottom border starts where v43 left it (the lower block did not move again).
      expect(m.px(1200, 1470)).toEqual([0, 0, 0, 255]);
      // The icon: by distance from the prints' centre (289.1, 128.1) — black
      // to 52, white to 58.5, black to 62.3 (the pack's disc ran to 54.9, so
      // 55 px out was black on its right and the white ring reached 61).
      expect(m.px(289, 128 - 50), `${key} disc`).toEqual([0, 0, 0, 255]);
      expect(m.px(289, 128 - 55), `${key} white ring`).toEqual([255, 255, 255, 255]);
      expect(m.px(289 + 55, 128), `${key} white ring, right`).toEqual([255, 255, 255, 255]);
      expect(m.px(289 - 55, 128), `${key} white ring, left`).toEqual([255, 255, 255, 255]);
      expect(m.px(289, 128 - 60), `${key} black line`).toEqual([0, 0, 0, 255]);
      expect(m.px(289, 128), `${key} triangle`).toEqual([255, 255, 255, 255]);
      // The shield lies over the right border: its light rim reaches x 2055
      // (the pack's stopped at 2043), opaque all the way.
      let rimRight = -1;
      for (let y = 1300; y < 1476; y += 1) {
        for (let x = 2070; x > 1975; x -= 1) {
          const [r, g, b, a] = m.px(x, y);
          if (a === 255 && (r + g + b) / 3 > 150) {
            if (x > rimRight) rimRight = x;
            break;
          }
        }
      }
      expect(rimRight, `${key} shield`).toBe(2055);
      // …and the master is solid paint under the whole shield's middle.
      const { box } = BATTLE_SHIELD;
      for (let y = box.y + 50; y < box.y + box.height - 50; y += 4) for (let x = box.x + 40; x < box.x + box.width - 40; x += 4) expect(m.a(x, y), `${key} ${x},${y}`).toBe(255);
      // The corner is cut at the one radius.
      expect(m.a(0, 0)).toBe(0);
      expect(m.a(2099, 1499)).toBe(0);
    }
  }, 120_000);

  it.skipIf(!have)("battle: every colour master has the black border, the moved lower block and a solid shield; only `c` is see-through in its bars (set FRAMES_BUILD_DIR if skipped)", async () => {
    for (const key of BATTLE_KEYS) {
      const m = await raw(key);
      // The border: opaque black on all four edges (the MSE master had none).
      for (const [x, y] of [[1000, 5], [1000, 53], [1000, 1450], [1000, 1495], [5, 750], [100, 750], [2045, 750], [2095, 750]] as const) {
        expect(m.px(x, y), `${key} ${x},${y}`).toEqual([0, 0, 0, 255]);
      }
      // The full-art window (x 168–2038 at mid height), and its sliver
      // between the shield and the border.
      expect(m.a(1000, 500), key).toBe(0);
      expect(m.a(168, 600), key).toBe(0);
      expect(m.a(165, 600), key).toBe(255);
      expect(m.a(2038, 600), key).toBe(0);
      expect(m.a(2041, 600), key).toBe(255);
      // (2034–2036 px now: the shield's right side sits 12 px further right.)
      expect(m.a(2035, 1410), key).toBe(0);
      expect(m.px(2035, 1410), key).toEqual([0, 0, 0, 0]);
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
    // (The see-through frame starts at row 57 since the top block moved 2 px up.)
    expect(p.artSlot.topPct * 15).toBeLessThan(57);
    expect((p.artSlot.topPct + p.artSlot.heightPct) * 15).toBeGreaterThan(1436);
    expect((p.artSlot.topPct + p.artSlot.heightPct) * 15).toBeLessThan(1446);
  }, 120_000);
});
