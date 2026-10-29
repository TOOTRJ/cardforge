"use client";

import { Layers, Plus } from "lucide-react";
import { inDecksLabel } from "@/lib/decks/membership-copy";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// A card's decks on a My Cards tile or row (TODO DK9.2): "In 2 decks" — the
// owner's own decks that hold it — or "Add to deck" when none does. Either
// way it opens the picker for that card (AddToDeckDialog). It sits OUTSIDE
// the tile's link / role="button" (CardTile's rule: no control inside the
// picture's own control). `count` null = the count couldn't be read: it
// says "Decks" and claims nothing.
// ---------------------------------------------------------------------------

export function DeckChipButton({
  count,
  title,
  onClick,
  className,
}: {
  count: number | null;
  title: string;
  onClick: () => void;
  className?: string;
}) {
  const inDecks = count === null ? null : inDecksLabel(count);
  const text = count === null ? "Decks" : (inDecks ?? "Add to deck");
  const name =
    count === null
      ? `Decks for ${title}`
      : inDecks
        ? `${inDecks} — change the decks for ${title}`
        : `Add ${title} to a deck`;
  const Icon = inDecks || count === null ? Layers : Plus;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={name}
      data-testid="deck-chip"
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
        inDecks
          ? "border-primary/40 bg-primary/10 text-foreground hover:border-primary/70"
          : "border-border/70 text-muted hover:border-border-strong hover:text-foreground",
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {text}
    </button>
  );
}
