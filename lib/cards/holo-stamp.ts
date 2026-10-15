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

/** The rules keep-out while the BORDERLESS stamp is drawn (TODO 4.9d): the
 *  printed arch over the oval — the bar lifted 32.6 px at the centre, so its
 *  bevel's top at 1897.4 px (scripts/lib/borderless-stamp.mjs ARCH_LIFT_PX;
 *  the prints' rim ends at 1916 there) — with 5 px of air above it, x
 *  655–845 px as M15's, down past the rules box's bottom (1923.6): 1892–1925.
 *  Taller than M15's: the borderless bevel is a bright line over the art,
 *  where the bordered frame's is white on its cream box. */
export const M15BORDERLESS_HOLO_STAMP_KEEP_OUT: Rect = { leftPct: 43.67, topPct: (1892 / 2100) * 100, widthPct: 12.67, heightPct: (33 / 2100) * 100 };

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

/** What a `holoStamp` overlay slot declares beside its notch image
 *  (FrameOverlaySlot, lib/cards/template-layout.ts). */
export type HoloStampArt = {
  /** The shape this frame's notch is cut for — what every "on" value draws. */
  shape: HoloStampShape;
  /** The shape's rect: the ellipse the oval art fills, or the triangle's
   *  bounding box (M15UB_HOLO_STAMP_BOX). */
  oval: Rect;
  /** The rules keep-out over the arch while the stamp is drawn. */
  keepOut: Rect;
};
