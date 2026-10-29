import { DECK_ENTRY_STATUS_VALUES, type DeckBoard, type DeckCardEntry, type DeckEntryStatus } from "@/types/deck";
import type { Card } from "@/types/card";
import { effectiveEntryFields } from "@/lib/decks/effective-entry";
import { deckEntryStatus } from "@/lib/decks/entry-status";

// ---------------------------------------------------------------------------
// Deck analytics — pure functions over deck entries (quantity-weighted, so
// 4× Lightning Bolt counts as 4 cards). Playable boards only; the
// maybeboard is a scratchpad and never counts toward totals or the curve.
// ---------------------------------------------------------------------------

/** Type buckets in canonical deck-list display order. First matching word in
 *  the type line wins (an Artifact Creature is a creature, matching how deck
 *  sites group). */
export const TYPE_BUCKETS = [
  "Battle",
  "Planeswalker",
  "Creature",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Land",
  "Other",
] as const;

export type TypeBucket = (typeof TYPE_BUCKETS)[number];

/** A bucket's group heading in the deck list ("Sorceries", never
 *  "Sorcerys"). "Other" stays as it is. */
export const TYPE_BUCKET_PLURALS: Record<TypeBucket, string> = {
  Battle: "Battles",
  Planeswalker: "Planeswalkers",
  Creature: "Creatures",
  Instant: "Instants",
  Sorcery: "Sorceries",
  Artifact: "Artifacts",
  Enchantment: "Enchantments",
  Land: "Lands",
  Other: "Other",
};

// Creature still wins over everything (a Land Creature like Dryad Arbor is a
// creature on every deck site), but Land is matched BEFORE Artifact and
// Enchantment: "Artifact Land" / "Enchantment Land" are lands for curve and
// land-count purposes — with Land last they were bucketed as
// Artifact/Enchantment, so they entered the mana curve and vanished from
// the land count.
const BUCKET_MATCH_ORDER: readonly Exclude<TypeBucket, "Other">[] = [
  "Creature",
  "Planeswalker",
  "Battle",
  "Instant",
  "Sorcery",
  "Land",
  "Artifact",
  "Enchantment",
];

export function typeBucketFor(typeLine: string | null | undefined): TypeBucket {
  if (!typeLine) return "Other";
  // Only the front face of a split type line ("Creature — Human // Land").
  // Case-insensitive: Scryfall type lines are Title Case, but custom cards
  // store lowercase card_type values ("creature").
  const front = typeLine.split("//")[0].toLowerCase();
  for (const bucket of BUCKET_MATCH_ORDER) {
    if (front.includes(bucket.toLowerCase())) return bucket;
  }
  return "Other";
}

export type DeckAnalytics = {
  /** Physical cards per board (quantities summed). */
  byBoard: Record<DeckBoard, number>;
  /** Physical cards across playable boards. */
  total: number;
  /** Physical cards per entry status (deckEntryStatus, TODO DK2.6),
   *  playable boards — Imported / Edited / Remix / Original / Not found. */
  byStatus: Record<DeckEntryStatus, number>;
  /** Mana curve over playable non-land cards: indexes 0–6 are exact mana
   *  values, index 7 is "7+". Cards with unknown mana value are excluded. */
  curve: number[];
  /** WUBRG + colorless pip presence, quantity-weighted (playable boards).
   *  A multicolor card counts once per color in its identity. */
  byColor: Record<"W" | "U" | "B" | "R" | "G" | "C", number>;
  /** Gold cards, quantity-weighted (playable boards): every card of two or
   *  more colours (also counted once per colour in `byColor`), plus a custom
   *  card saved as only "multicolor", whose colours aren't named — counted
   *  here alone, never as colorless. */
  multicolor: number;
  /** Cards per type bucket (playable boards). */
  byType: Record<TypeBucket, number>;
  lands: number;
  /** Average mana value across playable non-land cards with a known value. */
  averageManaValue: number | null;
};

/** The deck's cards by status as a breakdown lists them (the deck page's
 *  "Card status", the report PDF): the four kinds of card always — a 0 is
 *  news too — and "Not found" only when the deck has one. */
export function statusRows(analytics: Pick<DeckAnalytics, "byStatus">): Array<{ status: DeckEntryStatus; count: number }> {
  return DECK_ENTRY_STATUS_VALUES.map((status) => ({ status, count: analytics.byStatus[status] })).filter(
    (row) => row.status !== "not_found" || row.count > 0,
  );
}

function emptyCounter<K extends string>(keys: readonly K[]): Record<K, number> {
  const init = {} as Record<K, number>;
  for (const key of keys) init[key] = 0;
  return init;
}

const COLOR_KEYS = ["W", "U", "B", "R", "G", "C"] as const;

export function computeDeckAnalytics(
  items: Array<{ entry: DeckCardEntry; card?: Card | null }>,
): DeckAnalytics {
  const byBoard = emptyCounter<DeckBoard>([
    "main",
    "side",
    "maybe",
    "commander",
    "companion",
  ]);
  const byColor = emptyCounter(COLOR_KEYS);
  const byType = emptyCounter(TYPE_BUCKETS);
  const byStatus = emptyCounter(DECK_ENTRY_STATUS_VALUES);
  const curve = Array.from({ length: 8 }, () => 0);

  let total = 0;
  let multicolor = 0;
  let lands = 0;
  let mvTotal = 0;
  let mvSample = 0;

  for (const { entry, card } of items) {
    byBoard[entry.board] += entry.quantity;
    if (entry.board === "maybe") continue;

    total += entry.quantity;
    // The entry's status and its effective fields (TODO DK2.6 / DK2.7): an
    // edited card counts as what it now is, an unchanged import as its
    // printing.
    const status = deckEntryStatus(entry, card);
    byStatus[status] += entry.quantity;
    const fields = effectiveEntryFields(entry, card, status);

    const bucket = typeBucketFor(fields.typeLine);
    byType[bucket] += entry.quantity;

    if (fields.colors.length === 0) {
      // A custom card saved as "multicolor" without naming its colours is
      // gold, not colorless.
      if (fields.multicolorOnly) {
        multicolor += entry.quantity;
      } else {
        byColor.C += entry.quantity;
      }
    } else {
      for (const color of fields.colors) byColor[color] += entry.quantity;
      if (new Set(fields.colors).size > 1) multicolor += entry.quantity;
    }

    if (bucket === "Land") {
      lands += entry.quantity;
      continue; // lands stay out of the curve + average, deck-site convention
    }

    const mv = fields.manaValue;
    if (mv !== null) {
      const slot = Math.min(Math.max(Math.floor(mv), 0), 7);
      curve[slot] += entry.quantity;
      mvTotal += mv * entry.quantity;
      mvSample += entry.quantity;
    }
  }

  return {
    byBoard,
    total,
    byStatus,
    curve,
    byColor,
    multicolor,
    byType,
    lands,
    averageManaValue: mvSample > 0 ? mvTotal / mvSample : null,
  };
}
