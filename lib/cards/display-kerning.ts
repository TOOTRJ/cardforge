// ---------------------------------------------------------------------------
// The display face's collision-guard kerns, zeroed (layout v72).
//
// Beleren Bold (public/fonts/Beleren-Bold.ttf, "Version P1.01") kerns a few
// pairs APART where the two letters' ink would otherwise touch: K's leg and
// R's leg over a descender (K→y +0.25 em, R→y +0.31 em, R→j +0.33 em), f's
// hook over an ascender or i's dot (f→l +0.14 em, f→i +0.09 em), k's arm.
// Both renderers apply the font's GPOS, so "Kylox" baked as "K ylox" and
// "Snuffler" as "Snuff ler". The prints set every one of these pairs tight
// and let the ink touch or cross (Scryfall: Kylox, Kytheon, Ryusei, Reflector
// Mage, Skyfisher Spider, Elfhame Druid, Afflict, Griffin Aerie — the
// before/after sheet of the PR).
//
// So the committed font files carry those pairs' positive kerns at 0
// (scripts/fix-beleren-kerning.mjs — the same pairs, and the same pairs with
// an accented right letter, "fí"). Every OTHER pair keeps the font's value:
// the tightening ones (AV, To, Ty), the capital pairs no print has shown us
// (R→A, K→A, f→T), the small spacing pairs (r→y, f→u) and every pair with a
// digit or a punctuation mark (f→’ is spaced on print: "Aardwolf's").
//
// Client-safe, no imports. The list is DATA: the script, the layout scope
// (lib/cards/layout-version.ts kerningGuardsChanged) and the test that reads
// the font (tests/unit/cards/display-kerning.test.ts) all read it.
// ---------------------------------------------------------------------------

/** The pairs whose positive kern the committed Beleren carries at 0: left
 *  letter, then right letter (ASCII; an accented right letter counts by its
 *  base, see hasZeroedKernPair). Never grow it without print evidence. */
export const ZEROED_DISPLAY_KERN_PAIRS: readonly string[] = [
  "Kj", "Ky",
  "Qg", "Qj", "Qy",
  "Rg", "Rj", "Rp", "Ry",
  "fb", "fh", "fi", "fj", "fk", "fl", "fx",
  "kv", "kw", "kx", "ky", "kz",
];

const PAIRS = new Set(ZEROED_DISPLAY_KERN_PAIRS);

/** A letter without its accents ("í" → "i"). */
function baseLetter(ch: string): string {
  return ch.normalize("NFD").charAt(0);
}

/** True when `text` holds one of the zeroed pairs, i.e. a line of it set in
 *  the display face drew differently before v72. Reads the characters as
 *  typed: a name set in synthesized small caps (TextSlot.smallCaps) draws
 *  capitals there, so this errs wide for those, never narrow. */
export function hasZeroedKernPair(text: string | null | undefined): boolean {
  if (!text) return false;
  const chars = Array.from(text);
  for (let i = 0; i + 1 < chars.length; i++) {
    if (PAIRS.has(chars[i] + baseLetter(chars[i + 1]))) return true;
  }
  return false;
}
