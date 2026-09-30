import {
  KEYRUNE_CODEPOINTS,
  KEYRUNE_DEFAULT_CODEPOINT,
  KEYRUNE_GLYPHS,
  KEYRUNE_UNITS_PER_EM,
} from "@/lib/cards/keyrune-metrics";
import { printedSetSymbolPx } from "@/lib/cards/set-symbol-prints";
import type { FrameProfile } from "@/lib/cards/template-layout";
import {
  displayPct,
  KEYRUNE_EM_PER_BOX,
  RULES_HD_WIDTH,
  SET_SYMBOL_KEYLINE_EM,
  SET_SYMBOL_MAX_WIDTH_PCT,
} from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// How big a card's set symbol draws (TODO 4.20, layout v32) — the ONE size
// rule both renderers (components/cards/card-preview.tsx, the Satori bake in
// lib/render/card-image.tsx) and the MSE report script read.
//
// A profile's set-symbol BOX is `symbolSizePct`, or — for a profile that
// sets none (every frame outside the M15-era family) — `type.sizePct × 1.1`,
// the size every frame drew at before v32. What draws in it:
//   • an uploaded icon and the default PipGlyph mark: contained in a square
//     of the box;
//   • a Keyrune glyph, on a profile with `setSymbolFit: "ink"` (the M15-era
//     family): at the size its set PRINTS at when the set was measured
//     (lib/cards/set-symbol-prints.ts, layout v36, TODO 4.46): fitted inside
//     the printed box by its ink, never wider than CC's 0.12 W symbol box —
//     by its ink AND the keyline's ring on a profile that draws one
//     (`setSymbolKeyline`, the borderless bars): the printed box is
//     keyline-inclusive;
//   • otherwise — a set with no print measurement, or `setSymbolFit:
//     "ink-box"` (the full-art basics) — fitted by its INK
//     (lib/cards/keyrune-metrics.ts, read from keyrune.ttf) to the box: the
//     font is box × KEYRUNE_EM_PER_BOX (0.065 W on M15, the full-art basics'
//     print-checked size), or smaller when the glyph's ink would then stand
//     taller than the box (a compact glyph like DOM's fills it exactly) or
//     wider than CC's 0.12 W symbol box (owner decision 2026-09-28);
//   • a Keyrune glyph on any other profile: the box IS its font size, as
//     before — so those frames bake byte-identically, whatever an override
//     sets symbolSizePct to (the flag is code-owned).
// The symbol is as wide as it draws: the square's side, or the glyph's
// advance at its font size. Its INK starts `inkLeftPct` into that width (a
// glyph's left side bearing; 0 for an icon or the mark; a printed-size glyph
// on a keylined profile: where its ring starts) — the measured type line's
// room ends a gap before the ink (lib/cards/render-tiers.ts).
// Client-safe (no fs).
// ---------------------------------------------------------------------------

/** Where a card's set symbol comes from — both renderers' order: an
 *  uploaded icon, else a preset Keyrune glyph, else the PipGlyph mark. */
export type SetSymbolSource =
  | { kind: "icon" }
  | { kind: "mark" }
  | { kind: "glyph"; codepoint: number };

/** The Keyrune glyph a set code draws — the bake's getKeyruneCodepoint
 *  lookup ("ss-" tolerated, case-insensitive), the default glyph for a code
 *  keyrune.css doesn't know (a bare `.ss`, as the preview shows it). */
export function keyruneCodepointFor(setCode: string): number {
  const key = setCode.toLowerCase().replace(/^ss-/, "");
  return Object.prototype.hasOwnProperty.call(KEYRUNE_CODEPOINTS, key)
    ? KEYRUNE_CODEPOINTS[key]
    : KEYRUNE_DEFAULT_CODEPOINT;
}

/** A card's set-symbol source from its two columns. */
export function setSymbolSource(iconUrl?: string | null, setCode?: string | null): SetSymbolSource {
  if (iconUrl) return { kind: "icon" };
  if (setCode) return { kind: "glyph", codepoint: keyruneCodepointFor(setCode) };
  return { kind: "mark" };
}

type SymbolProfile = Pick<FrameProfile, "symbolSizePct" | "setSymbolFit" | "type" | "orientation" | "setSymbolKeyline">;

/** The profile's set-symbol box side, as a fraction of card width. */
export function setSymbolBoxPct(profile: Pick<FrameProfile, "symbolSizePct" | "type">): number {
  return profile.symbolSizePct ?? profile.type.sizePct * 1.1;
}

export type SetSymbolSize = {
  /** The set-symbol box side (fraction of card width). */
  boxPct: number;
  /** What the renderer draws at (fraction of card width): the icon's or the
   *  mark's square side, or the Keyrune glyph's font size. */
  sizePct: number;
  /** A Keyrune glyph's advance in font units; null for an icon or the mark,
   *  which are exactly as wide as they are tall. */
  advanceUnits: number | null;
  /** The width the symbol takes in its band (fraction of card width). */
  drawnWidthPct: number;
  /** How far into that width its ink starts (fraction of card width): a
   *  Keyrune glyph's left side bearing at its font size, never negative; 0
   *  for an icon (its art may fill the square) and the mark. A printed-size
   *  glyph on a keylined profile starts at its ring instead — the bearing
   *  less SET_SYMBOL_KEYLINE_EM, negative where the ring reaches out of the
   *  advance box — so the type line stops a gap before the ring. */
  inkLeftPct: number;
};

/** The glyph a codepoint draws: itself, or the default glyph for one
 *  keyrune.ttf lacks. */
function glyphCodepoint(codepoint: number): number {
  return KEYRUNE_GLYPHS[codepoint] ? codepoint : KEYRUNE_DEFAULT_CODEPOINT;
}

function glyphMetrics(codepoint: number) {
  return KEYRUNE_GLYPHS[glyphCodepoint(codepoint)];
}

/** The set symbol's size on `profile` for `source` (setSymbolSource). */
export function setSymbolSize(profile: SymbolProfile, source: SetSymbolSource): SetSymbolSize {
  const boxPct = setSymbolBoxPct(profile);
  if (source.kind !== "glyph") {
    return { boxPct, sizePct: boxPct, advanceUnits: null, drawnWidthPct: boxPct, inkLeftPct: 0 };
  }
  const [advance, xMin, yMin, xMax, yMax] = glyphMetrics(source.codepoint);
  let sizePct = boxPct;
  // Where the symbol's silhouette starts in its advance, in em: the glyph's
  // left side bearing (a keylined printed-size glyph: less its ring).
  let silhouetteLeftEm = Math.max(0, xMin) / KEYRUNE_UNITS_PER_EM;
  if (profile.setSymbolFit === "ink" || profile.setSymbolFit === "ink-box") {
    const inkHeightEm = (yMax - yMin) / KEYRUNE_UNITS_PER_EM;
    const inkWidthEm = (xMax - xMin) / KEYRUNE_UNITS_PER_EM;
    const orientation = profile.orientation ?? "portrait";
    const maxWidthPct = displayPct(SET_SYMBOL_MAX_WIDTH_PCT, orientation);
    const printed = profile.setSymbolFit === "ink" ? printedSetSymbolPx(glyphCodepoint(source.codepoint)) : null;
    if (printed) {
      // The set's printed box (HD px on the portrait card, the same physical
      // size on a landscape one), the glyph fitted inside it by its ink. The
      // box is keyline-inclusive, so a profile that draws a keyline round
      // the glyph (the borderless bars' white SET_SYMBOL_KEYLINE, 0.05 em
      // out on every side) fits the ink AND the ring — to the box and to
      // CC's 0.12 W — and its type line stops a gap before the ring.
      const ringEm = profile.setSymbolKeyline ? SET_SYMBOL_KEYLINE_EM : 0;
      const heightEm = inkHeightEm + 2 * ringEm;
      const widthEm = inkWidthEm + 2 * ringEm;
      const [heightPct, widthPct] = printed.map((px) => displayPct(px / RULES_HD_WIDTH.portrait, orientation));
      sizePct = Math.min(
        heightEm > 0 ? heightPct / heightEm : Infinity,
        widthEm > 0 ? widthPct / widthEm : Infinity,
        widthEm > 0 ? maxWidthPct / widthEm : Infinity,
      );
      silhouetteLeftEm -= ringEm;
    } else {
      sizePct = Math.min(
        boxPct * KEYRUNE_EM_PER_BOX,
        inkHeightEm > 0 ? boxPct / inkHeightEm : Infinity,
        inkWidthEm > 0 ? maxWidthPct / inkWidthEm : Infinity,
      );
    }
  }
  return {
    boxPct,
    sizePct,
    advanceUnits: advance,
    drawnWidthPct: (advance * sizePct) / KEYRUNE_UNITS_PER_EM,
    inkLeftPct: silhouetteLeftEm * sizePct,
  };
}

/** The drawn width in whole-px renderer terms — the bake's: the symbol is
 *  drawn at Math.round(sizePct × width) px, and a glyph is then as wide as
 *  its advance at that font size (Satori sizes a text node by its advances). */
export function setSymbolDrawnPx(size: SetSymbolSize, cardWidth: number): number {
  const px = Math.round(size.sizePct * cardWidth);
  return size.advanceUnits === null ? px : (size.advanceUnits * px) / KEYRUNE_UNITS_PER_EM;
}
