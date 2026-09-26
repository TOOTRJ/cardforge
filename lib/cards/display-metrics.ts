// Measured advance widths of the display face — CardDisplay, Beleren Bold
// (public/fonts/Beleren-Bold.ttf, the committed master both renderers load:
// the preview through globals.css, the bake through lib/render/card-fonts.ts).
//
// The single-line fit (fitSingleLineSizePct) counts every character at one
// average advance, 0.56 em. That errs wide on purpose for type lines, but a
// name that only just reaches the pips would shrink ~13 % when it needed
// under 1 % (Miner the Miner, Damned Delver). The title next to a detached
// cost (lib/cards/title-band.ts) measures its text here instead, so it
// shrinks only as far as it must — the way a printed name is set.
//
// Kerning is left out: Beleren's pairs mostly tighten (a public title's
// kerned width is 97.5 % of this sum at the median, 101.2 % at the worst),
// and the title fit keeps its own headroom for the rest.
// tests/unit/cards/display-metrics.test.ts re-measures the table from the TTF.

/** Advances of printable ASCII (U+0020–U+007E, in code-point order), in
 *  thousandths of an em. */
const ASCII_ADVANCE_MILLI_EM = [
  240, 296, 405, 620, 453, 860, 630, 215, 347, 347, 543, 620, 276, 523, 276, 414,
  620, 450, 524, 495, 569, 524, 588, 494, 596, 588, 276, 276, 620, 620, 620, 536,
  780, 639, 601, 592, 697, 543, 490, 689, 705, 350, 355, 660, 505, 840, 675, 718,
  590, 718, 635, 509, 550, 645, 600, 900, 648, 600, 527, 347, 355, 347, 620, 500,
  400, 511, 590, 492, 585, 510, 370, 500, 595, 295, 295, 551, 295, 836, 596, 566,
  590, 580, 425, 405, 375, 590, 510, 740, 545, 510, 458, 347, 300, 347, 620,
] as const;

/** The typographic punctuation card names use (curly quotes, dashes, the
 *  ellipsis, a bullet, the minus sign), in thousandths of an em. */
const PUNCTUATION_ADVANCE_MILLI_EM: Readonly<Record<string, number>> = {
  "\u2018": 276, // left single quote
  "\u2019": 276, // right single quote / apostrophe
  "\u201c": 502, // left double quote
  "\u201d": 502, // right double quote
  "\u2013": 671, // en dash
  "\u2014": 831, // em dash
  "\u2022": 366, // bullet
  "\u2026": 870, // ellipsis
  "\u2212": 640, // minus sign
};

/** A character the table does not know (another script, an emoji): counted
 *  at a full em, wider than any Latin capital here, so a name set in a
 *  fallback face shrinks early rather than ellipsizing. */
const UNKNOWN_ADVANCE_EM = 1;

/** One character's advance in em. Accented Latin letters measure as their
 *  base letter: Beleren draws them on the same advance (ñ = n, é = e) or a
 *  little narrower (ō by 0.034 em), so they are never under-counted. */
function advanceEm(ch: string): number {
  if (/\p{M}/u.test(ch)) return 0; // a combining accent rides on its letter
  const at =(c: string): number | undefined => {
    const code = c.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) return ASCII_ADVANCE_MILLI_EM[code - 0x20] / 1000;
    const punct = PUNCTUATION_ADVANCE_MILLI_EM[c];
    return punct === undefined ? undefined : punct / 1000;
  };
  return at(ch) ?? at(ch.normalize("NFD").charAt(0)) ?? UNKNOWN_ADVANCE_EM;
}

/**
 * Width of one line of display-face text at a 1 em font size (multiply by the
 * font size for the drawn width): the sum of its advances plus the letter
 * spacing after every character, as both renderers set it.
 */
export function displayTextWidthEm(
  text: string,
  { letterSpacingEm = 0, uppercase = false }: { letterSpacingEm?: number; uppercase?: boolean } = {},
): number {
  const chars = Array.from(uppercase ? text.toUpperCase() : text);
  return chars.reduce((w, ch) => w + advanceEm(ch) + letterSpacingEm, 0);
}
