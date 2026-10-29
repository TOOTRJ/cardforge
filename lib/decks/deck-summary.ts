import { statusRows, type DeckAnalytics } from "@/lib/decks/analytics";
import { deckSizeRule, formatHasCommander } from "@/lib/decks/format-rules";
import type { DeckEntryStatus, DeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck page's sticky summary bar (TODO DK5.9) as data: the count
// against the format's size, the commander, the composition (the four
// kinds of card), the average mana value and the lands — every number the
// deck's breakdown already says (computeDeckAnalytics, playable boards), so
// the bar and the breakdown never disagree. The format check's verdict and
// "Edit next" are the owner's and come from the page. Pure.
// ---------------------------------------------------------------------------

export type DeckSizeState =
  /** The format's exact size, or past its floor. */
  | "ok"
  | "short"
  | "over"
  /** The format sets no size (Casual). */
  | "free";

export type DeckSummary = {
  /** Cards counted toward the format's size: commander + companion-less
   *  mainboard (the number validateDeck checks). */
  size: number;
  /** "100" for Commander, "60+" for Standard, null for Casual. */
  target: string | null;
  sizeState: DeckSizeState;
  /** Commander formats only: the zone's cards by name (empty = none set). */
  commanders: string[] | null;
  composition: Array<{ status: DeckEntryStatus; count: number }>;
  averageManaValue: number | null;
  lands: number;
};

export function deckSummaryOf(
  format: DeckFormat,
  analytics: Pick<DeckAnalytics, "total" | "byBoard" | "byStatus" | "averageManaValue" | "lands">,
  /** The commander zone's names as the viewer's list shows them. */
  commanderNames: readonly string[],
): DeckSummary {
  // Companions live outside the deck proper; the sideboard is not the deck.
  const size = analytics.total - analytics.byBoard.side - analytics.byBoard.companion;
  const rule = deckSizeRule(format);
  const sizeState: DeckSizeState =
    rule.exact !== undefined
      ? size === rule.exact
        ? "ok"
        : size < rule.exact
          ? "short"
          : "over"
      : rule.min !== undefined
        ? size >= rule.min
          ? "ok"
          : "short"
        : "free";
  return {
    size,
    target: rule.exact !== undefined ? String(rule.exact) : rule.min !== undefined ? `${rule.min}+` : null,
    sizeState,
    commanders: formatHasCommander(format) ? [...commanderNames] : null,
    composition: statusRows(analytics),
    averageManaValue: analytics.averageManaValue,
    lands: analytics.lands,
  };
}
