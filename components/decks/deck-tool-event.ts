// ---------------------------------------------------------------------------
// The deck page's owner tools, opened from anywhere on the page by ONE
// window event (`pipglyph:deck-tool`): the details dialog and the decklist
// import (DeckOwnerTools listens), and the add box (DeckAddBox listens —
// "add", or "add-commander" with the Commander board chosen). A module of
// its own so the card list and the doors can open them without loading the
// dialogs' code.
// ---------------------------------------------------------------------------

/** The import dialog's modes (components/decks/import-decklist-dialog.tsx). */
export type DeckImportTool = "paste" | "names" | "commander";

/** What a page control can open. */
export type DeckTool = "details" | DeckImportTool | "add" | "add-commander";

export const DECK_TOOL_EVENT = "pipglyph:deck-tool";

export type DeckToolDetail = { tool: DeckTool; opener: HTMLElement | null };

/** Opens one of the owner's tools; a dialog closed hands the focus back to
 *  `opener` (a click's own control — Safari doesn't focus a clicked button,
 *  so it is passed, never read from the document). */
export function openDeckTool(tool: DeckTool, opener: HTMLElement | null = null) {
  window.dispatchEvent(new CustomEvent<DeckToolDetail>(DECK_TOOL_EVENT, { detail: { tool, opener } }));
}
