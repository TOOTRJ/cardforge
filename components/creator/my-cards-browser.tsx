"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CheckSquare,
  FolderOpen,
  Globe2,
  Grid3x3,
  Heart,
  LayoutGrid,
  Link2,
  Pencil,
  Repeat2,
  Rows3,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { EmptyState } from "@/components/ui/empty-state";
import { inputClass } from "@/components/creator/field-group";
import {
  DashboardCardTile,
  type DashboardCard,
} from "@/components/creator/dashboard-card-tile";
import { DashboardBulkBar } from "@/components/creator/dashboard-bulk-bar";
import { LikedCardTile } from "@/components/creator/liked-card-tile";
import {
  LikedCardListRow,
  MyCardListRow,
} from "@/components/creator/my-cards-list-row";
import { buildTypeLine } from "@/lib/cards/card-display";
import {
  DEFAULT_MY_CARDS_FILTER,
  DEFAULT_MY_CARDS_SORT,
  MY_CARDS_SORTS,
  MY_CARDS_SORT_LABELS,
  MY_CARDS_VIEW_COOKIE,
  MY_CARDS_VIEW_COOKIE_MAX_AGE,
  filterMyCards,
  parseMyCardsSort,
  sortMyCards,
  type MyCardsFilter,
  type MyCardsSort,
  type MyCardsView,
} from "@/lib/cards/my-cards-view";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import type { CardWithStats, RemixParentLink } from "@/lib/cards/queries";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// MyCardsBrowser — the whole /dashboard/cards library: filter tabs (All /
// Public / Unlisted / Drafts / Remixes / Liked), search, sort, three views and
// the bulk-selection model the dashboard sections used to own.
//
// Everything is client-side over the already-loaded list (listMyCards caps at
// 1000), so switching tabs / sort / view is instant. Only a page of tiles is
// mounted at a time ("Show more") — drafts have no stored render, so each one
// is a live CardPreview and a few hundred of those would crawl.
//
// Persistence:
//   - view   → cookie, so the server renders the remembered view first paint
//   - filter → ?show=   } history.replaceState, no server round-trip; both
//   - sort   → ?sort=   } survive a refresh and are linkable from Overview
//
// Selection semantics (unchanged from the old dashboard sections):
//   - Cmd/Ctrl-click or the corner checkbox toggles one card
//   - Shift-click range-selects in DISPLAY order from the last-clicked card,
//     extending (not replacing) the selection — the macOS Finder pattern
//   - "Select" flips plain clicks from navigate to toggle
// ---------------------------------------------------------------------------

const PAGE_SIZE: Record<MyCardsView, number> = {
  grid: 24,
  compact: 48,
  list: 50,
};

const GRID_CLASS: Record<Exclude<MyCardsView, "list">, string> = {
  grid: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
  compact: "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5",
};

const VIEW_OPTIONS: Array<{ value: MyCardsView; label: string; icon: LucideIcon }> = [
  { value: "grid", label: "Large grid", icon: LayoutGrid },
  { value: "compact", label: "Compact grid", icon: Grid3x3 },
  { value: "list", label: "List", icon: Rows3 },
];

// Module scope (not inside the component) — it writes a browser global.
function rememberView(view: MyCardsView) {
  document.cookie = `${MY_CARDS_VIEW_COOKIE}=${view}; path=/dashboard/cards; max-age=${MY_CARDS_VIEW_COOKIE_MAX_AGE}; samesite=lax`;
}

function syncUrl(filter: MyCardsFilter, sort: MyCardsSort) {
  const params = new URLSearchParams(window.location.search);
  if (filter === DEFAULT_MY_CARDS_FILTER) params.delete("show");
  else params.set("show", filter);
  if (sort === DEFAULT_MY_CARDS_SORT) params.delete("sort");
  else params.set("sort", sort);
  const { pathname } = window.location;
  window.history.replaceState(null, "", params.size ? `${pathname}?${params}` : pathname);
}

type MyCardsBrowserProps = {
  cards: DashboardCard[];
  likedCards: CardWithStats[];
  /** "Remixed from" links keyed by PARENT card id. */
  remixParents: Record<string, RemixParentLink>;
  profileOverrides?: FrameProfileOverridesMap | null;
  initialView: MyCardsView;
  initialFilter: MyCardsFilter;
  initialSort: MyCardsSort;
};

export function MyCardsBrowser({
  cards,
  likedCards,
  remixParents,
  profileOverrides = null,
  initialView,
  initialFilter,
  initialSort,
}: MyCardsBrowserProps) {
  const [view, setView] = useState(initialView);
  const [filter, setFilter] = useState(initialFilter);
  const [sort, setSort] = useState(initialSort);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE[initialView]);

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);

  const isLiked = filter === "liked";

  const clearSelection = useCallback(() => {
    setSelection(new Set());
    setLastClickedId(null);
  }, []);

  // Leaving select mode also drops any in-progress selection, matching the
  // "Cancel" affordance users expect from photo-grid selection.
  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    clearSelection();
  }, [clearSelection]);

  const changeView = (next: MyCardsView) => {
    setView(next);
    setShown(PAGE_SIZE[next]);
    rememberView(next);
  };

  const changeFilter = (next: MyCardsFilter) => {
    setFilter(next);
    setShown(PAGE_SIZE[view]);
    // A selection must never outlive the cards it was made on — a bulk
    // delete should only ever hit what the user can see.
    exitSelectMode();
    syncUrl(next, sort);
  };

  const changeSort = (next: MyCardsSort) => {
    setSort(next);
    setShown(PAGE_SIZE[view]);
    syncUrl(filter, next);
  };

  const changeQuery = (next: string) => {
    setQuery(next);
    setShown(PAGE_SIZE[view]);
    // Same rule as changeFilter: searching can hide selected cards.
    clearSelection();
  };

  const counts = useMemo(
    () => ({
      all: cards.length,
      public: filterMyCards(cards, "public").length,
      unlisted: filterMyCards(cards, "unlisted").length,
      drafts: filterMyCards(cards, "drafts").length,
      remixes: filterMyCards(cards, "remixes").length,
      liked: likedCards.length,
    }),
    [cards, likedCards],
  );

  const needle = query.trim().toLowerCase();
  const matches = useCallback(
    (card: DashboardCard | CardWithStats) =>
      !needle ||
      card.title.toLowerCase().includes(needle) ||
      buildTypeLine({
        supertype: card.supertype,
        cardType: card.card_type,
        subtypes: card.subtypes,
      })
        .toLowerCase()
        .includes(needle),
    [needle],
  );

  const ownedResults = useMemo(
    () =>
      isLiked ? [] : sortMyCards(filterMyCards(cards, filter).filter(matches), sort),
    [cards, filter, isLiked, matches, sort],
  );
  const likedResults = useMemo(
    // "Recently edited" on the liked tab keeps the query's own order —
    // most-recently-LIKED first — which is what "recent" means there.
    () => {
      if (!isLiked) return [];
      const filtered = likedCards.filter(matches);
      return sort === DEFAULT_MY_CARDS_SORT ? filtered : sortMyCards(filtered, sort);
    },
    [isLiked, likedCards, matches, sort],
  );

  const total = isLiked ? likedResults.length : ownedResults.length;
  const visibleOwned = ownedResults.slice(0, shown);
  const visibleLiked = likedResults.slice(0, shown);
  const visibleIds = useMemo(
    () => ownedResults.slice(0, shown).map((c) => c.id),
    [ownedResults, shown],
  );

  const toggleOne = useCallback((cardId: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
    setLastClickedId(cardId);
  }, []);

  const handleToggle = useCallback(
    (cardId: string, modifiers: { meta: boolean; shift: boolean }) => {
      const from = lastClickedId ? visibleIds.indexOf(lastClickedId) : -1;
      const to = visibleIds.indexOf(cardId);
      if (!modifiers.shift || from < 0 || to < 0) {
        toggleOne(cardId);
        return;
      }
      setSelection((prev) => {
        const next = new Set(prev);
        for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
          next.add(visibleIds[i]);
        }
        return next;
      });
      // Don't advance the anchor on a range pick — a follow-up Shift-click
      // should still range from the original anchor, matching Finder.
    },
    [lastClickedId, visibleIds, toggleOne],
  );

  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selection.has(id));
  const selectAllVisible = () => {
    setSelection(new Set(visibleIds));
    setLastClickedId(visibleIds[visibleIds.length - 1] ?? null);
  };

  const filterOptions: ChipOption<MyCardsFilter>[] = (
    [
      { value: "all", label: "All" },
      { value: "public", label: "Public", icon: Globe2 },
      { value: "unlisted", label: "Unlisted", icon: Link2 },
      { value: "drafts", label: "Drafts", icon: FolderOpen },
      { value: "remixes", label: "Remixes", icon: Repeat2 },
      { value: "liked", label: "Liked", icon: Heart },
    ] satisfies ChipOption<MyCardsFilter>[]
  )
    // Unlisted is rare — only offer the tab when it has something in it.
    .filter((o) => o.value !== "unlisted" || counts.unlisted > 0 || filter === "unlisted")
    .map((o) => ({
      ...o,
      badge: <span className="tabular-nums opacity-70">{counts[o.value]}</span>,
    }));

  const remixCaption = (card: DashboardCard) => {
    if (filter !== "remixes" || !card.parent_card_id) return undefined;
    const parent = remixParents[card.parent_card_id];
    return parent ? (
      <Link
        href={parent.path}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-w-0 items-center gap-1 text-[11px] text-subtle transition-colors hover:text-foreground"
      >
        <Repeat2 className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">Remixed from {parent.title}</span>
        <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden />
      </Link>
    ) : (
      <span className="inline-flex items-center gap-1 text-[11px] text-subtle">
        <Repeat2 className="h-3 w-3 shrink-0" aria-hidden />
        Original no longer available
      </span>
    );
  };

  const selectedIds = Array.from(selection);

  return (
    <div className="mt-8 flex flex-col gap-4">
      <ChipGroup
        ariaLabel="Show"
        options={filterOptions}
        value={filter}
        onChange={changeFilter}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Search by name or type"
            aria-label="Search your cards"
            className={cn(inputClass(false), "pl-9")}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sort}
            onChange={(event) => changeSort(parseMyCardsSort(event.target.value))}
            aria-label="Sort cards"
            className={cn(inputClass(false), "w-auto")}
          >
            {MY_CARDS_SORTS.map((value) => (
              <option key={value} value={value}>
                {isLiked && value === DEFAULT_MY_CARDS_SORT
                  ? "Recently liked"
                  : MY_CARDS_SORT_LABELS[value]}
              </option>
            ))}
          </select>

          <div
            role="radiogroup"
            aria-label="Card view"
            className="flex h-10 items-center gap-0.5 rounded-md border border-border bg-background/60 p-1"
          >
            {VIEW_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={view === value}
                aria-label={label}
                title={label}
                onClick={() => changeView(value)}
                className={cn(
                  "flex h-full w-9 items-center justify-center rounded transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
                  view === value
                    ? "bg-elevated text-accent"
                    : "text-subtle hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </button>
            ))}
          </div>

          {isLiked || ownedResults.length === 0 ? null : selectMode ? (
            <>
              <span className="text-sm text-muted">
                <span className="font-semibold text-foreground">
                  {selection.size}
                </span>{" "}
                selected
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={allVisibleSelected ? clearSelection : selectAllVisible}
              >
                {allVisibleSelected ? "Clear all" : "Select all"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={exitSelectMode}>
                <X className="h-3.5 w-3.5" aria-hidden />
                Cancel
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10"
              onClick={() => setSelectMode(true)}
            >
              <CheckSquare className="h-4 w-4" aria-hidden />
              Select
            </Button>
          )}
        </div>
      </div>

      {total === 0 ? (
        <MyCardsEmptyState
          filter={filter}
          searching={needle.length > 0}
          hasAnyCards={cards.length > 0}
        />
      ) : view === "list" ? (
        <ul className="flex flex-col gap-2">
          {isLiked
            ? visibleLiked.map((card) => (
                <LikedCardListRow
                  key={card.id}
                  card={card}
                  profileOverrides={profileOverrides}
                />
              ))
            : visibleOwned.map((card) => (
                <MyCardListRow
                  key={card.id}
                  card={card}
                  profileOverrides={profileOverrides}
                  isSelected={selection.has(card.id)}
                  selectMode={selectMode}
                  caption={remixCaption(card)}
                  onToggle={handleToggle}
                />
              ))}
        </ul>
      ) : (
        <div className={GRID_CLASS[view]}>
          {isLiked
            ? visibleLiked.map((card) => (
                <LikedCardTile
                  key={card.id}
                  card={card}
                  profileOverrides={profileOverrides}
                />
              ))
            : visibleOwned.map((card) => (
                <DashboardCardTile
                  key={card.id}
                  card={card}
                  profileOverrides={profileOverrides}
                  isSelected={selection.has(card.id)}
                  selectMode={selectMode}
                  density={view === "compact" ? "compact" : "regular"}
                  caption={remixCaption(card)}
                  onToggle={handleToggle}
                />
              ))}
        </div>
      )}

      {total > 0 ? (
        <div className="flex flex-col items-center gap-3 pt-2">
          <p className="text-xs text-subtle" aria-live="polite">
            Showing {Math.min(shown, total)} of {total}
          </p>
          {shown < total ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setShown((n) => n + PAGE_SIZE[view])}
            >
              Show more
            </Button>
          ) : null}
        </div>
      ) : null}

      {selectedIds.length > 0 ? (
        <DashboardBulkBar
          selectedIds={selectedIds}
          onClear={clearSelection}
          onSuccess={exitSelectMode}
        />
      ) : null}
    </div>
  );
}

function MyCardsEmptyState({
  filter,
  searching,
  hasAnyCards,
}: {
  filter: MyCardsFilter;
  searching: boolean;
  hasAnyCards: boolean;
}) {
  if (searching) {
    return (
      <EmptyState
        icon={Search}
        title="No matches"
        description="No cards here match that search. Try a different name or type."
      />
    );
  }
  if (filter === "liked") {
    return (
      <EmptyState
        icon={Heart}
        title="No liked cards yet"
        description="Tap the heart on any card in the gallery or trending section to save it here."
        action={
          <Button asChild>
            <Link href="/gallery">Browse the gallery</Link>
          </Button>
        }
      />
    );
  }
  if (!hasAnyCards) {
    return (
      <EmptyState
        icon={Pencil}
        title="No cards yet"
        description="Open the creator and forge your very first card. Everything you save lands here."
        action={
          <Button asChild>
            <Link href="/create">Open creator</Link>
          </Button>
        }
      />
    );
  }
  switch (filter) {
    case "drafts":
      return (
        <EmptyState
          icon={FolderOpen}
          title="No drafts"
          description="Drafts you save while creating will live here until you publish."
        />
      );
    case "remixes":
      return (
        <EmptyState
          icon={Repeat2}
          title="No remixes yet"
          description="Open any card in the gallery and hit Remix to spin up your own take — it'll show up here."
          action={
            <Button asChild>
              <Link href="/gallery">Browse the gallery</Link>
            </Button>
          }
        />
      );
    case "unlisted":
      return (
        <EmptyState
          icon={Link2}
          title="Nothing unlisted"
          description="Unlisted cards are viewable by link only — set a card's visibility to Unlisted from the editor."
        />
      );
    default:
      return (
        <EmptyState
          icon={Globe2}
          title="Nothing public yet"
          description="Toggle a card's visibility to Public from the editor and it will appear here."
        />
      );
  }
}
