"use client";

import { useState, useTransition } from "react";
import { Check, Pin, PinOff } from "lucide-react";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { updatePinnedCardsAction } from "@/app/(app)/settings/actions";
import { PINNED_CARDS_MAX } from "@/lib/auth/schemas";
import type { ArtPosition, FrameStyle } from "@/types/card";
import type { CardWithStats } from "@/lib/cards/queries";

// ---------------------------------------------------------------------------
// PinnedCardsPicker — toggleable grid of the user's public cards. At most
// three may be selected at once; clicking a fourth replaces the oldest
// selection (FIFO) so the user doesn't get stuck. Selection survives
// optimistically across re-renders; the save button persists via
// updatePinnedCardsAction.
// ---------------------------------------------------------------------------

type PinnedCardsPickerProps = {
  cards: CardWithStats[];
  initialPinned: string[];
};

export function PinnedCardsPicker({
  cards,
  initialPinned,
}: PinnedCardsPickerProps) {
  const [selected, setSelected] = useState<string[]>(initialPinned);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (cards.length === 0) {
    return (
      <p className="rounded-md border border-border/40 bg-background/40 px-4 py-6 text-center text-sm text-muted">
        You need at least one public card to pin. Publish a card from the
        dashboard to choose it here.
      </p>
    );
  }

  const toggle = (id: string) => {
    setSuccess(false);
    setError(null);
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= PINNED_CARDS_MAX) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const onSave = () => {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const formData = new FormData();
      for (const id of selected) formData.append("pinned_card_ids", id);
      const result = await updatePinnedCardsAction(
        { status: "idle" },
        formData,
      );
      if (result.formError) {
        setError(result.formError);
        return;
      }
      if (result.success) setSuccess(true);
    });
  };

  const dirty =
    selected.length !== initialPinned.length ||
    selected.some((id, i) => id !== initialPinned[i]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          {selected.length} / {PINNED_CARDS_MAX} pinned
        </p>
        <div className="flex items-center gap-2">
          {selected.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected([]);
                setSuccess(false);
              }}
              disabled={isPending}
            >
              <PinOff className="h-3.5 w-3.5" aria-hidden /> Clear
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={!dirty || isPending}
          >
            {isPending ? "Saving…" : "Save pinned cards"}
          </Button>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-foreground"
        >
          {error}
        </div>
      ) : null}
      {success ? (
        <div
          role="status"
          className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-foreground"
        >
          Pinned cards saved.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const isPinned = selected.includes(card.id);
          const pinIndex = selected.indexOf(card.id);
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => toggle(card.id)}
              className={cn(
                "group relative flex flex-col gap-2 rounded-md border-2 p-1.5 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
                isPinned
                  ? "border-primary bg-primary/10"
                  : "border-border/40 hover:border-border-strong",
              )}
              aria-pressed={isPinned}
              aria-label={`${isPinned ? "Unpin" : "Pin"} ${card.title}`}
            >
              <div className="relative">
                <BakedCardThumbnail
                  renderedImageUrl={card.rendered_image_url}
                  title={card.title}
                  previewData={{
                    title: card.title,
                    cost: card.cost,
                    cardType: card.card_type,
                    supertype: card.supertype,
                    subtypes: card.subtypes,
                    rarity: card.rarity,
                    colorIdentity: card.color_identity,
                    rulesText: card.rules_text,
                    flavorText: card.flavor_text,
                    power: card.power,
                    toughness: card.toughness,
                    loyalty: card.loyalty,
                    defense: card.defense,
                    artistCredit: card.artist_credit,
                    artUrl: card.art_url,
                    artPosition: card.art_position as ArtPosition,
                    frameStyle: card.frame_style as FrameStyle,
                    setIconUrl: card.set_icon_url,
                    setIconCode: card.set_icon_code,
                  }}
                />
                {isPinned ? (
                  <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center gap-1 rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground shadow">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    {pinIndex + 1}
                  </span>
                ) : (
                  <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-muted opacity-0 transition-opacity group-hover:opacity-100">
                    <Pin className="h-3.5 w-3.5" aria-hidden />
                  </span>
                )}
              </div>
              <span className="truncate text-xs font-medium text-foreground">
                {card.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
