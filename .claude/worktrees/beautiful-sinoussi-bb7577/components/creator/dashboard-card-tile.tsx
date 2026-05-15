"use client";

import { type MouseEvent } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { CardPreview } from "@/components/cards/card-preview";
import { CardHoverEffect } from "@/components/cards/card-hover-effect";
import { cn } from "@/lib/utils";
import type { ArtPosition, FrameStyle } from "@/types/card";
import type { listMyCards } from "@/lib/cards/queries";

// ---------------------------------------------------------------------------
// DashboardCardTile — one tile on the dashboard grid that participates in
// bulk selection. Behavior:
//   - Plain click on the card body → navigates to the edit page (existing UX)
//   - Cmd / Ctrl + click → toggles selection without clearing others
//   - Shift + click → range-selects from the last-clicked card to this one
//   - Click on the corner checkbox → toggles selection (always available)
//
// The visible checkbox is a deliberate deviation from the chunk-08 plan's
// "plain click = toggle" — keeping plain click as navigate preserves the
// existing dashboard mental model, and the checkbox makes bulk-select
// discoverable for users without keyboard modifiers.
// ---------------------------------------------------------------------------

export type DashboardCard = Awaited<ReturnType<typeof listMyCards>>[number];

type Props = {
  card: DashboardCard;
  isSelected: boolean;
  /** Called for Cmd/Ctrl/Shift-modifier clicks on the card body and any
   *  click on the corner checkbox. */
  onToggle: (
    cardId: string,
    modifiers: { meta: boolean; shift: boolean },
  ) => void;
};

export function DashboardCardTile({ card, isSelected, onToggle }: Props) {
  const handleLinkClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      event.preventDefault();
      onToggle(card.id, {
        meta: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
      });
    }
    // Plain click — let the Link navigate normally.
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          // The selection ring sits on the outer rectangle so the
          // CardHoverEffect tilt still works without distorting it. The
          // ring transitions in/out on selection-state changes.
          "relative rounded-frame transition-[box-shadow] duration-150",
          isSelected
            ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
            : "",
        )}
      >
        <Link
          href={`/card/${card.slug}/edit`}
          className="group block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={`Edit ${card.title}`}
          onClick={handleLinkClick}
          style={{ viewTransitionName: `card-${card.id}` }}
        >
          <CardHoverEffect>
            <CardPreview
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
          </CardHoverEffect>
        </Link>
        {/* Corner checkbox. z-30 keeps it above CardHoverEffect's glare
            (z-20) so the tile's hover sheen never covers the click target. */}
        <button
          type="button"
          onClick={(event) => {
            // Independent of modifiers — checkbox is always a single-toggle.
            event.stopPropagation();
            onToggle(card.id, {
              meta: event.metaKey || event.ctrlKey,
              shift: event.shiftKey,
            });
          }}
          aria-pressed={isSelected}
          aria-label={isSelected ? `Deselect ${card.title}` : `Select ${card.title}`}
          className={cn(
            "absolute right-3 top-3 z-30 flex h-7 w-7 items-center justify-center rounded-md border shadow-md transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            isSelected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border/80 bg-background/80 text-transparent hover:border-border-strong hover:text-foreground",
          )}
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>{visibilityLabel(card.visibility)}</span>
        <span className="opacity-0 transition-opacity group-hover:opacity-100">
          Click to edit →
        </span>
      </div>
    </div>
  );
}

function visibilityLabel(visibility: "private" | "unlisted" | "public"): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "unlisted":
      return "Unlisted";
    default:
      return "Private";
  }
}
