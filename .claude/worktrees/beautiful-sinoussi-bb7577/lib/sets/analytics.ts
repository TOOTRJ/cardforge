import {
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
  type Card,
  type CardType,
  type ColorIdentity,
  type Rarity,
} from "@/types/card";

export type SetAnalytics = {
  total: number;
  byCardType: Record<CardType, number>;
  byRarity: Record<Rarity, number>;
  byColor: Record<ColorIdentity, number>;
  /** Average parseable mana value across cards that had a parseable cost. */
  averageCost: number | null;
  /** How many cards contributed to the averageCost calculation. */
  averageCostSampleSize: number;
};

/**
 * Parse a "fantasy cost" string like `{2}{R}{R}` into a numeric mana value.
 * Returns null when nothing parseable was found, so the caller can skip
 * variable-only costs ({X}, hybrid pips, etc.) when computing averages.
 *
 * Rules:
 *   - `{N}` where N is an integer → +N
 *   - `{W|U|B|R|G|C}` (single letter color/colorless) → +1
 *   - Anything else (e.g. `{X}`, `{W/U}` hybrids, `{2/W}` two-brid) → +0
 *     but still counts as a parseable token.
 */
export function parseCost(cost: string | null | undefined): number | null {
  if (!cost) return null;
  const tokens = Array.from(cost.matchAll(/\{([^}]+)\}/g));
  if (tokens.length === 0) {
    // Fall back: treat the entire string as a bare number if it's just digits.
    const bare = cost.trim();
    if (/^\d+$/.test(bare)) return Number(bare);
    return null;
  }
  let total = 0;
  for (const token of tokens) {
    const value = token[1];
    if (/^\d+$/.test(value)) {
      total += Number(value);
    } else if (/^[WUBRGC]$/i.test(value)) {
      total += 1;
    }
    // Hybrid, two-brid, {X}, etc. count as 0 but still register as parseable
    // tokens — they're explicit cost pieces the designer typed.
  }
  return total;
}

function emptyCounter<K extends string>(values: readonly K[]): Record<K, number> {
  const init = {} as Record<K, number>;
  for (const v of values) init[v] = 0;
  return init;
}

export function computeSetAnalytics(cards: Card[]): SetAnalytics {
  const byCardType = emptyCounter<CardType>(CARD_TYPE_VALUES);
  const byRarity = emptyCounter<Rarity>(RARITY_VALUES);
  const byColor = emptyCounter<ColorIdentity>(COLOR_IDENTITY_VALUES);

  let costTotal = 0;
  let costSample = 0;

  for (const card of cards) {
    if (card.card_type) byCardType[card.card_type] += 1;
    if (card.rarity) byRarity[card.rarity] += 1;

    if (card.color_identity.length === 0) {
      byColor.colorless += 1;
    } else if (card.color_identity.length > 1) {
      byColor.multicolor += 1;
      for (const color of card.color_identity) {
        if (color !== "multicolor" && color !== "colorless") {
          byColor[color] += 1;
        }
      }
    } else {
      const single = card.color_identity[0];
      byColor[single] += 1;
    }

    const parsed = parseCost(card.cost);
    if (parsed !== null) {
      costTotal += parsed;
      costSample += 1;
    }
  }

  return {
    total: cards.length,
    byCardType,
    byRarity,
    byColor,
    averageCost: costSample > 0 ? costTotal / costSample : null,
    averageCostSampleSize: costSample,
  };
}
