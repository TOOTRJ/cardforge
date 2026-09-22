import { MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";
import { clampManaValue } from "@/lib/decks/import-resolution";
import type { DeckCardInsert } from "@/types/supabase";

// ---------------------------------------------------------------------------
// The commit half of a decklist import, as a pure plan: which rows to insert
// and which existing rows get their quantity bumped. Kept out of the server
// action so the merge rules can be unit-tested — one of them guards against
// a real data-loss bug (see `quantityUpdates` below).
// ---------------------------------------------------------------------------

export type ExistingDeckRow = {
  id: string;
  board: string;
  quantity: number;
  position: number | null;
  scryfall_id: string | null;
  name: string;
};

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

export type ImportPlan = {
  inserts: DeckCardInsert[];
  /** One update per existing row, with the FINAL quantity (base + every
   *  matching line, clamped). */
  quantityUpdates: Array<{ id: string; quantity: number }>;
  placeholders: number;
};

/** Merge key: same board + same card — Scryfall id when the row has one,
 *  else the case-insensitive name (covers placeholders). */
export function importMergeKey(row: {
  board: string;
  scryfall_id: string | null;
  name: string;
}): string {
  return `${row.board}|${row.scryfall_id ?? `name:${row.name.trim().toLowerCase()}`}`;
}

/** Only image URLs from Scryfall's CDN survive — belt-and-braces against a
 *  tampered client posting arbitrary hotlinks into public deck pages. */
export function scryfallImageOnly(url: string | null): string | null {
  return url && url.startsWith("https://cards.scryfall.io/") ? url : null;
}

export function planImportWrites(
  deckId: string,
  existingRows: ExistingDeckRow[],
  lines: ImportCommitLine[],
): ImportPlan {
  const existingByKey = new Map(existingRows.map((row) => [importMergeKey(row), row]));
  let maxPosition = existingRows.reduce((max, row) => Math.max(max, row.position ?? 0), -1);

  const inserts: DeckCardInsert[] = [];
  // Accumulate quantity bumps PER existing row id. Two committed lines can
  // resolve to the same existing deck row (e.g. an exact line + a
  // fuzzy-rescued typo of it, same board/scryfall_id); pushing a separate
  // update for each (both computed from the same base quantity) made the
  // writes clobber each other last-write-wins, silently dropping one line's
  // copies. Summing here and issuing one update per row fixes it.
  const quantityAddByRowId = new Map<string, { base: number; added: number }>();
  // Duplicate keys WITHIN the payload merge as we go.
  const pendingByKey = new Map<string, DeckCardInsert>();
  let placeholders = 0;

  for (const line of lines) {
    const resolved = line.resolved;
    if (!resolved) placeholders += 1;
    const candidate: DeckCardInsert = {
      deck_id: deckId,
      board: line.board,
      quantity: line.quantity,
      position: 0, // assigned below for fresh inserts
      scryfall_id: resolved?.scryfall_id ?? null,
      name: resolved?.name ?? line.name,
      set_code: resolved?.set_code ?? null,
      collector_number: resolved?.collector_number ?? null,
      type_line: resolved?.type_line ?? null,
      mana_cost: resolved?.mana_cost ?? null,
      mana_value: clampManaValue(resolved?.mana_value),
      color_identity: resolved?.color_identity ?? [],
      rarity: resolved?.rarity ?? null,
      image_url: scryfallImageOnly(resolved?.image_url ?? null),
    };
    const key = importMergeKey({
      board: candidate.board ?? "main",
      scryfall_id: candidate.scryfall_id ?? null,
      name: candidate.name,
    });

    const pending = pendingByKey.get(key);
    if (pending) {
      pending.quantity = Math.min((pending.quantity ?? 1) + line.quantity, MAX_ENTRY_QUANTITY);
      continue;
    }

    const existing = existingByKey.get(key);
    if (existing) {
      const acc = quantityAddByRowId.get(existing.id) ?? { base: existing.quantity, added: 0 };
      acc.added += line.quantity;
      quantityAddByRowId.set(existing.id, acc);
      continue;
    }

    maxPosition += 1;
    candidate.position = maxPosition;
    pendingByKey.set(key, candidate);
    inserts.push(candidate);
  }

  return {
    inserts,
    quantityUpdates: Array.from(quantityAddByRowId, ([id, { base, added }]) => ({
      id,
      quantity: Math.min(base + added, MAX_ENTRY_QUANTITY),
    })),
    placeholders,
  };
}
