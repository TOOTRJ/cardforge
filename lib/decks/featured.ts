import { isStoredRenderUrl } from "@/lib/cards/render-cdn";
import { drawableMediaUrl } from "@/lib/media/media-urls";
import { stableDeckHash } from "@/lib/decks/cover";

// ---------------------------------------------------------------------------
// The cards a deck's hero (and its share image) fans out in front of the
// cover — TODO DK6.5, until DK6.4 stores the owner's picks. Pure.
//
// In order, up to FAN_MAX distinct cards:
//   1. the COMMANDERS (and partners), in the deck's order;
//   2. — DK6.4: the owner's "Feature on cover" picks slot in HERE, between
//      the commanders and the fill (deck_cards.featured_rank) —
//   3. a seeded shuffle (the deck id: the same fan on every visit) of the
//      deck's own PipGlyph cards with a stored bake thumbnail — the custom
//      work is what a deck shows off;
//   4. then a seeded shuffle of its real printings (basic lands left out).
//
// What may stand in the fan, for EVERY viewer alike (the owner sees what a
// visitor sees):
//   * a linked card only when it is readable and NOT private (a private card
//     is never drawn on a public surface, D11 — a visitor's RLS read has it
//     null, the owner's has it private: both skip it, and the entry's
//     printing is not drawn in its place) and only with its 600 px thumb
//     beside its bake (`isStoredRenderUrl`, checked against the card's own
//     object names) — never the HD PNG, never a live preview; a card
//     mid-save (pointers cleared) is left out;
//   * a printing only through `drawableMediaUrl("deck-card-image")`
//     (Scryfall's image host, migration 0127).
// The maybeboard is not the deck.
// ---------------------------------------------------------------------------

/** The most cards a fan shows. */
export const FAN_MAX = 5;

/** The card fields a fan reads (a `Card` has them all). */
export type FeaturableCard = {
  id: string;
  owner_id: string;
  title: string;
  visibility: string;
  rendered_image_url: string | null;
  rendered_thumb_url: string | null;
};

type FeaturableEntry = {
  id: string;
  board: string;
  name: string;
  position?: number | null;
  card_id: string | null;
  scryfall_id: string | null;
  image_url: string | null;
  type_line: string | null;
};

export type FeaturedCard<C extends FeaturableCard = FeaturableCard> =
  | { kind: "custom"; key: string; title: string; card: C }
  | { kind: "printing"; key: string; title: string; imageUrl: string };

/** mulberry32 — seeded, so a deck's fan is the same on every render. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates over a copy sorted by a stable key first, so the result
 *  depends on the deck and its entries — never on the order rows came in. */
function seededShuffle<T>(items: readonly T[], keyOf: (item: T) => string, random: () => number): T[] {
  const out = [...items].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const isBasicLand = (typeLine: string | null) => /\bBasic\b[^—]*\bLand\b/i.test(typeLine ?? "");

function asFeatured<C extends FeaturableCard>(entry: FeaturableEntry, card: C | null): FeaturedCard<C> | null {
  if (entry.card_id) {
    if (!card || card.visibility === "private") return null;
    const own = { ownerId: card.owner_id, cardId: card.id };
    if (!isStoredRenderUrl(card.rendered_image_url, own) || !isStoredRenderUrl(card.rendered_thumb_url, own)) {
      return null;
    }
    return { kind: "custom", key: `card:${card.id}`, title: card.title, card };
  }
  const imageUrl = drawableMediaUrl("deck-card-image", entry.image_url);
  if (!imageUrl) return null;
  return { kind: "printing", key: `print:${entry.scryfall_id ?? entry.name.toLowerCase()}`, title: entry.name, imageUrl };
}

export function featuredCardsOf<C extends FeaturableCard>(
  items: readonly { entry: FeaturableEntry; card: C | null }[],
  deckId: string,
  max: number = FAN_MAX,
): FeaturedCard<C>[] {
  const playable = items.filter((item) => item.entry.board !== "maybe");
  const random = seededRandom(stableDeckHash(deckId));
  const chosen: FeaturedCard<C>[] = [];
  const seen = new Set<string>();
  const take = (candidate: FeaturedCard<C> | null) => {
    if (!candidate || seen.has(candidate.key) || chosen.length >= max) return;
    seen.add(candidate.key);
    chosen.push(candidate);
  };

  const commanders = playable
    .filter((item) => item.entry.board === "commander")
    .sort((a, b) => (a.entry.position ?? 0) - (b.entry.position ?? 0));
  for (const { entry, card } of commanders) take(asFeatured(entry, card));

  // DK6.4: the owner's picks go here.

  const rest = playable.filter((item) => item.entry.board !== "commander");
  const customs = rest.filter((item) => item.entry.card_id);
  for (const { entry, card } of seededShuffle(customs, (item) => item.entry.id, random)) take(asFeatured(entry, card));

  const printings = rest.filter((item) => !item.entry.card_id && !isBasicLand(item.entry.type_line));
  for (const { entry, card } of seededShuffle(printings, (item) => item.entry.id, random)) take(asFeatured(entry, card));

  return chosen;
}
