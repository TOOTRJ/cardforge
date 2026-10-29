import { DECK_ENTRY_STATUS_VALUES, type DeckBoard, type DeckCardEntry, type DeckEntryStatus } from "@/types/deck";
import { effectiveEntryFields, type EffectiveEntryCard } from "@/lib/decks/effective-entry";
import { deckEntryStatus } from "@/lib/decks/entry-status";

// ---------------------------------------------------------------------------
// Deck analytics — pure functions over deck entries (quantity-weighted, so
// 4× Lightning Bolt counts as 4 cards). Playable boards only; the
// maybeboard is a scratchpad and never counts toward totals or the curve.
// The curve, the average mana value, the types and the lands count the
// main deck and the commander alone (countsTowardDeckStats).
// ---------------------------------------------------------------------------

/** The boards the deck's stats read — the curve, the average and median
 *  mana value, the card types and the lands, here and in the breakdown's
 *  charts (lib/decks/deck-charts.ts): the main deck and the commander, as
 *  Moxfield and Archidekt count (owner 2026-10-29). Never the sideboard, the
 *  companion or the maybeboard. */
export function countsTowardDeckStats(board: DeckBoard): boolean {
  return board === "main" || board === "commander";
}

/** The cards those stats count (countsTowardDeckStats) — the deck's size
 *  the breakdown's "Deck size" says. */
export function deckStatCards(analytics: Pick<DeckAnalytics, "byBoard">): number {
  return analytics.byBoard.main + analytics.byBoard.commander;
}

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

/** The curve's columns: mana values 0–6, then "7+" (index 7). */
export const CURVE_SLOTS = 8;

/** A mana value's column on the curve — THE bucket the breakdown's curve,
 *  its click-to-filter (TODO DK7.1) and the list's "Group by mana value"
 *  all read, so a bar and the cards it filters to never disagree. A split
 *  card's value is already both halves' (effectiveEntryFields); a half
 *  mana (Un-sets) rounds down. */
export function manaValueSlot(manaValue: number): number {
  return Math.min(Math.max(Math.floor(manaValue), 0), CURVE_SLOTS - 1);
}

/** A curve column's label: "0" … "6", "7+". */
export function curveSlotLabel(slot: number): string {
  return slot >= CURVE_SLOTS - 1 ? `${CURVE_SLOTS - 1}+` : String(slot);
}

export type DeckAnalytics = {
  /** Physical cards per board (quantities summed). */
  byBoard: Record<DeckBoard, number>;
  /** Physical cards across playable boards. */
  total: number;
  /** Physical cards per entry status (deckEntryStatus, TODO DK2.6),
   *  playable boards — Imported / Edited / Remix / Original / Not found. */
  byStatus: Record<DeckEntryStatus, number>;
  /** Physical cards whose entry links a PipGlyph card (playable boards) —
   *  what `decks.linked_card_count` stores (0143), counted from the rows:
   *  the hero's "made on PipGlyph". */
  linked: number;
  /** Mana curve over the main deck's and the commander's non-land cards
   *  (countsTowardDeckStats): indexes 0–6 are exact mana values, index 7 is
   *  "7+". Cards with unknown mana value are excluded. */
  curve: number[];
  /** WUBRG + colorless pip presence, quantity-weighted (playable boards).
   *  A multicolor card counts once per color in its identity. */
  byColor: Record<"W" | "U" | "B" | "R" | "G" | "C", number>;
  /** Gold cards, quantity-weighted (playable boards): every card of two or
   *  more colours (also counted once per colour in `byColor`), plus a custom
   *  card saved as only "multicolor", whose colours aren't named — counted
   *  here alone, never as colorless. */
  multicolor: number;
  /** Cards per type bucket (the main deck and the commander). */
  byType: Record<TypeBucket, number>;
  /** Lands in the main deck and the commander. */
  lands: number;
  /** Average mana value across the main deck's and the commander's non-land
   *  cards with a known value. */
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
  items: Array<{ entry: DeckCardEntry; card?: EffectiveEntryCard | null }>,
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
  const curve = Array.from({ length: CURVE_SLOTS }, () => 0);

  let total = 0;
  let linked = 0;
  let multicolor = 0;
  let lands = 0;
  let mvTotal = 0;
  let mvSample = 0;

  for (const { entry, card } of items) {
    byBoard[entry.board] += entry.quantity;
    if (entry.board === "maybe") continue;

    total += entry.quantity;
    if (entry.card_id) linked += entry.quantity;
    // The entry's status and its effective fields (TODO DK2.6 / DK2.7): an
    // edited card counts as what it now is, an unchanged import as its
    // printing.
    const status = deckEntryStatus(entry, card);
    byStatus[status] += entry.quantity;
    const fields = effectiveEntryFields(entry, card, status);

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

    // The sideboard and a companion stop here: off the types, the lands,
    // the curve and the average (owner 2026-10-29).
    if (!countsTowardDeckStats(entry.board)) continue;
    const bucket = typeBucketFor(fields.typeLine);
    byType[bucket] += entry.quantity;

    if (bucket === "Land") {
      lands += entry.quantity;
      continue; // lands stay out of the curve + average, deck-site convention
    }

    const mv = fields.manaValue;
    if (mv !== null) {
      curve[manaValueSlot(mv)] += entry.quantity;
      mvTotal += mv * entry.quantity;
      mvSample += entry.quantity;
    }
  }

  return {
    byBoard,
    total,
    byStatus,
    linked,
    curve,
    byColor,
    multicolor,
    byType,
    lands,
    averageManaValue: mvSample > 0 ? mvTotal / mvSample : null,
  };
}
