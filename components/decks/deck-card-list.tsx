"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckSquare, ClipboardPaste, FileText, Pencil, Trash2 } from "lucide-react";
import { DeckAddBox } from "@/components/decks/deck-add-box";
import { DeckBulkBar } from "@/components/decks/deck-bulk-bar";
import { DeckCardModal } from "@/components/decks/deck-card-modal";
import { DeckGroupViews } from "@/components/decks/deck-card-views";
import { EntryMenuButton, EntryStepper, MenuTrigger } from "@/components/decks/deck-entry-controls";
import { EntryMenu, type MenuItem } from "@/components/decks/deck-entry-menu";
import { DeckMobileBar } from "@/components/decks/deck-mobile-bar";
import { createPreviewStore, DeckPreviewPane } from "@/components/decks/deck-preview-pane";
import type { DeckRowUi, OpenerProps, ViewRow } from "@/components/decks/deck-row-ui";
import { DeckSummaryBar } from "@/components/decks/deck-summary-bar";
import { openDeckTool } from "@/components/decks/deck-tool-event";
import { DeckViewToolbar } from "@/components/decks/deck-view-toolbar";
import { useMediaQuery } from "@/components/creator/use-media-query";
import { DeckEditorProvider, useDeckEditor, type DeckEditor, type EditorItem } from "@/components/decks/use-deck-editor";
import { computeDeckAnalytics, type DeckAnalytics } from "@/lib/decks/analytics";
import { deckSummaryOf } from "@/lib/decks/deck-summary";
import {
  deckStatusCountsOf,
  DECK_VIEW_COOKIE,
  DECK_VIEW_COOKIE_MAX_AGE,
  DECK_VIEW_COOKIE_PATH,
  DECK_VIEW_LABELS,
  DECK_VIEWS,
  deckRowsOf,
  filterDeckRows,
  groupDeckRows,
  nextUnchangedImport,
  serializeDeckViewPrefs,
  statusFilterOptions,
  type DeckViewPrefs,
  type StatusFilter,
} from "@/lib/decks/deck-view";
import { moveTargets, sideToggleBoard } from "@/lib/decks/entry-ops";
import { entryShortcutOf } from "@/lib/decks/entry-shortcuts";
import { formatHasCommander, validateDeck } from "@/lib/decks/format-rules";
import { MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";
import { publicDeckItems } from "@/lib/decks/private-card-name";
import { coverPickRowsOf, standsInFan } from "@/lib/decks/featured";
import type { DeckItem, DeckPageCard } from "@/lib/decks/queries";
import { entryEditTarget, parseDeckEntryAnchor } from "@/lib/decks/return-to";
import { cn } from "@/lib/utils";
import { DECK_BOARD_LABELS, type DeckBoard, type DeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// DeckCardList — the deck page's card area (TODO DK5.1 / DK5.3 / DK5.6 /
// DK5.9): the view toolbar, the cards in the viewer's view — Stacks, Grid,
// List or Table — grouped and sorted their way, the status filter, the
// pop-up a card opens (info for everyone, management for the owner; a bottom
// sheet on touch) and the sticky summary bar. Every group, sort and filter
// is lib/decks/deck-view.ts's (the entry's EFFECTIVE fields and its ONE
// status); the view, the grouping and the sort are remembered per viewer in
// a cookie (DECK_VIEW_COOKIE), so the server draws the first paint right.
// The status filter and "custom cards ⇄ real cards" are this visit's.
//
// For the OWNER (`canManage` with its `deck`) it is the deck's editor
// (TODO DK5 part 2): the add box (DK5.2), steppers and "⋯" menus on the
// List and Table rows, the entry keys (+ − M S on a focused card), Remove
// with an Undo, a selection with its bulk bar (DK5.4), Edit on every card
// and the way back to it (DK5.5), every change drawn at once and rolled
// back if the server refuses it (DK5.8, components/decks/use-deck-editor),
// and on a phone a bottom bar — Add · View · Undo · More (DK5.10). Every
// visitor and the owner alike get the large preview pane on a wide screen
// and foldable groups (DK5.7 / DK5.10).
//
// A visitor never reads a private card's title (D11): the items go through
// publicDeckItems here too — the page already did; a list rendered on its
// own is held to the same rule — and the card is a "Private card" tile.
// ---------------------------------------------------------------------------

/** The view a list rendered without the viewer's prefs starts on. */
const LIST_PREFS: DeckViewPrefs = { view: "list", group: "type", sort: "mana" };
/** Where the large preview pane shows (Tailwind's `xl`). */
const PREVIEW_PANE_QUERY = "(min-width: 80rem)";
/** How long a press must rest to select a card on touch. */
const LONG_PRESS_MS = 500;
/** How far a finger may drift and still be a press. */
const LONG_PRESS_SLOP_PX = 10;

export type DeckCardListSummary = {
  format: DeckFormat;
  /** The deck's breakdown (computeDeckAnalytics over the viewer's rows). */
  analytics: Pick<DeckAnalytics, "total" | "byBoard" | "averageManaValue" | "lands">;
  /** The owner's format check: how many issues (0 = passes). Null for a
   *  visitor, who never sees it (TODO DK0.9). */
  formatIssues: number | null;
};

type DeckCardListProps = {
  items: DeckItem<DeckPageCard>[];
  ownerUsername: string | null;
  canManage: boolean;
  /** The owner's deck: with it, the list is the deck's editor. */
  deck?: { id: string; slug: string; title: string; format: DeckFormat } | null;
  /** The deck's owner, given to the OWNER's list only: the pop-up's cover
   *  picks (TODO DK6.4, components/decks/deck-cover-picks.tsx). */
  coverOwnerId?: string | null;
  /** The viewer's remembered view (the cookie). The List when left out. */
  initialPrefs?: DeckViewPrefs;
  /** The sticky summary bar's numbers; no bar when left out. */
  summary?: DeckCardListSummary;
  /** The owner's empty deck: its doors (drawn under the add box). */
  emptyState?: ReactNode;
  /** A commander deck with no commander yet: its slot (over the cards). */
  commanderSlot?: ReactNode;
};

export function DeckCardList(props: DeckCardListProps) {
  const { deck, canManage } = props;
  const editorDeck = useMemo(
    () => (canManage && deck ? { id: deck.id, slug: deck.slug, title: deck.title, format: deck.format } : null),
    [canManage, deck?.id, deck?.slug, deck?.title, deck?.format], // eslint-disable-line react-hooks/exhaustive-deps -- by value
  );
  if (editorDeck) {
    return (
      <DeckEditorProvider deck={editorDeck} items={props.items as EditorItem[]}>
        <DeckCardArea {...props} />
      </DeckEditorProvider>
    );
  }
  return <DeckCardArea {...props} />;
}

type MenuRequest = { label: string; items: MenuItem[] };

/** The view, the grouping and the sort, remembered for the next deck page. */
function rememberPrefs(prefs: DeckViewPrefs) {
  document.cookie = `${DECK_VIEW_COOKIE}=${serializeDeckViewPrefs(prefs)}; path=${DECK_VIEW_COOKIE_PATH}; max-age=${DECK_VIEW_COOKIE_MAX_AGE}; samesite=lax`;
}

function DeckCardArea({
  items: given,
  ownerUsername,
  canManage,
  coverOwnerId = null,
  initialPrefs,
  summary,
  emptyState,
  commanderSlot,
}: DeckCardListProps) {
  const editor = useDeckEditor();
  const editing = Boolean(editor);
  const items: EditorItem[] = editor?.items ?? (given as EditorItem[]);
  const [prefs, setPrefs] = useState<DeckViewPrefs>(initialPrefs ?? LIST_PREFS);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [showProxies, setShowProxies] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const changePrefs = (patch: Partial<DeckViewPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    rememberPrefs(next);
  };

  // The rows as this viewer may see them (a visitor: no private card's
  // title), each with its status, badge and effective fields — once.
  const shown = useMemo(() => publicDeckItems(items, canManage), [items, canManage]);
  const rows = useMemo(() => deckRowsOf(shown, canManage) as ViewRow[], [shown, canManage]);
  // THE status count — the chips, the bar and the page's breakdown say the
  // same numbers (the deck's cards; the maybeboard never counts).
  const counts = useMemo(() => deckStatusCountsOf(rows), [rows]);
  const chips = statusFilterOptions(counts, filter);
  const allGroups = useMemo(() => groupDeckRows(rows, prefs.group, prefs.sort), [rows, prefs.group, prefs.sort]);
  const groups = useMemo(
    () =>
      filter === "all"
        ? allGroups
        : allGroups.flatMap((group) => {
            const kept = filterDeckRows(group.rows, filter);
            return kept.length > 0 ? [{ ...group, rows: kept, count: kept.reduce((sum, row) => sum + row.quantity, 0) }] : [];
          }),
    [allGroups, filter],
  );
  /** The cards on show, in the order the page reads them. */
  const visibleRows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);

  // Closing the pop-up hands the focus back to the card that opened it
  // (TODO 5.17). The dialog has no Dialog.Trigger — a card opens it through
  // state — so Radix has nowhere to return the focus and it fell to <body>:
  // a keyboard user started again from the top of the page. The opener is
  // found by its entry id (`data-deck-entry`, on the opener of every view)
  // once the dialog has unmounted (its focus trap would pull the focus back
  // before that).
  //
  // Three things the first cut missed (the independent check of #536):
  //  - a click on the BACKDROP closes the dialog on pointerdown, and the
  //    same click's mousedown then takes the focus off the opener again (it
  //    lands on <body>): the hand-back is repeated once the click is over;
  //  - the entry may be GONE — "Remove from deck" in the pop-up, or a card
  //    linked under the "Imported" filter — before or just after the
  //    close: the focus then goes to the opener that took its place (the
  //    last one, past the end; the list's first control when none is left),
  //    never to <body>;
  //  - an entry removed while its pop-up is open unmounts the dialog without
  //    `selectedId` changing: the pop-up counts as open only while its entry
  //    is still in `items` (`openId`).
  const listRef = useRef<HTMLDivElement | null>(null);
  const openId = selectedId !== null && items.some((i) => i.entry.id === selectedId) ? selectedId : null;
  const returnFocusTo = useRef<{ id: string; index: number } | null>(null);
  // The opener the focus was handed back to, for as long as the focus is on it.
  const handedBack = useRef<{ id: string; index: number } | null>(null);
  const rowsOf = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-deck-entry]") ?? []);
  const focusNear = (index: number) => {
    const openers = rowsOf();
    const target =
      openers[Math.max(0, Math.min(index, openers.length - 1))] ??
      listRef.current?.querySelector<HTMLElement>("button, a[href]");
    target?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (openId !== null) {
      returnFocusTo.current = {
        id: openId,
        index: rowsOf().findIndex((row) => row.dataset.deckEntry === openId),
      };
      handedBack.current = null;
      return;
    }
    const from = returnFocusTo.current;
    returnFocusTo.current = null;
    if (!from) return;
    const handBack = () => {
      const row = rowsOf().find((el) => el.dataset.deckEntry === from.id);
      if (row) {
        row.focus();
        handedBack.current = from;
      } else {
        focusNear(from.index);
      }
    };
    handBack();
    // A backdrop click: its mousedown comes after the close and blurs the opener.
    const again = setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) handBack();
    }, 0);
    return () => clearTimeout(again);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read refs and the live DOM
  }, [openId]);
  // The opener the focus was handed back to is taken away by the refresh
  // that follows the close (a removal answers after the pop-up has shut).
  useEffect(() => {
    const given = handedBack.current;
    if (!given) return;
    if (rowsOf().some((row) => row.dataset.deckEntry === given.id)) return;
    handedBack.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    focusNear(given.index);
  });

  // ---- the owner's selection (TODO DK5.4 / DK5.10) -------------------------
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // Only cards still on show stay picked (a removal, a filter).
  const selectedIds = useMemo(() => visibleRows.filter((row) => picked.has(row.id) && !row.item.pending).map((row) => row.id), [picked, visibleRows]);
  const isSelected = (id: string) => picked.has(id);
  const toggleSelected = (id: string) => {
    setSelecting(true);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  // ---- folded groups (TODO DK5.10) ------------------------------------------
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggleGroup = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ---- the preview pane (TODO DK5.7) ---------------------------------------
  const [preview] = useState(createPreviewStore);
  const wide = useMediaQuery(PREVIEW_PANE_QUERY) === true;

  // ---- menus: a row's "⋯" and the M key's -----------------------------------
  const hasCommander = summary ? formatHasCommander(summary.format) : true;
  const boardsFor = (current: DeckBoard | null) => {
    const boards = moveTargets(hasCommander);
    return current && !boards.includes(current) ? [current, ...boards] : boards;
  };
  /** The boards as a menu's radios. `focusBack`: the card whose opener the
   *  focus returns to once the move has drawn it in its new group. */
  const moveItems = (ids: string[], current: DeckBoard | null, focusBack?: string): MenuItem[] =>
    editor
      ? [
          { kind: "heading", label: "Move to" },
          ...boardsFor(current).map((board) => ({
            kind: "radio" as const,
            label: DECK_BOARD_LABELS[board],
            checked: board === current,
            onSelect: () => {
              if (focusBack) editor.holdFocusOn(focusBack);
              editor.move(ids, board);
            },
          })),
        ]
      : [];
  const rowMenuItems = (row: ViewRow): MenuItem[] => {
    if (!editor) return [];
    const edit = entryEditTarget(row.item, editor.deck.slug);
    return [
      ...moveItems([row.id], row.board),
      { kind: "separator" },
      { kind: "item", label: edit.label, icon: <Pencil className="h-3.5 w-3.5" />, href: edit.href },
      { kind: "item", label: "Select", icon: <CheckSquare className="h-3.5 w-3.5" />, onSelect: () => toggleSelected(row.id) },
      { kind: "separator" },
      { kind: "item", label: "Remove", icon: <Trash2 className="h-3.5 w-3.5" />, danger: true, onSelect: () => editor.remove([row.id]) },
    ];
  };
  // The M key on a card with no "⋯" of its own: a menu at the card.
  const [keyMenu, setKeyMenu] = useState<MenuRequest | null>(null);
  const keyMenuAnchor = useRef<HTMLElement | null>(null);

  // ---- one opener for every view -------------------------------------------
  const press = useRef<{ id: string; timer: number; x: number; y: number } | null>(null);
  const swallowClick = useRef<string | null>(null);
  const endPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => endPress, []);

  const onEntryKey = (event: React.KeyboardEvent<HTMLElement>, row: ViewRow) => {
    if (!editor || row.item.pending) return;
    const shortcut = entryShortcutOf(event);
    if (!shortcut) return;
    event.preventDefault();
    if (shortcut === "increment") {
      if (row.quantity >= MAX_ENTRY_QUANTITY) editor.announce(`${row.name}: ${MAX_ENTRY_QUANTITY} copies is the most.`);
      else editor.step([row.id], 1);
    } else if (shortcut === "decrement") {
      if (row.quantity <= 1) editor.announce(`${row.name}: one copy is the fewest — remove it from its menu.`);
      else editor.step([row.id], -1);
    } else if (shortcut === "side") {
      editor.move([row.id], sideToggleBoard(row.board));
    } else {
      keyMenuAnchor.current = event.currentTarget;
      // The card may change groups: the focus comes back to it.
      setKeyMenu({ label: `Move ${row.name}`, items: moveItems([row.id], row.board, row.id) });
    }
  };

  const openerProps = (row: ViewRow, label: string): OpenerProps => {
    const id = row.id;
    const pending = Boolean(row.item.pending);
    const props: OpenerProps = {
      id: `entry-${id}`,
      "data-deck-entry": id,
      "aria-label": pending ? `${label} — adding…` : label,
      onClick: (event) => {
        if (pending) return;
        if (swallowClick.current === id) {
          swallowClick.current = null;
          return;
        }
        if (editing && (selecting || ("shiftKey" in event && event.shiftKey))) {
          toggleSelected(id);
          return;
        }
        setSelectedId(id);
      },
      onFocus: () => preview.set(id),
      onPointerEnter: (event) => {
        if (event.pointerType !== "touch") preview.set(id);
      },
    };
    if (editing && selecting) props["aria-pressed"] = picked.has(id);
    else props["aria-haspopup"] = "dialog";
    if (row.item.saving) props["aria-busy"] = true;
    if (pending) props["aria-disabled"] = true;
    if (!editing) return props;
    return {
      ...props,
      onKeyDown: (event) => onEntryKey(event, row),
      // A long press selects the card on touch (its non-gesture twin: the
      // toolbar's Select, a row's menu, the phone bar's More).
      onPointerDown: (event) => {
        if (event.pointerType !== "touch" || pending) return;
        endPress();
        const timer = window.setTimeout(() => {
          press.current = null;
          swallowClick.current = id;
          toggleSelected(id);
          navigator.vibrate?.(10);
        }, LONG_PRESS_MS);
        press.current = { id, timer, x: event.clientX, y: event.clientY };
      },
      onPointerMove: (event) => {
        const current = press.current;
        if (current && Math.hypot(event.clientX - current.x, event.clientY - current.y) > LONG_PRESS_SLOP_PX) endPress();
      },
      onPointerUp: endPress,
      onPointerCancel: endPress,
      onPointerLeave: endPress,
      onContextMenu: (event) => {
        // A long press's own menu (Android) would cover the selection.
        if (swallowClick.current === id || press.current?.id === id) event.preventDefault();
      },
    };
  };

  const ui: DeckRowUi = {
    editing,
    selecting: editing && selecting,
    isSelected,
    openerProps,
    stepper: (row) => (
      <EntryStepper entryId={row.id} name={row.name} quantity={row.quantity} saving={Boolean(row.item.saving)} />
    ),
    menuButton: (row) => <EntryMenuButton name={row.name} items={rowMenuItems(row)} />,
    isCollapsed: (key) => folded.has(key),
    toggleGroup,
  };

  // ---- back from the creator: the card, or the walk's next (TODO DK5.5) ----
  // The anchor the creator's returnTo named (lib/decks/return-to.ts): the
  // card is scrolled to and marked for a moment (data-flash, app/globals.css)
  // and takes the focus — or, on the walk, "Edit next" does, naming the next.
  const editNextRow = canManage ? nextUnchangedImport(allGroups) : null;
  useEffect(() => {
    const arrive = () => {
      const anchor = parseDeckEntryAnchor(window.location.hash);
      if (!anchor) return;
      const opener = listRef.current?.querySelector<HTMLElement>(`[data-deck-entry="${anchor.entryId}"]`);
      if (opener) {
        opener.scrollIntoView({ block: "center" });
        opener.setAttribute("data-flash", "");
        window.setTimeout(() => opener.removeAttribute("data-flash"), 2400);
      }
      if (anchor.kind === "next") {
        const next = listRef.current?.querySelector<HTMLElement>("[data-edit-next]");
        if (next) {
          next.focus({ preventScroll: true });
          editor?.announce(`Saved. Next to customize: ${next.getAttribute("data-edit-next-name") ?? "the next card"}.`);
          return;
        }
        editor?.announce("Saved. Every imported card is customized.");
      }
      opener?.focus({ preventScroll: true });
    };
    arrive();
    window.addEventListener("hashchange", arrive);
    return () => window.removeEventListener("hashchange", arrive);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on arrival only (and a later hash change)
  }, []);

  const anyLinked = items.some((i) => i.entry.card_id);
  // The modal reads the CURRENT item from the rows by id, so an edit (drawn
  // at once, then the server's answer) re-renders it instead of a stale copy.
  const selected = selectedId ? (shown.find((i) => i.entry.id === selectedId) ?? null) : null;
  // The owner's cover picks, rank 1 first, from the rows the list reads.
  const coverPicks = useMemo(
    () => (canManage && coverOwnerId ? coverPickRowsOf(items, coverOwnerId) : null),
    [items, canManage, coverOwnerId],
  );

  // The bar's numbers: the server's for a visitor; the owner's own rows —
  // edits on their way included — on the owner's page, so the bar moves
  // with every edit.
  const liveAnalytics = useMemo(() => (editor ? computeDeckAnalytics(items) : null), [editor, items]);
  const liveIssues = useMemo(
    () => (editor && summary ? validateDeck(summary.format, items.map((item) => item.entry)).length : null),
    [editor, items, summary],
  );
  const bar = summary
    ? {
        summary: deckSummaryOf(
          summary.format,
          liveAnalytics ?? summary.analytics,
          rows.filter((row) => row.board === "commander").map((row) => row.privateName ?? row.name),
          counts,
        ),
        formatIssues: liveIssues ?? summary.formatIssues,
        editNext: editNextRow
          ? {
              href: editor ? entryEditTarget(editNextRow.item, editor.deck.slug, "next").href : `/create?deckCard=${editNextRow.id}`,
              name: editNextRow.name,
            }
          : null,
      }
    : null;

  // The owner's empty deck shows its doors instead of an empty toolbar.
  const empty = items.length === 0 && Boolean(emptyState);
  const showsCommanderSlot =
    Boolean(commanderSlot) && hasCommander && items.length > 0 && !items.some((item) => item.entry.board === "commander");
  // On a phone the owner's bars sit over the editing bar.
  const overPhoneBar = editing ? "bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-3" : undefined;

  const viewMenu: MenuItem[] = [
    { kind: "heading", label: "View" },
    ...DECK_VIEWS.map((view) => ({
      kind: "radio" as const,
      label: DECK_VIEW_LABELS[view],
      checked: prefs.view === view,
      onSelect: () => changePrefs({ view }),
    })),
    { kind: "separator" },
    folded.size > 0
      ? { kind: "item", label: "Unfold every group", onSelect: () => setFolded(new Set()) }
      : { kind: "item", label: "Fold every group", onSelect: () => setFolded(new Set(groups.map((group) => group.key))) },
  ];
  const moreMenu: MenuItem[] = [
    selecting
      ? { kind: "item", label: "Stop selecting", icon: <CheckSquare className="h-3.5 w-3.5" />, onSelect: stopSelecting }
      : { kind: "item", label: "Select cards", icon: <CheckSquare className="h-3.5 w-3.5" />, onSelect: () => setSelecting(true) },
    { kind: "item", label: "Import a decklist", icon: <ClipboardPaste className="h-3.5 w-3.5" />, onSelect: () => openDeckTool("paste") },
    { kind: "item", label: "Deck details", icon: <FileText className="h-3.5 w-3.5" />, onSelect: () => openDeckTool("details") },
  ];

  return (
    <div
      ref={listRef}
      className={cn("flex flex-col gap-5", editing && "pb-20 md:pb-0")}
      // The focus moved on by itself (Tab, a click on another control): the
      // opener it was handed back to is no longer anyone's concern.
      onBlurCapture={(event) => {
        if (event.relatedTarget) handedBack.current = null;
      }}
      onKeyDown={(event) => {
        // Escape ends a selection — from the cards themselves: a menu or a
        // dialog (portalled, so outside this element) keeps its own Escape.
        if (event.key !== "Escape" || !selecting || event.defaultPrevented) return;
        if (listRef.current?.contains(event.target as Node)) stopSelecting();
      }}
    >
      {editing ? <DeckAddBox /> : null}

      {empty ? (
        emptyState
      ) : (
        <>
          {showsCommanderSlot ? commanderSlot : null}
          <DeckViewToolbar
            prefs={prefs}
            onPrefs={changePrefs}
            filter={filter}
            filterOptions={chips}
            onFilter={setFilter}
            proxyToggle={anyLinked ? { showProxies, onToggle: () => setShowProxies((prev) => !prev) } : null}
            select={
              editing
                ? { selecting, onToggle: () => (selecting ? stopSelecting() : setSelecting(true)) }
                : null
            }
          />

          <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start xl:gap-8 2xl:grid-cols-[minmax(0,1fr)_22rem]">
            {/* The bar sticks within the CARDS only: it never sits over the
                toolbar, and it rests under the last card. */}
            <div className="flex min-w-0 flex-col gap-5">
              {groups.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  {filter === "imported" ? "Every real card here is edited. 🎉" : "No cards match this filter."}
                </p>
              ) : (
                <DeckGroupViews
                  view={prefs.view}
                  groups={groups}
                  sort={prefs.sort}
                  onSort={(sort) => changePrefs({ sort })}
                  showProxies={showProxies}
                  ui={ui}
                />
              )}

              {editing && selecting ? (
                <DeckBulkBar
                  count={selectedIds.length}
                  cards={visibleRows.filter((row) => picked.has(row.id)).reduce((sum, row) => sum + row.quantity, 0)}
                  total={visibleRows.filter((row) => !row.item.pending).length}
                  moveItems={moveItems(selectedIds, null)}
                  onSelectAll={() => setPicked(new Set(visibleRows.filter((row) => !row.item.pending).map((row) => row.id)))}
                  onStep={(by) => editor?.step(selectedIds, by)}
                  onRemove={() => {
                    editor?.remove(selectedIds);
                    stopSelecting();
                  }}
                  onDone={stopSelecting}
                />
              ) : bar ? (
                <DeckSummaryBar
                  summary={bar.summary}
                  formatIssues={bar.formatIssues}
                  editNext={bar.editNext}
                  unchanged={counts.imported}
                  canManage={canManage}
                  className={overPhoneBar}
                />
              ) : null}
            </div>

            {/* The pane's column is the CSS's from 1280 px (so nothing moves
                when it mounts); the pane itself — and its picture — only
                where it shows. */}
            <div className="hidden xl:block xl:self-stretch">
              {wide ? (
                <DeckPreviewPane
                  store={preview}
                  rows={visibleRows}
                  showProxies={showProxies}
                  actions={editor ? (row) => <PaneActions row={row} editor={editor} menuItems={rowMenuItems(row)} /> : null}
                  onDetails={(entryId) => setSelectedId(entryId)}
                />
              ) : null}
            </div>
          </div>
        </>
      )}

      {selected ? (
        <DeckCardModal
          item={selected}
          ownerUsername={ownerUsername}
          canManage={canManage}
          open
          onOpenChange={(open) => {
            if (!open) setSelectedId(null);
          }}
          preferProxy={showProxies}
          cover={
            coverPicks && coverOwnerId
              ? { picks: coverPicks, shown: standsInFan(selected.entry, selected.card, coverOwnerId) }
              : null
          }
        />
      ) : null}

      {editor ? (
        <>
          <EntryMenu
            label={keyMenu?.label ?? "Move"}
            items={keyMenu?.items ?? []}
            open={keyMenu !== null}
            onOpenChange={(open) => {
              if (!open) setKeyMenu(null);
            }}
            anchor={keyMenuAnchor}
            align="start"
          />
          {selecting ? null : (
            <DeckMobileBar
              onAdd={() => openDeckTool("add")}
              viewItems={viewMenu}
              undoLabel={editor.undoLabel}
              onUndo={editor.undo}
              moreItems={moreMenu}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

/** The preview pane's controls for the owner's card: the stepper, the "⋯"
 *  menu (Move to, Edit, Select, Remove) and Edit as its own button. */
function PaneActions({ row, editor, menuItems }: { row: ViewRow; editor: DeckEditor; menuItems: MenuItem[] }) {
  const edit = entryEditTarget(row.item, editor.deck.slug);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-surface/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <EntryStepper entryId={row.id} name={row.name} quantity={row.quantity} saving={Boolean(row.item.saving)} size="md" />
        <EntryMenu
          label={`${row.name}: actions`}
          items={menuItems}
          open={open}
          onOpenChange={setOpen}
          trigger={<MenuTrigger label={`More for ${row.name}`} className="border-border bg-surface" />}
        />
      </div>
      <Link
        href={edit.href}
        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        {edit.label}
        <span className="sr-only">: {row.name}</span>
      </Link>
    </div>
  );
}
