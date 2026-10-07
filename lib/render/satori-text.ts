import "server-only";

import fontkit from "@pdf-lib/fontkit";
import type { SlotFace } from "@/lib/cards/type-faces";
import { faceFontBytes } from "@/lib/render/card-fonts";

// ---------------------------------------------------------------------------
// How Satori sets one run of text — the width its layout gives the text node
// versus the advance it actually draws — for the bake's centred display
// lines (TODO 4.31).
//
// Satori sizes a text node from each grapheme's OWN advance (no kerning) but
// draws the run kerned: opentype.js applies the font's GPOS pairs, and its
// 'liga' never forms Beleren's ffi ligature, so fontkit with liga off
// reproduces the drawn advance glyph for glyph (checked on every public
// production title, type line and artist credit). The browser sizes the box
// from the kerned run, so the two only disagree about where a line that is
// NOT at the start of its band goes.
// ---------------------------------------------------------------------------

type Font = ReturnType<typeof fontkit.create>;

const parsed = new Map<SlotFace, Font>();

function fontOf(face: SlotFace): Font {
  let font = parsed.get(face);
  if (!font) {
    font = fontkit.create(faceFontBytes(face));
    parsed.set(face, font);
  }
  return font;
}

/**
 * One single-line run at `fontPx`, in px, set in `face` (the slot's —
 * lib/cards/type-faces.ts slotFace; CardDisplay when the caller names
 * none): `box` is the width Satori's layout gives it, `ink` the advance it
 * draws. `text` must be what Satori sets — after displayLine and any
 * uppercase transform. (MPlantin kerns nothing: its box is its ink.)
 */
export function displayRunPx(
  text: string,
  fontPx: number,
  letterSpacingPx = 0,
  face: SlotFace = "display",
): { box: number; ink: number } {
  const display = fontOf(face);
  const scale = fontPx / display.unitsPerEm;
  const glyphs = display.glyphsForString(text);
  // Both sides add the tracking after every glyph, so it never moves the
  // difference; it only matters for "does the line fit".
  const tracking = glyphs.length * letterSpacingPx;
  return {
    box: glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) * scale + tracking,
    ink: display.layout(text, { liga: false }).advanceWidth * scale + tracking,
  };
}

// A Keyrune set glyph's advance is not measured here: both renderers read it
// from lib/cards/keyrune-metrics.ts (setSymbolSize / setSymbolDrawnPx in
// lib/cards/set-symbol-size.ts), generated from the same keyrune.ttf.
