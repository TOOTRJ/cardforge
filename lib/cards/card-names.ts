// ---------------------------------------------------------------------------
// How rules text names a card — the ONE set of helpers every path that finds
// a card's self-references reads (pure, no imports):
//
//   * the AI deck remix renaming a card's self-references
//     (lib/ai/remix-names.ts renameSelfReferences);
//   * the Scryfall import writing a flavour-name printing's own name as `~`
//     (TODO 6.2, lib/cards/self-name.ts oracleSelfNamesAsTokens).
//
// Moved here from lib/ai/remix-names.ts (TODO 6.2, independent check S2):
// the import must not re-implement them and drop their guards.
// ---------------------------------------------------------------------------

/**
 * The short name rules text calls a card by, or null: the part before the
 * comma ("Dokai, Weaver of Life" → "Dokai"), or — for a LEGENDARY face
 * without one — the ONE word before " the " ("Goka the Unjust" → "Goka":
 * Scryfall's oracle for the CHK flip reads "Goka deals 4 damage"). Never
 * shorter than 3 characters. A non-legendary "Curse of the Fire Penguin"
 * has no short name, nor does the legendary "Kodama of the North Tree"
 * (its rules text uses the full name).
 */
export function shortNameOf(
  name: string,
  supertype?: string | null,
): string | null {
  const title = name.trim();
  const comma = title.indexOf(",");
  let short = comma > 0 ? title.slice(0, comma).trim() : "";
  if (!short && /\blegendary\b/i.test(supertype ?? "")) {
    const the = title.indexOf(" the ");
    const head = the > 0 ? title.slice(0, the).trim() : "";
    if (head && !/\s/.test(head)) short = head;
  }
  return short.length >= 3 ? short : null;
}

// A one-word name that is also a word rules text starts sentences with
// ("Exile" is a real card; "Exile target creature." is not about it) can't
// be told apart from the instruction, so its self-references are left as
// they are. Compared case-insensitively.
const RULES_WORDS: ReadonlySet<string> = new Set([
  "activate", "add", "all", "another", "any", "as", "at", "attach", "attack",
  "block", "cast", "choose", "copy", "counter", "create", "destroy", "discard",
  "double", "draw", "each", "exchange", "exile", "explore", "fight", "flip",
  "gain", "if", "investigate", "it", "look", "lose", "mill", "play", "prevent",
  "proliferate", "put", "regenerate", "remove", "return", "reveal",
  "sacrifice", "scry", "search", "shuffle", "surveil", "take", "tap", "target",
  "that", "then", "this", "transform", "turn", "until", "untap", "up", "vote",
  "when", "whenever", "you",
]);

/** Whether a ONE-word name is a word rules text starts sentences with —
 *  never a self-reference ("Exile", "Proliferate"). A name with a space is
 *  never one. */
export function isRulesWord(name: string): boolean {
  return !/\s/.test(name.trim()) && RULES_WORDS.has(name.trim().toLowerCase());
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
