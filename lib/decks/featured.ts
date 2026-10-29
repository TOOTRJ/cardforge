import { isStoredRenderUrl } from "@/lib/cards/render-cdn";
import { drawableMediaUrl } from "@/lib/media/media-urls";
import { stableDeckHash } from "@/lib/decks/cover";
import { canLinkIntoDeck } from "@/lib/decks/entry-status";

// ---------------------------------------------------------------------------
// The cards a deck's hero (and its share image, and its tiles) fans out in
// front of the cover — TODO DK6.5 / DK6.4. Pure.
//
// The fan aims for three and holds five: it fills every slot the deck can,
// and shows fewer only when the deck has fewer cards that may stand in it.
// In order, distinct cards:
//   1. the COMMANDERS (and partners), in the deck's order — always first;
//   2. the owner's "Feature on cover" picks (deck_cards.featured_rank,
//      migration 0151: up to five, 1 first) — by rank, whichever board
//      they are on but the maybeboard;
//   3. the fill, a seeded shuffle (the deck id: the same fan on every
//      visit) of the deck's own PipGlyph cards with a stored bake thumbnail
//      — the custom work is what a deck shows off —
//   4. then a seeded shuffle of its real printings (basic lands left out).
// A pick passes the same test as every other card below: a private one, or
// another creator's that isn't public, is left out for every viewer (the
// deck's owner too) and the next card takes its place.
//
// What may stand in the fan, for EVERY viewer alike (the owner sees what a
// visitor sees):
//   * another creator's card only while it is PUBLIC (owner decision D3,
//     canLinkIntoDeck — the rule listDeckCards reads by; an UNLISTED card is
//     readable by anyone through RLS, and never a deck's), and then it is
//     left out entirely, its printing included;
//   * a linked card only when it is readable and NOT private (a private card
//     is never drawn on a public surface, D11 — a visitor's RLS read has it
//     null, the owner's has it private: both skip the entry, and its
//     printing is not drawn in its place) and with its 600 px thumb beside
//     its bake (`isStoredRenderUrl`, checked against the card's own object
//     names) — never the HD PNG, never a live preview;
//   * a public linked card with no thumb yet (never baked, or mid-save with
//     its pointers cleared) stands in as the entry's printing when it has
//     one — what the deck list draws for it — else it is left out;
//   * a printing only through `drawableMediaUrl("deck-card-image")`
//     (Scryfall's image host, migration 0127).
// The maybeboard is not the deck. The share image asks for `printings:
// false`: it fills from the baked PipGlyph cards alone (never a scan baked
// into a PipGlyph image — app/(marketing)/deck/[slug]/opengraph-image.tsx).
// ---------------------------------------------------------------------------

/** The most cards a fan shows. */
export const FAN_MAX = 5;

/** The most cards an owner may feature (0151's CHECK: ranks 1–5). */
export const FEATURED_PICKS_MAX = 5;

/** A stored rank as the app reads it: 1–5, else none. */
export function featuredRankOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= FEATURED_PICKS_MAX
    ? value
    : null;
}

/** PostgREST's "no such column" (42703) for `featured_rank`: a database
 *  0151 has not reached. Its readers ask again without the column (the fan
 *  then has no picks). Remove once 0151 is on production and on dev. */
export function missingFeaturedRank(error: { code?: string | null; message?: string | null } | null): boolean {
  return error?.code === "42703" && (error.message ?? "").includes("featured_rank");
}

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
  /** The owner's pick (0151); absent on a database 0151 hasn't reached. */
  featured_rank?: number | null;
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

type Candidate<C extends FeaturableCard> = { entryId: string; typeLine: string | null; featured: FeaturedCard<C> };

/** True when the entry may stand in the deck page's fan at all (the
 *  header's rules) — the cover picker's "not shown on the cover" note. */
export function standsInFan<C extends FeaturableCard>(entry: FeaturableEntry, card: C | null, deckOwnerId: string): boolean {
  return entry.board !== "maybe" && asFeatured(entry, card, deckOwnerId) !== null;
}

/** The deck's picks, rank 1 first — every ranked entry, shown or not (the
 *  owner's list in the cover picker). */
export function coverPicksOf<E extends FeaturableEntry>(entries: readonly E[]): E[] {
  return entries
    .filter((entry) => featuredRankOf(entry.featured_rank) !== null)
    .sort((a, b) => featuredRankOf(a.featured_rank)! - featuredRankOf(b.featured_rank)!);
}

/** One of the owner's picks as the cover picker lists it. */
export type CoverPickRow = {
  entryId: string;
  /** The card's title (the owner reads their private cards), else the
   *  entry's name. */
  name: string;
  /** False when the fan skips it (private, another creator's no longer
   *  public, no picture, or on the maybeboard) — picked all the same. */
  shown: boolean;
};

/** The owner's picks, rank 1 first, for the deck card pop-up. */
export function coverPickRowsOf<C extends FeaturableCard>(
  items: readonly { entry: FeaturableEntry; card: C | null }[],
  deckOwnerId: string,
): CoverPickRow[] {
  const cardOf = new Map(items.map((item) => [item.entry.id, item.card]));
  return coverPicksOf(items.map((item) => item.entry)).map((entry) => {
    const card = cardOf.get(entry.id) ?? null;
    return { entryId: entry.id, name: card?.title ?? entry.name, shown: standsInFan(entry, card, deckOwnerId) };
  });
}

/** What an entry may stand in the fan as — its baked card, its printing,
 *  or nothing (the header's rules). */
function asFeatured<C extends FeaturableCard>(entry: FeaturableEntry, card: C | null, deckOwnerId: string): FeaturedCard<C> | null {
  if (entry.card_id) {
    if (!card || card.visibility === "private" || !canLinkIntoDeck(card, deckOwnerId)) return null;
    const own = { ownerId: card.owner_id, cardId: card.id };
    if (isStoredRenderUrl(card.rendered_image_url, own) && isStoredRenderUrl(card.rendered_thumb_url, own)) {
      return { kind: "custom", key: `card:${card.id}`, title: card.title, card };
    }
  }
  const imageUrl = drawableMediaUrl("deck-card-image", entry.image_url);
  if (!imageUrl) return null;
  return { kind: "printing", key: `print:${entry.scryfall_id ?? entry.name.toLowerCase()}`, title: entry.name, imageUrl };
}

export function featuredCardsOf<C extends FeaturableCard>(
  items: readonly { entry: FeaturableEntry; card: C | null }[],
  /** The deck: its id seeds the fill, its owner decides whose cards are
   *  its own (D3). */
  deck: { id: string; owner_id: string },
  options: {
    /** The most cards (FAN_MAX). */
    max?: number;
    /** false = baked PipGlyph cards only (the share image). */
    printings?: boolean;
  } = {},
): FeaturedCard<C>[] {
  const { max = FAN_MAX, printings = true } = options;
  const random = seededRandom(stableDeckHash(deck.id));
  const allowed = (featured: FeaturedCard<C> | null): featured is FeaturedCard<C> =>
    Boolean(featured) && (printings || featured!.kind === "custom");

  const playable = items.filter((item) => item.entry.board !== "maybe");
  const candidates = (rows: typeof playable): Candidate<C>[] =>
    rows.flatMap(({ entry, card }) => {
      const featured = asFeatured(entry, card, deck.owner_id);
      return allowed(featured) ? [{ entryId: entry.id, typeLine: entry.type_line, featured }] : [];
    });

  const chosen: FeaturedCard<C>[] = [];
  const seen = new Set<string>();
  const take = (list: readonly Candidate<C>[]) => {
    for (const { featured } of list) {
      if (chosen.length >= max) return;
      if (seen.has(featured.key)) continue;
      seen.add(featured.key);
      chosen.push(featured);
    }
  };

  // 1. The commanders, in the deck's order.
  take(
    candidates(
      playable
        .filter((item) => item.entry.board === "commander")
        .sort((a, b) => (a.entry.position ?? 0) - (b.entry.position ?? 0)),
    ),
  );

  // 2. The owner's picks, by rank.
  take(
    candidates(
      playable
        .filter((item) => featuredRankOf(item.entry.featured_rank) !== null)
        .sort((a, b) => featuredRankOf(a.entry.featured_rank)! - featuredRankOf(b.entry.featured_rank)!),
    ),
  );

  // 3–4. The fill: baked PipGlyph cards first, then printings.
  const rest = candidates(playable.filter((item) => item.entry.board !== "commander"));
  const byEntry = (candidate: Candidate<C>) => candidate.entryId;
  take(seededShuffle(rest.filter((c) => c.featured.kind === "custom"), byEntry, random));
  take(seededShuffle(rest.filter((c) => c.featured.kind === "printing" && !isBasicLand(c.typeLine)), byEntry, random));

  return chosen;
}
