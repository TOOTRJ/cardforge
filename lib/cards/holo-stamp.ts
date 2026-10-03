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
 *  and the Universes Beyond triangle (LTR-style frames, every rarity —
 *  wave 2, TODO 4.9d). */
export type HoloStampShape = "oval" | "triangle";

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
};

/**
 * Whether the switch value draws the stamp for a card (the template's
 * notch aside — resolveHoloStamp in lib/cards/anatomy.ts asks the profile):
 * "auto" on a rare or mythic; "oval" and "triangle" always; "none" and an
 * absent key never; never on a token or an emblem. The SHAPE drawn is the
 * template's own (the notch is cut for one shape): an imported "triangle"
 * on a wave-1 frame draws that frame's oval, and keeps its key for a frame
 * that prints the triangle (4.9d).
 */
export function holoStampWanted(stamp: unknown, facts: HoloStampFacts): boolean {
  if (!isHoloStampSwitch(stamp) || stamp === "none") return false;
  if (STAMPLESS_CARD_TYPES.has(facts.cardType ?? "")) return false;
  if (stamp === "auto") return AUTO_RARITIES.has((facts.rarity ?? "").toLowerCase());
  return true;
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

/** The walker's: from its notch piece's top (1893 px: the piece draws a
 *  black line above the rim) past its rules rect's bottom (1919.4). Read by
 *  the plain box only (a non-walker card on the frame, a walker with no
 *  abilities); the ability rows keep their own shield rule and get the arch
 *  in 4.9d. */
export const M15PW_HOLO_STAMP_KEEP_OUT: Rect = { leftPct: 43.94, topPct: 90.15, widthPct: 12.14, heightPct: 1.3 };

/** What a `holoStamp` overlay slot declares beside its notch image
 *  (FrameOverlaySlot, lib/cards/template-layout.ts). */
export type HoloStampArt = {
  /** The shape this frame's notch is cut for — what every "on" value draws. */
  shape: HoloStampShape;
  /** The oval's rect (the ellipse the art fills). */
  oval: Rect;
  /** The rules keep-out over the arch while the stamp is drawn. */
  keepOut: Rect;
};
