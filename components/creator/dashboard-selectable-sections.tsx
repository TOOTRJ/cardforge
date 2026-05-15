"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { FolderOpen, Globe2, Pencil } from "lucide-react";
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

  const renderTile = (card: DashboardCard) => (
    <DashboardCardTile
      key={card.id}
      card={card}
      isSelected={selection.has(card.id)}
      onToggle={handleToggle}
    />
  );

  const selectedIds = Array.from(selection);

  return (
    <>
      <DashboardSection
        title="Recent cards"
        description="Click any card to open the editor. Cmd/Shift-click or use the corner checkbox to bulk-select."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/gallery">View gallery</Link>
          </Button>
        }
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
            {recentCards.map(renderTile)}
          </div>
        )}
      </DashboardSection>

      <DashboardSection
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
            {drafts.slice(0, 6).map(renderTile)}
          </div>
        )}
      </DashboardSection>

      <DashboardSection
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
            {publicCards.slice(0, 6).map(renderTile)}
          </div>
        )}
      </DashboardSection>

      {selectedIds.length > 0 ? (
        <DashboardBulkBar
          selectedIds={selectedIds}
          onClear={clearSelection}
          userSets={userSets}
          onSuccess={clearSelection}
        />
      ) : null}
    </>
  );
}

function DashboardSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
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
