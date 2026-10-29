// ---------------------------------------------------------------------------
// The printed quotes and dashes, folded to what a keyboard types — for
// MATCHING only. Its own dependency-free module so a small client island
// (the help centre's filter box) can match the way My Cards does without
// importing the creator's typography pass; lib/validation/print-typography.ts
// re-exports both, and every existing caller imports them from there.
// ---------------------------------------------------------------------------

/** The printed quotes and dashes and what a keyboard types for each. The
 *  gallery's SQL search folds the same six the same way (migration 0136's
 *  translate(); a unit test holds the two together). */
export const TYPED_FORMS: Readonly<Record<string, string>> = {
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "—": "-",
  "–": "-",
};

/** `text` with its printed quotes and dashes as typed ones — for MATCHING
 *  only (a search box against a title), on BOTH sides of the comparison:
 *  cards saved since TODO 6.11 hold “Urza’s”, older ones and every keyboard
 *  hold "Urza's". Never stored, never drawn. */
export function typedForMatching(text: string): string {
  return text.replace(/[’‘“”—–]/g, (ch) => TYPED_FORMS[ch] ?? ch);
}
