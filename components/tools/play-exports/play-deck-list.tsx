"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { inputClass } from "@/components/ui/field-classes";
import { cn } from "@/lib/utils";
import { PlayExportButton } from "./play-export-button";

export type PlayDeckRow = {
  id: string;
  title: string;
  format: string | null;
  cards: number;
  visibility: string;
};

/** Words for a deck's second line: "Commander · 100 cards · Private". */
function deckMeta(deck: PlayDeckRow): string {
  return [
    deck.format ? deck.format.charAt(0).toUpperCase() + deck.format.slice(1) : null,
    `${deck.cards} card${deck.cards === 1 ? "" : "s"}`,
    deck.visibility === "private" ? "Private" : deck.visibility === "unlisted" ? "Unlisted" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The tool page's decks: each with its own "Play online" (the same dialog a
 * deck page opens). A filter past six decks; an empty deck has nothing to
 * export and says so.
 */
export function PlayDeckList({ decks }: { decks: PlayDeckRow[] }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? decks.filter((deck) => deck.title.toLowerCase().includes(q)) : decks;
  }, [decks, query]);

  if (decks.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
        You have no decks yet. Pick cards in My Cards instead, or start a deck.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {decks.length > 6 ? (
        <label className="relative block">
          <span className="sr-only">Find a deck</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a deck"
            className={cn(inputClass(false), "pl-9")}
          />
        </label>
      ) : null}
      <ul className="flex max-h-[26rem] flex-col divide-y divide-border/50 overflow-y-auto rounded-lg border border-border/60" aria-label="Your decks">
        {shown.map((deck) => (
          <li key={deck.id} className="flex min-w-0 items-center gap-3 px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{deck.title}</span>
              <span className="block text-xs text-subtle">{deckMeta(deck)}</span>
            </span>
            <PlayExportButton
              source={{ kind: "deck", deckId: deck.id }}
              label={deck.title}
              nameSuffix={deck.title}
              disabledReason={deck.cards === 0 ? "This deck has no cards yet." : null}
            />
          </li>
        ))}
        {shown.length === 0 ? <li className="px-3 py-4 text-sm text-muted">No deck matches “{query}”.</li> : null}
      </ul>
    </div>
  );
}
