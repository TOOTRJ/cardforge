"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { CardPreview } from "@/components/cards/card-preview";
import {
  addCardToSetAction,
  removeCardFromSetAction,
} from "@/lib/sets/actions";
import type { Card, ArtPosition, FrameStyle } from "@/types/card";
import type { SetItem } from "@/lib/sets/queries";
import { cn } from "@/lib/utils";

type SetCardManagerProps = {
  setId: string;
  setSlug: string;
  items: SetItem[];
  candidates: Card[];
};

export function SetCardManager({
  setId,
  setSlug,
  items,
  candidates,
}: SetCardManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleAdd = (cardId: string) => {
    setPendingId(cardId);
    startTransition(async () => {
      const result = await addCardToSetAction(setId, cardId);
      if (!result.ok) {
        toast.error(result.formError ?? "Could not add the card.");
      } else {
        toast.success("Added to set.");
        router.refresh();
      }
      setPendingId(null);
    });
  };

  const handleRemove = (cardId: string, title: string) => {
    setPendingId(cardId);
    startTransition(async () => {
      const result = await removeCardFromSetAction(setId, cardId);
      if (!result.ok) {
        toast.error(result.formError ?? "Could not remove the card.");
      } else {
        toast.success(`Removed “${title}” from set.`);
        router.refresh();
      }
      setPendingId(null);
    });
  };

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Cards in this set
          </h2>
          <p className="text-sm text-muted">
            {items.length === 0
              ? "No cards yet — pick some from your library below."
              : `${items.length} card${items.length === 1 ? "" : "s"} included.`}
          </p>
        </header>

        {items.length === 0 ? (
          <SurfaceCard className="flex items-center justify-center border-dashed p-8 text-center text-sm text-muted">
            Empty for now. Use the picker below to add your first card.
          </SurfaceCard>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map(({ card }) => (
              <div key={card.id} className="flex flex-col gap-2">
                <CardPreview
                  staticInEditor
                  title={card.title}
                  cost={card.cost}
                  cardType={card.card_type}
                  supertype={card.supertype}
                  subtypes={card.subtypes}
                  rarity={card.rarity}
                  colorIdentity={card.color_identity}
                  rulesText={card.rules_text}
                  flavorText={card.flavor_text}
                  power={card.power}
                  toughness={card.toughness}
                  loyalty={card.loyalty}
                  defense={card.defense}
                  artistCredit={card.artist_credit}
                  artUrl={card.art_url}
                  artPosition={card.art_position as ArtPosition}
                  frameStyle={card.frame_style as FrameStyle}
                />
                <div className="flex items-center justify-between gap-2 text-xs text-muted">
                  <span className="truncate">/{card.slug}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(card.id, card.title)}
                    disabled={isPending && pendingId === card.id}
                  >
                    {isPending && pendingId === card.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <X className="h-3.5 w-3.5" aria-hidden />
                    )}
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Add cards
          </h2>
          <p className="text-sm text-muted">
            Pick from cards you own that aren&apos;t already in this set.
          </p>
        </header>

        {candidates.length === 0 ? (
          <SurfaceCard className="flex flex-col items-center gap-3 border-dashed p-8 text-center text-sm text-muted">
            <p>
              No cards available — every card you own is already in this set, or
              you haven&apos;t forged any yet.
            </p>
          </SurfaceCard>
        ) : (
          <ul className="grid gap-2">
            {candidates.map((card) => (
              <li
                key={card.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border/70 bg-surface/60 px-3 py-2",
                  pendingId === card.id ? "opacity-70" : null,
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="h-12 w-9 shrink-0 overflow-hidden rounded-sm border border-border/40 bg-background">
                    {card.art_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={card.art_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[8px] uppercase tracking-wider text-subtle">
                        Art
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {card.title}
                    </span>
                    <span className="truncate text-xs text-muted">
                      {[card.card_type, card.rarity].filter(Boolean).join(" · ") ||
                        "Untyped"}
                    </span>
                  </div>
                  <Badge variant="outline" className="hidden sm:inline-flex">
                    {visibilityLabel(card.visibility)}
                  </Badge>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => handleAdd(card.id)}
                  disabled={isPending && pendingId === card.id}
                >
                  {isPending && pendingId === card.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-subtle">
          Set slug: <span className="font-mono">{setSlug}</span>
        </p>
      </section>
    </div>
  );
}

function visibilityLabel(visibility: string): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "unlisted":
      return "Unlisted";
    default:
      return "Private";
  }
}
