import { boardPhrase, moveTargets } from "@/lib/decks/entry-ops";
import { isDeckBoard, type DeckBoard } from "@/types/deck";

// ---------------------------------------------------------------------------
// Dragging a deck entry from one board to another (TODO DK5.15) — the rules
// as data, so the owner's page (components/decks/use-board-drag.tsx) and the
// unit tests read ONE answer. Pure and client-safe.
//
// A drag is a MOVE, never a second path: a drop calls the editor's `move`
// (lib/decks/entry-ops.ts `movePatches` → updateDeckEntriesAction), the way
// the "⋯" menu's "Move to", the M key's menu and the S key do — so the undo,
// the revalidation, the live region's line and the format check behave as
// for any move. Where a card may go is `moveTargets` — the menus' list: the
// commander zone only where the format has one. Nothing here judges a card
// for the zone (a non-legendary commander): the page says what the format
// check says, as it does after a move from the menu.
//
// The drag itself is the pointer's alone: a FINE pointer that can hover
// (`BOARD_DRAG_QUERY`). On touch a press is the page's (a long press
// selects, a swipe scrolls), so a card never starts a drag there — the
// selection's bulk bar, the bottom sheet's and the menus' Move to are the
// way. The keyboard's way is the M key's menu (WCAG 2.5.7: every drag has a
// single-pointer and a keyboard twin).
// ---------------------------------------------------------------------------

/** Where a card can be dragged: a mouse or a pen, never touch. */
export const BOARD_DRAG_QUERY = "(hover: hover) and (pointer: fine)";

/** The drag's data type — a drop zone takes only the page's own drags
 *  (never a file, a link or another page's text). */
export const DECK_ENTRY_DRAG_TYPE = "application/x-pipglyph-deck-entries";

/** The board a group of the page stands for — a drop on it moves the card
 *  there. The deck's own groups ("Deck" under Group by None, the
 *  mainboard's type / mana / colour… groups, `main-*`) are the mainboard;
 *  a group that is a board is that board; anything else is no target. */
export function boardOfGroup(groupKey: string): DeckBoard | null {
  if (isDeckBoard(groupKey)) return groupKey;
  if (groupKey === "deck" || groupKey.startsWith("main-")) return "main";
  return null;
}

/** A drop on `board` moves something: the board is one the menus offer in
 *  this format, and at least one dragged card is on another board. */
export function canDropOn(board: DeckBoard | null, from: Iterable<DeckBoard>, hasCommander: boolean): board is DeckBoard {
  if (!board || !moveTargets(hasCommander).includes(board)) return false;
  for (const current of from) if (current !== board) return true;
  return false;
}

/** The drop zone's words while a card is held over it. */
export function dropHint(board: DeckBoard, count: number): string {
  return `Move ${count === 1 ? "here" : `${count} cards here`} — ${boardPhrase(board)}`;
}

/** The cards a drag carries: the one picked up — or, while the owner
 *  selects, the whole selection when the card picked up is part of it. */
export function draggedIds(entryId: string, selection: { selecting: boolean; ids: readonly string[] }): string[] {
  if (selection.selecting && selection.ids.includes(entryId)) return [...selection.ids];
  return [entryId];
}

/** A drag may start from a card's own picture or row — never from a control
 *  beside it (the stepper, the "⋯", the "2 faces" button): those keep
 *  their press. `pressedOn` is the element the pointer went down on. */
export function dragStartsFrom(pressedOn: Element | null): boolean {
  if (!pressedOn) return true;
  const control = pressedOn.closest?.("button, a[href], input, select, textarea, [role='button'], [role='menuitem']");
  return !control || control.hasAttribute("data-deck-entry");
}
