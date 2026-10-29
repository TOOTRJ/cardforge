"use client";

import { Layers } from "lucide-react";
import { NewDeckButton } from "@/components/decks/new-deck-provider";

// ---------------------------------------------------------------------------
// "Build a deck around this card" (TODO DK8.3) — the New deck dialog with the
// card as the deck's first entry (`openNewDeck({ cardId })`, #670):
// createDeckAction adds it once the deck exists — the card that leads its
// format into the commander zone (lib/decks/first-card.ts) — and a
// signed-out visitor keeps it through the sign-up round trip. Only where the
// card may join someone's deck: a PUBLIC card, or the viewer's own (owner
// decision D3) — the caller decides. Several sit on a row of tiles, so the
// name says which card (after the visible words, which a voice user says).
// ---------------------------------------------------------------------------

export function BuildDeckAroundButton({
  cardId,
  cardTitle,
  className,
  size = "sm",
}: {
  cardId: string;
  cardTitle: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <NewDeckButton cardId={cardId} variant="outline" size={size} className={className} icon={false}>
      <Layers aria-hidden />
      Build a deck around this card
      <span className="sr-only">: {cardTitle}</span>
    </NewDeckButton>
  );
}
