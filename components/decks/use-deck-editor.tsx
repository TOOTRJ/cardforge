"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  removeDeckEntriesAction,
  restoreDeckEntriesAction,
  updateDeckEntriesAction,
} from "@/lib/decks/card-actions";
import { addToDeckAction, type DeckAddResult } from "@/lib/decks/add-actions";
import { addTargetEntry, type AddPick } from "@/lib/decks/add-search";
import { createEntryQueue, type QueueOutcome } from "@/lib/decks/entry-queue";
import {
  applyEntryOp,
  describeEdit,
  movePatches,
  opEntryIds,
  restoringPatches,
  stepPatches,
  type EntryOp,
  type EntryPatch,
} from "@/lib/decks/entry-ops";
import { isTypingTarget } from "@/lib/decks/entry-shortcuts";
import { useLeaveWarning } from "@/components/ai/use-leave-warning";
import type { RemovedEntry } from "@/lib/decks/entry-batch";
import type { DeckItem, DeckPageCard } from "@/lib/decks/queries";
import type { DeckBoard, DeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// The owner's deck page as an editor (TODO DK5.4 / DK5.8) — every edit the
// page makes, in ONE place: quantities, boards, removals and their undo,
// and the add box's adds. What it promises:
//
//   * INSTANT: an edit is drawn the moment it is made (React's
//     useOptimistic over the rows the server sent — lib/decks/entry-ops.ts:
//     every edit is the VALUE it wants, so drawn over rows that already
//     hold it nothing changes) and sent through the write queue
//     (lib/decks/entry-queue.ts: one line per entry, a waiting edit
//     replaced by a newer one of its kind, a failure cancelling the edits
//     made on top of it). The action that writes it revalidates the deck
//     page, which brings the page's new rows back WITH its answer — never a
//     router.refresh() per edit. The drawn edit lasts until that answer is
//     in, so the rows never blink back.
//   * NO SILENT LOSS: a refusal or a lost request rolls the rows back to
//     what the server holds (the drawn edit simply ends) and says so — a
//     toast and the live region, naming what went back. A request that
//     never answered (offline, a deploy) also asks the server again: its
//     state is unknown. While an edit is on its way, leaving the page asks
//     first (useLeaveWarning: an unload can cut the request off).
//   * UNDO: the last changes, newest first (a removal's toast, the phone
//     bar's Undo, ⌘/Ctrl Z outside a field). An edit's undo is the edit
//     back; a removal's is restoreDeckEntriesAction — the lines back through
//     the paths cards come in by — and the entries' new ids then stand for
//     the old ones in the undos still waiting.
//   * ONE VOICE: `announce` is the page's polite live region.
//   * THE FOCUS STAYS: an edit made from a card's opener (a key) or a menu
//     that moves the card to another group re-draws its opener there, and a
//     removal takes its row away — the focus goes back to that card, or on
//     to the card that took the removed one's place, never to <body>. Only
//     while the focus is lost and for a few seconds: a reader who clicked or
//     moved on is left alone.
// ---------------------------------------------------------------------------

/** A row as the editor draws it: `pending` — written by no one yet (an
 *  add, a removal being undone): drawn, not an opener yet; `saving` — an
 *  edit of it is on its way. */
export type EditorItem = DeckItem<DeckPageCard> & { pending?: true; saving?: true };

export type DeckEditorDeck = { id: string; slug: string; title: string; format: DeckFormat };

type UndoStep = { label: string; run: () => void };

export type DeckEditor = {
  deck: DeckEditorDeck;
  /** The rows with every edit on its way drawn in. */
  items: EditorItem[];
  /** Each entry `by` copies more or fewer (held to 1–250). */
  step: (entryIds: readonly string[], by: number) => void;
  /** Each entry onto `board`. */
  move: (entryIds: readonly string[], board: DeckBoard) => void;
  /** The entries out of the deck — with an Undo. */
  remove: (entryIds: readonly string[]) => void;
  /** One card onto `board` (the add box). `preview`: the row drawn while
   *  the server writes a NEW line. */
  add: (pick: AddPick, board: DeckBoard, preview: EditorItem | null) => Promise<DeckAddResult>;
  /** Undo the last change. */
  undo: () => void;
  /** What Undo would undo, in words — null: nothing. */
  undoLabel: string | null;
  announce: (text: string) => void;
  /** The focus goes back to this card's opener once an edit has re-drawn
   *  it (a menu's pick: the menu held the focus). */
  holdFocusOn: (entryId: string) => void;
};

const DeckEditorContext = createContext<DeckEditor | null>(null);

/** The editor of the owner's deck page — null for a visitor (and for a
 *  list drawn on its own). */
export function useDeckEditor(): DeckEditor | null {
  return useContext(DeckEditorContext);
}

/** The optimistic reducer: the edit drawn in, an update's rows marked as
 *  saving. */
export function reduceEditorItems(items: EditorItem[], op: EntryOp): EditorItem[] {
  const next = applyEntryOp(items, op);
  if (op.kind !== "update") return next;
  const saving = new Set(opEntryIds(op));
  return next.map((item) => (saving.has(item.entry.id) && !item.saving ? { ...item, saving: true as const } : item));
}

const UNDO_LIMIT = 20;
export const LOST_REQUEST = "The change didn't reach the server — check your connection.";

const nameOf = (item: Pick<EditorItem, "entry" | "card">) => item.card?.title ?? item.entry.name;
/** "Sol Ring", or "3 cards". */
const whoOf = (names: readonly string[]) => (names.length === 1 ? names[0]! : `${names.length} cards`);

type Answer = { ok: true } | { ok: false; error: string };

export function DeckEditorProvider({
  deck,
  items: serverItems,
  children,
}: {
  deck: DeckEditorDeck;
  items: EditorItem[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [items, draw] = useOptimistic(serverItems, reduceEditorItems);
  // The rows as drawn now, for handlers that run later.
  const drawnRef = useRef(items);
  drawnRef.current = items;
  const queue = useRef(createEntryQueue()).current;

  // ---- the focus, kept through a re-draw ---------------------------------
  const heldFocus = useRef<{ selector: string; until: number } | null>(null);
  const holdSelector = useCallback((selector: string | null) => {
    heldFocus.current = selector ? { selector, until: Date.now() + 4000 } : null;
  }, []);
  const holdFocusOn = useCallback((entryId: string) => holdSelector(openerSelector(entryId)), [holdSelector]);
  /** The card whose opener holds the focus now, kept. */
  const holdActive = useCallback(() => {
    const opener = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>("[data-deck-entry]");
    if (opener?.dataset.deckEntry) holdFocusOn(opener.dataset.deckEntry);
  }, [holdFocusOn]);
  /** The card after `ids` (else before them) in the page's order: where the
   *  focus goes once they are gone. */
  const holdNeighbour = useCallback(
    (ids: readonly string[]) => {
      const gone = new Set(ids);
      const openers = Array.from(document.querySelectorAll<HTMLElement>("[data-deck-entry]"));
      const lastGone = openers.reduce((at, el, index) => (gone.has(el.dataset.deckEntry ?? "") ? index : at), -1);
      const after = openers.slice(lastGone + 1).find((el) => !gone.has(el.dataset.deckEntry ?? ""));
      const before = openers.slice(0, Math.max(lastGone, 0)).reverse().find((el) => !gone.has(el.dataset.deckEntry ?? ""));
      const next = after ?? before;
      holdSelector(next?.dataset.deckEntry ? openerSelector(next.dataset.deckEntry) : null);
    },
    [holdSelector],
  );
  useLayoutEffect(() => {
    const held = heldFocus.current;
    if (!held) return;
    if (Date.now() > held.until) {
      heldFocus.current = null;
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const target = document.querySelector<HTMLElement>(held.selector);
    if (!target) return;
    heldFocus.current = null;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: "nearest" });
  });
  useEffect(() => {
    // A reader who clicks elsewhere has moved on.
    const forget = () => {
      heldFocus.current = null;
    };
    window.addEventListener("pointerdown", forget, true);
    return () => window.removeEventListener("pointerdown", forget, true);
  }, []);

  // ---- the live region ---------------------------------------------------
  const [spoken, setSpoken] = useState("");
  const speakTimer = useRef<number | null>(null);
  const announce = useCallback((text: string) => {
    // Cleared first, so the same words twice are said twice.
    setSpoken("");
    if (speakTimer.current) window.clearTimeout(speakTimer.current);
    speakTimer.current = window.setTimeout(() => setSpoken(text), 60);
  }, []);
  useEffect(
    () => () => {
      if (speakTimer.current) window.clearTimeout(speakTimer.current);
    },
    [],
  );

  // ---- the undo stack ----------------------------------------------------
  const undoStack = useRef<UndoStep[]>([]);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  /** A removed entry's id → the id of the entry that came back for it. */
  const renamed = useRef(new Map<string, string>());
  const resolveId = useCallback((id: string) => {
    let current = id;
    for (let hops = 0; hops < 8 && renamed.current.has(current); hops += 1) current = renamed.current.get(current)!;
    return current;
  }, []);
  const pushUndo = useCallback((step: UndoStep) => {
    undoStack.current = [...undoStack.current, step].slice(-UNDO_LIMIT);
    setUndoLabel(step.label);
  }, []);
  /** Takes `step` (or the last one) off the stack; null when it is gone —
   *  already undone from elsewhere. */
  const takeUndo = useCallback((step?: UndoStep): UndoStep | null => {
    const stack = undoStack.current;
    const index = step ? stack.lastIndexOf(step) : stack.length - 1;
    if (index < 0) return null;
    const taken = stack[index]!;
    undoStack.current = [...stack.slice(0, index), ...stack.slice(index + 1)];
    setUndoLabel(undoStack.current.at(-1)?.label ?? null);
    return taken;
  }, []);

  // ---- one edit: drawn, queued, answered ---------------------------------
  // Edits on their way: leaving the page (a reload, a closed tab) asks first
  // — a request cut off by the unload may never reach the server, and the
  // page already shows it as made.
  const [writing, setWriting] = useState(0);
  useLeaveWarning(writing > 0);
  const send = useCallback(
    <T extends Answer>(
      op: EntryOp,
      write: () => Promise<T>,
      options: {
        coalesce?: string;
        /** Said when the server refuses it or never answers. */
        failure: string;
        onDone?: (value: T) => void;
      },
    ): Promise<QueueOutcome<T>> =>
      new Promise((resolve) => {
        setWriting((count) => count + 1);
        startTransition(async () => {
          draw(op);
          const outcome = await queue.run(opEntryIds(op), write, {
            coalesce: options.coalesce,
            failed: (value) => !value.ok,
          });
          setWriting((count) => Math.max(0, count - 1));
          if (outcome.status === "done") options.onDone?.(outcome.value);
          if (outcome.status === "failed") {
            const value = outcome.value as Answer | undefined;
            const reason = value && !value.ok ? value.error : LOST_REQUEST;
            toast.error(options.failure, { description: reason });
            announce(`${options.failure} ${reason}`);
            // A request that never answered: what the server holds is
            // unknown — ask for it.
            if (!value) router.refresh();
          }
          resolve(outcome);
        });
      }),
    [announce, draw, queue, router],
  );

  const namesOf = useCallback((ids: readonly string[]) => {
    const wanted = new Set(ids);
    return drawnRef.current.filter((item) => wanted.has(item.entry.id)).map(nameOf);
  }, []);

  /** Patches as ONE update: drawn, written, undoable. */
  const update = useCallback(
    function update(patches: EntryPatch[], kind: "quantity" | "board", undoable = true) {
      if (patches.length === 0) return;
      const ids = patches.map((patch) => patch.id);
      const before = restoringPatches(drawnRef.current, ids);
      const op: EntryOp = { kind: "update", updates: patches };
      const who = whoOf(namesOf(ids));
      const said = describeEdit(op, namesOf(ids));
      // Said at once — the page already shows it.
      announce(said);
      if (!heldFocus.current) holdActive();
      void send(op, () => updateDeckEntriesAction({ deckId: deck.id, updates: patches }), {
        coalesce: kind,
        failure: kind === "board" ? `Couldn't move ${who} — back where it was.` : `Couldn't change ${who} — back to what it was.`,
        onDone: () => {
          if (!undoable) return;
          pushUndo({
            label: `Undo: ${said.replace(/\.$/, "")}`,
            run: () =>
              update(
                before
                  .map((patch) => ({ ...patch, id: resolveId(patch.id) }))
                  .filter((patch) => drawnRef.current.some((item) => item.entry.id === patch.id)),
                kind,
                false,
              ),
          });
        },
      });
    },
    [announce, deck.id, holdActive, namesOf, pushUndo, resolveId, send],
  );

  const step = useCallback(
    (entryIds: readonly string[], by: number) => update(stepPatches(drawnRef.current, entryIds, by), "quantity"),
    [update],
  );
  const move = useCallback(
    (entryIds: readonly string[], board: DeckBoard) => update(movePatches(drawnRef.current, entryIds, board), "board"),
    [update],
  );

  // ---- removal, and its undo ---------------------------------------------
  const restore = useCallback(
    (removed: RemovedEntry[], drawnAs: EditorItem[]) => {
      // The rows as they were, drawn until the server has them back.
      const op: EntryOp = {
        kind: "insert",
        items: drawnAs.map((item) => ({ ...item, saving: undefined, pending: true as const })),
      };
      const who = whoOf(removed.map((row) => row.name));
      const plural = removed.length > 1;
      void send(op, () => restoreDeckEntriesAction({ deckId: deck.id, entries: removed }), {
        failure: `Couldn't put ${who} back.`,
        onDone: (result) => {
          if (!result.ok) return;
          for (const row of result.restored) if (row.to) renamed.current.set(row.from, row.to);
          const notes = result.restored.flatMap((row) => (row.note ? [row.note] : []));
          if (notes.length === 0) {
            announce(`${who} ${plural ? "are" : "is"} back in the deck.`);
            return;
          }
          const back = result.restored.some((row) => row.to);
          toast.warning(back ? `${who} ${plural ? "are" : "is"} back, with a note.` : `Couldn't put ${who} back.`, {
            description: notes.slice(0, 3).join(" ") + (notes.length > 3 ? ` …and ${notes.length - 3} more.` : ""),
          });
          announce(notes.join(" "));
        },
      });
    },
    [announce, deck.id, send],
  );

  /** A removal no one undoes (an add's undo): no toast, no undo of its own. */
  const removeQuietly = useCallback(
    (id: string, name: string) =>
      void send({ kind: "remove", ids: [id] }, () => removeDeckEntriesAction({ deckId: deck.id, entryIds: [id] }), {
        failure: `Couldn't take ${name} out again.`,
        onDone: (result) => {
          if (result.ok) announce(`${name} is out of the deck again.`);
        },
      }),
    [announce, deck.id, send],
  );

  const remove = useCallback(
    (entryIds: readonly string[]) => {
      const wanted = new Set(entryIds);
      const drawnAs = drawnRef.current.filter((item) => wanted.has(item.entry.id) && !item.pending);
      if (drawnAs.length === 0) return;
      const ids = drawnAs.map((item) => item.entry.id);
      const who = whoOf(drawnAs.map(nameOf));
      announce(`Removed ${who}.`);
      holdNeighbour(ids);
      void send({ kind: "remove", ids }, () => removeDeckEntriesAction({ deckId: deck.id, entryIds: ids }), {
        failure: `Couldn't remove ${who} — ${drawnAs.length === 1 ? "it's" : "they're"} still in the deck.`,
        onDone: (result) => {
          if (!result.ok) return;
          const removed = result.removed;
          const drawn = drawnAs.filter((item) => removed.some((row) => row.id === item.entry.id));
          const undoStep: UndoStep = { label: `Undo: remove ${who}`, run: () => restore(removed, drawn) };
          pushUndo(undoStep);
          toast(`Removed ${who}.`, {
            duration: 8000,
            action: {
              label: "Undo",
              // Gone already (undone from the bar or the keys): nothing.
              onClick: () => takeUndo(undoStep)?.run(),
            },
          });
        },
      });
    },
    [announce, deck.id, holdNeighbour, pushUndo, restore, send, takeUndo],
  );

  // ---- the add box's add -------------------------------------------------
  const add = useCallback(
    async (pick: AddPick, board: DeckBoard, preview: EditorItem | null): Promise<DeckAddResult> => {
      // The row it lands on, as the server will pick it (one copy more), or
      // the new line's preview.
      const target = addTargetEntry(
        drawnRef.current.filter((item) => !item.pending).map((item) => item.entry),
        pick,
        board,
      );
      const op: EntryOp = target
        ? { kind: "update", updates: [{ id: target.id, quantity: target.quantity + 1 }] }
        : preview
          ? { kind: "insert", items: [{ ...preview, pending: true as const }] }
          : { kind: "update", updates: [] };
      const name = pick.kind === "card" ? pick.title : pick.name;
      const outcome = await send(op, () => addToDeckAction({ deckId: deck.id, board, pick: wire(pick) }), {
        failure: `Couldn't add ${name}.`,
        onDone: (result) => {
          if (!result.ok) return;
          const was = result.quantity - 1;
          pushUndo({
            label: `Undo: add ${name}`,
            run: () => {
              const id = resolveId(result.entryId);
              if (!drawnRef.current.some((item) => item.entry.id === id)) return;
              if (result.merged && was >= 1) update([{ id, quantity: was }], "quantity", false);
              else removeQuietly(id, name);
            },
          });
        },
      });
      if (outcome.status === "done" || outcome.status === "failed") {
        if (outcome.value) return outcome.value;
      }
      return { ok: false, error: LOST_REQUEST };
    },
    [deck.id, pushUndo, removeQuietly, resolveId, send, update],
  );

  const undo = useCallback(() => {
    const taken = takeUndo();
    if (!taken) {
      announce("Nothing to undo.");
      return;
    }
    taken.run();
  }, [announce, takeUndo]);

  // ⌘/Ctrl Z outside a field, with no dialog open: the last change back.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector("[role=dialog][data-state=open], [role=alertdialog][data-state=open], [role=menu]")) return;
      if (undoStack.current.length === 0) return;
      event.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const value = useMemo<DeckEditor>(
    () => ({ deck, items, step, move, remove, add, undo, undoLabel, announce, holdFocusOn }),
    [deck, items, step, move, remove, add, undo, undoLabel, announce, holdFocusOn],
  );

  return (
    <DeckEditorContext.Provider value={value}>
      {children}
      <p role="status" aria-live="polite" className="sr-only" data-testid="deck-editor-status">
        {spoken}
      </p>
    </DeckEditorContext.Provider>
  );
}

const openerSelector = (entryId: string) => `[data-deck-entry="${entryId.replace(/["\\]/g, "")}"]`;

/** The pick as the action takes it. */
function wire(pick: AddPick) {
  return pick.kind === "card"
    ? { kind: "card" as const, cardId: pick.cardId }
    : { kind: "printing" as const, scryfallId: pick.scryfallId, name: pick.name };
}
