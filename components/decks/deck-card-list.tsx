"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HelpCircle, Sparkles } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { DeckCardModal } from "@/components/decks/deck-card-modal";
import { DeckEntryStatusBadge, NO_LONGER_AVAILABLE } from "@/components/decks/deck-entry-status-badge";
import {
  typeBucketFor,
  TYPE_BUCKET_PLURALS,
  TYPE_BUCKETS,
} from "@/lib/decks/analytics";
import { effectiveEntryFields } from "@/lib/decks/effective-entry";
import { deckEntryStatus, deckEntryUnavailable } from "@/lib/decks/entry-status";
import type { DeckItem } from "@/lib/decks/queries";
import type { DeckBoard, DeckEntryStatus } from "@/types/deck";
import { DECK_BOARD_LABELS, DECK_ENTRY_STATUS_LABELS } from "@/types/deck";
import { cn } from "@/lib/utils";
import { isStoredRenderUrl, toRenderCdnUrl } from "@/lib/cards/render-cdn";
import { hasBackPicture } from "@/lib/cards/tile-faces";
import { TwoFacesMark } from "@/components/cards/two-faces-mark";
import { drawableMediaUrl } from "@/lib/media/media-urls";

// ---------------------------------------------------------------------------
// DeckCardList — the deck's card list grouped by board, then by type bucket.
// Client component: rows open the deck-card modal (info for everyone,
// management for the owner), the status filter narrows the list, and the
// real cards ⇄ custom cards toggle flips which image an entry with both
// shows. The words are the deck vocabulary (TODO DK2.2,
// components/creator/card-glossary.tsx). Each row's badge is its status —
// Imported / Edited / Remix / Original / Not found, ONE deckEntryStatus
// (lib/decks/entry-status.ts), or "No longer available" — and the filter
// chips say the same words as the badges, each showing exactly the rows
// that wear its badge (TODO DK5.6's status chips). A row's group and cost
// are its EFFECTIVE fields (lib/decks/effective-entry.ts: an edited card
// counts as what it now is).
// ---------------------------------------------------------------------------

const BOARD_ORDER: readonly DeckBoard[] = [
  "commander",
  "companion",
  "main",
  "side",
  "maybe",
];

/** What a row's badge says: its status, or "No longer available". */
type EntryBadge = DeckEntryStatus | "unavailable";
/** The filter: every row, or the rows wearing one badge. */
type StatusFilter = "all" | EntryBadge;

/** The chips after Imported and Edited (always shown, #654), each only
 *  where the deck has a row wearing it. */
const OTHER_BADGES: readonly EntryBadge[] = ["remix", "original", "not_found", "unavailable"];

const BADGE_LABELS: Record<EntryBadge, string> = {
  ...DECK_ENTRY_STATUS_LABELS,
  unavailable: NO_LONGER_AVAILABLE,
};

function entryBadge(item: DeckItem, viewerIsOwner: boolean): EntryBadge {
  return deckEntryUnavailable(item.entry, item.card, viewerIsOwner) ? "unavailable" : deckEntryStatus(item.entry, item.card);
}

const countOf = (counts: ReadonlyMap<EntryBadge, number>, badge: EntryBadge) => {
  const n = counts.get(badge) ?? 0;
  return n > 0 ? ` (${n})` : "";
};

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
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [showProxies, setShowProxies] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Closing the pop-up hands the focus back to the ROW that opened it (TODO
  // 5.17). The dialog has no Dialog.Trigger — a row opens it through state —
  // so Radix has nowhere to return the focus and it fell to <body>: a
  // keyboard user started again from the top of the page. The row is found
  // by its entry id once the dialog has unmounted (its focus trap would pull
  // the focus back before that).
  //
  // Three things the first cut missed (the independent check of #536):
  //  - a click on the BACKDROP closes the dialog on pointerdown, and the
  //    same click's mousedown then takes the focus off the row again (it
  //    lands on <body>): the hand-back is repeated once the click is over;
  //  - the row may be GONE — "Remove from deck" in the pop-up, or a card
  //    linked under the "Imported" filter — before or just after the
  //    close: the focus then goes to the row that took its place (the last
  //    one, past the end; the list's first control when no row is left),
  //    never to <body>;
  //  - an entry removed while its pop-up is open unmounts the dialog without
  //    `selectedId` changing: the pop-up counts as open only while its entry
  //    is still in `items` (`openId`).
  const listRef = useRef<HTMLDivElement | null>(null);
  const openId = selectedId !== null && items.some((i) => i.entry.id === selectedId) ? selectedId : null;
  const returnFocusTo = useRef<{ id: string; index: number } | null>(null);
  // The row the focus was handed back to, for as long as the focus is on it.
  const handedBack = useRef<{ id: string; index: number } | null>(null);
  const rowsOf = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-deck-entry]") ?? []);
  const focusNear = (index: number) => {
    const rows = rowsOf();
    const target =
      rows[Math.max(0, Math.min(index, rows.length - 1))] ??
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
    // A backdrop click: its mousedown comes after the close and blurs the row.
    const again = setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) handBack();
    }, 0);
    return () => clearTimeout(again);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the helpers read refs and the live DOM
  }, [openId]);
  // The row the focus was handed back to is taken away by the refresh that
  // follows the close (a removal answers after the pop-up has shut).
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
  // Each row's badge, once: the status filter and the chips' counts read it.
  const badgeOf = useMemo(() => {
    const out = new Map<string, EntryBadge>();
    for (const item of items) out.set(item.entry.id, entryBadge(item, canManage));
    return out;
  }, [items, canManage]);
  const badgeCounts = useMemo(() => {
    const counts = new Map<EntryBadge, number>();
    for (const badge of badgeOf.values()) counts.set(badge, (counts.get(badge) ?? 0) + 1);
    return counts;
  }, [badgeOf]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item) => badgeOf.get(item.entry.id) === filter);
  }, [items, filter, badgeOf]);

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
    <div
      ref={listRef}
      className="flex flex-col gap-6"
      // The focus moved on by itself (Tab, a click on another control): the
      // row it was handed back to is no longer anyone's concern.
      onBlurCapture={(event) => {
        if (event.relatedTarget) handedBack.current = null;
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by card status"
        >
          <FilterChip
            label="All"
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterChip
            label={`Imported${countOf(badgeCounts, "imported")}`}
            active={filter === "imported"}
            onClick={() => setFilter("imported")}
          />
          <FilterChip
            label={`Edited${countOf(badgeCounts, "edited")}`}
            active={filter === "edited"}
            onClick={() => setFilter("edited")}
          />
          {/* The rest of the statuses, where the deck has them. */}
          {OTHER_BADGES.filter((badge) => (badgeCounts.get(badge) ?? 0) > 0).map((badge) => (
            <FilterChip
              key={badge}
              label={`${BADGE_LABELS[badge]}${countOf(badgeCounts, badge)}`}
              active={filter === badge}
              onClick={() => setFilter(badge)}
            />
          ))}
        </div>
        {anyLinked ? (
          <button
            type="button"
            onClick={() => setShowProxies((prev) => !prev)}
            aria-pressed={showProxies}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
          >
            <Sparkles className="h-3 w-3" aria-hidden />
            {showProxies ? "Showing custom cards" : "Showing real cards"}
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          {filter === "imported"
            ? "Every real card here is edited. 🎉"
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
                  viewerIsOwner={canManage}
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
  viewerIsOwner,
  onOpen,
}: {
  items: DeckItem[];
  showProxies: boolean;
  viewerIsOwner: boolean;
  onOpen: (deckCardId: string) => void;
}) {
  const byBucket = new Map<string, DeckItem[]>();
  for (const item of items) {
    // The analytics' bucket (effectiveEntryFields): an edited card groups
    // as what it now is, a card with no printing by its own type line.
    const bucket = typeBucketFor(effectiveEntryFields(item.entry, item.card).typeLine);
    const list = byBucket.get(bucket) ?? [];
    list.push(item);
    byBucket.set(bucket, list);
  }

  return (
    // minmax(0, 1fr) columns and min-w-0 groups: a row's badges and pips
    // never widen the column past a 390 px screen (the title truncates).
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {TYPE_BUCKETS.map((bucket) => {
        const bucketItems = byBucket.get(bucket);
        if (!bucketItems || bucketItems.length === 0) return null;
        const bucketCount = bucketItems.reduce(
          (sum, i) => sum + i.entry.quantity,
          0,
        );
        return (
          <SurfaceCard key={bucket} className="flex min-w-0 flex-col gap-1 p-4">
            <span className="mb-1 text-xs font-semibold uppercase tracking-wider text-subtle">
              {TYPE_BUCKET_PLURALS[bucket]} · {bucketCount}
            </span>
            <ul className="flex flex-col">
              {bucketItems.map((item) => (
                <EntryRow
                  key={item.entry.id}
                  item={item}
                  showProxies={showProxies}
                  viewerIsOwner={viewerIsOwner}
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
  viewerIsOwner,
  onOpen,
}: {
  item: DeckItem;
  showProxies: boolean;
  viewerIsOwner: boolean;
  onOpen: (deckCardId: string) => void;
}) {
  const { entry, card } = item;
  const status = deckEntryStatus(entry, card);
  const unavailable = deckEntryUnavailable(entry, card, viewerIsOwner);
  const fields = effectiveEntryFields(entry, card, status);
  // Only a bake in our card-renders bucket (lib/cards/render-cdn.ts): a row
  // written before migration 0126 could point the card anywhere.
  // The 32 px row draws the 600 px WebP thumb where the bake wrote one —
  // never the HD PNG when there is a thumb (TODO 5.15).
  const proxyPng = card && isStoredRenderUrl(card.rendered_image_url) ? card.rendered_image_url : null;
  const proxyThumb = proxyPng && card && isStoredRenderUrl(card.rendered_thumb_url) ? card.rendered_thumb_url : null;
  const proxyImage = proxyThumb ? (toRenderCdnUrl(proxyThumb) ?? proxyThumb) : proxyPng;
  // A proxy with a back picture: the row says so (the picture is too small
  // to turn; the pop-up has the Front / Back switch).
  const twoFaces = Boolean(card && hasBackPicture(card));
  // …and a printing image only from Scryfall (migration 0127,
  // lib/media/media-urls.ts), the one outside host a deck entry stores.
  const printImage = drawableMediaUrl("deck-card-image", entry.image_url);
  const thumb =
    (showProxies ? proxyImage : printImage) ??
    proxyImage ??
    printImage;

  return (
    <li>
      <button
        type="button"
        data-deck-entry={entry.id}
        onClick={() => onOpen(entry.id)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
        aria-label={`Open ${card?.title ?? entry.name}${item.cardOwner?.username ? ` by @${item.cardOwner.username}` : ""}`}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className={cn(
              "h-11 w-8 shrink-0 rounded-sm object-cover",
              // A printing with no PipGlyph card yet.
              !entry.card_id && "opacity-70 saturate-50",
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
          {/* Another creator's card (D3): their credit. */}
          {item.cardOwner?.username ? (
            <span className="ml-1.5 font-mono text-[11px] text-subtle">by @{item.cardOwner.username}</span>
          ) : null}
        </span>
        {fields.cost ? <ManaCostGlyphs cost={fields.cost} size="sm" /> : null}
        {twoFaces && thumb === proxyImage ? <TwoFacesMark /> : null}
        <DeckEntryStatusBadge status={status} unavailable={unavailable} small />
      </button>
    </li>
  );
}
