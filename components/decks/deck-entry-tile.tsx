"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { HelpCircle, Lock } from "lucide-react";
import { CardTile } from "@/components/cards/card-tile";
import { DeckEntryStatusBadge } from "@/components/decks/deck-entry-status-badge";
import { cardCornersClass } from "@/lib/cards/card-orientation";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import { isStoredRenderUrl } from "@/lib/cards/render-cdn";
import { entryPrintingImage } from "@/lib/decks/entry-image";
import type { DeckRow } from "@/lib/decks/deck-view";
import type { DeckItem, DeckPageCard } from "@/lib/decks/queries";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// One deck entry as a CARD — the Stacks and Grid views (TODO DK5.3). What
// it draws, in order:
//
//   * a visitor's view of a card they can't read (D11, TODO DK5.17): the
//     "Private card" tile — a lock, those words and the REAL card's name the
//     entry stands for (its printing's) — never the private card's title
//     or art (lib/decks/private-card-name.ts);
//   * a PipGlyph card with a stored bake (when the list shows custom cards,
//     or the entry has no printing): through CardTile + BakedCardThumbnail,
//     the 600 px thumb, never the HD PNG — and a two-faced card's "2 faces"
//     button and hover-turn, exactly as every gallery tile (TODO 5.15 /
//     5.17: the body is an empty element UNDER the picture, the button its
//     sibling — never a control inside the opener);
//   * the printing: Scryfall's "normal" picture on its own 5:7 tile with the
//     ONE card corner (cardCornersClass);
//   * a PipGlyph card with no bake yet and no printing: its live preview
//     (BakedCardThumbnail's fallback — the page reads every field it draws);
//   * nothing to draw: the name on a blank card.
//
// The opener is a role="button" (a CardTile body holds the picture's divs, so
// it can't be a <button>) or a <button> around a plain <img>; either way it
// carries `data-deck-entry` — the pop-up hands the focus back to it — and
// the row's full name (quantity and status included, TODO DK5.12). The
// quantity and the status ride on the picture as a strip of chips, hidden
// from assistive tech (the name already says them) and from the pointer.
// ---------------------------------------------------------------------------

type TileItem = DeckItem<DeckPageCard>;

/** The opener's focus ring, and its distance from the sticky summary bar
 *  when the focus scrolls it into view (WCAG 2.4.11). */
const OPENER_CLASS =
  "scroll-mb-28 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Enter / Space open the card, as a <button> would. */
function openOnKey(event: KeyboardEvent<HTMLElement>, open: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    open();
  }
}

export function DeckEntryTile({
  row,
  label,
  showProxies,
  onOpen,
  sizes,
  chips = "overlay",
  maker = null,
}: {
  row: DeckRow<TileItem>;
  /** The opener's accessible name (deckRowLabel). */
  label: string;
  /** The list's "custom cards ⇄ real cards" choice. */
  showProxies: boolean;
  onOpen: (entryId: string) => void;
  /** The picture's rendered width (next/image `sizes`) for an older bake. */
  sizes: string;
  /** Where the quantity and status go: on the picture under its title bar
   *  (Stacks: the only part of a stacked card on show), or under the card
   *  (Grid). */
  chips?: "overlay" | "caption";
  /** Another creator's card (D3): their handle, in the caption. */
  maker?: string | null;
}) {
  const { entry, card } = row.item;
  const open = () => onOpen(entry.id);
  const opener = {
    "data-deck-entry": entry.id,
    "aria-label": label,
    "aria-haspopup": "dialog" as const,
  };

  const baked = Boolean(card && isStoredRenderUrl(card.rendered_image_url));
  const printing = entryPrintingImage(entry.image_url, "normal");
  const useCard = Boolean(card && (baked ? showProxies || !printing : !printing));

  let picture: ReactNode;
  if (row.isPrivate) {
    picture = (
      <button type="button" {...opener} onClick={open} className={cn("block w-full", cardCornersClass(false), OPENER_CLASS)}>
        <PrivateCardFace name={row.privateName} />
      </button>
    );
  } else if (card && useCard) {
    picture = (
      <CardTile
        className="scroll-mb-28 cursor-pointer"
        thumbnail={{
          renderedImageUrl: card.rendered_image_url,
          renderedThumbUrl: card.rendered_thumb_url,
          renderedBackThumbUrl: card.rendered_back_thumb_url,
          title: card.title,
          previewData: cardToPreviewData(card),
          sizes,
        }}
        body={(slot) => (
          <div
            role="button"
            tabIndex={0}
            {...opener}
            onClick={open}
            onKeyDown={(event) => openOnKey(event, open)}
            className={slot.className}
            style={slot.style}
            data-tile-body={slot["data-tile-body"]}
          >
            {slot.children}
          </div>
        )}
      />
    );
  } else if (printing) {
    picture = (
      <button
        type="button"
        {...opener}
        onClick={open}
        className={cn(
          "relative block aspect-[5/7] w-full overflow-hidden border border-border/40 bg-[#101015] shadow-[0_18px_60px_-30px_rgba(0,0,0,0.85)]",
          cardCornersClass(false),
          OPENER_CLASS,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Scryfall's own CDN, sized by the URL */}
        <img src={printing} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      </button>
    );
  } else {
    picture = (
      <button type="button" {...opener} onClick={open} className={cn("block w-full", cardCornersClass(false), OPENER_CLASS)}>
        <BlankCardFace name={row.name} />
      </button>
    );
  }

  const chipStrip = (
    <span aria-hidden className="flex min-w-0 flex-wrap items-center gap-1">
      {row.quantity > 1 ? (
        <span className="rounded-full border border-white/20 bg-black/75 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-white">
          {row.quantity}×
        </span>
      ) : null}
      <DeckEntryStatusBadge status={row.status} unavailable={row.badge === "unavailable"} small onPicture={chips === "overlay"} />
    </span>
  );

  if (chips === "caption") {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        {picture}
        <div className="flex min-w-0 items-center gap-1.5 px-0.5">
          {chipStrip}
          {maker ? <span className="truncate font-mono text-[11px] text-subtle">by @{maker}</span> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="relative">
      {picture}
      {/* Just under the card's title bar: the part of a stacked card on show. */}
      <div className="pointer-events-none absolute inset-x-1.5 top-[calc(var(--stack-title)_+_0.15rem)] z-10 flex">{chipStrip}</div>
    </div>
  );
}

/** A drawn card's empty face: a title bar where a printed card has one (the
 *  part of a pile on show — so a pile of them still reads), a mark in the
 *  middle. Every length is a share of the card, so it scales with the tile. */
function StandInFace({
  title,
  titleIcon,
  children,
  dashed = false,
}: {
  title: string;
  titleIcon?: ReactNode;
  children: ReactNode;
  dashed?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative block aspect-[5/7] w-full overflow-hidden border bg-elevated",
        dashed ? "border-dashed border-border-strong" : "border-border",
        cardCornersClass(false),
      )}
      style={
        dashed
          ? { backgroundImage: "repeating-linear-gradient(135deg, transparent 0 10px, rgba(127,127,127,0.07) 10px 20px)" }
          : undefined
      }
    >
      <span className="absolute inset-x-[5%] top-[3.5%] flex h-[7.5%] items-center gap-1 rounded-[3px] border border-border bg-surface px-1.5 text-left">
        {titleIcon}
        <span className="min-w-0 truncate text-[11px] font-semibold leading-none text-foreground">{title}</span>
      </span>
      <span className="absolute inset-x-[8%] bottom-[12%] top-[22%] flex flex-col items-center justify-center gap-2 text-center">
        {children}
      </span>
    </span>
  );
}

/** A visitor's private card (D11): a lock, the words, the real card's name
 *  where the entry has one — never the private card's title or art. */
function PrivateCardFace({ name }: { name: string | null }) {
  return (
    <StandInFace title={name ?? "Private card"} titleIcon={<Lock className="h-3 w-3 shrink-0 text-muted" aria-hidden />} dashed>
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-muted">
        <Lock className="h-4 w-4" aria-hidden />
      </span>
      <span className="text-sm font-semibold text-foreground">Private card</span>
      <span className="text-xs leading-5 text-muted">Its maker keeps it private.</span>
    </StandInFace>
  );
}

/** Nothing to draw: the name on a blank card. */
function BlankCardFace({ name }: { name: string }) {
  return (
    <StandInFace title={name}>
      <HelpCircle className="h-6 w-6 text-subtle" aria-hidden />
      <span className="line-clamp-3 text-xs font-medium text-muted [overflow-wrap:anywhere]">No picture</span>
    </StandInFace>
  );
}

