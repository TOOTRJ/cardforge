import { MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";
import { clampManaValue } from "@/lib/decks/import-resolution";
import { isScryfallPrintingImage } from "@/lib/media/media-urls";

// ---------------------------------------------------------------------------
// The commit half of a decklist import, as a pure plan. The app merges the
// list's own duplicate lines and builds each entry's fields; the database
// (migration 0143, `import_deck_entries`) merges them into the rows the deck
// already holds and inserts the rest — in ONE transaction under a per-deck
// lock, so a double submit can never read the same rows twice and insert
// every line twice (it used to: read-then-write in the app).
// ---------------------------------------------------------------------------

/** The most entry ROWS a deck may hold — the `deck_cards` cap of migration
 *  0143 (`guard_deck_entry_limit`, `import_deck_entries`). A unit test holds
 *  the two equal. Quantities don't count: one row is N copies. */
export const MAX_DECK_ENTRIES = 500;

export type ImportResolvedCard = {
  scryfall_id: string;
  name: string;
  set_code: string | null;
  collector_number: string | null;
  type_line: string | null;
  mana_cost: string | null;
  mana_value: number | null;
  color_identity: string[];
  rarity: string | null;
  image_url: string | null;
};

export type ImportCommitLine = {
  board: string;
  quantity: number;
  name: string;
  /** null = an unresolved placeholder row (name only). */
  resolved: ImportResolvedCard | null;
};

/** One entry as `import_deck_entries` takes it: deck_cards' own keys. */
export type ImportEntry = {
  board: string;
  quantity: number;
  name: string;
  scryfall_id: string | null;
  set_code: string | null;
  collector_number: string | null;
  type_line: string | null;
  mana_cost: string | null;
  mana_value: number | null;
  color_identity: string[];
  rarity: string | null;
  image_url: string | null;
};

export type ImportPlan = {
  /** One entry per merge key, in the list's order. */
  entries: ImportEntry[];
  /** Lines that go in as name-only placeholders. */
  placeholders: number;
};

/** Merge key: same board + same card — Scryfall id when the row has one,
 *  else the case-insensitive name (covers placeholders). The SQL side of
 *  0143 matches the deck's rows with the same rule. */
export function importMergeKey(row: {
  board: string;
  scryfall_id: string | null;
  name: string;
}): string {
  return `${row.board}|${row.scryfall_id ?? `name:${row.name.trim().toLowerCase()}`}`;
}

/** Only Scryfall printing images survive — belt-and-braces against a
 *  tampered client posting arbitrary hotlinks into public deck pages. The
 *  SAME rule migration 0127 enforces on `deck_cards.image_url`
 *  (isScryfallPrintingImage): a URL the database would refuse becomes null
 *  here, so one odd image drops that picture instead of failing the whole
 *  import (every entry goes in with one insert). */
export function scryfallImageOnly(url: string | null): string | null {
  return isScryfallPrintingImage(url) ? url : null;
}

export function planImportEntries(lines: ImportCommitLine[]): ImportPlan {
  // Duplicate keys WITHIN the payload merge as we go (an exact line and a
  // fuzzy-rescued typo of it, same board and printing); the database refuses
  // a payload that still holds two entries with one key.
  const byKey = new Map<string, ImportEntry>();
  const entries: ImportEntry[] = [];
  let placeholders = 0;

  for (const line of lines) {
    const resolved = line.resolved;
    if (!resolved) placeholders += 1;
    const candidate: ImportEntry = {
      board: line.board,
      quantity: Math.min(line.quantity, MAX_ENTRY_QUANTITY),
      name: (resolved?.name ?? line.name).trim(),
      scryfall_id: resolved?.scryfall_id ?? null,
      set_code: resolved?.set_code ?? null,
      collector_number: resolved?.collector_number ?? null,
      type_line: resolved?.type_line ?? null,
      mana_cost: resolved?.mana_cost ?? null,
      mana_value: clampManaValue(resolved?.mana_value),
      color_identity: resolved?.color_identity ?? [],
      rarity: resolved?.rarity ?? null,
      image_url: scryfallImageOnly(resolved?.image_url ?? null),
    };
    const key = importMergeKey(candidate);
    const pending = byKey.get(key);
    if (pending) {
      pending.quantity = Math.min(pending.quantity + line.quantity, MAX_ENTRY_QUANTITY);
      continue;
    }
    byKey.set(key, candidate);
    entries.push(candidate);
  }

  return { entries, placeholders };
}

// ---------------------------------------------------------------------------
// Errors the database raises on an entry write (migration 0143), read back
// into words a person can act on.
// ---------------------------------------------------------------------------

export type DeckEntryWriteError = { message?: string | null; details?: string | null } | null | undefined;

/** The 500-row cap: `deck_entry_limit` (check_violation), with
 *  `existing=N,adding=M` in its detail when the database knows the numbers. */
export function deckEntryLimitMessage(error: DeckEntryWriteError): string | null {
  if (!error?.message?.includes("deck_entry_limit")) return null;
  const numbers = /existing=(\d+),adding=(\d+)/.exec(error.details ?? "");
  const cap = MAX_DECK_ENTRIES.toLocaleString("en-US");
  if (!numbers) {
    return `A deck holds at most ${cap} different entries. Remove some lines, or start a second deck for the rest.`;
  }
  const existing = Number(numbers[1]);
  const adding = Number(numbers[2]);
  const total = (existing + adding).toLocaleString("en-US");
  return existing >= MAX_DECK_ENTRIES
    ? `This deck already holds ${existing.toLocaleString("en-US")} different entries — the most a deck can hold is ${cap}. Lines for cards it already has still merge; new cards need another deck.`
    : `A deck holds at most ${cap} different entries — this import would bring it to ${total}. Remove some lines, or start a second deck for the rest.`;
}

/** `deck_not_owned`: the RPCs' own ownership check. */
export function isDeckNotOwnedError(error: DeckEntryWriteError): boolean {
  return Boolean(error?.message?.includes("deck_not_owned"));
}
