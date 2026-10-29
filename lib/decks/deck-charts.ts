import {
  computeDeckAnalytics,
  curveSlotLabel,
  CURVE_SLOTS,
  manaValueSlot,
  TYPE_BUCKET_PLURALS,
  TYPE_BUCKETS,
  type DeckAnalytics,
  type TypeBucket,
} from "@/lib/decks/analytics";
import {
  DECK_RARITY_KEYS,
  deckRarityKey,
  deckRarityLabel,
  deckRowsOf,
  type DeckRarityKey,
  type DeckRow,
  type ViewItem,
} from "@/lib/decks/deck-view";
import { keywordFrequency, type KeywordFrequency } from "@/lib/decks/keyword-frequency";
import { publicDeckItems } from "@/lib/decks/private-card-name";
import { COLOR_IDENTITY_LABELS, COLOR_LETTER_IDENTITY, type ColorLetter } from "@/types/card";
import type { DeckCardEntry } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck breakdown's charts (TODO DK7.1 / DK7.3) — pure, over the deck's
// rows as the list builds them (deckRowsOf: each entry's EFFECTIVE fields,
// its rarity by effectiveEntryRarity), so a bar on the curve and the cards
// it filters the list to are one set. The DECK is every board but the
// maybeboard, a scratchpad that never counts (computeDeckAnalytics' rule:
// the curve here adds up to its curve, card for card); the LIBRARY the draw
// odds and the sample hand shuffle is the mainboard alone (deckLibraryOf).
//
//   * the curve: nonland cards with a mana value, 0 … 6 and 7+
//     (manaValueSlot), each column split into creatures and other spells,
//     with the entry ids it counts (the list's filter);
//   * average and median mana value over the same cards — lands left out,
//     as the curve leaves them;
//   * colour: the coloured symbols in the costs against the mana SOURCES
//     of each colour (manaProduced);
//   * types, rarity (DECK_RARITY_KEYS) and the keywords (DK7.3).
// ---------------------------------------------------------------------------

/** The colours the colour chart counts, wheel order, colourless last. */
export const MANA_COLORS = ["W", "U", "B", "R", "G", "C"] as const satisfies readonly ColorLetter[];
export type ManaColor = (typeof MANA_COLORS)[number];

export function manaColorLabel(color: ManaColor): string {
  return COLOR_IDENTITY_LABELS[COLOR_LETTER_IDENTITY[color]];
}

const WUBRG: readonly ManaColor[] = ["W", "U", "B", "R", "G"];

/** The coloured symbols of a cost, per colour. A hybrid symbol counts for
 *  each colour it names ({R/G}: one red, one green — either pays it), a
 *  Phyrexian or two-generic hybrid for its colour ({G/P}, {2/W}); {C} is
 *  colourless mana a card asks for by name. Generic, X and snow ask for no
 *  colour. A split card's " // " cost reads both halves. */
export function costColorSymbols(cost: string | null | undefined): Record<ManaColor, number> {
  const out: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  if (!cost) return out;
  for (const match of cost.matchAll(/\{([^}]+)\}/g)) {
    const parts = new Set(match[1].toUpperCase().split("/"));
    for (const color of MANA_COLORS) if (parts.has(color)) out[color] += 1;
  }
  return out;
}

const BASIC_LAND_TYPES: Readonly<Record<string, ManaColor>> = {
  plains: "W",
  island: "U",
  swamp: "B",
  mountain: "R",
  forest: "G",
};

const ANY_COLOR = /\bany (?:one )?colou?r\b|\bany combination of colou?rs\b|\bchosen colou?r\b|\bmana of any type\b/i;

/**
 * The colours a card is a mana SOURCE of:
 *   * its rules text's "Add …" (any face whose text the card carries):
 *     each mana symbol it adds — {C} included — and every colour for "one
 *     mana of any color" (or of the chosen colour, any combination…);
 *   * a land's basic land types ("Land — Mountain Forest": red and green,
 *     the intrinsic {T}: Add of CR 305.6);
 *   * a land whose text says nothing (a printing — the page has no Oracle
 *     text — or a basic with none): the colours of its identity, which for
 *     a land are the mana its text adds.
 * A nonland card with no text to read is no source: the page can't know.
 */
export function manaProduced({
  typeLine,
  colors,
  texts,
}: {
  typeLine: string | null;
  colors: readonly string[];
  texts: ReadonlyArray<string | null | undefined>;
}): Set<ManaColor> {
  const out = new Set<ManaColor>();
  for (const text of texts) {
    if (!text) continue;
    for (const clause of text.matchAll(/\badd\b([^.\n]*)/gi)) {
      const words = clause[1];
      if (ANY_COLOR.test(words)) for (const color of WUBRG) out.add(color);
      const symbols = costColorSymbols(words);
      for (const color of MANA_COLORS) if (symbols[color] > 0) out.add(color);
    }
  }
  const front = (typeLine ?? "").split("//")[0];
  const isLand = /\bland\b/i.test(front);
  if (isLand) {
    const subtypes = front.split(/[—–]/)[1] ?? "";
    for (const word of subtypes.toLowerCase().split(/\s+/)) {
      const color = BASIC_LAND_TYPES[word];
      if (color) out.add(color);
    }
    if (out.size === 0) for (const color of colors) if ((WUBRG as readonly string[]).includes(color)) out.add(color as ManaColor);
  }
  return out;
}

export type CurveColumn = {
  slot: number;
  /** "0" … "6", "7+". */
  label: string;
  creatures: number;
  other: number;
  total: number;
  /** The entries this column counts — what a click filters the list to. */
  entryIds: string[];
};

export type ColorBalanceRow = {
  color: ManaColor;
  label: string;
  symbols: number;
  sources: number;
  /** This colour's share of the shown colours' symbols / sources (0–1). */
  symbolShare: number;
  sourceShare: number;
};

export type DeckCharts = {
  /** Cards in the deck (maybeboard out). */
  total: number;
  curve: CurveColumn[];
  /** Nonland cards with a mana value — the curve's cards. */
  curveCards: number;
  lands: number;
  /** Nonland cards with no cost to read: off the curve too. */
  noManaValue: number;
  averageManaValue: number | null;
  medianManaValue: number | null;
  colors: ColorBalanceRow[];
  types: Array<{ key: TypeBucket; label: string; count: number }>;
  rarity: Array<{ key: DeckRarityKey; label: string; count: number }>;
  keywords: KeywordFrequency;
};

/** The median of a quantity-weighted list of values (null when empty). */
export function weightedMedian(values: ReadonlyArray<{ value: number; quantity: number }>): number | null {
  const expanded = values.flatMap(({ value, quantity }) => Array.from({ length: Math.max(0, quantity) }, () => value));
  if (expanded.length === 0) return null;
  expanded.sort((a, b) => a - b);
  const middle = Math.floor(expanded.length / 2);
  return expanded.length % 2 === 1 ? expanded[middle] : (expanded[middle - 1] + expanded[middle]) / 2;
}

type TextCard = { rules_text?: string | null; back_face?: unknown };

/** The rules texts a card carries: its own and its second face's. */
export function cardTexts(card: TextCard | null | undefined): string[] {
  if (!card) return [];
  const back = card.back_face && typeof card.back_face === "object" ? (card.back_face as { rules_text?: unknown }).rules_text : null;
  return [card.rules_text, typeof back === "string" ? back : null].filter((text): text is string => Boolean(text?.trim()));
}

type ChartItem = ViewItem & { card: (ViewItem["card"] & TextCard) | null };

/** The breakdown's charts over the deck's items (read as the viewer may:
 *  the counts never name a card). */
export function computeDeckCharts(items: readonly ChartItem[]): DeckCharts {
  const rows = deckRowsOf(items, true).filter((row) => row.board !== "maybe");

  const curve: CurveColumn[] = Array.from({ length: CURVE_SLOTS }, (_, slot) => ({
    slot,
    label: curveSlotLabel(slot),
    creatures: 0,
    other: 0,
    total: 0,
    entryIds: [],
  }));
  const manaValues: Array<{ value: number; quantity: number }> = [];
  const typeCounts = new Map<TypeBucket, number>();
  const rarityCounts = new Map<DeckRarityKey, number>();
  const symbols: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const sources: Record<ManaColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let total = 0;
  let lands = 0;
  let noManaValue = 0;

  for (const row of rows) {
    const quantity = row.quantity;
    total += quantity;
    typeCounts.set(row.bucket, (typeCounts.get(row.bucket) ?? 0) + quantity);
    const rarity = deckRarityKey(row.rarity);
    rarityCounts.set(rarity, (rarityCounts.get(rarity) ?? 0) + quantity);

    const cost = costColorSymbols(row.fields.cost);
    for (const color of MANA_COLORS) symbols[color] += cost[color] * quantity;
    const card = row.item.card as (TextCard & ViewItem["card"]) | null;
    for (const color of manaProduced({ typeLine: row.fields.typeLine, colors: row.fields.colors, texts: cardTexts(card) })) {
      sources[color] += quantity;
    }

    if (row.bucket === "Land") {
      lands += quantity;
      continue;
    }
    const mv = row.fields.manaValue;
    if (mv === null) {
      noManaValue += quantity;
      continue;
    }
    const column = curve[manaValueSlot(mv)];
    if (row.bucket === "Creature") column.creatures += quantity;
    else column.other += quantity;
    column.total += quantity;
    column.entryIds.push(row.id);
    manaValues.push({ value: mv, quantity });
  }

  const curveCards = manaValues.reduce((sum, { quantity }) => sum + quantity, 0);
  const average = curveCards > 0 ? manaValues.reduce((sum, { value, quantity }) => sum + value * quantity, 0) / curveCards : null;

  // The colours the deck ASKS for; a deck that asks for none (colourless)
  // shows the colours it makes.
  let shown = MANA_COLORS.filter((color) => symbols[color] > 0);
  if (shown.length === 0) shown = WUBRG.filter((color) => sources[color] > 0);
  const symbolTotal = shown.reduce((sum, color) => sum + symbols[color], 0);
  const sourceTotal = shown.reduce((sum, color) => sum + sources[color], 0);

  return {
    total,
    curve,
    curveCards,
    lands,
    noManaValue,
    averageManaValue: average,
    medianManaValue: weightedMedian(manaValues),
    colors: shown.map((color) => ({
      color,
      label: manaColorLabel(color),
      symbols: symbols[color],
      sources: sources[color],
      symbolShare: symbolTotal > 0 ? symbols[color] / symbolTotal : 0,
      sourceShare: sourceTotal > 0 ? sources[color] / sourceTotal : 0,
    })),
    types: TYPE_BUCKETS.filter((bucket) => (typeCounts.get(bucket) ?? 0) > 0).map((bucket) => ({
      key: bucket,
      label: TYPE_BUCKET_PLURALS[bucket],
      count: typeCounts.get(bucket) ?? 0,
    })),
    rarity: DECK_RARITY_KEYS.filter((key) => (rarityCounts.get(key) ?? 0) > 0).map((key) => ({
      key,
      label: deckRarityLabel(key),
      count: rarityCounts.get(key) ?? 0,
    })),
    keywords: keywordFrequency(
      rows.filter((row) => row.item.card).map((row) => ({ texts: cardTexts(row.item.card as TextCard), quantity: row.quantity })),
    ),
  };
}

/**
 * The deck page's rows and counts as THIS viewer reads the deck: the items
 * through publicDeckItems (a visitor's private card with no printing has no
 * name and no type line), and the breakdown's analytics and charts over
 * those same items — so a visitor's curve, types and land count agree with
 * the list they see (a private planeswalker is "Other" in both, never
 * "Planeswalkers 1" beside a "Private card" tile). The owner's rows are
 * untouched.
 */
export function viewerDeckBreakdown<T extends ChartItem & { entry: DeckCardEntry }>(
  items: readonly T[],
  viewerIsOwner: boolean,
): { shownItems: T[]; analytics: DeckAnalytics; charts: DeckCharts } {
  const shownItems = publicDeckItems(items, viewerIsOwner);
  return { shownItems, analytics: computeDeckAnalytics(shownItems), charts: computeDeckCharts(shownItems) };
}

// ---------------------------------------------------------------------------
// The library (TODO DK7.2): what the draw odds and the sample hand shuffle.
// ---------------------------------------------------------------------------

export type LibraryCard = {
  id: string;
  quantity: number;
  /** The name the viewer may read (a visitor's private card: the real
   *  card's name its entry stands for, else "Private card"). */
  name: string;
  isLand: boolean;
};

/** The mainboard as a library — a commander waits in the command zone, a
 *  companion outside the game, the sideboard and maybeboard aside. */
export function deckLibraryOf<R extends Pick<DeckRow, "id" | "board" | "quantity" | "name" | "privateName" | "bucket">>(
  rows: readonly R[],
): LibraryCard[] {
  return rows
    .filter((row) => row.board === "main" && row.quantity > 0)
    .map((row) => ({ id: row.id, quantity: row.quantity, name: row.privateName ?? row.name, isLand: row.bucket === "Land" }));
}

/** The "chance to draw a card" picker's choices: one per NAME (a printing
 *  and its edited twin are copies of one card), by name. A visitor's
 *  private card with no real name behind it is left out — it can't be told
 *  from another. */
export function drawPickOptions(library: readonly LibraryCard[], privateName: string): DrawPickOption[] {
  const byName = new Map<string, DrawPickOption>();
  for (const card of library) {
    if (card.name === privateName) continue;
    const key = card.name.trim().toLowerCase();
    const option = byName.get(key) ?? { key, name: card.name, copies: 0, isLand: true };
    option.copies += card.quantity;
    option.isLand = option.isLand && card.isLand;
    byName.set(key, option);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
}

export type DrawPickOption = { key: string; name: string; copies: number; isLand: boolean };

/** The picker's first choice: the spell with the most copies (the lands
 *  have their own table), the first by name on a tie; a deck of lands
 *  alone starts on its first. */
export function defaultDrawPick(options: readonly DrawPickOption[]): DrawPickOption | null {
  const spells = options.filter((option) => !option.isLand);
  const pool = spells.length > 0 ? spells : options;
  return pool.reduce<DrawPickOption | null>((best, option) => (!best || option.copies > best.copies ? option : best), null);
}
