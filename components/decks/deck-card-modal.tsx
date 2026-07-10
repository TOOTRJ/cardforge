"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  Link2,
  Loader2,
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
  unlinkDeckCardAction,
  updateDeckCardAction,
  type MyCardLite,
} from "@/lib/decks/card-actions";
import { buildCardPath } from "@/lib/cards/utils";
import {
  DECK_BOARD_LABELS,
  DECK_BOARD_VALUES,
  deckEntryState,
} from "@/types/deck";
import type { DeckItem } from "@/lib/decks/queries";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// DeckCardModal — the "more info" view for one deck entry. Everyone gets the
// original⇄proxy image flipper and source links; the deck owner additionally
// gets the management actions (remix, link/unlink proxy, quantity, board,
// remove). Mutations refresh the route so the server-rendered list reflects
// the change.
// ---------------------------------------------------------------------------

type DeckCardModalProps = {
  item: DeckItem;
  ownerUsername: string | null;
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which image the list was showing when opened — keeps the flip state
   *  consistent between grid and modal. */
  preferProxy: boolean;
};

export function DeckCardModal({
  item,
  ownerUsername,
  canManage,
  open,
  onOpenChange,
  preferProxy,
}: DeckCardModalProps) {
  const { entry, card } = item;
  const state = deckEntryState(entry);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const proxyImage = card?.rendered_image_url ?? null;
  const originalImage = entry.image_url;
  const hasBoth = Boolean(proxyImage && originalImage);
  // Adjust-during-render (not an effect): re-sync the flip state when the
  // list's toggle changes between opens.
  const [showProxy, setShowProxy] = useState(preferProxy);
  const [lastPrefer, setLastPrefer] = useState(preferProxy);
  if (preferProxy !== lastPrefer) {
    setShowProxy(preferProxy);
    setLastPrefer(preferProxy);
  }

  const shownImage =
    (showProxy ? proxyImage : originalImage) ?? proxyImage ?? originalImage;

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
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {card?.title ?? entry.name}
            <StateBadgeLarge state={state} />
            <CardGlossary />
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {entry.type_line ?? card?.card_type ?? "Card"}
            {entry.mana_cost || card?.cost ? (
              <ManaCostGlyphs cost={entry.mana_cost ?? card?.cost} size="sm" />
            ) : null}
            {entry.set_code ? (
              <span className="font-mono text-xs text-subtle">
                {entry.set_code.toUpperCase()} {entry.collector_number}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-[minmax(0,260px)_1fr]">
          {/* Image + flipper */}
          <div className="flex flex-col gap-2">
            <div className="relative aspect-[5/7] w-full overflow-hidden rounded-xl border border-border/60 bg-elevated">
              {shownImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shownImage}
                  alt={card?.title ?? entry.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center px-4 text-center text-xs text-subtle">
                  No image — {entry.name}
                </span>
              )}
            </div>
            {hasBoth ? (
              <div
                className="grid grid-cols-2 gap-1 rounded-md border border-border bg-background/60 p-1 text-xs"
                role="group"
                aria-label="Image version"
              >
                <FlipButton
                  label="Original"
                  active={!showProxy}
                  onClick={() => setShowProxy(false)}
                />
                <FlipButton
                  label="My proxy"
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

            <div className="flex flex-col gap-2">
              {entry.scryfall_id ? (
                <a
                  href={`/go/scryfall/${entry.scryfall_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  View the original on Scryfall
                </a>
              ) : null}
              {card ? (
                <Link
                  href={buildCardPath({
                    slug: card.slug,
                    owner: { username: ownerUsername },
                  })}
                  className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden />
                  Open the custom proxy&apos;s page
                </Link>
              ) : null}
            </div>

            {canManage ? (
              <div className="flex flex-col gap-4 border-t border-border/40 pt-4">
                {/* The headline action: turn the real card into a proxy. */}
                {entry.scryfall_id && !card ? (
                  <Button asChild size="lg">
                    <Link href={`/create?deckCard=${entry.id}`}>
                      <Sparkles className="h-4 w-4" aria-hidden />
                      Create a custom proxy
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
                      Unlink proxy
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
      </DialogContent>
    </Dialog>
  );
}

function FlipButton({
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
        "rounded px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
        active
          ? "bg-primary/15 text-primary-bright"
          : "text-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function StateBadgeLarge({
  state,
}: {
  state: ReturnType<typeof deckEntryState>;
}) {
  if (state === "remixed")
    return (
      <Badge variant="primary" className="gap-1">
        <Sparkles className="h-3 w-3" aria-hidden /> Custom proxy
      </Badge>
    );
  if (state === "custom") return <Badge variant="accent">Custom card</Badge>;
  if (state === "unresolved")
    return <Badge variant="outline">Placeholder</Badge>;
  return <Badge variant="outline">Needs proxy</Badge>;
}

// ---------------------------------------------------------------------------
// LinkCardPicker — lazily loads the caller's cards on first render, with a
// client-side name filter. Kept intentionally light (200 most recent).
// ---------------------------------------------------------------------------

function LinkCardPicker({
  onPick,
  disabled,
}: {
  onPick: (cardId: string) => void;
  disabled: boolean;
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
    const q = query.trim().toLowerCase();
    const matches = q
      ? cards.filter((c) => c.title.toLowerCase().includes(q))
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
      <p className="text-xs text-muted">
        You haven&apos;t created any cards yet — use “Remix this card” instead.
      </p>
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
        {filtered.map((card) => (
          <li key={card.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(card.id)}
              className="group flex w-full flex-col gap-1 rounded-md border border-border/60 p-1.5 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
            >
              {card.rendered_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.rendered_image_url}
                  alt=""
                  className="aspect-[5/7] w-full rounded-sm object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="flex aspect-[5/7] w-full items-center justify-center rounded-sm bg-elevated px-1 text-center text-[9px] text-subtle">
                  {card.title}
                </span>
              )}
              <span className="truncate text-[10px] text-muted group-hover:text-foreground">
                {card.title}
              </span>
            </button>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="col-span-full py-4 text-center text-xs text-muted">
            No cards match.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
