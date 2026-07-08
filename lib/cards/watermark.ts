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

/** Neutral ink for mana-glyph watermarks — a darker shade of the cream text
 *  box, per the printed convention. (Tinting toward the frame color is a
 *  future polish: thread a colorHex through resolveWatermarkStyle.) */
export const WATERMARK_INK = "#3b3126";

const WATERMARK_DEFAULT_OPACITY = 0.14;
/** The "large" (basic-land big symbol) treatment reads as line art, not a
 *  faint stamp — real basics print it near-solid. */
const WATERMARK_LARGE_DEFAULT_OPACITY = 0.85;

/** Original PipGlyph faction-style marks (public/watermarks/{key}.png,
 *  1024px dark-ink line art on transparency). IP-safe: our own designs,
 *  never WotC trade dress. */
export const WATERMARK_PRESETS = [
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

export function isWatermarkPresetKey(key: string): boolean {
  return (WATERMARK_PRESET_KEYS as string[]).includes(key);
}

// Basic land types → the mana symbol their text box prints. Real basics
// replace the rules text with a large centered symbol (Portal/6ED+); Wastes
// keeps its one rules line printed over it.
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

/** The mana key for a basic land (card_type land + a basic subtype), else
 *  null. Drives the automatic big-symbol treatment in both renderers and
 *  hides the rules field in the editor. */
export function basicLandManaKey(
  cardType: string | null | undefined,
  subtypes: readonly string[] | null | undefined,
): "w" | "u" | "b" | "r" | "g" | "c" | null {
  if (cardType !== "land") return null;
  for (const s of subtypes ?? []) {
    const key = BASIC_LAND_KEYS[s.trim().toLowerCase()];
    if (key) return key;
  }
  return null;
}

/** The watermark a face should actually render: an explicit pick wins;
 *  otherwise basic lands get the authentic large mana symbol automatically. */
export function resolveWatermark(
  watermark: CardWatermark | null | undefined,
  cardType: string | null | undefined,
  subtypes: readonly string[] | null | undefined,
): CardWatermark | null {
  if (watermark) return watermark;
  const key = basicLandManaKey(cardType, subtypes);
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
