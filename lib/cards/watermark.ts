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

export const WATERMARK_DEFAULT_OPACITY = 0.14;
/** The "large" (basic-land big symbol) treatment reads as line art, not a
 *  faint stamp — real basics print it near-solid. */
export const WATERMARK_LARGE_DEFAULT_OPACITY = 0.85;

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

export type WatermarkPresetKey = (typeof WATERMARK_PRESETS)[number]["key"];

export const WATERMARK_PRESET_KEYS = WATERMARK_PRESETS.map((p) => p.key);

export function isWatermarkPresetKey(key: string): boolean {
  return (WATERMARK_PRESET_KEYS as string[]).includes(key);
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
