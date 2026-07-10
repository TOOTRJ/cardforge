"use client";

import { useMemo, useState } from "react";
import { HelpCircle, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { DeckCardModal } from "@/components/decks/deck-card-modal";
import { typeBucketFor, TYPE_BUCKETS } from "@/lib/decks/analytics";
import { deckEntryState } from "@/types/deck";
import type { DeckItem } from "@/lib/decks/queries";
import type { DeckBoard } from "@/types/deck";
import { DECK_BOARD_LABELS } from "@/types/deck";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// DeckCardList — the deck's card list grouped by board, then by type bucket.
// Client component: rows open the deck-card modal (info for everyone,
// management for the owner), a remix-state filter narrows the list, and the
// Originals ⇄ Proxies toggle flips which image remixed entries show.
// ---------------------------------------------------------------------------

const BOARD_ORDER: readonly DeckBoard[] = [
  "commander",
  "companion",
  "main",
  "side",
  "maybe",
];

type RemixFilter = "all" | "needs" | "remixed";

type DeckCardListProps = {
  items: DeckItem[];
  ownerUsername: string | null;
  canManage: boolean;
};

export function DeckCardList({
  items,
  ownerUsername,
  canManage,
}: DeckCardListProps) {
  const [filter, setFilter] = useState<RemixFilter>("all");
  const [showProxies, setShowProxies] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const anyRemixed = items.some((i) => i.entry.card_id);
  const needsCount = items.filter(
    (i) => deckEntryState(i.entry) === "real",
  ).length;

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item) => {
      const state = deckEntryState(item.entry);
      return filter === "remixed"
        ? state === "remixed" || state === "custom"
        : state === "real" || state === "unresolved";
    });
  }, [items, filter]);

  // The modal reads the CURRENT item from props by id, so a mutation +
  // router.refresh() re-renders it with fresh data instead of a stale copy.
  const selected = selectedId
    ? (items.find((i) => i.entry.id === selectedId) ?? null)
    : null;

  const byBoard = new Map<DeckBoard, DeckItem[]>();
  for (const item of filtered) {
    const list = byBoard.get(item.entry.board) ?? [];
    list.push(item);
    byBoard.set(item.entry.board, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by remix state"
        >
          <FilterChip
            label="All"
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterChip
            label={`Needs remix${needsCount > 0 ? ` (${needsCount})` : ""}`}
            active={filter === "needs"}
            onClick={() => setFilter("needs")}
          />
          <FilterChip
            label="Remixed"
            active={filter === "remixed"}
            onClick={() => setFilter("remixed")}
          />
        </div>
        {anyRemixed ? (
          <button
            type="button"
            onClick={() => setShowProxies((prev) => !prev)}
            aria-pressed={showProxies}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
          >
            <Sparkles className="h-3 w-3" aria-hidden />
            {showProxies ? "Showing my proxies" : "Showing originals"}
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          {filter === "needs"
            ? "Every card here has been remixed. 🎉"
            : "No cards match this filter."}
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {BOARD_ORDER.map((board) => {
            const boardItems = byBoard.get(board);
            if (!boardItems || boardItems.length === 0) return null;
            const boardCount = boardItems.reduce(
              (sum, i) => sum + i.entry.quantity,
              0,
            );
            return (
              <section key={board} aria-label={DECK_BOARD_LABELS[board]}>
                <h3 className="mb-3 flex items-baseline gap-2 font-display text-lg font-semibold text-foreground">
                  {DECK_BOARD_LABELS[board]}
                  <span className="text-xs font-normal text-subtle">
                    {boardCount} card{boardCount === 1 ? "" : "s"}
                  </span>
                </h3>
                <BoardGroups
                  items={boardItems}
                  showProxies={showProxies}
                  onOpen={(id) => setSelectedId(id)}
                />
              </section>
            );
          })}
        </div>
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
        />
      ) : null}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
        active
          ? "border-primary bg-primary/15 text-primary-bright"
          : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function BoardGroups({
  items,
  showProxies,
  onOpen,
}: {
  items: DeckItem[];
  showProxies: boolean;
  onOpen: (deckCardId: string) => void;
}) {
  const byBucket = new Map<string, DeckItem[]>();
  for (const item of items) {
    const bucket = typeBucketFor(item.entry.type_line);
    const list = byBucket.get(bucket) ?? [];
    list.push(item);
    byBucket.set(bucket, list);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {TYPE_BUCKETS.map((bucket) => {
        const bucketItems = byBucket.get(bucket);
        if (!bucketItems || bucketItems.length === 0) return null;
        const bucketCount = bucketItems.reduce(
          (sum, i) => sum + i.entry.quantity,
          0,
        );
        return (
          <SurfaceCard key={bucket} className="flex flex-col gap-1 p-4">
            <span className="mb-1 text-xs font-semibold uppercase tracking-wider text-subtle">
              {bucket === "Other" ? "Other" : `${bucket}s`} · {bucketCount}
            </span>
            <ul className="flex flex-col">
              {bucketItems.map((item) => (
                <EntryRow
                  key={item.entry.id}
                  item={item}
                  showProxies={showProxies}
                  onOpen={onOpen}
                />
              ))}
            </ul>
          </SurfaceCard>
        );
      })}
    </div>
  );
}

function EntryRow({
  item,
  showProxies,
  onOpen,
}: {
  item: DeckItem;
  showProxies: boolean;
  onOpen: (deckCardId: string) => void;
}) {
  const { entry, card } = item;
  const state = deckEntryState(entry);
  const proxyImage = card?.rendered_image_url ?? null;
  const thumb =
    (showProxies ? proxyImage : entry.image_url) ??
    proxyImage ??
    entry.image_url;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(entry.id)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
        aria-label={`Open ${card?.title ?? entry.name}`}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className={cn(
              "h-11 w-8 shrink-0 rounded-sm object-cover",
              state === "real" && "opacity-70 saturate-50",
            )}
          />
        ) : (
          <span className="flex h-11 w-8 shrink-0 items-center justify-center rounded-sm bg-elevated">
            <HelpCircle className="h-3.5 w-3.5 text-subtle" aria-hidden />
          </span>
        )}
        <span className="w-7 shrink-0 text-right font-mono text-xs text-subtle">
          {entry.quantity}×
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {card?.title ?? entry.name}
        </span>
        {entry.mana_cost || card?.cost ? (
          <ManaCostGlyphs cost={entry.mana_cost ?? card?.cost} size="sm" />
        ) : null}
        <StateBadge state={state} />
      </button>
    </li>
  );
}

function StateBadge({ state }: { state: ReturnType<typeof deckEntryState> }) {
  if (state === "remixed") {
    return (
      <Badge variant="primary" className="shrink-0 gap-1 text-[10px]">
        <Sparkles className="h-2.5 w-2.5" aria-hidden /> Remixed
      </Badge>
    );
  }
  if (state === "custom") {
    return (
      <Badge variant="accent" className="shrink-0 text-[10px]">
        Custom
      </Badge>
    );
  }
  if (state === "unresolved") {
    return (
      <Badge variant="outline" className="shrink-0 text-[10px]">
        Placeholder
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 text-[10px]">
      Remix
    </Badge>
  );
}
