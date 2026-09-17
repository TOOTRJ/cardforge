// Shared design-watermark model — the faint mark behind the rules text
// (cards.watermark). Client-safe (no fs): the preview renders mana marks via
// the mana font and preset/custom marks via <img>; the Satori bake mirrors
// it with the same constants (lib/render/card-image.tsx +
// getWatermarkDataUrl in lib/render/card-frames.ts) so both stay identical.
//
// Real-card conventions: watermarks sit centered behind the rules text at
// low opacity; basic lands' big centered mana symbol is technically a
// text-box treatment, but modeling it as the "large" watermark size matches
// how every card creator does it.

import type { CardWatermark } from "@/types/card";

/** Neutral ink for preset/fallback watermarks — a darker shade of the cream
 *  text box, per the printed convention. */
export const WATERMARK_INK = "#3b3126";

/** Mana-glyph watermark ink per FRAME color key — printed cards tint the
 *  mark toward the card's color (the DOM Forest's big symbol is green, not
 *  gray). Multicolor and unknown keys fall back to the neutral ink. */
const WATERMARK_COLOR_INKS: Record<string, string> = {
  w: "#7d6e4d",
  u: "#28527a",
  b: "#2e2b29",
  r: "#8c3b2a",
  g: "#3d7247",
  c: "#55514b",
};

/** The ink a mana-glyph watermark renders in for a frame color key. */
export function watermarkInk(colorKey: string | null | undefined): string {
  return (colorKey && WATERMARK_COLOR_INKS[colorKey]) || WATERMARK_INK;
}

const WATERMARK_DEFAULT_OPACITY = 0.14;
/** The "large" (basic-land big symbol) treatment reads as line art, not a
 *  faint stamp — real basics print it near-solid. */
const WATERMARK_LARGE_DEFAULT_OPACITY = 0.85;

/** Original PipGlyph marks (public/watermarks/{key}.png, 1024px dark-ink
 *  line art on transparency). IP-safe: our own designs, never WotC trade
 *  dress. The PipGlyph Rose (the brand's Astral Rose seal, generated from
 *  public/brand/pipglyph-mark-mono-black.svg) leads the list. */
export const WATERMARK_PRESETS = [
  { key: "pipglyph-rose", label: "PipGlyph Rose" },
  { key: "order-sun", label: "Order of the Sun" },
  { key: "tide-crest", label: "Tide Crest" },
  { key: "raven-skull", label: "Raven Skull" },
  { key: "ember-fang", label: "Ember Fang" },
  { key: "wildwood-antler", label: "Wildwood Antler" },
  { key: "gearworks-cog", label: "Gearworks Cog" },
  { key: "twin-serpent", label: "Twin Serpent" },
  { key: "crown-laurel", label: "Crown Laurel" },
] as const;

const WATERMARK_PRESET_KEYS = WATERMARK_PRESETS.map((p) => p.key);

/** Card types that carry the PipGlyph Rose watermark by default for free
 *  accounts and NO watermark for subscribers (owner decision 2026-09-17).
 *  Every other type keeps the user's own choice under Advanced. */
export const DEFAULT_WATERMARK_CARD_TYPES: ReadonlySet<string> = new Set([
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
]);

export function usesDefaultWatermark(cardType: string | null | undefined): boolean {
  return Boolean(cardType && DEFAULT_WATERMARK_CARD_TYPES.has(cardType));
}

export const PIPGLYPH_ROSE_WATERMARK: CardWatermark = {
  kind: "preset",
  key: "pipglyph-rose",
  size: "normal",
};

/** The watermark a NEW card of `cardType` starts with: the Rose for a free
 *  account on the default types, nothing otherwise. */
export function defaultWatermarkFor(
  cardType: string | null | undefined,
  paid: boolean,
): CardWatermark | null {
  return usesDefaultWatermark(cardType) && !paid ? PIPGLYPH_ROSE_WATERMARK : null;
}

export function isWatermarkPresetKey(key: string): boolean {
  return (WATERMARK_PRESET_KEYS as string[]).includes(key);
}

// ---------------------------------------------------------------------------
// Basic-land detection — the ONE rule both renderers and the creator use to
// decide "big mana symbol, no rules text" vs "rules text".
//
// A land is BASIC when it carries the Basic supertype (the printed rule:
// "Basic Land — Forest", "Basic Snow Land — Island"; Wastes is "Basic Land"
// with no land type and is recognised by name). The subtype alone is NOT
// enough — dual lands like Breeding Pool ("Land — Forest Island") print
// rules text — and, until 2026-09, keying on the subtype alone was what made
// nonbasics go textless: the creator seeds every new Land as a basic, and a
// card renamed to Command Tower (or a Scryfall import that carried no
// supertype/subtypes of its own) kept the seed's "Plains"/"Wastes" subtype
// and lost its text box. One legacy fallback remains for rows written
// before the seed existed and for AI output: a land with a basic subtype,
// NO supertype and NO rules text has nothing else to print, so it stays a
// basic.
// ---------------------------------------------------------------------------

// Basic land types → the mana symbol their text box prints. Real basics
// replace the rules text with a large centered symbol (Portal/6ED+). Wastes
// has no land type in the rules; "wastes" stays here only so legacy rows
// that stored it as a subtype keep rendering.
const BASIC_LAND_KEYS: Record<string, "w" | "u" | "b" | "r" | "g" | "c"> = {
  plains: "w",
  island: "u",
  swamp: "b",
  mountain: "r",
  forest: "g",
  wastes: "c",
};

/** Frame color key → the basic land it maps to ("m" has no basic — real
 *  multicolor lands are nonbasics like Command Tower). Single source for the
 *  creator's land auto-naming and the frame-compare sample cards. */
export const BASIC_LAND_NAME_BY_KEY: Record<
  "w" | "u" | "b" | "r" | "g" | "c",
  string
> = {
  w: "Plains",
  u: "Island",
  b: "Swamp",
  r: "Mountain",
  g: "Forest",
  c: "Wastes",
};

/** The basic land name for a frame color key, or null for "m"/unknown. */
export function basicLandNameForColorKey(key: string): string | null {
  return (
    BASIC_LAND_NAME_BY_KEY[key as keyof typeof BASIC_LAND_NAME_BY_KEY] ?? null
  );
}

/** The fields the basic-land rule reads — a slice every renderer's face
 *  object and the creator's live form both provide. */
export type BasicLandFace = {
  cardType: string | null | undefined;
  supertype?: string | null;
  subtypes?: readonly string[] | null;
  title?: string | null;
  rulesText?: string | null;
};

/** True when the supertype carries "Basic" ("Basic", "Basic Snow", …). */
export function hasBasicSupertype(supertype: string | null | undefined): boolean {
  return /\bbasic\b/i.test(supertype ?? "");
}

/** Strip an optional "Snow-Covered " prefix and normalise for name checks. */
function normalizeLandTitle(title: string | null | undefined): string {
  return (title ?? "")
    .trim()
    .toLowerCase()
    .replace(/^snow-covered\s+/, "");
}

/** True when the title IS one of the six basics (Snow-Covered variants too)
 *  — what the creator's seed writes, and what a user keeps when they really
 *  are making a basic. */
export function isBasicLandTitle(title: string | null | undefined): boolean {
  return normalizeLandTitle(title) in BASIC_LAND_KEYS;
}

/** The mana key of the first basic land type among the subtypes. */
export function basicSubtypeManaKey(
  subtypes: readonly string[] | null | undefined,
): "w" | "u" | "b" | "r" | "g" | "c" | null {
  for (const s of subtypes ?? []) {
    const key = BASIC_LAND_KEYS[s.trim().toLowerCase()];
    if (key) return key;
  }
  return null;
}

/**
 * The mana key a BASIC land prints as its big symbol, else null (the land is
 * nonbasic and prints rules text — or the card isn't a land). Drives the
 * automatic big-symbol treatment in both renderers and the Text step's
 * icon-vs-text editor in the creator.
 */
export function basicLandManaKey(
  face: BasicLandFace,
): "w" | "u" | "b" | "r" | "g" | "c" | null {
  if (face.cardType !== "land") return null;
  const subtypeKey = basicSubtypeManaKey(face.subtypes);
  if (hasBasicSupertype(face.supertype)) {
    // Wastes: "Basic Land" with no land type — the name identifies it.
    return subtypeKey ?? (normalizeLandTitle(face.title) === "wastes" ? "c" : null);
  }
  // Legacy/AI shape: basic subtype, no supertype, nothing else to print.
  if (subtypeKey && !face.supertype?.trim() && !face.rulesText?.trim()) {
    return subtypeKey;
  }
  return null;
}

/** The watermark a face should actually render: an explicit pick wins;
 *  otherwise basic lands get the authentic large mana symbol automatically. */
export function resolveWatermark(
  watermark: CardWatermark | null | undefined,
  face: BasicLandFace,
): CardWatermark | null {
  if (watermark) return watermark;
  const key = basicLandManaKey(face);
  return key ? { kind: "mana", key, size: "large" } : null;
}

export function watermarkOpacity(wm: CardWatermark): number {
  return (
    wm.opacity ??
    (wm.size === "large"
      ? WATERMARK_LARGE_DEFAULT_OPACITY
      : WATERMARK_DEFAULT_OPACITY)
  );
}

/** The mark's height as a fraction of the rules rect height. "normal" fills
 *  ~62% (a faint stamp behind text); "large" ~92% (the basic-land big
 *  symbol). Width is left to the intrinsic aspect (marks are square-ish). */
export function watermarkHeightFraction(wm: CardWatermark): number {
  return wm.size === "large" ? 0.92 : 0.62;
}
