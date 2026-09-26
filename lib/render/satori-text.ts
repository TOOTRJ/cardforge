import "server-only";

import fontkit from "@pdf-lib/fontkit";
import { DISPLAY_FONT_BYTES, KEYRUNE_FONT_BYTES } from "@/lib/render/card-fonts";

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

let display: Font | null = null;
let keyrune: Font | null = null;

/**
 * One single-line CardDisplay run at `fontPx`, in px: `box` is the width
 * Satori's layout gives it, `ink` the advance it draws. `text` must be what
 * Satori sets — after displayLine and any uppercase transform.
 */
export function displayRunPx(
  text: string,
  fontPx: number,
  letterSpacingPx = 0,
): { box: number; ink: number } {
  display ??= fontkit.create(DISPLAY_FONT_BYTES);
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

/** The advance of one Keyrune set-symbol glyph at `fontPx`, in px. */
export function keyruneAdvancePx(glyph: string, fontPx: number): number {
  keyrune ??= fontkit.create(KEYRUNE_FONT_BYTES);
  const advance = keyrune
    .glyphsForString(glyph)
    .reduce((sum, g) => sum + g.advanceWidth, 0);
  return (advance * fontPx) / keyrune.unitsPerEm;
}
