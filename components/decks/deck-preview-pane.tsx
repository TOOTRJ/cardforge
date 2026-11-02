"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { Ban, HelpCircle, Lock, Maximize2 } from "lucide-react";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { TwoFacesMark } from "@/components/cards/two-faces-mark";
import { HOVER_REST_MS } from "@/components/cards/baked-card-flip";
import { DeckEntryStatusBadge } from "@/components/decks/deck-entry-status-badge";
import type { ViewRow } from "@/components/decks/deck-row-ui";
import { cardCornersClass } from "@/lib/cards/card-orientation";
import { isStoredRenderUrl, toRenderCdnUrl } from "@/lib/cards/render-cdn";
import { hasBackPicture } from "@/lib/cards/tile-faces";
import { entryPrintingImage } from "@/lib/decks/entry-image";
import { GONE_CARD_NAME, PRIVATE_CARD_NAME } from "@/lib/decks/private-card-name";
import { cn } from "@/lib/utils";
import { DECK_BOARD_LABELS } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck page's large preview (TODO DK5.7) — a sticky pane beside the
// cards on a wide screen that shows the card the pointer rests on or the
// keyboard's focus is on, and (the owner's) its actions: the stepper, Move
// to, Edit and Remove — so nothing on the cards themselves waits for a
// hover. The pop-up ("Details") stays the card's full view.
//
// Which card it shows is a tiny store of its own (`createPreviewStore`),
// set by the openers' pointer and focus events: a hover re-renders the pane,
// never the deck's hundred cards. The focus shows its card at once; a
// pointer only once it has RESTED on a card (HOVER_REST_MS, the two-faced
// tiles' rest), so one crossing other cards on its way to the pane's
// buttons never changes the card they act on — and while the pane's menu
// is open nothing does. It shows the deck's first card until one is
// pointed at, and moves to the first again when its card leaves.
//
// Pictures: a PipGlyph card's 600 px thumb (never the HD PNG — a pane that
// follows the pointer over a hundred cards would pull 3 MB a card) and a
// printing's Scryfall "normal" picture, the tiles' own; a visitor's private
// card is never drawn (D11).
// ---------------------------------------------------------------------------

export type PreviewStore = {
  get: () => string | null;
  /** Shows a card at once (the keyboard's focus, a click). */
  set: (entryId: string | null) => void;
  /** A pointer on a card: shown once it has rested there HOVER_REST_MS. */
  rest: (entryId: string) => void;
  /** The pointer left the card: a rest it hadn't finished is dropped. */
  leave: (entryId: string) => void;
  /** While held (the pane's own menu open), no pointer changes the card. */
  hold: (held: boolean) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createPreviewStore(restMs: number = HOVER_REST_MS): PreviewStore {
  let current: string | null = null;
  let held = false;
  let resting: { id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  const listeners = new Set<() => void>();
  const show = (entryId: string | null) => {
    if (entryId === current) return;
    current = entryId;
    for (const listener of listeners) listener();
  };
  const drop = () => {
    if (resting) clearTimeout(resting.timer);
    resting = null;
  };
  return {
    get: () => current,
    set: (entryId) => {
      drop();
      show(entryId);
    },
    rest: (entryId) => {
      if (held || entryId === current) {
        if (resting?.id !== entryId) drop();
        return;
      }
      // Every move on the card starts its rest again.
      drop();
      resting = {
        id: entryId,
        timer: setTimeout(() => {
          resting = null;
          if (!held) show(entryId);
        }, restMs),
      };
    },
    leave: (entryId) => {
      if (resting?.id === entryId) drop();
    },
    hold: (next) => {
      held = next;
      if (next) drop();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function pictureOf(row: ViewRow, showProxies: boolean): string | null {
  if (row.isPrivate) return null;
  const { entry, card } = row.item;
  const thumb =
    card && isStoredRenderUrl(card.rendered_image_url) && isStoredRenderUrl(card.rendered_thumb_url)
      ? (toRenderCdnUrl(card.rendered_thumb_url) ?? card.rendered_thumb_url)
      : null;
  const printing = entryPrintingImage(entry.image_url, "normal");
  return (showProxies ? thumb : printing) ?? thumb ?? printing;
}

export function DeckPreviewPane({
  store,
  rows,
  showProxies,
  actions,
  onDetails,
  className,
}: {
  store: PreviewStore;
  /** The cards on show, in the order the page reads them. */
  rows: readonly ViewRow[];
  showProxies: boolean;
  /** The owner's controls for the card shown (null for a visitor). */
  actions: ((row: ViewRow) => ReactNode) | null;
  /** Opens the card's pop-up. */
  onDetails: (entryId: string, opener: HTMLElement) => void;
  className?: string;
}) {
  const activeId = useSyncExternalStore(store.subscribe, store.get, () => null);
  const row = rows.find((candidate) => candidate.id === activeId) ?? rows[0] ?? null;
  if (!row) return null;
  const picture = pictureOf(row, showProxies);
  const maker = row.item.cardOwner?.username ?? null;
  const twoFaces = Boolean(row.item.card && hasBackPicture(row.item.card)) && picture !== entryPrintingImage(row.item.entry.image_url, "normal");

  return (
    <section aria-label="Card preview" className={cn("sticky top-24 flex max-h-[calc(100dvh-7rem)] flex-col gap-3 overflow-y-auto", className)}>
      <div className={cn("relative aspect-[5/7] w-full overflow-hidden border border-border/60 bg-elevated", cardCornersClass(false))}>
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- our 600 px thumb or Scryfall's sized picture
          <img key={picture} src={picture} alt={row.name} decoding="async" className="absolute inset-0 h-full w-full bg-[#101015] object-cover" />
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted">
            {row.isGone ? (
              <Ban className="h-5 w-5" aria-hidden />
            ) : row.isPrivate ? (
              <Lock className="h-5 w-5" aria-hidden />
            ) : (
              <HelpCircle className="h-5 w-5" aria-hidden />
            )}
            {/* A visitor's deleted card (0153) is gone, not private. */}
            {row.isPrivate ? (row.isGone ? GONE_CARD_NAME : PRIVATE_CARD_NAME) : "No picture"}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate font-display text-base font-semibold text-foreground">{row.name}</h3>
          <DeckEntryStatusBadge status={row.status} unavailable={row.badge === "unavailable"} small />
          {twoFaces ? <TwoFacesMark /> : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {row.privateName ? <span>{row.privateName}</span> : null}
          {row.fields.typeLine ? <span className="min-w-0 truncate">{row.fields.typeLine}</span> : null}
          {row.fields.cost ? <ManaCostGlyphs cost={row.fields.cost} size="sm" /> : null}
        </p>
        <p className="text-xs text-subtle">
          {DECK_BOARD_LABELS[row.board]} · {row.quantity} {row.quantity === 1 ? "copy" : "copies"}
          {maker ? (
            <>
              {" · "}
              <Link href={`/profile/${maker}`} className="rounded-sm text-muted underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50">
                by <span className="font-mono">@{maker}</span>
              </Link>
            </>
          ) : null}
        </p>
      </div>
      {actions && !row.item.pending ? actions(row) : null}
      <button
        type="button"
        onClick={(event) => onDetails(row.id, event.currentTarget)}
        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
      >
        <Maximize2 className="h-3.5 w-3.5" aria-hidden />
        Details
        <span className="sr-only">: {row.name}</span>
      </button>
    </section>
  );
}
