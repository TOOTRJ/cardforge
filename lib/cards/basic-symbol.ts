// ---------------------------------------------------------------------------
// The basic-land symbol slot (TODO 3.24) — the ONE model both renderers
// (components/cards/card-preview.tsx, lib/render/card-image.tsx) and the
// bake's asset preload (frameAssetPathsFor) read, so the preview and the
// stored PNG draw the same symbol at the same size in the same place.
//
// Without a slot, a basic land's symbol is the automatic `{mana, large}`
// watermark, drawn centred in the rules rect at 0.92 of its height. On a
// full-art frame that rect is most of the card, so the bake painted a ~1,200
// px glyph across the art while the frame's own symbol socket stayed empty.
// A profile that sets `basicSymbol` (FrameProfile.basicSymbol) draws a
// basic's symbol in the socket instead, and skips the rules-rect watermark;
// every other card on that profile keeps the rules-rect watermark.
// ---------------------------------------------------------------------------

import { basicLandManaKey, resolveWatermark, type BasicLandFace } from "@/lib/cards/watermark";
import type { BasicSymbolSlot, FrameProfile, Rect } from "@/lib/cards/template-layout";
import type { CardWatermark } from "@/types/card";

/** The symbol's size in its box: Card Conjurer's `s?.png` symbols fill
 *  136 of their 168 px box (81 %); the Mana font's basic glyphs are ~1 em
 *  tall, so the glyph is set at 0.8 of the disc's diameter. */
export const BASIC_SYMBOL_GLYPH_SCALE = 0.8;

/** The drawn disc's fill per FRAME colour key — Card Conjurer's Fullart
 *  Basics (2022) discs, sampled at their centres (`textless/2022/{w,u,b,r,g,
 *  m,l}.png`; "c" takes the land frame's `l`). */
export const BASIC_SYMBOL_DISC_FILL: Readonly<Record<string, string>> = {
  w: "#cec6ab",
  u: "#b4d1e4",
  b: "#bfb7b5",
  r: "#f2c2ab",
  g: "#bdd0c6",
  c: "#cec6c1",
  m: "#b9a66f",
};

/** The drawn symbol's ink per MANA key — the colour of Card Conjurer's
 *  2022 symbols (`s{w,u,b,r,g,c}.png`, their opaque pixels' mean). */
export const BASIC_SYMBOL_INK: Readonly<Record<string, string>> = {
  w: "#fdffff",
  u: "#0075be",
  b: "#1c1611",
  r: "#ef3827",
  g: "#007b43",
  c: "#ae9788",
};

/** The glyph's halo — in em so it scales with the symbol in both renderers
 *  (the white sun needs it on a pale disc; Card Conjurer's symbols carry a
 *  soft outer glow). */
export const BASIC_SYMBOL_HALO = "0 0.02em 0.06em rgba(0,0,0,0.55)";

/** What a basic land prints in the slot: its mana symbol, or the image of an
 *  explicit preset / custom watermark. */
export type BasicSymbolMark =
  | { kind: "mana"; key: "w" | "u" | "b" | "r" | "g" | "c" }
  | { kind: "preset"; key: string }
  | { kind: "custom"; url: string };

export type BasicSymbolPlan = {
  slot: BasicSymbolSlot;
  mark: BasicSymbolMark;
  /** An explicit watermark's own opacity, else fully opaque (it is the
   *  land's printed symbol now, not a faint stamp). */
  opacity: number;
};

/**
 * The symbol a face prints in its profile's basic-symbol slot, or null: the
 * profile has no slot, or the face is not a BASIC land (basicLandManaKey —
 * the same rule that suppresses a basic's rules text). An explicit watermark
 * swaps in: a mana watermark changes the symbol, a preset or custom image is
 * contained in the slot. When this returns a plan, neither renderer draws the
 * rules-rect watermark for the face.
 */
export function basicSymbolFor(
  profile: Pick<FrameProfile, "basicSymbol">,
  face: BasicLandFace,
  watermark: CardWatermark | null | undefined,
): BasicSymbolPlan | null {
  const slot = profile.basicSymbol;
  if (!slot || basicLandManaKey(face) === null) return null;
  const wm = resolveWatermark(watermark, face);
  // A basic always resolves (the automatic mana symbol); keep TS honest.
  if (!wm) return null;
  const mark: BasicSymbolMark =
    wm.kind === "mana"
      ? { kind: "mana", key: wm.key }
      : wm.kind === "preset"
        ? { kind: "preset", key: wm.key }
        : { kind: "custom", url: wm.url };
  return { slot, mark, opacity: watermark?.opacity ?? 1 };
}

/** The square box (a circle's bounding box) the disc and the symbol are
 *  centred in: the largest square inside `rect`, in card percent. `aspect`
 *  is the card's height / width (7/5 portrait, 5/7 landscape). */
export function basicSymbolBox(rect: Rect, aspect: number): Rect {
  const sideW = Math.min(rect.widthPct, rect.heightPct * aspect);
  const sideH = sideW / aspect;
  return {
    leftPct: rect.leftPct + (rect.widthPct - sideW) / 2,
    topPct: rect.topPct + (rect.heightPct - sideH) / 2,
    widthPct: sideW,
    heightPct: sideH,
  };
}

/** The glyph's font size as a fraction of the card's WIDTH (the unit every
 *  slot size uses: cqw in the preview, × width in the bake). */
export function basicSymbolGlyphSizePct(rect: Rect, aspect: number): number {
  return (basicSymbolBox(rect, aspect).widthPct / 100) * BASIC_SYMBOL_GLYPH_SCALE;
}

/** The symbol image a slot draws for a mana key, when it has one. */
export function basicSymbolAssetPath(slot: BasicSymbolSlot, key: string): string | null {
  return slot.assetPathTemplate ? slot.assetPathTemplate.replace("{symbol}", key) : null;
}

/** Every public/frames or frames-bucket asset a plan draws — the bake must
 *  preload these (frameAssetPathsFor). Watermark presets live in
 *  public/watermarks and custom images are inlined, so neither is listed. */
export function basicSymbolAssetPaths(plan: BasicSymbolPlan | null): string[] {
  if (!plan || plan.slot.style === "none" || plan.mark.kind !== "mana") return [];
  const path = basicSymbolAssetPath(plan.slot, plan.mark.key);
  return path ? [path] : [];
}
