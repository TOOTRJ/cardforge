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
import { addManyToDeckAction, addToDeckAction, type DeckAddManyResult, type DeckAddResult } from "@/lib/decks/add-actions";
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
import {
  combineReverses,
  createUndoHistory,
  redoWords,
  undoWords,
  type HistoryStep,
  type Reverse,
  type UndoHistory,
  type UndoLabels,
} from "@/lib/decks/undo-history";
import { useLeaveWarning } from "@/components/ai/use-leave-warning";
import type { RemovedEntry } from "@/lib/decks/entry-batch";
import type { DeckItem, DeckPageCard } from "@/lib/decks/queries";
import type { DeckBoard, DeckFormat } from "@/types/deck";
import type { Visibility } from "@/types/card";

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
//   * UNDO / REDO (TODO DK5.13): the last changes, newest first (the
//     toolbar's Undo / Redo, a removal's toast, the phone bar, ⌘/Ctrl Z and
//     ⇧⌘Z / Ctrl Y outside a field) — ONE stack, lib/decks/undo-history.ts:
//     every change is recorded as its reverse, and a reverse hands back its
//     own reverse, which is the redo. An edit's undo is the edit back; a
//     removal's is restoreDeckEntriesAction — the lines back through the
//     paths cards come in by — and the entries' new ids then stand for the
//     old ones in the steps still waiting. A version restored from the
//     change history is one more step.
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

export type DeckEditorDeck = {
  id: string;
  slug: string;
  title: string;
  format: DeckFormat;
  /** Public / unlisted: the add box asks about a private card (TODO DK0.13). */
  visibility?: Visibility;
};

/** Where a change's reverse goes (lib/decks/undo-history.ts). */
type Sink = (next: Reverse | null) => void;

/** The History dialog's "Restore this version" (TODO DK5.13): the version
 *  (the newest change id it keeps), its words, and the server call — the
 *  dialog's, so this file imports no history action. */
export type VersionRestoreRequest = {
  changeId: number;
  /** "the version of 3 Nov, 14:02" */
  label: string;
  write: (changeId: number) => Promise<VersionRestoreAnswer>;
};
export type VersionRestoreAnswer =
  | { ok: true; headBefore: number | null; said: string }
  | { ok: false; error: string; stale?: true };
/** What the dialog gets back: the words, and `undo` — THIS restore back
 *  (the toast's Undo), false and nothing done once it no longer can be. */
export type VersionRestoreResult =
  | { ok: true; said: string; undo: () => boolean }
  | { ok: false; error: string; stale?: true };

/** The queue's line every version restore waits on. */
const VERSION_KEY = "deck:version";

/** One card of an "Add N": what to add and the row drawn for a new line. */
export type AddManyPick = { pick: AddPick; preview: EditorItem | null };

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
   *  the server writes a NEW line. `privateCard: "publish"`: the maker's
   *  private card made public first (TODO DK0.13). */
  add: (
    pick: AddPick,
    board: DeckBoard,
    preview: EditorItem | null,
    privateCard?: "keep" | "publish",
  ) => Promise<DeckAddResult>;
  /** Several cards onto `board` in ONE call (the add box's "Add N", TODO
   *  DK5.17): drawn at once, one undo for them all. `publish`: the maker's
   *  private cards (by id) made public first. */
  addMany: (picks: readonly AddManyPick[], board: DeckBoard, publish?: readonly string[]) => Promise<DeckAddManyResult>;
  /** Undo the last change. */
  undo: () => void;
  /** Make the last undone change again (TODO DK5.13). */
  redo: () => void;
  /** What Undo would undo, in words — null: nothing. */
  undoLabel: string | null;
  /** What Redo would make again, in words — null: nothing. */
  redoLabel: string | null;
  /** The deck's rows back as a version of its change history had them —
   *  undoable (TODO DK5.13). */
  restoreVersion: (request: VersionRestoreRequest) => Promise<VersionRestoreResult>;
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

export const LOST_REQUEST = "The change didn't reach the server — check your connection.";

const nameOf = (item: Pick<EditorItem, "entry" | "card">) => item.card?.title ?? item.entry.name;
/** "Sol Ring", or "3 cards". */
const whoOf = (names: readonly string[]) => (names.length === 1 ? names[0]! : `${names.length} cards`);

/** `stale`: the server found the entries gone (removed in another tab). */
type Answer = { ok: true } | { ok: false; error: string; stale?: true };

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

  // ---- the undo / redo stacks (TODO DK5.13: lib/decks/undo-history.ts) --
  const [labels, setLabels] = useState<UndoLabels>({ undo: null, redo: null });
  const history = useRef<UndoHistory | null>(null);
  if (!history.current) history.current = createUndoHistory(setLabels);
  /** A removed entry's id → the id of the entry that came back for it. */
  const renamed = useRef(new Map<string, string>());
  const resolveId = useCallback((id: string) => {
    let current = id;
    for (let hops = 0; hops < 8 && renamed.current.has(current); hops += 1) current = renamed.current.get(current)!;
    return current;
  }, []);
  /** Where a change's reverse goes once the server has it: a fresh edit's
   *  onto Undo under `label`; an undo's / redo's back to the stack that
   *  ran it (`Sink`). */
  const sinkFor = useCallback(
    (to: Sink | { label: string }): Sink =>
      typeof to === "function" ? to : (next) => next && history.current!.record({ label: to.label, reverse: next }, "edit"),
    [],
  );
  const isHere = useCallback((id: string) => drawnRef.current.some((item) => item.entry.id === id && !item.pending), []);

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
        /** Anything but "done": refused, lost, superseded or cancelled. */
        onMissed?: () => void;
        /** More entries to wait behind than the op's own (a version
         *  restore waits for every edit on its way). */
        keys?: readonly string[];
      },
    ): Promise<QueueOutcome<T>> =>
      new Promise((resolve) => {
        setWriting((count) => count + 1);
        startTransition(async () => {
          draw(op);
          const outcome = await queue.run(options.keys ?? opEntryIds(op), write, {
            coalesce: options.coalesce,
            failed: (value) => !value.ok,
          });
          setWriting((count) => Math.max(0, count - 1));
          if (outcome.status === "done") options.onDone?.(outcome.value);
          else options.onMissed?.();
          if (outcome.status === "failed") {
            const value = outcome.value as Answer | undefined;
            const reason = value && !value.ok ? value.error : LOST_REQUEST;
            toast.error(options.failure, { description: reason });
            announce(`${options.failure} ${reason}`);
            // A request that never answered (what the server holds is
            // unknown), or entries the server no longer has (another tab
            // removed them): ask for the deck again.
            if (!value || (!value.ok && value.stale)) router.refresh();
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

  // Every edit below takes `to`: where its reverse goes once the server has
  // it — `{ label }` for the reader's own edit (onto Undo, Redo cleared), or
  // the Sink of the Undo / Redo that ran it (lib/decks/undo-history.ts).
  // Whatever happens, the Sink is answered exactly once: the reverse, or
  // null when nothing was done (refused, lost, the entries gone).

  /** Patches as ONE update: drawn, written, its reverse recorded. */
  const update = useCallback(
    function update(
      patches: EntryPatch[],
      kind: "quantity" | "board",
      to: Sink | "edit" = "edit",
      /** What the reverse writes, when the caller knows it (an undo's
       *  reverse is the edit's own patches) — else read off the rows. */
      known?: EntryPatch[],
    ) {
      if (patches.length === 0) {
        if (to !== "edit") to(null);
        return;
      }
      const ids = patches.map((patch) => patch.id);
      const before = known ?? restoringPatches(drawnRef.current, ids);
      const op: EntryOp = { kind: "update", updates: patches };
      const who = whoOf(namesOf(ids));
      const said = describeEdit(op, namesOf(ids));
      const sink = sinkFor(to === "edit" ? { label: said.replace(/\.$/, "") } : to);
      // Said at once — the page already shows it.
      announce(said);
      if (!heldFocus.current) holdActive();
      void send(op, () => updateDeckEntriesAction({ deckId: deck.id, updates: patches }), {
        coalesce: kind,
        failure: kind === "board" ? `Couldn't move ${who} — back where it was.` : `Couldn't change ${who} — back to what it was.`,
        onDone: () =>
          sink((done) => {
            const here = (list: EntryPatch[]) =>
              list.map((patch) => ({ ...patch, id: resolveId(patch.id) })).filter((patch) => isHere(patch.id));
            update(here(before), kind, done, here(patches));
          }),
        onMissed: () => sink(null),
      });
    },
    [announce, deck.id, holdActive, isHere, namesOf, resolveId, send, sinkFor],
  );

  const step = useCallback(
    (entryIds: readonly string[], by: number) => update(stepPatches(drawnRef.current, entryIds, by), "quantity"),
    [update],
  );
  const move = useCallback(
    (entryIds: readonly string[], board: DeckBoard) => update(movePatches(drawnRef.current, entryIds, board), "board"),
    [update],
  );

  // ---- removal, and the way back -----------------------------------------
  // A removal's reverse puts the lines back (restore); a restore's reverse
  // takes the lines it brought back out again (removeQuietly) — so a removal
  // undone can be redone, and an add undone (a removal) can be redone (the
  // same line back).
  const removeQuietlyRef = useRef<(ids: string[], who: string, sink: Sink) => void>(() => {});
  const restore = useCallback(
    (removed: RemovedEntry[], drawnAs: EditorItem[], sink: Sink) => {
      // The rows as they were, drawn until the server has them back.
      const op: EntryOp = {
        kind: "insert",
        items: drawnAs.map((item) => ({ ...item, saving: undefined, pending: true as const })),
      };
      const who = whoOf(removed.map((row) => row.name));
      const plural = removed.length > 1;
      void send(op, () => restoreDeckEntriesAction({ deckId: deck.id, entries: removed }), {
        failure: `Couldn't put ${who} back.`,
        onMissed: () => sink(null),
        onDone: (result) => {
          if (!result.ok) {
            sink(null);
            return;
          }
          for (const row of result.restored) if (row.to) renamed.current.set(row.from, row.to);
          const back = result.restored.flatMap((row) => (row.to ? [row.to] : []));
          sink(
            back.length === 0
              ? null
              : (done) => {
                  const here = back.map(resolveId).filter(isHere);
                  if (here.length === 0) done(null);
                  else removeQuietlyRef.current(here, who, done);
                },
          );
          const notes = result.restored.flatMap((row) => (row.note ? [row.note] : []));
          if (notes.length === 0) {
            announce(`${who} ${plural ? "are" : "is"} back in the deck.`);
            return;
          }
          toast.warning(back.length > 0 ? `${who} ${plural ? "are" : "is"} back, with a note.` : `Couldn't put ${who} back.`, {
            description: notes.slice(0, 3).join(" ") + (notes.length > 3 ? ` …and ${notes.length - 3} more.` : ""),
          });
          announce(notes.join(" "));
        },
      });
    },
    [announce, deck.id, isHere, resolveId, send],
  );

  /** A removal made by an Undo or a Redo: no toast of its own. */
  const removeQuietly = useCallback(
    (ids: string[], who: string, sink: Sink) => {
      const wanted = new Set(ids);
      const drawnAs = drawnRef.current.filter((item) => wanted.has(item.entry.id) && !item.pending);
      void send({ kind: "remove", ids }, () => removeDeckEntriesAction({ deckId: deck.id, entryIds: ids }), {
        failure: `Couldn't take ${who} out again.`,
        onMissed: () => sink(null),
        onDone: (result) => {
          if (!result.ok) {
            sink(null);
            return;
          }
          announce(`${who} ${ids.length > 1 ? "are" : "is"} out of the deck again.`);
          const drawn = drawnAs.filter((item) => result.removed.some((row) => row.id === item.entry.id));
          sink((done) => restore(result.removed, drawn, done));
        },
      });
    },
    [announce, deck.id, restore, send],
  );
  removeQuietlyRef.current = removeQuietly;

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
          const steps = history.current!;
          steps.record({ label: `remove ${who}`, reverse: (done) => restore(removed, drawn, done) }, "edit");
          const undoStep = steps.top("undo");
          toast(`Removed ${who}.`, {
            duration: 8000,
            action: {
              label: "Undo",
              // Gone already (undone from the bar or the keys): nothing.
              onClick: () => {
                if (undoStep) steps.run("undo", undoStep);
              },
            },
          });
        },
      });
    },
    [announce, deck.id, holdNeighbour, restore, send],
  );

  /** The reverse of cards that landed: copies back where an add merged
   *  (several picks on one row: back to before the first), the new lines
   *  out — as ONE step (one ⌘Z takes all four of an "Add 4" back out, one
   *  ⇧⌘Z puts them in again). */
  const addedReverse = useCallback(
    (landed: ReadonlyArray<{ row: { entryId: string; merged: boolean; quantity: number }; name: string }>): Reverse =>
      (done) => {
        const back = new Map<string, number>();
        const out = new Set<string>();
        for (const { row } of landed) {
          const id = resolveId(row.entryId);
          if (!isHere(id)) continue;
          if (row.merged) back.set(id, Math.min(back.get(id) ?? Infinity, row.quantity - 1));
          else out.add(id);
        }
        const patches = [...back].filter(([id, quantity]) => quantity >= 1 && !out.has(id)).map(([id, quantity]) => ({ id, quantity }));
        const parts: Reverse[] = [];
        if (patches.length > 0) parts.push((sink) => update(patches, "quantity", sink));
        if (out.size > 0) {
          const who = whoOf(landed.filter(({ row }) => out.has(resolveId(row.entryId))).map(({ name }) => name));
          parts.push((sink) => removeQuietly([...out], who, sink));
        }
        combineReverses(parts)(done);
      },
    [isHere, removeQuietly, resolveId, update],
  );

  // ---- the add box's add -------------------------------------------------
  const add = useCallback(
    async (
      pick: AddPick,
      board: DeckBoard,
      preview: EditorItem | null,
      privateCard: "keep" | "publish" = "keep",
    ): Promise<DeckAddResult> => {
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
      const outcome = await send(op, () =>
          addToDeckAction({
            deckId: deck.id,
            board,
            pick: wire(pick),
            ...(privateCard === "publish" ? { privateCard } : {}),
          }), {
        failure: `Couldn't add ${name}.`,
        onDone: (result) => {
          if (!result.ok) return;
          history.current!.record({ label: `add ${name}`, reverse: addedReverse([{ row: result, name }]) }, "edit");
        },
      });
      if (outcome.status === "done" || outcome.status === "failed") {
        if (outcome.value) return outcome.value;
      }
      return { ok: false, error: LOST_REQUEST };
    },
    [addedReverse, deck.id, send],
  );

  // ---- the add box's "Add N" (TODO DK5.17) ------------------------------
  const addMany = useCallback(
    async (picks: readonly AddManyPick[], board: DeckBoard, publish: readonly string[] = []): Promise<DeckAddManyResult> => {
      // Each card drawn where the server will land it: one copy more on its
      // board's row — two picks on one row, two more — or its new line.
      const rows = drawnRef.current.filter((item) => !item.pending).map((item) => item.entry);
      const bumped = new Map<string, number>();
      const inserts: Array<EditorItem & { pending: true }> = [];
      for (const { pick, preview } of picks) {
        const target = addTargetEntry(rows, pick, board);
        if (target) bumped.set(target.id, (bumped.get(target.id) ?? target.quantity) + 1);
        else if (preview) inserts.push({ ...preview, pending: true as const });
      }
      const ops: EntryOp[] = [];
      if (bumped.size > 0) ops.push({ kind: "update", updates: [...bumped].map(([id, quantity]) => ({ id, quantity })) });
      if (inserts.length > 0) ops.push({ kind: "insert", items: inserts });
      const op: EntryOp = { kind: "batch", ops };
      const names = picks.map(({ pick }) => (pick.kind === "card" ? pick.title : pick.name));
      const who = whoOf(names);
      const outcome = await send(
        op,
        () =>
          addManyToDeckAction({
            deckId: deck.id,
            board,
            picks: picks.map(({ pick }) => wire(pick)),
            ...(publish.length > 0 ? { publish: [...publish] } : {}),
          }),
        {
          failure: `Couldn't add ${who}.`,
          onDone: (result) => {
            if (!result.ok) return;
            const landed = result.results.flatMap((row, index) => (row.ok ? [{ row, name: names[index]! }] : []));
            if (landed.length === 0) return;
            history.current!.record(
              { label: `add ${whoOf(landed.map(({ name }) => name))}`, reverse: addedReverse(landed) },
              "edit",
            );
          },
        },
      );
      if ((outcome.status === "done" || outcome.status === "failed") && outcome.value) return outcome.value;
      return { ok: false, error: LOST_REQUEST };
    },
    [addedReverse, deck.id, send],
  );

  // ---- a version from the change history (TODO DK5.13) ------------------
  // The History dialog's "Restore this version": one server call that puts
  // the deck's rows back as they were after a recorded change. It waits
  // behind every edit on its way (every row's line in the queue), and its
  // reverse is a restore to the version it replaced — so Undo takes a
  // restore back, and Redo makes it again. A fresh restore empties the
  // session's stacks first: their steps name rows it may have replaced.
  const restoreVersion = useCallback(
    function restoreVersion(
      request: VersionRestoreRequest,
      to: Sink | "edit" = "edit",
    ): Promise<VersionRestoreResult> {
      const keys = [VERSION_KEY, ...drawnRef.current.map((item) => item.entry.id)];
      let recorded: HistoryStep | null = null;
      const sink = sinkFor(to === "edit" ? { label: `restore ${request.label}` } : to);
      return send({ kind: "batch", ops: [] }, () => request.write(request.changeId), {
        keys,
        failure: `Couldn't restore ${request.label}.`,
        onMissed: () => sink(null),
        onDone: (result) => {
          if (!result.ok) {
            sink(null);
            return;
          }
          announce(result.said);
          if (to === "edit") history.current!.clear();
          const back = result.headBefore;
          sink(back === null ? null : (done) => void restoreVersion({ ...request, changeId: back }, done));
          // The step this restore just recorded (a fresh one: on top).
          if (to === "edit" && back !== null) recorded = history.current!.top("undo");
        },
      }).then((outcome): VersionRestoreResult => {
        if (outcome.status !== "done" && outcome.status !== "failed") return { ok: false, error: LOST_REQUEST };
        const value = outcome.value;
        if (!value) return { ok: false, error: LOST_REQUEST };
        if (!value.ok) return value;
        const step = recorded;
        return {
          ok: true,
          said: value.said,
          // THIS restore back — only while it is still the newest step: once
          // undone (⌘Z, the toolbar) it is not on Undo any more, and under a
          // newer edit its reverse (the whole deck back to the version it
          // replaced) would take that edit back with it.
          undo: () => {
            const steps = history.current!;
            if (!step || steps.top("undo") !== step) return false;
            return steps.run("undo", step);
          },
        };
      });
    },
    [announce, send, sinkFor],
  );

  const undo = useCallback(() => {
    if (!history.current!.run("undo")) announce("Nothing to undo.");
  }, [announce]);
  const redo = useCallback(() => {
    if (!history.current!.run("redo")) announce("Nothing to redo.");
  }, [announce]);

  // ⌘/Ctrl Z outside a field, with no dialog open: the last change back;
  // ⇧⌘Z / Ctrl Y: the last undo made again.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const which = key === "z" ? (event.shiftKey ? "redo" : "undo") : key === "y" && event.ctrlKey && !event.shiftKey ? "redo" : null;
      if (!which) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector("[role=dialog][data-state=open], [role=alertdialog][data-state=open], [role=menu]")) return;
      if (!history.current!.labels()[which]) return;
      event.preventDefault();
      if (which === "undo") undo();
      else redo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const undoLabel = labels.undo ? undoWords(labels.undo) : null;
  const redoLabel = labels.redo ? redoWords(labels.redo) : null;

  const value = useMemo<DeckEditor>(
    () => ({ deck, items, step, move, remove, add, addMany, undo, redo, undoLabel, redoLabel, restoreVersion, announce, holdFocusOn }),
    [deck, items, step, move, remove, add, addMany, undo, redo, undoLabel, redoLabel, restoreVersion, announce, holdFocusOn],
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
