"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  Link2,
  Loader2,
  Maximize2,
  Search,
  Sparkles,
  Trash2,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { CardGlossary } from "@/components/creator/card-glossary";
import {
  linkDeckCardAction,
  listMyCardsLiteAction,
  removeDeckCardAction,
  setDeckCoverPicksAction,
  unlinkDeckCardAction,
  updateDeckCardAction,
  type MyCardLite,
} from "@/lib/decks/card-actions";
import { buildCardPath } from "@/lib/cards/utils";
import { isLandscapeFrame } from "@/lib/cards/card-orientation";
import { isStoredRenderUrl, toRenderCdnUrl } from "@/lib/cards/render-cdn";
import { hasBackPicture } from "@/lib/cards/tile-faces";
import { drawableMediaUrl } from "@/lib/media/media-urls";
import {
  DECK_BOARD_LABELS,
  DECK_BOARD_VALUES,
} from "@/types/deck";
import type { DeckItem, DeckPageCard } from "@/lib/decks/queries";
import { deckEntryStatus, deckEntryUnavailable } from "@/lib/decks/entry-status";
import { effectiveEntryFields } from "@/lib/decks/effective-entry";
import { DeckEntryStatusBadge } from "@/components/decks/deck-entry-status-badge";
import { DeckCoverPicks } from "@/components/decks/deck-cover-picks";
import type { CoverPickRow } from "@/lib/decks/featured";
import { cn } from "@/lib/utils";
import { typedForMatching } from "@/lib/validation/print-typography";

// ---------------------------------------------------------------------------
// DeckCardModal — the "more info" view for one deck entry. Everyone gets the
// real card ⇄ custom card image flipper and source links; the deck owner
// additionally gets the management actions (customize, link / unlink a card,
// quantity, board, remove, "Feature on cover" — DeckCoverPicks, TODO DK6.4).
// Mutations refresh the route so the
// server-rendered list reflects the change. Its words are the deck
// vocabulary (TODO DK2.2, components/creator/card-glossary.tsx).
// ---------------------------------------------------------------------------

type DeckCardModalProps = {
  item: DeckItem<DeckPageCard>;
  ownerUsername: string | null;
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which image the list was showing when opened — keeps the flip state
   *  consistent between grid and modal. */
  preferProxy: boolean;
  /** The owner's cover picks (TODO DK6.4) and whether this entry can stand
   *  in the fan; null = no "Feature on cover" (a visitor). */
  cover?: { picks: readonly CoverPickRow[]; shown: boolean } | null;
};

export function DeckCardModal({
  item,
  ownerUsername,
  canManage,
  open,
  onOpenChange,
  preferProxy,
  cover = null,
}: DeckCardModalProps) {
  const { entry, card } = item;
  const status = deckEntryStatus(entry, card);
  // Its PipGlyph card is gone (D3): another creator's card that went
  // private (the owner reads all of their own), or a deleted one.
  const unavailable = deckEntryUnavailable(entry, card, canManage);
  const fields = effectiveEntryFields(entry, card, status);
  // Another creator's card (D3): their handle, and THEIR card page.
  const maker = item.cardOwner?.username ?? null;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Only a bake in our card-renders bucket (lib/cards/render-cdn.ts): a row
  // written before migration 0126 could point the card anywhere.
  const proxyImage = card && isStoredRenderUrl(card.rendered_image_url) ? card.rendered_image_url : null;
  // A printing image only from Scryfall (migration 0127, lib/media/media-urls.ts).
  const originalImage = drawableMediaUrl("deck-card-image", entry.image_url);
  const hasBoth = Boolean(proxyImage && originalImage);
  // Adjust-during-render (not an effect): re-sync the flip state when the
  // list's toggle changes between opens.
  const [showProxy, setShowProxy] = useState(preferProxy);
  const [lastPrefer, setLastPrefer] = useState(preferProxy);
  if (preferProxy !== lastPrefer) {
    setShowProxy(preferProxy);
    setLastPrefer(preferProxy);
  }

  // A proxy with a back PICTURE (TODO 5.15; lib/cards/tile-faces.ts — the
  // cards a tile gives its "2 faces" button) gets a Front / Back switch
  // under its picture. The back's file is asked for only once Back is
  // chosen. One face at a time: the picture column is one card wide at
  // every size, and a phone has no room for two.
  const proxyBackImage =
    proxyImage && card && hasBackPicture(card) && isStoredRenderUrl(card.rendered_back_image_url)
      ? card.rendered_back_image_url
      : null;
  const [proxyFace, setProxyFace] = useState<"front" | "back">("front");

  const shownFront =
    (showProxy ? proxyImage : originalImage) ?? proxyImage ?? originalImage;
  const showingProxy = Boolean(shownFront && shownFront === proxyImage);
  const canTurn = showingProxy && Boolean(proxyBackImage);
  const showingBack = canTurn && proxyFace === "back";
  const shownImage = showingBack ? proxyBackImage : shownFront;
  const shownAlt = `${card?.title ?? entry.name}${showingBack ? " (back face)" : ""}`;
  // A 7:5 proxy bake (Battle, Split) is shown whole in its own landscape box
  // inside the 5:7 frame, never cropped to its middle (TODO 3.26 review).
  const landscapeProxy = Boolean(shownImage && shownImage === proxyImage && isLandscapeFrame(card?.frame_style));
  // Where the card "lives": a custom card / proxy has a PipGlyph page (a
  // soft navigation there opens the site's large card modal over this
  // deck); a real card points at Scryfall.
  const cardPath = card
    ? buildCardPath({ slug: card.slug, owner: { username: item.cardOwner ? maker : ownerUsername } })
    : null;
  const scryfallHref = entry.scryfall_id ? `/go/scryfall/${entry.scryfall_id}` : null;
  // The PICTURE's link opens the face it shows (TODO 5.17): with Back chosen
  // the card page — and the card modal a soft navigation opens — starts
  // flipped (`?face=back`, components/cards/card-hero-preview.tsx).
  const picturePath = cardPath && showingBack ? `${cardPath}?face=back` : cardPath;

  const [linkPickerOpen, setLinkPickerOpen] = useState(false);

  const mutate = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* xl, like the gallery's card modal — the card is the point here. */}
      <DialogContent size="xl" className="min-h-0">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {cardPath ? (
              <Link
                href={cardPath}
                onClick={() => onOpenChange(false)}
                className="underline-offset-4 transition-colors hover:text-primary-bright hover:underline"
                title="Open this card's page"
              >
                {card?.title ?? entry.name}
              </Link>
            ) : (
              card?.title ?? entry.name
            )}
            <DeckEntryStatusBadge status={status} unavailable={unavailable} />
            <CardGlossary />
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {fields.typeLine ?? "Card"}
            {fields.cost ? <ManaCostGlyphs cost={fields.cost} size="sm" /> : null}
            {maker ? (
              <Link
                href={`/profile/${maker}`}
                onClick={() => onOpenChange(false)}
                className="text-xs text-muted transition-colors hover:text-foreground"
              >
                by <span className="font-mono text-foreground">@{maker}</span>
              </Link>
            ) : null}
            {entry.set_code ? (
              <span className="font-mono text-xs text-subtle">
                {entry.set_code.toUpperCase()} {entry.collector_number}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {/* Body padding matches the header's px-5 (the grid used to sit
            flush against the dialog edge). The image column is card-page
            sized; the whole image is a link to the card's page. */}
        {/* The padding lives on an inner block: padding on the scroll
            container itself is dropped at the bottom once the content
            overflows, which is why the last row sat flush on the edge. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-6 px-5 py-5 md:grid-cols-[auto_minmax(0,1fr)]">
          {/* Image + flipper */}
          <div className="flex flex-col gap-2">
            <CardImageLink
              href={picturePath ?? scryfallHref}
              external={!cardPath && Boolean(scryfallHref)}
              label={
                cardPath
                  ? showingBack
                    ? "Open this card's page on its back face"
                    : "Open this card's page"
                  : "View on Scryfall"
              }
              onNavigate={() => onOpenChange(false)}
            >
              {shownImage && landscapeProxy ? (
                <span className="flex h-full w-full items-center">
                  <span className="block aspect-[7/5] w-full overflow-hidden card-corners-landscape">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={shownImage}
                      alt={shownAlt}
                      className="h-full w-full bg-[#101015] object-cover"
                    />
                  </span>
                </span>
              ) : shownImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shownImage}
                  alt={shownAlt}
                  className="h-full w-full bg-[#101015] object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-subtle">
                  No image — {entry.name}
                </span>
              )}
            </CardImageLink>
            {canTurn ? (
              <div
                className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background/60 p-1 text-sm"
                role="group"
                aria-label="Card face"
                data-testid="deck-card-face-switch"
              >
                <FlipButton
                  label="Front"
                  active={!showingBack}
                  onClick={() => setProxyFace("front")}
                  tall
                />
                <FlipButton
                  label="Back"
                  active={showingBack}
                  onClick={() => setProxyFace("back")}
                  tall
                />
              </div>
            ) : null}
            {hasBoth ? (
              <div
                className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background/60 p-1 text-xs"
                role="group"
                aria-label="Image version"
              >
                <FlipButton
                  label="Real card"
                  active={!showProxy}
                  onClick={() => setShowProxy(false)}
                />
                <FlipButton
                  label="Custom card"
                  active={showProxy}
                  onClick={() => setShowProxy(true)}
                />
              </div>
            ) : null}
          </div>

          {/* Details + actions */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge variant="outline">
                {DECK_BOARD_LABELS[entry.board]} · {entry.quantity}×
              </Badge>
            </div>

            {/* Never WHY (made private or unlisted, hidden by moderation,
                deleted): the deck can't tell these apart for sure. */}
            {unavailable ? (
              <p className="text-sm leading-6 text-muted" data-testid="deck-card-unavailable">
                This card is no longer available.
              </p>
            ) : null}

            <div className="flex flex-col gap-2">
              {entry.scryfall_id ? (
                <a
                  href={`/go/scryfall/${entry.scryfall_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  View the real card on Scryfall
                </a>
              ) : null}
              {cardPath ? (
                <Link
                  href={cardPath}
                  onClick={() => onOpenChange(false)}
                  className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                  Open this card&apos;s page
                </Link>
              ) : null}
            </div>

            {canManage ? (
              <div className="flex flex-col gap-4 border-t border-border/40 pt-4">
                {/* The headline action: make your own version of the real card. */}
                {entry.scryfall_id && !card ? (
                  <Button asChild size="lg">
                    <Link href={`/create?deckCard=${entry.id}`}>
                      <Sparkles className="h-4 w-4" aria-hidden />
                      Customize
                    </Link>
                  </Button>
                ) : unavailable ? (
                  // Nothing left to start from but the name (D3): a card of
                  // the owner's own takes the entry's place on save.
                  <Button asChild size="lg">
                    <Link href={`/create?deckCard=${entry.id}`}>
                      <Sparkles className="h-4 w-4" aria-hidden />
                      Make your own version
                    </Link>
                  </Button>
                ) : null}

                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs text-subtle">
                    Quantity
                    <input
                      type="number"
                      min={1}
                      max={250}
                      defaultValue={entry.quantity}
                      key={`qty-${entry.id}-${entry.quantity}`}
                      disabled={isPending}
                      onBlur={(event) => {
                        const next = Number.parseInt(event.target.value, 10);
                        if (!Number.isFinite(next) || next === entry.quantity)
                          return;
                        mutate(() =>
                          updateDeckCardAction(entry.id, {
                            quantity: Math.max(1, Math.min(next, 250)),
                          }),
                        );
                      }}
                      className="h-9 w-20 rounded-md border border-border bg-background/60 px-2 text-center text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-subtle">
                    Board
                    <select
                      value={entry.board}
                      disabled={isPending}
                      onChange={(event) =>
                        mutate(() =>
                          updateDeckCardAction(entry.id, {
                            board: event.target
                              .value as (typeof DECK_BOARD_VALUES)[number],
                          }),
                        )
                      }
                      className="h-9 rounded-md border border-border bg-background/60 px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
                    >
                      {DECK_BOARD_VALUES.map((board) => (
                        <option key={board} value={board}>
                          {DECK_BOARD_LABELS[board]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {card ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() =>
                        mutate(() => unlinkDeckCardAction(entry.id))
                      }
                    >
                      <Unlink className="h-3.5 w-3.5" aria-hidden />
                      {/* Unlinking puts a real card back; an entry with no
                          real card behind it keeps only its name. */}
                      {entry.scryfall_id ? "Use the real card" : "Unlink card"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isPending}
                      onClick={() => setLinkPickerOpen((prev) => !prev)}
                    >
                      <Link2 className="h-3.5 w-3.5" aria-hidden />
                      Link an existing card
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() => {
                      mutate(async () => {
                        const result = await removeDeckCardAction(entry.id);
                        if (result.ok) {
                          toast.success(`Removed ${entry.name}.`);
                          onOpenChange(false);
                        }
                        return result;
                      });
                    }}
                    className="text-danger hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    Remove from deck
                  </Button>
                  {isPending ? (
                    <Loader2
                      className="h-4 w-4 animate-spin text-muted"
                      aria-hidden
                    />
                  ) : null}
                </div>

                {cover ? (
                  <DeckCoverPicks
                    entryId={entry.id}
                    board={entry.board}
                    picks={cover.picks}
                    shown={cover.shown}
                    pending={isPending}
                    onChange={(ids) => mutate(() => setDeckCoverPicksAction(entry.deck_id, ids))}
                  />
                ) : null}

                {linkPickerOpen && !card ? (
                  <LinkCardPicker
                    disabled={isPending}
                    onPick={(cardId) => {
                      setLinkPickerOpen(false);
                      mutate(() => linkDeckCardAction(entry.id, cardId));
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The card image as a link — soft navigation for a PipGlyph card (the
 *  site's card modal opens over the deck), a new tab for Scryfall. Falls
 *  back to a plain frame when there is nowhere to go. */
function CardImageLink({
  href,
  external,
  label,
  onNavigate,
  children,
}: {
  href: string | null;
  external: boolean;
  label: string;
  /** Called when an in-app link is followed (closes the deck dialog). */
  onNavigate?: () => void;
  children: React.ReactNode;
}) {
  // On wide screens the card is sized to the viewport height (5:7 kept), so
  // the whole dialog — padding included — fits without scrolling. The frame
  // IS the 5:7 card box, so it takes the ONE card corner (a fixed 12 px
  // radius left a sliver of a rounded bake's transparent corner showing).
  const frame =
    "relative block aspect-[5/7] w-full overflow-hidden card-corners border border-border/60 bg-elevated md:h-[min(60dvh,36rem)] md:w-auto";
  if (!href) return <div className={frame}>{children}</div>;
  const hint = (
    <span className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-linear-to-t from-background/85 to-transparent px-3 pb-3 pt-8 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/90 px-3 py-1 text-xs font-medium text-foreground">
        {external ? (
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
        )}
        {label}
      </span>
    </span>
  );
  const classes = `${frame} group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60`;
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes} aria-label={label}>
        {children}
        {hint}
      </a>
    );
  }
  return (
    <Link href={href} onClick={onNavigate} className={classes} aria-label={label}>
      {children}
      {hint}
    </Link>
  );
}

function FlipButton({
  label,
  active,
  onClick,
  tall = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  /** A thumb-sized (44 px) target — the Front / Back switch (TODO 5.15). */
  tall?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
        tall && "min-h-11 font-medium",
        active
          ? "bg-primary/15 text-primary-bright"
          : "text-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// LinkCardPicker — lazily loads the caller's cards on first render, with a
// client-side name filter. Kept intentionally light (200 most recent).
// Each tile draws the bake's 600 px WebP thumb (the CLAUDE.md tile rule —
// 24 HD PNGs were up to ~70 MB per open); a bake older than thumbnails
// goes through next/image, and a card with no bake shows its title.
// ---------------------------------------------------------------------------

/** The tile's picture: the thumb beside one of OUR bakes, as
 *  BakedCardThumbnail vouches for it (lib/cards/render-cdn.ts). */
function pickerThumbOf(card: MyCardLite): string | null {
  if (!isStoredRenderUrl(card.rendered_image_url) || !isStoredRenderUrl(card.rendered_thumb_url)) return null;
  return toRenderCdnUrl(card.rendered_thumb_url) ?? card.rendered_thumb_url;
}

/** The picker as the deck page's "Add from my cards" dialog uses it too
 *  (components/decks/add-from-my-cards-dialog.tsx). */
export { LinkCardPicker as MyCardPicker };

function LinkCardPicker({
  onPick,
  disabled,
  emptyText = "You haven’t created any cards yet — use “Customize” instead.",
}: {
  onPick: (cardId: string, title: string) => void;
  disabled: boolean;
  /** What a maker with no cards is told. */
  emptyText?: string;
}) {
  const [cards, setCards] = useState<MyCardLite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    listMyCardsLiteAction().then((result) => {
      if (cancelled) return;
      if (result.ok) setCards(result.cards);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!cards) return [];
    // Typed and printed quotes / dashes match each other (TODO 6.11).
    const q = typedForMatching(query.trim().toLowerCase());
    const matches = q
      ? cards.filter((c) => typedForMatching(c.title.toLowerCase()).includes(q))
      : cards;
    return matches.slice(0, 24);
  }, [cards, query]);

  if (error) {
    return <p className="text-xs text-danger">{error}</p>;
  }
  if (!cards) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Loading your cards…
      </p>
    );
  }
  if (cards.length === 0) {
    return (
      <p className="text-xs text-muted">{emptyText}</p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-background/40 p-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle"
          aria-hidden
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          placeholder="Filter your cards"
          aria-label="Filter your cards"
          className="h-8 w-full rounded-md border border-border bg-background/60 pl-8 pr-2 text-xs text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
        />
      </div>
      <ul className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
        {filtered.map((card) => {
          const thumb = pickerThumbOf(card);
          return (
            <li key={card.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(card.id, card.title)}
                className="group flex w-full flex-col gap-1 rounded-md border border-border/60 p-1.5 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
              >
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumb}
                    alt=""
                    className="aspect-[5/7] w-full card-corners bg-[#101015] object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : isStoredRenderUrl(card.rendered_image_url) ? (
                  // A bake older than thumbnails: the PNG resized by
                  // next/image, as BakedCardThumbnail draws it — never the
                  // ~3 MB file itself.
                  <span className="relative block aspect-[5/7] w-full overflow-hidden card-corners bg-[#101015]">
                    <Image
                      src={card.rendered_image_url}
                      alt=""
                      fill
                      sizes="(min-width: 640px) 120px, 30vw"
                      className="object-cover"
                    />
                  </span>
                ) : (
                  <span className="flex aspect-[5/7] w-full items-center justify-center card-corners bg-elevated px-1 text-center text-[9px] text-subtle">
                    {card.title}
                  </span>
                )}
                <span className="truncate text-[10px] text-muted group-hover:text-foreground">
                  {card.title}
                </span>
              </button>
            </li>
          );
        })}
        {filtered.length === 0 ? (
          <li className="col-span-full py-4 text-center text-xs text-muted">
            No cards match.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
