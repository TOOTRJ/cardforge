// ---------------------------------------------------------------------------
// The display face's collision-guard kerns, zeroed (layout v72).
//
// THE RULE: the list is Beleren Bold's COLLISION-GUARD class — the positive
// kerns that push two letters APART only because their ink would otherwise
// touch or cross: K's and R's leg (and Q's tail) over a descender (K→y
// +0.25 em, R→y +0.31 em, R→j +0.33 em), f's hook over an ascender or i's
// dot (f→l / f→h / f→k / f→b +0.14 em, f→i +0.09 em), k's arm against a
// diagonal (k→x, k→y…). The prints set that whole class TIGHT and let the
// ink touch or cross; the font's guard is a digital-type habit, not the
// look of any card. Both renderers apply the font's GPOS, so "Kylox" baked
// as "K ylox" and "Snuffler" as "Snuff ler".
//
// Print evidence (Scryfall scans; the before/after sheet of PR #626), read
// pair by pair where a print shows it directly:
//   K→y       Kylox, Visionary Inventor; Kytheon, Hero of Akros
//   k→y       Skyfisher Spider
//   R→y       Ryusei, the Falling Star
//   f→l       Reflector Mage
//   f→h       Elfhame Druid
//   f→i       Skyfisher Spider
//   ffi, ffl  Griffin Aerie; Afflict (f→f is a tightening kern the font
//             keeps; the second f's hook meets the i / l as above)
// The rest of the class (K→j, Q→g / j / y, R→g / j / p, f→b / j / k / x,
// k→v / w / x / z) is the same guard on the same letter shapes, and is set
// tight with it rather than trimmed pair by pair.
//
// The committed font files carry those pairs' positive kerns at 0
// (scripts/fix-beleren-kerning.mjs). An ACCENTED right letter is its own
// GPOS record, zeroed only where the font kerns it as its plain pair: fí
// (+180 = fi). fì (+495), fî (+451) and fï (+631) are kerned far wider than
// fi (+180) — to keep the f's hook off the accent — and no print shows them
// set tight, so they keep the font's values (ACCENTED_KERNS_KEPT). No other
// accented right letter of a listed pair is kerned by the font at all.
// Every OTHER pair keeps the font's value: the tightening ones (AV, To, Ty),
// the capital pairs no print has shown us (R→A, K→A, f→T), the small spacing
// pairs (r→y, f→u) and every pair with a digit or a punctuation mark (f→’ is
// spaced on print: "Aardwolf's").
//
// Client-safe, no imports. The list is DATA: the script, the layout scope
// (lib/cards/layout-version.ts kerningGuardsChanged) and the test that reads
// the font (tests/unit/cards/display-kerning.test.ts) all read it.
// ---------------------------------------------------------------------------

/** The pairs whose positive kern the committed Beleren carries at 0: left
 *  letter, then right letter (ASCII). Never grow it without print evidence
 *  for the pair's class. */
export const ZEROED_DISPLAY_KERN_PAIRS: readonly string[] = [
  "Kj", "Ky",
  "Qg", "Qj", "Qy",
  "Rg", "Rj", "Rp", "Ry",
  "fb", "fh", "fi", "fj", "fk", "fl", "fx",
  "kv", "kw", "kx", "ky", "kz",
];

/** The listed pairs with an accented right letter that the font kerns as
 *  its plain pair, zeroed with it (precomposed, NFC). */
export const ZEROED_ACCENTED_KERN_PAIRS: readonly string[] = ["fí"];

/** The listed pairs' accented forms the font kerns far wider than the plain
 *  pair, left at the font's values (font units at 2048 per em). */
export const ACCENTED_KERNS_KEPT: Readonly<Record<string, number>> = { "fì": 495, "fî": 451, "fï": 631 };

/** Every two-character sequence whose kern the committed font zeroed. */
const PAIRS = new Set([...ZEROED_DISPLAY_KERN_PAIRS, ...ZEROED_ACCENTED_KERN_PAIRS]);

/** True when `text` holds one of the zeroed pairs, i.e. a line of it set in
 *  the display face drew differently before v72. Reads the characters as
 *  typed: a name set in synthesized small caps (TextSlot.smallCaps) draws
 *  capitals there, and a decomposed accent ("f" "i" U+0300) reads as its
 *  plain pair, so this errs wide for those, never narrow. */
export function hasZeroedKernPair(text: string | null | undefined): boolean {
  if (!text) return false;
  const chars = Array.from(text);
  for (let i = 0; i + 1 < chars.length; i++) {
    if (PAIRS.has(chars[i] + chars[i + 1])) return true;
  }
  return false;
}
