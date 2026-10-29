// ---------------------------------------------------------------------------
// The holofoil security stamp (TODO 4.9c, design 2026-09-29 §1.2 / §2.4 /
// §3.3): the silver oval the 2015 frame prints in its bottom border on
// rares and mythics, with the notch the text box's pinline arches over it.
// An ADDITION under the owner rule (docs/FRAMES.md "Printed pieces a card
// switches on"), so it is OPT-IN PER CARD: `frame_style.stamp` holds "auto"
// (a new card: the oval on a rare or mythic, nothing else), "oval" or
// "triangle" (the owner's "Always", or an import following its printing's
// `security_stamp`), "none" (the owner's explicit "Never") — or nothing, a
// card saved before the stamp shipped, which keeps its look. Drawn only on
// a template whose PROFILES entry declares a `holoStamp` overlay (the
// notch; lib/cards/template-layout.ts M15_HOLO_STAMP), never on a token or
// an emblem (their control is hidden), and the save drops the key elsewhere
// (lib/cards/anatomy.ts normalizeAnatomy).
//
// The art is OURS (owner 2026-09-29): a neutral silver oval with a sheen
// and no symbol (lib/cards/holo-stamp-art.ts, a generated bitmap both
// renderers draw at the same rect, outside the foil sheen). The notch is
// Card Conjurer's arch, its rim tinted to our master's own pinline and its
// oval region cut clear before it reaches the frames bucket (scripts/lib/
// cc-frames.mjs HOLO_STAMP_NOTCHES).
//
// Pure, no imports beyond types: the preview, the bake, the creator, the
// actions and the import mapper read these same rules.
// ---------------------------------------------------------------------------

import type { Rect } from "@/lib/cards/template-layout";

/** What `frame_style.stamp` holds. */
export const HOLO_STAMP_SWITCH_VALUES = ["auto", "oval", "triangle", "none"] as const;
export type HoloStampSwitch = (typeof HOLO_STAMP_SWITCH_VALUES)[number];

/** The stamp shapes print uses: the oval (every 2015-frame rare and mythic)
 *  and the Universes Beyond triangle (the Universes Beyond frames, TODO
 *  4.25 — print stamps EVERY rarity there, so "auto" does too on a frame
 *  whose notch is cut for the triangle: owner Round 57, decision 2). */
export type HoloStampShape = "oval" | "triangle";

/** How the stamp's face is printed: the hologram (every oval; the
 *  triangle of a rare or mythic) or the flat MATTE grey the Universes
 *  Beyond frames print on a common and an uncommon (26 digital prints read
 *  2026-10-14: 95, 97, 96, no sheen). */
export type HoloStampTone = "holo" | "matte";

export function isHoloStampSwitch(value: unknown): value is HoloStampSwitch {
  return (HOLO_STAMP_SWITCH_VALUES as readonly unknown[]).includes(value);
}

/** The rarities print stamps under "auto" (design §1.2: 23,889 rare and
 *  7,732 mythic ovals; 353 of 36,545 prints at any other rarity). */
const AUTO_RARITIES: ReadonlySet<string> = new Set(["rare", "mythic"]);

/** Card types that never print the stamp in wave 1 (design §3.3: ordinary
 *  tokens and emblems carry none; a stamped SLD token or UB emblem lands on
 *  a frame without the notch and drops its key). The creator hides their
 *  control. */
export const STAMPLESS_CARD_TYPES: ReadonlySet<string> = new Set(["token", "emblem"]);

/** The facts the stamp rule reads. */
export type HoloStampFacts = {
  cardType?: string | null;
  rarity?: string | null;
  /** The shape the FRAME's notch is cut for (the profile's `holoStamp`
   *  slot). Absent = the oval — every caller that knows the frame passes
   *  it; one that doesn't gets the oval's rule. */
  shape?: HoloStampShape | null;
  /** The frame draws ONLY its own shape (HoloStampArt.ownShapeOnly — the
   *  borderless frames, TODO 4.9d): a value naming the other shape draws
   *  nothing there. */
  ownShapeOnly?: boolean | null;
};

/**
 * Whether the switch value draws the stamp for a card (the template's
 * notch aside — resolveHoloStamp in lib/cards/anatomy.ts asks the profile):
 * "auto" as the frame's own print does — a rare or mythic on an oval frame,
 * EVERY rarity on a triangle frame (Universes Beyond stamps commons and
 * uncommons too; owner Round 57); "oval" and "triangle" always; "none" and
 * an absent key never; never on a token or an emblem. The SHAPE drawn is
 * the template's own (the notch is cut for one shape): an imported
 * "triangle" on an oval frame draws that frame's oval.
 */
export function holoStampWanted(stamp: unknown, facts: HoloStampFacts): boolean {
  if (!isHoloStampSwitch(stamp) || stamp === "none") return false;
  if (STAMPLESS_CARD_TYPES.has(facts.cardType ?? "")) return false;
  // A frame that draws only its own shape (the borderless frames, owner
  // Round 70): the other shape — a Universes Beyond printing's triangle on
  // the oval-arched borderless frame — draws nothing, until that frame has
  // a notch cut for it.
  if (facts.ownShapeOnly && stamp !== "auto" && stamp !== (facts.shape ?? "oval")) return false;
  if (stamp === "auto") return facts.shape === "triangle" || AUTO_RARITIES.has((facts.rarity ?? "").toLowerCase());
  return true;
}

/**
 * The tone a drawn stamp's face takes: the triangle is MATTE on every
 * rarity print does not hologram (anything but a rare or a mythic — a card
 * with no rarity too), the hologram otherwise; the oval is always the
 * hologram (print stamps no oval below a rare, so "Always" on a common is
 * the maker's own call and draws the one oval there is).
 */
export function holoStampToneOf(shape: HoloStampShape, rarity: string | null | undefined): HoloStampTone {
  if (shape !== "triangle") return "holo";
  return AUTO_RARITIES.has((rarity ?? "").toLowerCase()) ? "holo" : "matte";
}

/** True when the creator offers the stamp control for a card type at all
 *  (a template with the notch aside). */
export function offersHoloStampForType(cardType: string | null | undefined): boolean {
  return !STAMPLESS_CARD_TYPES.has(cardType ?? "");
}

// ---------------------------------------------------------------------------
// Geometry, as fractions of a 1500 × 2100 card (the design's §1.2 / §2.1).
// ---------------------------------------------------------------------------

/** The oval, centred: Card Conjurer's 'Plain Holo Stamp' bounds
 *  (45.54 / 91.72 / 8.94 × 3.2 %: 683–817 × 1926–1993 px at HD), which the
 *  prints' silver oval fills (M15 #3, KLD #124, DMU #107, FDN #1). CC's
 *  notch pieces hold their hologram inside the same ellipse, 2 px in. */
export const M15_HOLO_STAMP_OVAL: Rect = { leftPct: 45.54, topPct: 91.72, widthPct: 8.94, heightPct: 3.2 };

/** The planeswalker's oval: the same ellipse 7 px (0.333 %H) higher — the
 *  walker's box ends at 1937 px, M15's at 1949, and CC's walker notch piece
 *  holds its hologram at 685–815 × 1921–1984 against the M15 piece's
 *  1928–1991 (measured on the pieces, 2026-10-02). */
export const M15PW_HOLO_STAMP_OVAL: Rect = { ...M15_HOLO_STAMP_OVAL, topPct: 91.72 - (7 / 2100) * 100 };

/** The margin the art bitmap draws beyond the oval, in HD px: a ring of
 *  the notch's own black, so the bitmap covers the notch piece's cut (the
 *  oval plus 2 px, HOLO_STAMP_CUT_MARGIN_PX) with a pixel to spare and the
 *  oval's edge is never a seam. The bitmap's rect is the oval grown by it. */
export const HOLO_STAMP_ART_MARGIN_PX = 3;

/** How far past the oval the importer cuts the notch piece clear (design
 *  §2.4: "the 45.54 / 91.72 / 8.94 × 3.2 rect plus a 2 px margin"). */
export const HOLO_STAMP_CUT_MARGIN_PX = 2;

/** A rect grown by `px` HD pixels on every side (the card 1500 × 2100). */
export function grownRect(rect: Rect, px: number): Rect {
  return {
    leftPct: rect.leftPct - (px / 1500) * 100,
    topPct: rect.topPct - (px / 2100) * 100,
    widthPct: rect.widthPct + (2 * px * 100) / 1500,
    heightPct: rect.heightPct + (2 * px * 100) / 2100,
  };
}

/** Where the oval ART bitmap is drawn for a slot's oval (the oval grown by
 *  HOLO_STAMP_ART_MARGIN_PX): both renderers stretch the same bitmap over
 *  this rect. */
export function holoStampArtRect(oval: Rect): Rect {
  return grownRect(oval, HOLO_STAMP_ART_MARGIN_PX);
}

/** The rules keep-out while the M15 stamp is drawn (design §2.1): the arch
 *  above the oval, x 655–845 px from its top at 1905 (the prints' arch top
 *  1910–1912, 5 px of air) down past the rules box's bottom (1923.6) —
 *  43.67 / 90.71 / 12.67 × 0.93 %. A glyph-level keep-out beside the stat
 *  badges (lib/cards/rules-box.ts DrawnStats.stamp): a line steps the size
 *  down only when its ink enters the arch, and the rules rect itself never
 *  shrinks — M15's box is vAlign "center", so a shrink would lift every
 *  short block ≈ 9 px off the prints. */
export const M15_HOLO_STAMP_KEEP_OUT: Rect = { leftPct: 43.67, topPct: 90.71, widthPct: 12.67, heightPct: 0.93 };

/**
 * The borderless arch (TODO 4.9d) — how far the pinline is lifted (HD px)
 * at |x − 750| = 0, 2, 4, … px (linear between; nothing from the last entry
 * on): fourteen prints measured 2026-10-15. The build's own copy is
 * scripts/lib/borderless-stamp.mjs ARCH_LIFT_PX (the pieces are lifted by
 * it); a unit test holds the two equal.
 */
export const BORDERLESS_ARCH_LIFT_PX: readonly number[] = [
  32.6, 32.6, 32.6, 32.5, 32.5, 32.4, 32.4, 32.3, 32.0, 31.7, 31.3, 30.9, 30.6, 30.4, 30.1, 29.6, 29.1, 28.5, 27.8, 27.2,
  26.6, 25.9, 25.1, 24.3, 23.5, 22.6, 21.7, 20.8, 19.7, 18.6, 17.5, 16.4, 15.3, 14.1, 12.7, 11.2, 9.7, 8.2, 6.6, 4.8,
  3.0, 1.4, 0.4, 0.1, 0,
];

/** The borderless arch's lift at card column `x` (HD px, the pixel's
 *  centre x + 0.5). */
export function borderlessArchLiftAt(x: number): number {
  const d = Math.abs(x + 0.5 - 750) / 2;
  const i = Math.floor(d);
  if (i >= BORDERLESS_ARCH_LIFT_PX.length - 1) return 0;
  const t = d - i;
  return BORDERLESS_ARCH_LIFT_PX[i]! * (1 - t) + BORDERLESS_ARCH_LIFT_PX[i + 1]! * t;
}

/** The borderless bar's bevel top (HD px): the masters' first bevel row. */
const BORDERLESS_BEVEL_TOP_PX = 1930;
/** The air a glyph keeps over the arch's bevel, HD px. */
export const BORDERLESS_ARCH_AIR_PX = 2;
/** The keep-out's column width, HD px (each column's top is the arch's
 *  highest point inside it, so the stair never cuts into the air). */
const BORDERLESS_ARCH_STRIP_PX = 4;
/** Past the rules box's bottom (1923.6). */
const BORDERLESS_ARCH_KEEP_OUT_BOTTOM_PX = 1925;

/**
 * The borderless stamp's keep-out as the ARCH'S SHAPE (TODO 4.9d, owner
 * Round 70): 4 px columns over the arch, each from BORDERLESS_ARCH_AIR_PX
 * above the lifted bevel's top in that column down past the rules box — so
 * a line steps down only where its glyphs would really meet the arch (a
 * single rect over the arch's highest point made a line whose ink cleared
 * the slopes step down too). Columns whose top falls below the box are
 * left out. Glyph-level like every badge (lib/cards/rules-box.ts).
 */
export function borderlessArchKeepOut(air = BORDERLESS_ARCH_AIR_PX): Rect[] {
  const out: Rect[] = [];
  for (let x0 = 660; x0 < 840; x0 += BORDERLESS_ARCH_STRIP_PX) {
    let lift = 0;
    for (let x = x0; x < x0 + BORDERLESS_ARCH_STRIP_PX; x += 1) lift = Math.max(lift, borderlessArchLiftAt(x));
    const top = BORDERLESS_BEVEL_TOP_PX - lift - air;
    if (top >= BORDERLESS_ARCH_KEEP_OUT_BOTTOM_PX) continue;
    out.push({
      leftPct: (x0 / 1500) * 100,
      topPct: (top / 2100) * 100,
      widthPct: (BORDERLESS_ARCH_STRIP_PX / 1500) * 100,
      heightPct: ((BORDERLESS_ARCH_KEEP_OUT_BOTTOM_PX - top) / 2100) * 100,
    });
  }
  return out;
}

/** The borderless arch's keep-out as columns (borderlessArchKeepOut at
 *  BORDERLESS_ARCH_AIR_PX): what the rules boxes read on the borderless
 *  frames (HoloStampArt.keepOutShape). */
export const M15BORDERLESS_HOLO_STAMP_KEEP_OUT_SHAPE: readonly Rect[] = borderlessArchKeepOut();

/** …and their bounds (HoloStampArt.keepOut): x 668–832 px from the lifted
 *  bevel's top at the centre (1897.4) less 2 px of air, past the rules
 *  box's bottom (1925). */
export const M15BORDERLESS_HOLO_STAMP_KEEP_OUT: Rect = (() => {
  const shape = M15BORDERLESS_HOLO_STAMP_KEEP_OUT_SHAPE;
  const left = Math.min(...shape.map((r) => r.leftPct));
  const top = Math.min(...shape.map((r) => r.topPct));
  const right = Math.max(...shape.map((r) => r.leftPct + r.widthPct));
  const bottom = Math.max(...shape.map((r) => r.topPct + r.heightPct));
  return { leftPct: left, topPct: top, widthPct: right - left, heightPct: bottom - top };
})();

/**
 * The BORDERLESS WALKERS' arch (TODO 4.9d, owner Round 70: "Build them
 * next") — how far the ability window's bottom outline and rim are lifted
 * (HD px) at |x − 750| = 0, 2, 4, … px (linear between; nothing from the
 * last entry on): thirteen prints measured 2026-10-16, 24.3 px at the
 * centre, from x 666 to x 834. The build's own copy is
 * scripts/lib/borderless-stamp.mjs WALKER_ARCH_LIFT_PX; a unit test holds
 * the two equal.
 */
export const BORDERLESS_WALKER_ARCH_LIFT_PX: readonly number[] = [
  24.3, 24.3, 24.2, 24.2, 24.2, 24.1, 24.1, 24.1, 23.9, 23.7, 23.5, 23.2, 22.8, 22.5, 22.2, 22.0, 21.7, 21.2, 20.7, 20.3,
  19.9, 19.4, 18.8, 18.3, 17.7, 17.0, 16.3, 15.7, 14.9, 14.1, 13.3, 12.4, 11.5, 10.6, 9.6, 8.5, 7.4, 6.3, 5.1, 3.8,
  2.4, 1.2, 0.3, 0,
];

/** The walker arch's lift at card column `x` (HD px, the pixel's centre). */
export function borderlessWalkerArchLiftAt(x: number): number {
  const d = Math.abs(x + 0.5 - 750) / 2;
  const i = Math.floor(d);
  if (i >= BORDERLESS_WALKER_ARCH_LIFT_PX.length - 1) return 0;
  const t = d - i;
  return BORDERLESS_WALKER_ARCH_LIFT_PX[i]! * (1 - t) + BORDERLESS_WALKER_ARCH_LIFT_PX[i + 1]! * t;
}

/** The walker masters' window outline: its first row (HD px), the top of
 *  the dark line the arch lifts. */
const BORDERLESS_WALKER_OUTLINE_TOP_PX = 1922;
/** Past the walker rules box's bottom (1919.4). */
const BORDERLESS_WALKER_KEEP_OUT_BOTTOM_PX = 1921;

/**
 * The borderless walkers' keep-out as the ARCH'S SHAPE: 4 px columns over
 * the arch, each from BORDERLESS_ARCH_AIR_PX above the lifted outline's top
 * in that column down past the rules box — the same rule as the spells'
 * (borderlessArchKeepOut), over the walker's own arch. Columns whose top
 * falls below the box are left out. Read by the plain box (glyph by glyph,
 * DrawnStats.stamp) AND by the ability rows (lib/cards/loyalty-rows.ts: the
 * last row's text keeps above it).
 */
export function borderlessWalkerArchKeepOut(air = BORDERLESS_ARCH_AIR_PX): Rect[] {
  const out: Rect[] = [];
  for (let x0 = 660; x0 < 840; x0 += BORDERLESS_ARCH_STRIP_PX) {
    let lift = 0;
    for (let x = x0; x < x0 + BORDERLESS_ARCH_STRIP_PX; x += 1) lift = Math.max(lift, borderlessWalkerArchLiftAt(x));
    const top = BORDERLESS_WALKER_OUTLINE_TOP_PX - lift - air;
    if (top >= BORDERLESS_WALKER_KEEP_OUT_BOTTOM_PX) continue;
    out.push({
      leftPct: (x0 / 1500) * 100,
      topPct: (top / 2100) * 100,
      widthPct: (BORDERLESS_ARCH_STRIP_PX / 1500) * 100,
      heightPct: ((BORDERLESS_WALKER_KEEP_OUT_BOTTOM_PX - top) / 2100) * 100,
    });
  }
  return out;
}

/** The borderless walkers' keep-out columns (HoloStampArt.keepOutShape). */
export const M15BORDERLESSPW_HOLO_STAMP_KEEP_OUT_SHAPE: readonly Rect[] = borderlessWalkerArchKeepOut();

/** …and their bounds (HoloStampArt.keepOut): from 2 px over the lifted
 *  outline's top at the centre (1897.7) past the rules box's bottom. */
export const M15BORDERLESSPW_HOLO_STAMP_KEEP_OUT: Rect = (() => {
  const shape = M15BORDERLESSPW_HOLO_STAMP_KEEP_OUT_SHAPE;
  const left = Math.min(...shape.map((r) => r.leftPct));
  const top = Math.min(...shape.map((r) => r.topPct));
  const right = Math.max(...shape.map((r) => r.leftPct + r.widthPct));
  const bottom = Math.max(...shape.map((r) => r.topPct + r.heightPct));
  return { leftPct: left, topPct: top, widthPct: right - left, heightPct: bottom - top };
})();

/** The walker's: from its notch piece's top (1893 px: the piece draws a
 *  black line above the rim) past its rules rect's bottom (1919.4). Read by
 *  the plain box only (a non-walker card on the frame, a walker with no
 *  abilities); the ability rows keep their own shield rule and get the arch
 *  in 4.9d. */
export const M15PW_HOLO_STAMP_KEEP_OUT: Rect = { leftPct: 43.94, topPct: 90.15, widthPct: 12.14, heightPct: 1.3 };

// ---------------------------------------------------------------------------
// The Universes Beyond triangle (TODO 4.25). Geometry in HD px on a
// 1500 × 2100 card, an apex-down triangle with round corners written as an
// INNER triangle and a corner radius (the shape is every point within
// `radius` of the inner triangle).
// ---------------------------------------------------------------------------

/** A round-cornered triangle: three inner vertices (HD px) and the radius. */
export type RoundTriangle = {
  points: readonly [readonly [number, number], readonly [number, number], readonly [number, number]];
  radius: number;
};

/** The HOLE of Card Conjurer's Universes Beyond stamp piece — its plain
 *  'Gray Holo Stamp' fitted (the piece is 299 × 137 at 857 / 2015,
 *  2534 / 2814; mean |α error| 0.5 %): top edge at 1918 px, 680–819 px
 *  wide, the apex past the piece's last row. The importer cuts the notch
 *  clear inside it plus HOLO_STAMP_CUT_MARGIN_PX; the art's black covers it
 *  plus HOLO_STAMP_ART_MARGIN_PX. */
export const UB_STAMP_HOLE: RoundTriangle = {
  points: [[687.1, 1924.6], [812.1, 1924.6], [749.6, 1992.5]],
  radius: 6.7,
};

/** The FACE our art draws (its 2 px keyline included), on the prints (61
 *  mono Universes Beyond spells, 40K 2022 → FIN 2025, medians at HD): the
 *  silver's top edge at 1919 px, 688–814 px wide 8 px below it, 708–793 at
 *  row 1950, the apex at 1991 — the hole's top corners with the apex 5 px
 *  higher, a hair inside the hole all round. */
export const UB_STAMP_FACE: RoundTriangle = {
  points: [[687.1, 1924.6], [812.1, 1924.6], [749.6, 1987.5]],
  radius: 6.5,
};

const pctX = (px: number) => (px / 1500) * 100;
const pctY = (px: number) => (px / 2100) * 100;

/** A round triangle's bounding box, in card percent. */
export function roundTriangleBounds(t: RoundTriangle): Rect {
  const xs = t.points.map((p) => p[0]);
  const ys = t.points.map((p) => p[1]);
  const left = Math.min(...xs) - t.radius;
  const top = Math.min(...ys) - t.radius;
  return {
    leftPct: pctX(left),
    topPct: pctY(top),
    widthPct: pctX(Math.max(...xs) + t.radius - left),
    heightPct: pctY(Math.max(...ys) + t.radius - top),
  };
}

/** Signed distance (HD px) from a point to a round triangle's edge:
 *  negative inside. Pure — the importer's cut, its checks and the art
 *  generator read the same shape. */
export function roundTriangleDistance(t: RoundTriangle, x: number, y: number): number {
  let d = Infinity;
  let sign = 0;
  let inside = true;
  for (let i = 0; i < 3; i += 1) {
    const [ax, ay] = t.points[i]!;
    const [bx, by] = t.points[(i + 1) % 3]!;
    const ex = bx - ax;
    const ey = by - ay;
    const wx = x - ax;
    const wy = y - ay;
    const k = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    d = Math.min(d, Math.hypot(wx - ex * k, wy - ey * k));
    const cross = ex * wy - ey * wx;
    if (sign === 0 && cross !== 0) sign = Math.sign(cross);
    else if (cross !== 0 && Math.sign(cross) !== sign) inside = false;
  }
  return (inside ? -d : d) - t.radius;
}

/** The Universes Beyond stamp's box (the hole's bounds: 680.4–818.8 ×
 *  1917.9–1999.2 px) — what the slot's `oval` holds for a triangle; the art
 *  bitmap is stretched over it grown by HOLO_STAMP_ART_MARGIN_PX. */
export const M15UB_HOLO_STAMP_BOX: Rect = roundTriangleBounds(UB_STAMP_HOLE);

/** The rules keep-out while the Universes Beyond stamp is drawn: the raised
 *  pinline above the triangle, x 650–850 px from the bevel's top (1897 px;
 *  the rim 1903–1913, the prints' black from 1911) down past the rules
 *  box's bottom (1923.6) — as M15_HOLO_STAMP_KEEP_OUT is for the oval's
 *  arch. */
export const M15UB_HOLO_STAMP_KEEP_OUT: Rect = { leftPct: pctX(650), topPct: pctY(1897), widthPct: pctX(200), heightPct: pctY(27) };

/** The rules keep-out while the PREPARE stamp is drawn (TODO 4.27b): the
 *  arch over the creature's box and the strip — the lifted bevel's top at
 *  the centre (1927 − 35.8 = 1891.2 px; scripts/lib/prepare-2026.mjs
 *  PREPARE_STAMP) less 1 px of air, down to the black border (1950), over
 *  the piece's 654–846 px. Only the creature's box reaches it (its rules
 *  rect ends at 1923.6; the page's at 1852). */
export const PREPARE_HOLO_STAMP_KEEP_OUT: Rect = { leftPct: pctX(654), topPct: pctY(1890), widthPct: pctX(192), heightPct: pctY(60) };

/** What a `holoStamp` overlay slot declares beside its notch image
 *  (FrameOverlaySlot, lib/cards/template-layout.ts). */
export type HoloStampArt = {
  /** The shape this frame's notch is cut for — what every "on" value draws. */
  shape: HoloStampShape;
  /** The shape's rect: the ellipse the oval art fills, or the triangle's
   *  bounding box (M15UB_HOLO_STAMP_BOX). */
  oval: Rect;
  /** The rules keep-out over the arch while the stamp is drawn: one rect
   *  (its bounds, where `keepOutShape` is set). */
  keepOut: Rect;
  /** The keep-out as the arch's SHAPE (TODO 4.9d: the borderless frames'
   *  columns, borderlessArchKeepOut) — what the rules boxes read in place
   *  of `keepOut` when set. */
  keepOutShape?: readonly Rect[];
  /** Every "on" value draws THIS shape — unless it names the other one: the
   *  frame then draws nothing (the borderless frames, owner Round 70: no
   *  triangle notch yet). */
  ownShapeOnly?: true;
  /** The notch is drawn ABOVE the ability rows and the rules backdrop, not
   *  in the frame layer (the borderless walkers, TODO 4.9d): their window
   *  is see-through and the rows' translucent stripes are drawn over it, so
   *  in the frame layer the arch would show through a stripe — print ends
   *  the window AT the arch. Both renderers then draw the notch, its foil
   *  sheen (as a plate's) and the oval after the rules layer, and leave the
   *  notch out of the frame layer and the finish masks. */
  aboveRows?: true;
  /** The oval sits on a painted STRIP, not on the notch's black (the OTJ
   *  Breaking News showcase: its notch piece is filled with the charcoal
   *  strip, HOLO_STAMP_STRIP_RING_RGB): the art's margin is the strip's
   *  colour and it draws no dark keyline, as print's hologram meets the
   *  strip directly (OTP #1–65) — HOLO_STAMP_OVAL_STRIP_ART. */
  ring?: "strip";
};

/** The Breaking News footer strip's charcoal (scripts/lib/cc-frames.mjs
 *  BREAKING_NEWS_STRIP_RGB, the notch piece's fill; a unit test holds the
 *  two together): the oval's ring where HoloStampArt.ring is "strip". */
export const HOLO_STAMP_STRIP_RING_RGB = [64, 58, 60] as const;

/**
 * The stamp value a frame stores (normalizeAnatomy): "none" for a value
 * naming the other shape on a frame that draws only its own (a triangle
 * printing on a borderless frame, owner Round 70), else the value as given.
 */
export function stampValueForFrame<T>(stamp: T, art: Pick<HoloStampArt, "shape" | "ownShapeOnly"> | null | undefined): T | "none" {
  if (!art?.ownShapeOnly) return stamp;
  return (stamp === "oval" || stamp === "triangle") && stamp !== art.shape ? "none" : stamp;
}
