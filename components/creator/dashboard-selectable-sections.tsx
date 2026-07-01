"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { CheckSquare, FolderOpen, Globe2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DashboardCardTile,
  type DashboardCard,
} from "@/components/creator/dashboard-card-tile";
import { DashboardBulkBar } from "@/components/creator/dashboard-bulk-bar";

// ---------------------------------------------------------------------------
// DashboardSelectableSections — wraps the three card sections (Recent /
// Drafts / Public) with shared bulk-selection state.
//
// Selection semantics:
//   - `selection`         — Set<string> of card ids
//   - `lastClickedId`     — anchor for Shift-click range selection
//   - `flatVisibleIds`    — ordered union of the three visible sections,
//                            used to compute Shift ranges in display order
//
// Range selection extends the existing selection (it does not clear),
// matching the macOS Finder pattern.
// ---------------------------------------------------------------------------

type DashboardSelectableSectionsProps = {
  recentCards: DashboardCard[];
  drafts: DashboardCard[];
  publicCards: DashboardCard[];
  userSets: Array<{ id: string; title: string; slug: string }>;
};

export function DashboardSelectableSections({
  recentCards,
  drafts,
  publicCards,
  userSets,
}: DashboardSelectableSectionsProps) {
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  // Select mode flips plain card clicks from "navigate to editor" to "toggle
  // checkmark" — the standard photo-grid multi-select pattern.
  const [selectMode, setSelectMode] = useState(false);

  const hasAnyCards =
    recentCards.length > 0 || drafts.length > 0 || publicCards.length > 0;

  // Stable display-order list across all three sections — needed so a
  // Shift-click that spans sections selects the right intermediate cards.
  // Drafts and public slices match what the rendered sections show.
  const flatVisibleIds = useMemo(() => {
    const ids: string[] = [];
    for (const c of recentCards) ids.push(c.id);
    for (const c of drafts.slice(0, 6)) ids.push(c.id);
    for (const c of publicCards.slice(0, 6)) ids.push(c.id);
    // Deduplicate — a card may appear in Recent AND Drafts/Public.
    return Array.from(new Set(ids));
  }, [recentCards, drafts, publicCards]);

  const toggleOne = useCallback(
    (cardId: string) => {
      setSelection((prev) => {
        const next = new Set(prev);
        if (next.has(cardId)) next.delete(cardId);
        else next.add(cardId);
        return next;
      });
      setLastClickedId(cardId);
    },
    [],
  );

  const selectRange = useCallback(
    (cardId: string) => {
      if (!lastClickedId) {
        toggleOne(cardId);
        return;
      }
      const fromIndex = flatVisibleIds.indexOf(lastClickedId);
      const toIndex = flatVisibleIds.indexOf(cardId);
      if (fromIndex < 0 || toIndex < 0) {
        toggleOne(cardId);
        return;
      }
      const [start, end] = [
        Math.min(fromIndex, toIndex),
        Math.max(fromIndex, toIndex),
      ];
      setSelection((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) next.add(flatVisibleIds[i]);
        return next;
      });
      // Don't advance the anchor on a range pick — a follow-up Shift-click
      // should still range from the original anchor, matching Finder.
    },
    [lastClickedId, flatVisibleIds, toggleOne],
  );

  const handleToggle = useCallback(
    (cardId: string, modifiers: { meta: boolean; shift: boolean }) => {
      if (modifiers.shift) {
        selectRange(cardId);
      } else {
        // Meta + plain checkbox clicks both route here. Either way: toggle
        // this one and set it as the new anchor.
        toggleOne(cardId);
      }
    },
    [selectRange, toggleOne],
  );

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

  const selectAllVisible = useCallback(() => {
    setSelection(new Set(flatVisibleIds));
    setLastClickedId(flatVisibleIds[flatVisibleIds.length - 1] ?? null);
  }, [flatVisibleIds]);

  // A card can appear in several sections; `viewTransitionName` must be unique
  // per document, so only the first-rendered instance (Recent → Drafts →
  // Public order) carries it. These sets identify the earlier occurrences so
  // later sections opt out.
  const recentIds = useMemo(
    () => new Set(recentCards.map((c) => c.id)),
    [recentCards],
  );
  const draftShownIds = useMemo(
    () => new Set(drafts.slice(0, 6).map((c) => c.id)),
    [drafts],
  );

  const renderTile = (card: DashboardCard, enableViewTransition = true) => (
    <DashboardCardTile
      key={card.id}
      card={card}
      isSelected={selection.has(card.id)}
      selectMode={selectMode}
      enableViewTransition={enableViewTransition}
      onToggle={handleToggle}
    />
  );

  const allVisibleSelected =
    flatVisibleIds.length > 0 &&
    flatVisibleIds.every((id) => selection.has(id));

  // Toolbar shown in the "Recent cards" header: a Select toggle at rest, or
  // the count + Select all / Cancel controls once select mode is active.
  const selectionToolbar = selectMode ? (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted">
        <span className="font-semibold text-foreground">{selection.size}</span>{" "}
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
    </div>
  ) : (
    <div className="flex items-center gap-2">
      {hasAnyCards ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSelectMode(true)}
        >
          <CheckSquare className="h-4 w-4" aria-hidden />
          Select
        </Button>
      ) : null}
      <Button asChild variant="ghost" size="sm">
        <Link href="/gallery">View gallery</Link>
      </Button>
    </div>
  );

  const selectedIds = Array.from(selection);

  return (
    <>
      <DashboardSection
        title="Recent cards"
        description={
          selectMode
            ? "Click cards to select them, then choose a bulk action below."
            : "Click any card to open the editor, or hit Select to choose several at once."
        }
        action={selectionToolbar}
      >
        {recentCards.length === 0 ? (
          <EmptyState
            icon={Pencil}
            title="No cards yet"
            description="Open the creator and forge your very first card. Saved drafts will surface here automatically."
            action={
              <Button asChild>
                <Link href="/create">Open creator</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentCards.map((card) => renderTile(card, true))}
          </div>
        )}
      </DashboardSection>

      <DashboardSection
        id="drafts"
        title="Drafts"
        description="Private, in-progress cards you haven't published."
      >
        {drafts.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No drafts"
            description="Drafts you save while creating will live here until you publish."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {drafts
              .slice(0, 6)
              .map((card) => renderTile(card, !recentIds.has(card.id)))}
          </div>
        )}
      </DashboardSection>

      <DashboardSection
        id="public-cards"
        title="Public cards"
        description="Cards visible on your public profile and the gallery."
      >
        {publicCards.length === 0 ? (
          <EmptyState
            icon={Globe2}
            title="Nothing public yet"
            description="Toggle a card's visibility to Public from the editor and it will appear here."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {publicCards
              .slice(0, 6)
              .map((card) =>
                renderTile(
                  card,
                  !recentIds.has(card.id) && !draftShownIds.has(card.id),
                ),
              )}
          </div>
        )}
      </DashboardSection>

      {selectedIds.length > 0 ? (
        <DashboardBulkBar
          selectedIds={selectedIds}
          onClear={clearSelection}
          userSets={userSets}
          onSuccess={exitSelectMode}
        />
      ) : null}
    </>
  );
}

function DashboardSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-12 scroll-mt-24">
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="max-w-2xl text-sm text-muted">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
