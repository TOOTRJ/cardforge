import { parseCost } from "@/lib/sets/analytics";
import type { DeckBoard, DeckCardEntry } from "@/types/deck";
import type { Card } from "@/types/card";

// ---------------------------------------------------------------------------
// Deck analytics — pure functions over deck entries (quantity-weighted, so
// 4× Lightning Bolt counts as 4 cards). Playable boards only; the
// maybeboard is a scratchpad and never counts toward totals or the curve.
// ---------------------------------------------------------------------------

export const PLAYABLE_BOARDS: readonly DeckBoard[] = [
  "commander",
  "companion",
  "main",
  "side",
];

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

const BUCKET_MATCH_ORDER: readonly Exclude<TypeBucket, "Other">[] = [
  "Creature",
  "Planeswalker",
  "Battle",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Land",
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

/** Mana value of an entry: the denormalized Scryfall value when present,
 *  otherwise parsed from the linked custom card's cost. */
export function entryManaValue(
  entry: Pick<DeckCardEntry, "mana_value" | "mana_cost">,
  card?: Pick<Card, "cost"> | null,
): number | null {
  if (entry.mana_value !== null && entry.mana_value !== undefined) {
    return entry.mana_value;
  }
  const fromEntryCost = parseCost(entry.mana_cost);
  if (fromEntryCost !== null) return fromEntryCost;
  return card ? parseCost(card.cost) : null;
}

export type DeckAnalytics = {
  /** Physical cards per board (quantities summed). */
  byBoard: Record<DeckBoard, number>;
  /** Physical cards across playable boards. */
  total: number;
  /** Entries with a linked custom proxy, quantity-weighted (playable boards). */
  remixed: number;
  /** Mana curve over playable non-land cards: indexes 0–6 are exact mana
   *  values, index 7 is "7+". Cards with unknown mana value are excluded. */
  curve: number[];
  /** WUBRG + colorless pip presence, quantity-weighted (playable boards).
   *  A multicolor card counts once per color in its identity. */
  byColor: Record<"W" | "U" | "B" | "R" | "G" | "C", number>;
  /** Cards per type bucket (playable boards). */
  byType: Record<TypeBucket, number>;
  lands: number;
  /** Average mana value across playable non-land cards with a known value. */
  averageManaValue: number | null;
};

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
  const curve = Array.from({ length: 8 }, () => 0);

  let total = 0;
  let remixed = 0;
  let lands = 0;
  let mvTotal = 0;
  let mvSample = 0;

  for (const { entry, card } of items) {
    byBoard[entry.board] += entry.quantity;
    if (entry.board === "maybe") continue;

    total += entry.quantity;
    if (entry.card_id) remixed += entry.quantity;

    const bucket = typeBucketFor(
      entry.type_line ?? (card ? [card.supertype, card.card_type].filter(Boolean).join(" ") : null),
    );
    byType[bucket] += entry.quantity;

    const colors =
      entry.color_identity.length > 0
        ? entry.color_identity
        : card
          ? card.color_identity
              .map((c) =>
                c === "white"
                  ? "W"
                  : c === "blue"
                    ? "U"
                    : c === "black"
                      ? "B"
                      : c === "red"
                        ? "R"
                        : c === "green"
                          ? "G"
                          : null,
              )
              .filter((c): c is "W" | "U" | "B" | "R" | "G" => c !== null)
          : [];
    if (colors.length === 0) {
      byColor.C += entry.quantity;
    } else {
      for (const color of colors) {
        if (color in byColor) {
          byColor[color as keyof typeof byColor] += entry.quantity;
        }
      }
    }

    if (bucket === "Land") {
      lands += entry.quantity;
      continue; // lands stay out of the curve + average, deck-site convention
    }

    const mv = entryManaValue(entry, card);
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
    remixed,
    curve,
    byColor,
    byType,
    lands,
    averageManaValue: mvSample > 0 ? mvTotal / mvSample : null,
  };
}
