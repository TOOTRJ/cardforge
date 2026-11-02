import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import type { DeckRow } from "@/lib/decks/deck-view";
import type { EditorItem } from "@/components/decks/use-deck-editor";

// ---------------------------------------------------------------------------
// What the deck's views (components/decks/deck-card-views.tsx) are handed to
// draw a row's opener and the owner's controls — built ONCE by the card area
// (components/decks/deck-card-list.tsx), so every view's opener does the
// same thing: open the pop-up (a bottom sheet on touch), follow the preview
// pane, take the entry keys (+ − M S, lib/decks/entry-shortcuts.ts), and —
// while the owner selects — toggle its card.
// ---------------------------------------------------------------------------

export type ViewRow = DeckRow<EditorItem>;

/** An opener's attributes and handlers — spread onto the element that opens
 *  the card (a <button>, or a CardTile body's role="button"). */
export type OpenerProps = {
  id: string;
  "data-deck-entry": string;
  "aria-label": string;
  "aria-haspopup"?: "dialog";
  /** Selecting: the opener is the card's toggle. */
  "aria-pressed"?: boolean;
  "aria-busy"?: boolean;
  "aria-disabled"?: boolean;
  onClick: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove?: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
};

export type DeckRowUi = {
  /** The owner's editor is on: steppers, menus, selection. */
  editing: boolean;
  selecting: boolean;
  isSelected: (entryId: string) => boolean;
  /** The opener of `row`, named `label` (deckRowLabel). */
  openerProps: (row: ViewRow, label: string) => OpenerProps;
  /** The owner's quantity stepper for a List / Table row. */
  stepper: (row: ViewRow) => ReactNode;
  /** The owner's "⋯" menu for a List / Table row. */
  menuButton: (row: ViewRow) => ReactNode;
  isCollapsed: (groupKey: string) => boolean;
  toggleGroup: (groupKey: string) => void;
};
