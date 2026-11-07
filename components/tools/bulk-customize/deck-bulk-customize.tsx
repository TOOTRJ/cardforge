"use client";

import type { ViewRow } from "@/components/decks/deck-row-ui";
import { entryEditTarget } from "@/lib/decks/return-to";
import type { BulkSource } from "@/lib/tools/bulk-customize/model";
import { BulkCustomizeButton } from "./bulk-customize-button";

/**
 * The deck selection bar's Customize (the owner's, where they have the Bulk
 * Customize tool): the picked entries that stand for a REAL card — a
 * printing with no PipGlyph card linked yet — made the owner's own in one
 * batch, each new card linked onto its entry (the step's
 * linkDeckCardAction; never a write to the deck tables of its own). One
 * such entry opens the creator as the entry's own Customize does.
 */
export function DeckBulkCustomize({
  rows,
  deckSlug,
  onFinished,
}: {
  rows: ViewRow[];
  deckSlug: string;
  onFinished: () => void;
}) {
  const real = rows.filter((row) => row.item.entry.scryfall_id && !row.item.entry.card_id);
  const sources: BulkSource[] = real.map((row) => ({ kind: "deck_entry", id: row.item.entry.id }));
  const only = real.length === 1 ? real[0] : null;
  return (
    <BulkCustomizeButton
      sources={sources}
      oneCardHref={only ? entryEditTarget(only.item, deckSlug).href : null}
      surface="deck"
      onFinished={onFinished}
    />
  );
}
