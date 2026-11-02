import { frontFaceName } from "@/lib/decks/parse-decklist";
import { typedForMatching } from "@/lib/validation/typed-forms";
import type { DeckBoard } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck page's add box (TODO DK5.2) as data — pure, shared by the box
// (components/decks/deck-add-box.tsx) and the server's add actions
// (lib/decks/add-actions.ts), so the copy count a result shows and the row
// an add lands on are ONE answer:
//
//   * "in deck ×N": a PipGlyph card by its id, a real card by its NAME (the
//     search shows one printing of each card; the deck may hold another),
//     the deck's boards summed — the maybeboard is never the deck, it is
//     named on its own;
//   * where an add lands: a card already on the chosen board gets one copy
//     more there — a PipGlyph card on its own entry, a real card on the
//     entry of the same printing, else of the same name (another printing,
//     your version of it) — never a second line for the same card;
//   * a typed search read the way a title is printed (TODO 6.11: ’ “ ” —):
//     the owner's card search matches both forms (`typedFoldPattern`, a
//     POSIX pattern for PostgREST's `imatch`).
// ---------------------------------------------------------------------------

/** Results shown per section. */
export const ADD_RESULTS_PER_SECTION = 6;
/** A search shorter than this asks only the owner's cards. */
export const ADD_SEARCH_MIN_CHARS = 2;
/** The longest query the box sends. */
export const ADD_SEARCH_MAX_CHARS = 100;

type CountEntry = {
  board: DeckBoard;
  quantity: number;
  name: string;
  card_id: string | null;
  scryfall_id: string | null;
};

/** A card's name as two entries compare it: its front face, typed forms,
 *  any case ("Delver of Secrets // Insectile Aberration" is "delver of
 *  secrets"). */
export function cardNameKey(name: string): string {
  const front = frontFaceName(name) ?? name;
  return typedForMatching(front.trim().toLowerCase());
}

export type InDeckCount = { deck: number; maybe: number };

function countWhere(entries: readonly CountEntry[], match: (entry: CountEntry) => boolean): InDeckCount {
  const count = { deck: 0, maybe: 0 };
  for (const entry of entries) {
    if (!match(entry)) continue;
    if (entry.board === "maybe") count.maybe += entry.quantity;
    else count.deck += entry.quantity;
  }
  return count;
}

/** Copies of a PipGlyph card in the deck. */
export function inDeckCountForCard(entries: readonly CountEntry[], cardId: string): InDeckCount {
  const id = cardId.toLowerCase();
  return countWhere(entries, (entry) => entry.card_id?.toLowerCase() === id);
}

/** Copies of a real card in the deck, by name (any printing, your version
 *  of it included). */
export function inDeckCountForName(entries: readonly CountEntry[], name: string): InDeckCount {
  const key = cardNameKey(name);
  return countWhere(entries, (entry) => cardNameKey(entry.name) === key);
}

/** "In deck ×2" / "In the maybeboard ×1" — null when it is in neither. */
export function inDeckLabel(count: InDeckCount): string | null {
  if (count.deck > 0) return `In deck ×${count.deck}`;
  if (count.maybe > 0) return `In the maybeboard ×${count.maybe}`;
  return null;
}

/** What is being added. */
export type AddPick =
  | { kind: "card"; cardId: string; title: string }
  | { kind: "printing"; scryfallId: string; name: string };

/**
 * The entry an add lands on — one copy more — or null for a new line. On
 * the chosen board only (the same card on another board is the owner's
 * other line, never merged into): a PipGlyph card's own entry; a real
 * card's printing, else an entry of the same name that stands for a real
 * card (it has a printing).
 */
export function addTargetEntry<E extends CountEntry & { id: string }>(
  entries: readonly E[],
  pick: AddPick,
  board: DeckBoard,
): E | null {
  const onBoard = entries.filter((entry) => entry.board === board);
  if (pick.kind === "card") {
    const id = pick.cardId.toLowerCase();
    return onBoard.find((entry) => entry.card_id?.toLowerCase() === id) ?? null;
  }
  const id = pick.scryfallId.toLowerCase();
  // The real card itself before your version of it — of the printing, then
  // of the name.
  const exact = onBoard.filter((entry) => entry.scryfall_id?.toLowerCase() === id);
  if (exact.length > 0) return exact.find((entry) => !entry.card_id) ?? exact[0];
  const key = cardNameKey(pick.name);
  const sameName = onBoard.filter((entry) => entry.scryfall_id && cardNameKey(entry.name) === key);
  return sameName.find((entry) => !entry.card_id) ?? sameName[0] ?? null;
}

/** Where a PipGlyph card already is when it is NOT on the chosen board —
 *  the deck holds one entry a card (add_custom_deck_entry), so the add says
 *  where instead of adding a second line. */
export function cardElsewhere<E extends CountEntry>(entries: readonly E[], cardId: string, board: DeckBoard): E | null {
  const id = cardId.toLowerCase();
  return entries.find((entry) => entry.board !== board && entry.card_id?.toLowerCase() === id) ?? null;
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;
/** The typed form of each printed character (lib/validation/typed-forms.ts)
 *  and every character it may be stored as. */
const FOLDED: Record<string, string> = {
  "'": "['‘’]",
  '"': '["“”]',
  "-": "[-–—]",
};

/**
 * A POSIX pattern matching `query` anywhere, read the way a title is typed:
 * an apostrophe matches ' ‘ ’, a quote " “ ”, a dash - – — (both sides
 * folded, as the gallery's search folds them — migration 0136; no `_`
 * wildcard: "n't" must not match "Constrictor"). Every other character is
 * itself (escaped). For PostgREST's case-insensitive `imatch`.
 */
export function typedFoldPattern(query: string): string {
  const typed = typedForMatching(query.trim());
  let out = "";
  for (const char of typed) {
    out += FOLDED[char] ?? char.replace(REGEX_SPECIAL, "\\$&");
  }
  return out;
}

/** The query as the box sends it: trimmed, inner runs of space one space,
 *  at most ADD_SEARCH_MAX_CHARS. */
export function normalizeAddQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, ADD_SEARCH_MAX_CHARS);
}

const NAME_WORD_BREAK = /[\s,'’-]+/;

/** The query's words appear in the name as whole words, in a row ("bolt"
 *  in "Lightning Bolt", never in "Boltwing"). */
function hasWholeWords(nameWords: readonly string[], queryWords: readonly string[]): boolean {
  if (queryWords.length === 0) return false;
  for (let i = 0; i + queryWords.length <= nameWords.length; i += 1) {
    if (queryWords.every((word, j) => nameWords[i + j] === word)) return true;
  }
  return false;
}

/**
 * Real cards in the order a typeahead should offer them, each tier in
 * Scryfall's own order (the most played first, `order=edhrec`):
 *
 *   0  the name typed whole            "Sol Ring" for "sol ring"
 *   1  a name that STARTS with the     "Sol Ring", "Sol Talisman" for "sol"
 *      query as whole words
 *   2  the query as whole words        "Lightning Bolt" for "bolt"
 *      anywhere else
 *   3  a name that starts with it      "Solemn Simulacrum", "Boltwing"
 *   4  a word that starts with it      "Arcbound Solemnist"
 *   5  the rest (Scryfall's fuzzier matches)
 *
 * So an exact WORD always beats a longer word that merely begins with the
 * query: "bolt" offers Lightning Bolt before Boltwing, "sol" Sol Ring
 * before Solemn Simulacrum.
 */
export function rankRealCards<C extends { name: string }>(cards: readonly C[], query: string, limit = ADD_RESULTS_PER_SECTION): C[] {
  const q = cardNameKey(query);
  if (!q) return cards.slice(0, limit);
  const queryWords = q.split(NAME_WORD_BREAK).filter(Boolean);
  const tier = (card: C) => {
    const name = cardNameKey(card.name);
    if (name === q) return 0;
    const words = name.split(NAME_WORD_BREAK).filter(Boolean);
    if (hasWholeWords(words.slice(0, queryWords.length), queryWords)) return 1;
    if (hasWholeWords(words, queryWords)) return 2;
    if (name.startsWith(q)) return 3;
    if (words.some((word) => word.startsWith(q))) return 4;
    return 5;
  };
  return cards
    .map((card, index) => ({ card, index, tier: tier(card) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .slice(0, limit)
    .map(({ card }) => card);
}

const SCRYFALL_PNG =/^(https:\/\/cards\.scryfall\.io\/)png(\/(?:front|back)\/[^?#]+)\.png((?:\?[^#]*)?)$/;

/** A Scryfall printing picture at the JPEG size a surface draws ("small"
 *  for the box's rows, "normal" for a card tile). The search route sends
 *  the PNG (lib/scryfall/client.ts pickPrintImageUrl); Scryfall serves each
 *  size under the same path. Anything else comes back as it is. */
export function scryfallPictureAt(url: string | null | undefined, size: "small" | "normal"): string | null {
  if (!url) return null;
  const match = SCRYFALL_PNG.exec(url);
  return match ? `${match[1]}${size}${match[2]}.jpg${match[3]}` : url;
}
