"use client";

import { useEffect, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from "react";
import { MoveRight } from "lucide-react";
import { useMediaQuery } from "@/components/creator/use-media-query";
import type { DeckEditor } from "@/components/decks/use-deck-editor";
import {
  BOARD_DRAG_QUERY,
  boardOfGroup,
  boardsShownIn,
  DECK_ENTRY_DRAG_TYPE,
  draggedIds,
  dragStartsFrom,
  dropHint,
  movedByDrop,
} from "@/lib/decks/board-drag";
import { moveTargets } from "@/lib/decks/entry-ops";
import { cn } from "@/lib/utils";
import { DECK_BOARD_LABELS, type DeckBoard } from "@/types/deck";

// ---------------------------------------------------------------------------
// Drag a card from one board to another on the owner's deck page (TODO
// DK5.15) — the Stacks, Grid and List views. The rules are
// lib/decks/board-drag.ts's; this is the page's half:
//
//   * a card's wrapper (its <li>) is draggable on a fine pointer only — no
//     drag on touch, where a press selects and a swipe scrolls; a press on a
//     control beside the opener (stepper, "⋯", "2 faces") never drags;
//   * while a card is held, every group that stands for a board it can go to
//     is outlined, the one under the pointer filled and named ("Move here —
//     the Sideboard"), and a tray of the format's boards shows at the bottom
//     — the way to a board with no group yet (an empty sideboard) and to one
//     scrolled out of view;
//   * a drop is the editor's `move` — the menus' move: drawn at once,
//     written in one batch, said in the live region, undoable — and the
//     focus is held on the card in its new group.
//
// Every drag has its twins (WCAG 2.5.7): the "⋯" menu's and the pop-up's
// Move to, the M key's menu and the S key on a focused card, the
// selection's bulk bar. A visitor's page has none of it.
// ---------------------------------------------------------------------------

export type DropState = "idle" | "target" | "over";

export type DragSourceProps = {
  draggable?: boolean;
  "data-drag-entry"?: string;
  onPointerDownCapture?: (event: PointerEvent<HTMLElement>) => void;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLElement>) => void;
};

export type DropZoneProps = {
  "data-drop-board"?: DeckBoard;
  "data-drop-state"?: DropState;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void;
};

export type DropZone = {
  props: DropZoneProps;
  state: DropState;
  /** The zone's words while a card is held over it. */
  hint: string | null;
};

export type BoardDrag = {
  /** A card's wrapper: draggable for the owner on a fine pointer. */
  dragProps: (entryId: string, pending?: boolean) => DragSourceProps;
  /** A group as a drop zone (keyed by the group's key). */
  dropZone: (groupKey: string) => DropZone;
  /** The boards' tray, while a card is held. */
  tray: ReactNode;
};

type Held = { ids: string[]; cards: { id: string; board: DeckBoard }[] };

const IDLE: DropZone = { props: {}, state: "idle", hint: null };

export function useBoardDrag({
  editor,
  hasCommander,
  selection,
  onDropped,
}: {
  editor: DeckEditor | null;
  hasCommander: boolean;
  /** After a drop moved cards (the list re-renders under a still pointer). */
  onDropped?: () => void;
  /** The owner's selection: a picked card carries the whole of it. */
  selection: { selecting: boolean; ids: readonly string[] };
}): BoardDrag {
  const fine = useMediaQuery(BOARD_DRAG_QUERY) === true;
  const [held, setHeld] = useState<Held | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const pressed = useRef<{ type: string; on: Element | null } | null>(null);
  const startTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (startTimer.current !== null) window.clearTimeout(startTimer.current);
    },
    [],
  );

  const enabled = Boolean(editor) && fine;

  const end = () => {
    if (startTimer.current !== null) window.clearTimeout(startTimer.current);
    startTimer.current = null;
    setHeld(null);
    setOver(null);
  };

  const cardsOf = (ids: readonly string[]): Held["cards"] => {
    const wanted = new Set(ids);
    return (editor?.items ?? [])
      .filter((item) => wanted.has(item.entry.id))
      .map((item) => ({ id: item.entry.id, board: item.entry.board }));
  };

  const dragProps = (entryId: string, pending = false): DragSourceProps => {
    if (!enabled || pending) return {};
    return {
      draggable: true,
      "data-drag-entry": entryId,
      onPointerDownCapture: (event) => {
        pressed.current = { type: event.pointerType, on: event.target instanceof Element ? event.target : null };
      },
      onDragStart: (event) => {
        const press = pressed.current;
        pressed.current = null;
        // Touch never drags (a long press is the selection's); nor does a
        // press on a control beside the card.
        if (press?.type === "touch" || !dragStartsFrom(press?.on ?? null)) {
          event.preventDefault();
          return;
        }
        const ids = draggedIds(entryId, selection);
        const cards = cardsOf(ids);
        if (cards.length === 0) {
          event.preventDefault();
          return;
        }
        event.stopPropagation();
        const transfer = event.dataTransfer;
        if (transfer) {
          transfer.effectAllowed = "move";
          transfer.setData(DECK_ENTRY_DRAG_TYPE, ids.join(","));
          // The card's own opener as the picture under the pointer (never
          // the row's stepper, never a stray thumbnail alone).
          const opener = event.currentTarget.querySelector<HTMLElement>("[data-deck-entry]");
          if (opener && typeof transfer.setDragImage === "function") {
            const box = opener.getBoundingClientRect();
            transfer.setDragImage(opener, Math.max(0, event.clientX - box.left), Math.max(0, event.clientY - box.top));
          }
        }
        // Drawn on the next tick: a browser that sees the page change under
        // a drag's first event ends the drag at once (Chrome).
        if (startTimer.current !== null) window.clearTimeout(startTimer.current);
        startTimer.current = window.setTimeout(() => {
          startTimer.current = null;
          setHeld({ ids, cards });
        }, 0);
      },
      onDragEnd: end,
    };
  };

  const zoneFor = (key: string, board: DeckBoard | null, shown: readonly DeckBoard[]): DropZone => {
    if (!enabled || !held || !board) return IDLE;
    const moving = movedByDrop(held.cards, board, shown, hasCommander);
    if (moving.length === 0) return IDLE;
    const state: DropState = over === key ? "over" : "target";
    return {
      state,
      hint: state === "over" ? dropHint(board, moving.length) : null,
      props: {
        "data-drop-board": board,
        "data-drop-state": state,
        onDragOver: (event) => {
          if (!event.dataTransfer?.types?.includes(DECK_ENTRY_DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (over !== key) setOver(key);
        },
        onDragLeave: (event) => {
          const to = event.relatedTarget;
          if (to instanceof Node && event.currentTarget.contains(to)) return;
          setOver((current) => (current === key ? null : current));
        },
        onDrop: (event) => {
          event.preventDefault();
          event.stopPropagation();
          end();
          if (!editor) return;
          const ids = moving;
          // The card's opener takes the focus in its new group (the menus'
          // move does the same).
          editor.holdFocusOn(ids[0]!);
          editor.move(ids, board);
          onDropped?.();
        },
      },
    };
  };

  const dropZone = (groupKey: string) => zoneFor(groupKey, boardOfGroup(groupKey), boardsShownIn(groupKey));
  const trayZone = (key: string, board: DeckBoard) => zoneFor(key, board, [board]);

  const tray =
    enabled && held ? <BoardDropTray boards={moveTargets(hasCommander)} count={held.ids.length} zoneFor={trayZone} /> : null;

  return { dragProps, dropZone, tray };
}

/** The boards' tray while a card is held: every board the format has, the
 *  card's own marked "(here)" — the way to a board with no group yet. */
function BoardDropTray({
  boards,
  count,
  zoneFor,
}: {
  boards: readonly DeckBoard[];
  count: number;
  zoneFor: (key: string, board: DeckBoard) => DropZone;
}) {
  return (
    <div data-board-drop-tray="" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full flex-col items-center gap-2 rounded-frame border border-border bg-surface/95 p-2.5 shadow-2xl backdrop-blur">
        <p className="px-1 text-xs text-muted">
          Drop on a board to move {count === 1 ? "the card" : `${count} cards`}
          <span className="hidden md:inline"> · with the keyboard: focus a card and press M</span>
        </p>
        <ul className="flex flex-wrap justify-center gap-2">
          {boards.map((board) => {
            const zone = zoneFor(`tray:${board}`, board);
            const here = zone.state === "idle";
            return (
              <li
                key={board}
                {...zone.props}
                className={cn(
                  "flex min-h-12 min-w-28 items-center justify-center gap-1.5 rounded-md border-2 px-3 text-sm font-medium transition-colors",
                  here && "border-dashed border-border text-subtle",
                  zone.state === "target" && "border-dashed border-primary-bright/60 text-foreground",
                  zone.state === "over" && "border-primary-bright bg-primary/15 text-foreground",
                )}
              >
                {zone.state === "over" ? <MoveRight className="h-4 w-4 text-primary-bright" aria-hidden /> : null}
                {DECK_BOARD_LABELS[board]}
                {here ? <span className="text-xs font-normal">(here)</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** A drop zone's outline: dashed while it can take the held card, solid and
 *  tinted while the card is over it. Never a change of layout. */
export function dropZoneClass(state: DropState): string | undefined {
  if (state === "target") return "rounded-frame outline-dashed outline-2 outline-offset-4 outline-primary-bright/50";
  if (state === "over") return "rounded-frame bg-primary/5 outline outline-2 outline-offset-4 outline-primary-bright";
  return undefined;
}

/** The words on a zone while the card is over it — drawn over its top
 *  edge, out of the layout. */
export function DropZoneHint({ hint }: { hint: string | null }) {
  if (!hint) return null;
  return (
    <span
      aria-hidden
      data-drop-hint=""
      className="pointer-events-none absolute right-2 top-0 z-40 -translate-y-1/2 rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-white shadow"
    >
      {hint}
    </span>
  );
}
