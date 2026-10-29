import { z } from "zod";
import { isUuid } from "@/lib/ids";
import { bringsCard } from "@/lib/decks/entry-status";
import { MAX_DECK_ENTRIES } from "@/lib/decks/import-plan";
import { MAX_DECKLIST_ENTRIES, MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";
import { MAX_MEMBERSHIP_BATCH } from "@/lib/decks/membership-copy";
import { DECK_BOARD_VALUES, isDeckBoard, type DeckBoard } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck page's batch writes (TODO DK5.4) as pure data: the payloads the
// server actions take (lib/decks/card-actions.ts — one deck per call, every
// entry of it at once, ONE revalidation), the grouping that makes a batch a
// handful of statements, and the plan that puts removed entries BACK.
//
// A removal is undone through the paths a card comes INTO a deck by —
// never a direct insert (CLAUDE.md: entry inserts go through the RPCs):
//
//   a printing (an import, with or without your version of it) or a
//   name-only line          → ONE decklist commit (import_deck_entries via
//                             commitDeckImportAction: the printing fetched
//                             again from Scryfall, never the browser's copy)
//                             on its board, at its quantity — then the card
//                             it had is linked back (the D3 guard judges it
//                             again: another creator's card that went
//                             private meanwhile comes back as the real card);
//   a PipGlyph card alone   → the ONE membership writer (add_custom_deck_entry
//                             via changeDeckMembershipAction), then its board
//                             and quantity.
//
// What a restored entry does NOT get back: its id, its place in "Recently
// added" and its position (it is new), and its `source` where the path
// writes its own ('import' for a line, 'link' for a card — descriptive,
// never a gate).
// ---------------------------------------------------------------------------

/** The most entries one batch call writes — a whole deck. */
export const MAX_ENTRY_BATCH = MAX_DECK_ENTRIES;

const entryIdSchema = z.string().refine((id) => isUuid(id), "Invalid deck entry id.");
const deckIdSchema = z.string().refine((id) => isUuid(id), "Invalid deck id.");

export const entryPatchSchema = z
  .object({
    id: entryIdSchema,
    quantity: z.number().int().min(1).max(MAX_ENTRY_QUANTITY).optional(),
    board: z.enum(DECK_BOARD_VALUES).optional(),
  })
  .refine((patch) => patch.quantity !== undefined || patch.board !== undefined, {
    message: "No changes provided.",
  });

export const updateEntriesSchema = z.object({
  deckId: deckIdSchema,
  updates: z
    .array(entryPatchSchema)
    .min(1, "No changes provided.")
    .max(MAX_ENTRY_BATCH, `At most ${MAX_ENTRY_BATCH} cards at a time.`)
    .refine((updates) => new Set(updates.map((u) => u.id.toLowerCase())).size === updates.length, {
      message: "An entry can change once a call.",
    }),
});

export const removeEntriesSchema = z.object({
  deckId: deckIdSchema,
  entryIds: z
    .array(entryIdSchema)
    .min(1, "No cards to remove.")
    .max(MAX_ENTRY_BATCH, `At most ${MAX_ENTRY_BATCH} cards at a time.`),
});

export type EntryUpdate = z.infer<typeof entryPatchSchema>;

/** The updates as statements: entries that take the same change share one
 *  UPDATE (a bulk move is one statement, a bulk "+1" one per quantity). */
export function groupEntryUpdates(
  updates: readonly EntryUpdate[],
): Array<{ patch: { quantity?: number; board?: DeckBoard }; ids: string[] }> {
  const groups = new Map<string, { patch: { quantity?: number; board?: DeckBoard }; ids: string[] }>();
  for (const update of updates) {
    const patch: { quantity?: number; board?: DeckBoard } = {};
    if (update.quantity !== undefined) patch.quantity = update.quantity;
    if (update.board !== undefined) patch.board = update.board;
    const key = `${patch.quantity ?? ""}|${patch.board ?? ""}`;
    const group = groups.get(key) ?? { patch, ids: [] };
    group.ids.push(update.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Removed entries, and their way back
// ---------------------------------------------------------------------------

/** What a removal hands back so the owner can undo it: the line as the deck
 *  held it. */
export type RemovedEntry = {
  id: string;
  name: string;
  board: DeckBoard;
  quantity: number;
  scryfallId: string | null;
  cardId: string | null;
  source: string | null;
};

export const removedEntrySchema = z.object({
  id: entryIdSchema,
  name: z.string().trim().min(1).max(200),
  board: z.enum(DECK_BOARD_VALUES),
  quantity: z.number().int().min(1).max(MAX_ENTRY_QUANTITY),
  scryfallId: z.string().refine((id) => isUuid(id), "That card's Scryfall id isn't valid.").nullable(),
  cardId: z.string().refine((id) => isUuid(id), "Invalid card id.").nullable(),
  source: z.string().max(40).nullable(),
});

export const restoreEntriesSchema = z.object({
  deckId: deckIdSchema,
  entries: z
    .array(removedEntrySchema)
    .min(1, "Nothing to put back.")
    .max(MAX_ENTRY_BATCH, `At most ${MAX_ENTRY_BATCH} cards at a time.`),
});

/** A deck_cards row as the removal read it. */
export function removedEntryOf(row: {
  id: string;
  name: string;
  board: string;
  quantity: number;
  scryfall_id: string | null;
  card_id: string | null;
  source?: string | null;
}): RemovedEntry {
  return {
    id: row.id,
    name: row.name,
    board: isDeckBoard(row.board) ? row.board : "main",
    quantity: row.quantity,
    scryfallId: row.scryfall_id,
    cardId: row.card_id,
    source: row.source ?? null,
  };
}

/** A decklist line the commit writes back (the commit payload's shape). */
export type RestoreLine = {
  name: string;
  quantity: number;
  board: DeckBoard;
  resolved: { scryfall_id: string } | null;
};

export type RestorePlan = {
  /** Printings and name-only lines: the decklist commit, in chunks of the
   *  commit's own cap. */
  lineChunks: RestoreLine[][];
  /** Which removed entry each line brings back (a line may carry two: the
   *  same printing on the same board — the commit merges them). */
  lineEntries: Array<{ entry: RemovedEntry; key: string }>;
  /** PipGlyph cards with no printing: the membership writer, in chunks of
   *  its cap. */
  cardChunks: RemovedEntry[][];
};

/** The merge key a line and a deck row share (lib/decks/import-plan.ts
 *  importMergeKey's rule). */
export function restoreLineKey(line: { board: string; scryfallId: string | null; name: string }): string {
  return `${line.board}|${line.scryfallId ? line.scryfallId.toLowerCase() : `name:${line.name.trim().toLowerCase()}`}`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function planRestore(entries: readonly RemovedEntry[]): RestorePlan {
  const lines = new Map<string, RestoreLine>();
  const lineEntries: RestorePlan["lineEntries"] = [];
  const cards: RemovedEntry[] = [];
  for (const entry of entries) {
    // A card alone (no printing) comes in through the card's own path —
    // unless the card was never the line's own (an import line linked to a
    // card later): that line stays a line.
    if (entry.cardId && !entry.scryfallId && (bringsCard(entry.source) || entry.source === null)) {
      cards.push(entry);
      continue;
    }
    const key = restoreLineKey(entry);
    lineEntries.push({ entry, key });
    const line = lines.get(key);
    if (line) {
      line.quantity = Math.min(line.quantity + entry.quantity, MAX_ENTRY_QUANTITY);
      continue;
    }
    lines.set(key, {
      name: entry.name,
      quantity: entry.quantity,
      board: entry.board,
      resolved: entry.scryfallId ? { scryfall_id: entry.scryfallId } : null,
    });
  }
  return {
    lineChunks: chunk([...lines.values()], MAX_DECKLIST_ENTRIES),
    lineEntries,
    cardChunks: chunk(cards, MAX_MEMBERSHIP_BATCH),
  };
}

/** What became of one removed entry. */
export type RestoredEntry = {
  /** The removed entry's id. */
  from: string;
  /** The entry that stands for it now — null when it couldn't come back. */
  to: string | null;
  /** Why it came back short, or not at all, in words. */
  note?: string;
};
