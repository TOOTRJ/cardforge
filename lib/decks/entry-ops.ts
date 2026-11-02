import { MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";
import { DECK_BOARD_LABELS, type DeckBoard } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck page's edits as data (TODO DK5.4 / DK5.8) — what the owner's
// page draws the moment an edit is made, before the server has it
// (components/decks/use-deck-editor.tsx folds these over the rows the
// server sent, React's useOptimistic). Every edit says the VALUE it wants —
// "3 copies", "the Sideboard", "gone" — never a step ("one more"): drawn
// over rows that already hold it, it changes nothing, so the server's
// answer and the edit can land in either order. Pure and client-safe.
// ---------------------------------------------------------------------------

/** One entry's new quantity and/or board. */
export type EntryPatch = { id: string; quantity?: number; board?: DeckBoard };

export type EntryOp =
  | { kind: "update"; updates: EntryPatch[] }
  | { kind: "remove"; ids: string[] }
  /** Rows drawn while the server writes them: an add, or a removal undone
   *  (its old rows, ids and all, until the new ones arrive). */
  | { kind: "insert"; items: PendingItem[] };

/** The entry fields an edit reads or writes. */
type EditableEntry = { id: string; quantity: number; board: DeckBoard };
type EditableItem = { entry: EditableEntry };

/** A row the server hasn't written yet: drawn, not yet an opener. */
export type PendingItem<I extends EditableItem = EditableItem> = I & { pending: true };

export const MIN_ENTRY_QUANTITY = 1;

export function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return MIN_ENTRY_QUANTITY;
  return Math.min(MAX_ENTRY_QUANTITY, Math.max(MIN_ENTRY_QUANTITY, Math.round(quantity)));
}

/** The rows with the edit drawn in. A patch names only an entry still
 *  there; a removal of a row already gone does nothing. */
export function applyEntryOp<I extends EditableItem>(items: readonly I[], op: EntryOp): I[] {
  switch (op.kind) {
    case "update": {
      const byId = new Map(op.updates.map((patch) => [patch.id, patch]));
      return items.map((item) => {
        const patch = byId.get(item.entry.id);
        if (!patch) return item;
        const quantity = patch.quantity === undefined ? item.entry.quantity : clampQuantity(patch.quantity);
        const board = patch.board ?? item.entry.board;
        if (quantity === item.entry.quantity && board === item.entry.board) return item;
        return { ...item, entry: { ...item.entry, quantity, board } };
      });
    }
    case "remove": {
      const gone = new Set(op.ids);
      return items.filter((item) => !gone.has(item.entry.id));
    }
    case "insert": {
      // A row already in the list (the server's answer came first) is not
      // drawn twice.
      const have = new Set(items.map((item) => item.entry.id));
      return [...items, ...(op.items.filter((item) => !have.has(item.entry.id)) as unknown as I[])];
    }
  }
}

/** The entries an edit touches — its place in the write queue. */
export function opEntryIds(op: EntryOp): string[] {
  switch (op.kind) {
    case "update":
      return op.updates.map((patch) => patch.id);
    case "remove":
      return [...op.ids];
    case "insert":
      return op.items.map((item) => item.entry.id);
  }
}

/** The patches that put `ids` back as they are in `items` — an update's
 *  undo, read BEFORE the update is drawn. */
export function restoringPatches(items: readonly EditableItem[], ids: readonly string[]): EntryPatch[] {
  const wanted = new Set(ids);
  return items
    .filter((item) => wanted.has(item.entry.id))
    .map((item) => ({ id: item.entry.id, quantity: item.entry.quantity, board: item.entry.board }));
}

/** Each entry `by` copies more (or fewer), held to 1–250; entries already
 *  at the limit are left out. */
export function stepPatches(items: readonly EditableItem[], ids: readonly string[], by: number): EntryPatch[] {
  const wanted = new Set(ids);
  const patches: EntryPatch[] = [];
  for (const item of items) {
    if (!wanted.has(item.entry.id)) continue;
    const quantity = clampQuantity(item.entry.quantity + by);
    if (quantity !== item.entry.quantity) patches.push({ id: item.entry.id, quantity });
  }
  return patches;
}

/** Every entry onto `board`; the ones already there are left out. */
export function movePatches(items: readonly EditableItem[], ids: readonly string[], board: DeckBoard): EntryPatch[] {
  const wanted = new Set(ids);
  return items
    .filter((item) => wanted.has(item.entry.id) && item.entry.board !== board)
    .map((item) => ({ id: item.entry.id, board }));
}

/** "S": to the sideboard — or, from it, back to the deck. */
export function sideToggleBoard(current: DeckBoard): DeckBoard {
  return current === "side" ? "main" : "side";
}

/** The boards an entry can be moved to, in the order a deck reads: the
 *  commander zone only where the format has one. */
export function moveTargets(hasCommander: boolean): DeckBoard[] {
  const boards: DeckBoard[] = ["main", "side", "maybe", "companion"];
  return hasCommander ? ["commander", ...boards] : boards;
}

/** "the Sideboard" — a board as a sentence names it. */
export function boardPhrase(board: DeckBoard): string {
  return `the ${DECK_BOARD_LABELS[board]}`;
}

/** What an edit did, in words — the live region's line and the undo's
 *  label. `names` are the entries' names as the page shows them. */
export function describeEdit(op: EntryOp, names: readonly string[]): string {
  const who = names.length === 1 ? names[0]! : `${names.length} cards`;
  switch (op.kind) {
    case "remove":
      return `Removed ${who}.`;
    case "insert":
      return `Added ${who}.`;
    case "update": {
      const boards = new Set(op.updates.map((patch) => patch.board).filter(Boolean));
      const quantities = new Set(op.updates.map((patch) => patch.quantity).filter((q) => q !== undefined));
      if (boards.size === 1 && quantities.size === 0) return `Moved ${who} to ${boardPhrase([...boards][0]!)}.`;
      if (quantities.size === 1 && boards.size === 0 && names.length === 1) {
        const quantity = [...quantities][0]!;
        return `${who}: ${quantity} ${quantity === 1 ? "copy" : "copies"}.`;
      }
      return `Changed ${who}.`;
    }
  }
}
