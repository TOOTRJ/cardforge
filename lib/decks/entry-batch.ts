import { z } from "zod";
import { isUuid } from "@/lib/ids";
import { bringsCard } from "@/lib/decks/entry-status";
import { MAX_DECK_ENTRIES } from "@/lib/decks/import-plan";
import { MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";
import { FEATURED_PICKS_MAX } from "@/lib/decks/featured";
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
//   name-only line          → the decklist commit (import_deck_entries via
//                             lib/decks/import-commit.ts: the printing
//                             fetched again from Scryfall, never the
//                             browser's copy), ONE line per entry, written
//                             so it is always a NEW row (stageRestoreLines:
//                             never merged into a row the deck holds) — then
//                             that new row, and only it, gets the entry's
//                             board, its card (the D3 guard judges it again:
//                             another creator's card that went private
//                             meanwhile comes back as the real card) and its
//                             cover pick;
//   a PipGlyph card alone   → the ONE membership writer (add_custom_deck_entry
//                             via changeDeckMembershipAction: a new row or
//                             "already in the deck"), then its board,
//                             quantity and cover pick.
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
  /** Its "Feature on cover" rank (0150), when it had one. */
  featuredRank?: number | null;
};

export const removedEntrySchema = z.object({
  id: entryIdSchema,
  name: z.string().trim().min(1).max(200),
  board: z.enum(DECK_BOARD_VALUES),
  quantity: z.number().int().min(1).max(MAX_ENTRY_QUANTITY),
  scryfallId: z.string().refine((id) => isUuid(id), "That card's Scryfall id isn't valid.").nullable(),
  cardId: z.string().refine((id) => isUuid(id), "Invalid card id.").nullable(),
  source: z.string().max(40).nullable(),
  featuredRank: z.number().int().min(1).max(FEATURED_PICKS_MAX).nullable().optional(),
});

export const restoreEntriesSchema = z.object({
  deckId: deckIdSchema,
  entries: z
    .array(removedEntrySchema)
    .min(1, "Nothing to put back.")
    .max(MAX_ENTRY_BATCH, `At most ${MAX_ENTRY_BATCH} cards at a time.`)
    .refine((entries) => new Set(entries.map((e) => e.id.toLowerCase())).size === entries.length, {
      message: "An entry comes back once a call.",
    }),
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
  featured_rank?: number | null;
}): RemovedEntry {
  return {
    id: row.id,
    name: row.name,
    board: isDeckBoard(row.board) ? row.board : "main",
    quantity: row.quantity,
    scryfallId: row.scryfall_id,
    cardId: row.card_id,
    source: row.source ?? null,
    featuredRank: typeof row.featured_rank === "number" ? row.featured_rank : null,
  };
}

/** A decklist line the commit writes back (the commit payload's shape). */
export type RestoreLine = {
  name: string;
  quantity: number;
  board: DeckBoard;
  resolved: { scryfall_id: string } | null;
};

/** The merge key a line and a deck row share (lib/decks/import-plan.ts
 *  importMergeKey's rule — import_deck_entries merges a line into the FIRST
 *  row of the deck with its key). */
export function restoreLineKey(line: { board: string; scryfallId: string | null; name: string }): string {
  return `${line.board}|${line.scryfallId ? line.scryfallId.toLowerCase() : `name:${line.name.trim().toLowerCase()}`}`;
}

/** A row's merge key. */
export function rowMergeKey(row: { board: string; scryfall_id: string | null; name: string }): string {
  return restoreLineKey({ board: row.board, scryfallId: row.scryfall_id, name: row.name });
}

/** Every key a line written onto `board` may land on: its printing's — and
 *  the name's, which is what the commit writes when Scryfall no longer has
 *  that printing (lib/decks/import-resolution.ts serverResolvedLines). */
export function restoreStagingKeys(entry: Pick<RemovedEntry, "scryfallId" | "name">, board: DeckBoard): string[] {
  const byName = restoreLineKey({ board, scryfallId: null, name: entry.name });
  return entry.scryfallId ? [restoreLineKey({ board, scryfallId: entry.scryfallId, name: entry.name }), byName] : [byName];
}

/** True when the entry comes back through the PipGlyph card's own path (a
 *  card alone, no printing) — unless the card was never the line's own (an
 *  import line linked to a card later): that line stays a line. */
export function restoresAsCard(entry: RemovedEntry): boolean {
  return Boolean(entry.cardId && !entry.scryfallId && (bringsCard(entry.source) || entry.source === null));
}

/** The boards a restored line may be written onto when its own board holds
 *  a row with its key (it moves to its own board right after). */
const STAGING_BOARDS: readonly DeckBoard[] = ["maybe", "side", "companion", "commander", "main"];

export type StagedLine = { entry: RemovedEntry; stage: DeckBoard };

/**
 * Undo NEVER merges a line into a row the deck holds (TODO DK5.4): two
 * rows of one printing on one board are legitimate (a Move never merges —
 * the moved row keeps its id, its card and its cover pick), and
 * import_deck_entries merges a line into the first row with its key. So
 * each removed entry is ONE line of its own, written onto a board where no
 * row — and no other line of this round — has its key: its own board when
 * that is free, else the first free of STAGING_BOARDS, and moved to its own
 * board once the commit has made it a NEW row. A line with no free board
 * this round waits for the next (the boards the round used are free again
 * once its rows have moved home).
 */
export function stageRestoreLines(
  lines: readonly RemovedEntry[],
  occupiedKeys: ReadonlySet<string>,
): { staged: StagedLine[]; waiting: RemovedEntry[] } {
  const taken = new Set(occupiedKeys);
  const staged: StagedLine[] = [];
  const waiting: RemovedEntry[] = [];
  for (const entry of lines) {
    const boards = [entry.board, ...STAGING_BOARDS.filter((board) => board !== entry.board)];
    const stage = boards.find((board) => restoreStagingKeys(entry, board).every((key) => !taken.has(key)));
    if (!stage) {
      waiting.push(entry);
      continue;
    }
    for (const key of restoreStagingKeys(entry, stage)) taken.add(key);
    staged.push({ entry, stage });
  }
  return { staged, waiting };
}

/** The commit line a staged entry is written as. */
export function stagedLineOf({ entry, stage }: StagedLine): RestoreLine {
  return {
    name: entry.name,
    quantity: entry.quantity,
    board: stage,
    resolved: entry.scryfallId ? { scryfall_id: entry.scryfallId } : null,
  };
}

type CommittedRow = {
  id: string;
  board: string;
  scryfall_id: string | null;
  name: string;
  card_id: string | null;
  quantity: number;
};

/** The NEW row a staged line became: an id the deck didn't hold before the
 *  commit, with the line's key, no card and exactly the line's count — never
 *  a row the deck had, nor one another tab wrote meanwhile that the line was
 *  merged into (its count is more than the line's). */
export function newRowOfStagedLine<R extends CommittedRow>(
  line: StagedLine,
  fresh: readonly R[],
  claimed: ReadonlySet<string>,
  /** The line's commit reported a merge: a fresh row AT the cap may be
   *  another tab's row the merge filled to 250, so it is never taken as the
   *  line's own (the merge path then says so). */
  commitMerged = false,
): R | null {
  const keys = new Set(restoreStagingKeys(line.entry, line.stage));
  const count = Math.min(line.entry.quantity, MAX_ENTRY_QUANTITY);
  if (commitMerged && count >= MAX_ENTRY_QUANTITY) return null;
  return (
    fresh.find((row) => !claimed.has(row.id) && keys.has(rowMergeKey(row)) && !row.card_id && row.quantity === count) ?? null
  );
}

/** The row a staged line was merged into when it found none of its own
 *  (the first row of its key, as the commit picks it — `after` in list
 *  order) and the count that row goes back to: what it held before, or,
 *  for a row written meanwhile, its count less the line's. `quantity: null`:
 *  a row written meanwhile that the merge took to the 250 cap — what it held
 *  can't be told (the cap ate part of the line), so it is left alone and the
 *  note says so. Null: nothing to take back. */
export function mergedRowOfStagedLine<R extends CommittedRow>(
  line: StagedLine,
  before: readonly R[],
  after: readonly R[],
): { row: R; quantity: number | null } | null {
  const keys = new Set(restoreStagingKeys(line.entry, line.stage));
  const row = after.find((candidate) => keys.has(rowMergeKey(candidate)));
  if (!row) return null;
  const old = before.find((candidate) => candidate.id === row.id);
  if (!old && row.quantity >= MAX_ENTRY_QUANTITY) return { row, quantity: null };
  const quantity = old ? old.quantity : row.quantity - line.entry.quantity;
  return quantity >= 1 && quantity < row.quantity ? { row, quantity } : null;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** What became of one removed entry. */
export type RestoredEntry = {
  /** The removed entry's id. */
  from: string;
  /** The NEW entry that stands for it now — null when it couldn't come back
   *  (never a row the deck already held). */
  to: string | null;
  /** Why it came back short, or not at all, in words. */
  note?: string;
};
