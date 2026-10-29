"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DeckCardModal } from "@/components/decks/deck-card-modal";
import { DeckGroupViews } from "@/components/decks/deck-card-views";
import { DeckSummaryBar } from "@/components/decks/deck-summary-bar";
import { DeckViewToolbar } from "@/components/decks/deck-view-toolbar";
import type { DeckAnalytics } from "@/lib/decks/analytics";
import { deckSummaryOf } from "@/lib/decks/deck-summary";
import {
  deckStatusCountsOf,
  DECK_VIEW_COOKIE,
  DECK_VIEW_COOKIE_MAX_AGE,
  DECK_VIEW_COOKIE_PATH,
  deckRowsOf,
  filterDeckRows,
  groupDeckRows,
  nextUnchangedImport,
  serializeDeckViewPrefs,
  statusFilterOptions,
  type DeckViewPrefs,
  type StatusFilter,
} from "@/lib/decks/deck-view";
import { publicDeckItems } from "@/lib/decks/private-card-name";
import type { DeckItem, DeckPageCard } from "@/lib/decks/queries";
import type { DeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// DeckCardList — the deck page's card area (TODO DK5.1 / DK5.3 / DK5.6 /
// DK5.9): the view toolbar, the cards in the viewer's view — Stacks, Grid,
// List or Table — grouped and sorted their way, the status filter, the
// pop-up a card opens (info for everyone, management for the owner) and the
// sticky summary bar. Every group, sort and filter is
// lib/decks/deck-view.ts's (the entry's EFFECTIVE fields and its ONE
// status); the view, the grouping and the sort are remembered per viewer in
// a cookie (DECK_VIEW_COOKIE), so the server draws the first paint right.
// The status filter and "custom cards ⇄ real cards" are this visit's.
//
// A visitor never reads a private card's title (D11): the items go through
// publicDeckItems here too — the page already did; a list rendered on its
// own is held to the same rule — and the card is a "Private card" tile.
// ---------------------------------------------------------------------------

/** The view a list rendered without the viewer's prefs starts on. */
const LIST_PREFS: DeckViewPrefs = { view: "list", group: "type", sort: "mana" };

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
  /** The viewer's remembered view (the cookie). The List when left out. */
  initialPrefs?: DeckViewPrefs;
  /** The sticky summary bar's numbers; no bar when left out. */
  summary?: DeckCardListSummary;
};

export function DeckCardList({ items, ownerUsername, canManage, initialPrefs, summary }: DeckCardListProps) {
  const [prefs, setPrefs] = useState<DeckViewPrefs>(initialPrefs ?? LIST_PREFS);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [showProxies, setShowProxies] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const changePrefs = (patch: Partial<DeckViewPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    document.cookie = `${DECK_VIEW_COOKIE}=${serializeDeckViewPrefs(next)}; path=${DECK_VIEW_COOKIE_PATH}; max-age=${DECK_VIEW_COOKIE_MAX_AGE}; samesite=lax`;
  };

  // The rows as this viewer may see them (a visitor: no private card's
  // title), each with its status, badge and effective fields — once.
  const shown = useMemo(() => publicDeckItems(items, canManage), [items, canManage]);
  const rows = useMemo(() => deckRowsOf(shown, canManage), [shown, canManage]);
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

  const anyLinked = items.some((i) => i.entry.card_id);
  // The modal reads the CURRENT item from props by id, so a mutation +
  // router.refresh() re-renders it with fresh data instead of a stale copy.
  const selected = selectedId ? (shown.find((i) => i.entry.id === selectedId) ?? null) : null;

  const bar = summary
    ? {
        summary: deckSummaryOf(
          summary.format,
          summary.analytics,
          rows.filter((row) => row.board === "commander").map((row) => row.privateName ?? row.name),
          counts,
        ),
        formatIssues: summary.formatIssues,
        editNext: canManage ? nextUnchangedImport(allGroups) : null,
      }
    : null;

  return (
    <div
      ref={listRef}
      className="flex flex-col gap-5"
      // The focus moved on by itself (Tab, a click on another control): the
      // opener it was handed back to is no longer anyone's concern.
      onBlurCapture={(event) => {
        if (event.relatedTarget) handedBack.current = null;
      }}
    >
      <DeckViewToolbar
        prefs={prefs}
        onPrefs={changePrefs}
        filter={filter}
        filterOptions={chips}
        onFilter={setFilter}
        proxyToggle={anyLinked ? { showProxies, onToggle: () => setShowProxies((prev) => !prev) } : null}
      />

      {/* The bar sticks within the CARDS only: it never sits over the
          toolbar, and it rests under the last card. */}
      <div className="flex flex-col gap-5">
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
            onOpen={(id) => setSelectedId(id)}
          />
        )}

        {bar ? (
          <DeckSummaryBar
            summary={bar.summary}
            formatIssues={bar.formatIssues}
            editNext={bar.editNext ? { href: `/create?deckCard=${bar.editNext.id}`, name: bar.editNext.name } : null}
            unchanged={counts.imported}
            canManage={canManage}
          />
        ) : null}
      </div>

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
        />
      ) : null}
    </div>
  );
}
