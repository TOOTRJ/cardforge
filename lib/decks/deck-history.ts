import { isUuid } from "@/lib/ids";
import { MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";
import { FEATURED_PICKS_MAX } from "@/lib/decks/featured";
import { DECK_BOARD_LABELS, isDeckBoard, type DeckBoard } from "@/types/deck";
import type { PlanTier } from "@/lib/billing/plans";
import type { EntryPatch } from "@/lib/decks/entry-ops";
import type { RemovedEntry } from "@/lib/decks/entry-batch";

// ---------------------------------------------------------------------------
// A deck's change history (TODO DK5.13, migration 0165) as pure data — what
// the History dialog lists and what "Restore this version" writes. Client-
// safe; the reads and writes are lib/decks/history-actions.ts.
//
// THE LOG. One row per change to an entry, written by ONE trigger on
// deck_cards (every write path, once): an insert, a delete, or an update of
// its quantity / board / card / printing / name, with the entry before and
// after. The rows are kept by plan:
//
//   Pro    the full history                         (historyAccessFor)
//   Plus   the last 30 days (DECK_HISTORY_PLUS_DAYS)
//   Free   none: the toolbar's undo / redo for the session — the History
//          view is a Plus perk (owner's DK5.13 brief; its rows are kept 30
//          days all the same, so an upgrade shows the last month at once)
//
// An owner who STOPS being Pro (past_due, cancelled, downgraded) keeps the
// rows past the lower plan's 30 days for DECK_HISTORY_PRO_GRACE_DAYS more
// after Pro ended (owner 2026-11-02; 0165's deck_history_pro_ends records
// when) — back on Pro inside them, the whole history is there again — and
// every deck keeps at most its newest DECK_HISTORY_MAX_ROWS changes.
//
// A VERSION is a run of changes made together — one write, or one burst of
// writes by the same person (a bulk move, an "Add 4", a restore) within
// VERSION_GAP_MS of each other — named by its NEWEST change id. "Restore
// this version" = the deck as it read right after that change: the rows the
// deck holds now, with every change made since put back, newest first
// (deckStateAfter). The rows the deck holds then go to that state through
// the paths a card comes in and out by (planRestore → the batch actions):
// never a direct insert, the D3 / private-card rules judged again on every
// card that comes back, and each restore one more set of changes in the log
// (so a restore can itself be restored from).
// ---------------------------------------------------------------------------

/** How far back a Plus plan reads the history (and the prune keeps it). */
export const DECK_HISTORY_PLUS_DAYS = 30;
/** How long rows past that window are kept once an owner's Pro ends. */
export const DECK_HISTORY_PRO_GRACE_DAYS = 30;
/** The most changes a deck keeps, whatever the plan (0165's cap). */
export const DECK_HISTORY_MAX_ROWS = 10_000;
/** Changes closer than this, by the same person, read as one version. */
export const VERSION_GAP_MS = 3000;
/** Rows a page of the History view reads. */
export const HISTORY_PAGE_ROWS = 300;
/** The most changes a restore puts back (a safety stop, never real data). */
export const MAX_RESTORE_CHANGES = 20_000;

export type HistoryAccess =
  | { kind: "locked" }
  | { kind: "window"; days: number }
  | { kind: "full" };

/** What a plan reads (the EFFECTIVE tier: getEntitlements — an admin and
 *  billing off count as Pro; a lapsed plan as free). */
export function historyAccessFor(effectiveTier: PlanTier): HistoryAccess {
  if (effectiveTier === "pro") return { kind: "full" };
  if (effectiveTier === "plus") return { kind: "window", days: DECK_HISTORY_PLUS_DAYS };
  return { kind: "locked" };
}

/** The oldest change the plan reads (ISO), null for all; never called for
 *  "locked". */
export function historySince(access: HistoryAccess, now: Date = new Date()): string | null {
  if (access.kind !== "window") return null;
  return new Date(now.getTime() - access.days * 24 * 60 * 60 * 1000).toISOString();
}

/** Whether a change made at `changedAt` is inside the plan's window. */
export function withinHistory(access: HistoryAccess, changedAt: string, now: Date = new Date()): boolean {
  if (access.kind === "locked") return false;
  const since = historySince(access, now);
  return since === null || changedAt >= since;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** An entry as the log keeps it (0165 deck_entry_change_snapshot). */
export type EntrySnapshot = {
  name: string;
  board: DeckBoard;
  quantity: number;
  scryfall_id: string | null;
  card_id: string | null;
  source: string | null;
  featured_rank: number | null;
};

export type ChangeOp = "insert" | "update" | "delete";

export type ChangeRow = {
  id: number;
  entry_id: string;
  op: ChangeOp;
  before: EntrySnapshot | null;
  after: EntrySnapshot | null;
  actor_id: string | null;
  tx: number;
  changed_at: string;
};

/** An entry the deck holds, by its id: the fields a version is made of. */
export type DeckRow = EntrySnapshot & { id: string };

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

/** A snapshot read back from the log's jsonb — null when it isn't one. */
export function parseSnapshot(value: unknown): EntrySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const name = text(row.name);
  const quantity = Number(row.quantity);
  if (!name || !isDeckBoard(row.board) || !Number.isInteger(quantity) || quantity < 1) return null;
  const rank = Number(row.featured_rank);
  return {
    name,
    board: row.board,
    quantity,
    scryfall_id: text(row.scryfall_id),
    card_id: text(row.card_id),
    source: text(row.source),
    featured_rank: Number.isInteger(rank) && rank >= 1 && rank <= FEATURED_PICKS_MAX ? rank : null,
  };
}

/** A log row as the database hands it out — null when it is malformed. */
export function parseChangeRow(row: {
  id: number | string;
  entry_id: string;
  op: string;
  before: unknown;
  after: unknown;
  actor_id: string | null;
  tx: number | string;
  changed_at: string;
}): ChangeRow | null {
  if (row.op !== "insert" && row.op !== "update" && row.op !== "delete") return null;
  const before = row.before == null ? null : parseSnapshot(row.before);
  const after = row.after == null ? null : parseSnapshot(row.after);
  if (row.op !== "insert" && !before) return null;
  if (row.op !== "delete" && !after) return null;
  return {
    id: Number(row.id),
    entry_id: row.entry_id,
    op: row.op,
    before: row.op === "insert" ? null : before,
    after: row.op === "delete" ? null : after,
    actor_id: row.actor_id,
    tx: Number(row.tx),
    changed_at: row.changed_at,
  };
}

// ---------------------------------------------------------------------------
// Versions, in words
// ---------------------------------------------------------------------------

export type HistoryChange = { id: number; text: string };

export type HistoryVersion = {
  /** Its newest change — what "Restore this version" names. */
  headId: number;
  /** When its newest change was made (ISO). */
  at: string;
  /** "Added Sol Ring", "Changed 4 cards"… */
  summary: string;
  /** Each change, newest first (at most HISTORY_CHANGES_SHOWN). */
  changes: HistoryChange[];
  /** How many changes it holds in all. */
  count: number;
  /** Made by the deck's owner (else: the platform — a card's deletion, a
   *  seed — or a person no longer the owner). */
  byOwner: boolean;
};

export const HISTORY_CHANGES_SHOWN = 8;

const copies = (n: number) => `${n} ${n === 1 ? "copy" : "copies"}`;
const times = (n: number) => (n > 1 ? `${n}× ` : "");

/** One change, in words. */
export function describeChange(row: ChangeRow): string {
  if (row.op === "insert") {
    const after = row.after!;
    return `Added ${times(after.quantity)}${after.name}${after.board === "main" ? "" : ` to the ${DECK_BOARD_LABELS[after.board]}`}`;
  }
  if (row.op === "delete") return `Removed ${times(row.before!.quantity)}${row.before!.name}`;
  const before = row.before!;
  const after = row.after!;
  const parts: string[] = [];
  if (before.name !== after.name) parts.push(`renamed ${after.name}`);
  if (before.card_id !== after.card_id) parts.push(after.card_id ? (before.card_id ? "now a different card" : "linked to a card") : "unlinked from its card");
  else if (before.scryfall_id !== after.scryfall_id) parts.push("another printing");
  if (before.board !== after.board) parts.push(`moved to the ${DECK_BOARD_LABELS[after.board]}`);
  if (before.quantity !== after.quantity) parts.push(`${before.quantity} → ${copies(after.quantity)}`);
  return `${before.name}: ${parts.join(", ") || "changed"}`;
}

/** A version's one line. */
export function summarizeChanges(rows: readonly ChangeRow[]): string {
  if (rows.length === 1) return describeChange(rows[0]!);
  const added = rows.filter((row) => row.op === "insert").length;
  const removed = rows.filter((row) => row.op === "delete").length;
  const changed = rows.length - added - removed;
  const parts: string[] = [];
  const cards = (n: number) => `${n} card${n === 1 ? "" : "s"}`;
  if (added > 0) parts.push(`added ${cards(added)}`);
  if (removed > 0) parts.push(`removed ${cards(removed)}`);
  if (changed > 0) parts.push(`changed ${cards(changed)}`);
  const line = parts.join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** The log's rows (NEWEST FIRST) as versions, newest first. */
export function groupChanges(
  rows: readonly ChangeRow[],
  ownerId: string,
  gapMs: number = VERSION_GAP_MS,
): HistoryVersion[] {
  const groups: ChangeRow[][] = [];
  for (const row of rows) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    const together =
      last &&
      last.actor_id === row.actor_id &&
      (last.tx === row.tx || Date.parse(last.changed_at) - Date.parse(row.changed_at) <= gapMs);
    if (group && together) group.push(row);
    else groups.push([row]);
  }
  return groups.map((group) => ({
    headId: group[0]!.id,
    at: group[0]!.changed_at,
    summary: summarizeChanges(group),
    changes: group.slice(0, HISTORY_CHANGES_SHOWN).map((row) => ({ id: row.id, text: describeChange(row) })),
    count: group.length,
    byOwner: group[0]!.actor_id === ownerId,
  }));
}

// ---------------------------------------------------------------------------
// A version back
// ---------------------------------------------------------------------------

/** The deck as it read right after the version: `current` with every
 *  change in `since` (the changes made AFTER it, NEWEST FIRST) put back. */
export function deckStateAfter(current: readonly DeckRow[], since: readonly ChangeRow[]): DeckRow[] {
  const rows = new Map(current.map((row) => [row.id, row]));
  for (const change of since) {
    if (change.op === "insert") rows.delete(change.entry_id);
    else rows.set(change.entry_id, { ...change.before!, id: change.entry_id });
  }
  return [...rows.values()];
}

export type RestorePlan = {
  /** Entries the version doesn't hold. */
  remove: string[];
  /** Entries both hold, back to the version's count and board. */
  update: EntryPatch[];
  /** The version's entries the deck no longer holds — put back through the
   *  restore path (each a NEW row; its card judged again). */
  restore: RemovedEntry[];
};

const identity = (row: Pick<EntrySnapshot, "card_id" | "scryfall_id" | "name">) =>
  `${row.card_id ?? ""}|${row.scryfall_id ?? ""}|${row.name.trim().toLowerCase()}`;

const patchOf = (id: string, from: EntrySnapshot, to: EntrySnapshot): EntryPatch | null => {
  const patch: EntryPatch = { id };
  if (from.quantity !== to.quantity) patch.quantity = Math.min(MAX_ENTRY_QUANTITY, to.quantity);
  if (from.board !== to.board) patch.board = to.board;
  return patch.quantity === undefined && patch.board === undefined ? null : patch;
};

function asRemoved(row: DeckRow): RemovedEntry | null {
  const name = row.name.trim().slice(0, 200);
  if (!name || !isUuid(row.id)) return null;
  return {
    id: row.id,
    name,
    board: row.board,
    quantity: Math.min(MAX_ENTRY_QUANTITY, row.quantity),
    scryfallId: row.scryfall_id && isUuid(row.scryfall_id) ? row.scryfall_id : null,
    cardId: row.card_id && isUuid(row.card_id) ? row.card_id : null,
    source: row.source ? row.source.slice(0, 40) : null,
    featuredRank: row.featured_rank,
  };
}

/** The writes that take the deck from `current` to `target`. An entry held
 *  by both keeps its row (its count and board written); one the version
 *  holds under another id — the same card, printing and name, brought back
 *  by an undo since — is that row too; a row whose card, printing or name
 *  changed is taken out and the version's line put back (a link is never
 *  written by hand: the restore path judges the card again). */
export function planRestore(current: readonly DeckRow[], target: readonly DeckRow[]): RestorePlan {
  const remove: string[] = [];
  const update: EntryPatch[] = [];
  const restore: RemovedEntry[] = [];
  const targetById = new Map(target.map((row) => [row.id, row]));
  const currentIds = new Set(current.map((row) => row.id));
  const leftCurrent: DeckRow[] = [];
  for (const row of current) {
    const wanted = targetById.get(row.id);
    if (!wanted) {
      leftCurrent.push(row);
      continue;
    }
    if (identity(row) === identity(wanted)) {
      const patch = patchOf(row.id, row, wanted);
      if (patch) update.push(patch);
    } else {
      remove.push(row.id);
      const back = asRemoved(wanted);
      if (back) restore.push(back);
    }
  }
  // The version's lines the deck holds under another id, then the rest.
  const spare = new Map<string, DeckRow[]>();
  for (const row of leftCurrent) spare.set(identity(row), [...(spare.get(identity(row)) ?? []), row]);
  for (const wanted of target) {
    if (currentIds.has(wanted.id)) continue;
    const twin = spare.get(identity(wanted))?.shift();
    if (twin) {
      const patch = patchOf(twin.id, twin, wanted);
      if (patch) update.push(patch);
      continue;
    }
    const back = asRemoved(wanted);
    if (back) restore.push(back);
  }
  for (const rows of spare.values()) for (const row of rows) remove.push(row.id);
  return { remove, update, restore };
}

export const isEmptyPlan = (plan: RestorePlan) =>
  plan.remove.length === 0 && plan.update.length === 0 && plan.restore.length === 0;
