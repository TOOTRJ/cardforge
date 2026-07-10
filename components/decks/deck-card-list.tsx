import Link from "next/link";
import { ExternalLink, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { typeBucketFor, TYPE_BUCKETS } from "@/lib/decks/analytics";
import { buildCardPath } from "@/lib/cards/utils";
import { deckEntryState } from "@/types/deck";
import type { DeckItem } from "@/lib/decks/queries";
import type { DeckBoard } from "@/types/deck";
import { DECK_BOARD_LABELS } from "@/types/deck";

// ---------------------------------------------------------------------------
// DeckCardList — read-only deck list grouped by board, then by type bucket
// (deck-site convention). Each row shows quantity, name, mana cost, and the
// entry's remix state:
//   remixed / custom → links to the custom card's page (proxy thumbnail)
//   real             → links to the original on Scryfall (via /go/scryfall)
//   unresolved       → inert placeholder
// Owner management (modals, remix CTAs, qty edits) lands in the next series
// PR; this component stays viewer-safe.
// ---------------------------------------------------------------------------

const BOARD_ORDER: readonly DeckBoard[] = [
  "commander",
  "companion",
  "main",
  "side",
  "maybe",
];

type DeckCardListProps = {
  items: DeckItem[];
  ownerUsername: string | null;
};

export function DeckCardList({ items, ownerUsername }: DeckCardListProps) {
  const byBoard = new Map<DeckBoard, DeckItem[]>();
  for (const item of items) {
    const list = byBoard.get(item.entry.board) ?? [];
    list.push(item);
    byBoard.set(item.entry.board, list);
  }

  return (
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
            <BoardGroups items={boardItems} ownerUsername={ownerUsername} />
          </section>
        );
      })}
    </div>
  );
}

function BoardGroups({
  items,
  ownerUsername,
}: {
  items: DeckItem[];
  ownerUsername: string | null;
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
                  ownerUsername={ownerUsername}
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
  ownerUsername,
}: {
  item: DeckItem;
  ownerUsername: string | null;
}) {
  const { entry, card } = item;
  const state = deckEntryState(entry);

  const inner = (
    <>
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
    </>
  );

  const rowClass =
    "flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50";

  if ((state === "remixed" || state === "custom") && card) {
    return (
      <li>
        <Link
          href={buildCardPath({
            slug: card.slug,
            owner: { username: ownerUsername },
          })}
          className={rowClass}
          aria-label={`Open ${card.title}`}
        >
          {inner}
        </Link>
      </li>
    );
  }

  if (state === "real" && entry.scryfall_id) {
    return (
      <li>
        <a
          href={`/go/scryfall/${entry.scryfall_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className={rowClass}
          aria-label={`View ${entry.name} on Scryfall`}
        >
          {inner}
          <ExternalLink className="h-3 w-3 shrink-0 text-subtle" aria-hidden />
        </a>
      </li>
    );
  }

  return <li className={`${rowClass} hover:bg-transparent`}>{inner}</li>;
}

function StateBadge({
  state,
}: {
  state: ReturnType<typeof deckEntryState>;
}) {
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
    <Badge variant="outline" className="shrink-0 text-[10px] text-subtle">
      Original
    </Badge>
  );
}
