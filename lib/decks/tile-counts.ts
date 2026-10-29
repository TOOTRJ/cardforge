// ---------------------------------------------------------------------------
// A deck TILE's card line (the "% proxied" replacement, TODO DK2.2): read
// off the stored counts (migration 0143 — never the deck's entry rows, which
// a page of tiles can't read past PostgREST's 1000-row cap). The stored
// counts know a card from a printing, not the five statuses (those need each
// card's fingerprint — the deck page's breakdown has them): "made on
// PipGlyph" is every entry that links a PipGlyph card, the deck owner's or
// another creator's (D3). Pure.
// ---------------------------------------------------------------------------

export type DeckTileCounts = {
  /** Physical cards, maybeboard left out (`decks.card_count`). */
  cards_count: number;
  /** Those whose entry links a PipGlyph card (`decks.linked_card_count`). */
  linked_count: number;
};

export function madeOnPipGlyph(deck: DeckTileCounts): {
  made: number;
  total: number;
  pct: number;
  /** "12 of 60 made on PipGlyph". */
  label: string;
} {
  const total = Math.max(0, deck.cards_count);
  const made = Math.min(Math.max(0, deck.linked_count), total);
  return {
    made,
    total,
    pct: total > 0 ? Math.round((made / total) * 100) : 0,
    label: `${made} of ${total} made on PipGlyph`,
  };
}
