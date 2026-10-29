import type { DeckAnalytics } from "@/lib/decks/analytics";
import { statusCountRows, type EntryBadge, type StatusFilter } from "@/lib/decks/deck-view";
import { deckSizeRule, formatHasCommander } from "@/lib/decks/format-rules";
import type { DeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// The deck page's sticky summary bar (TODO DK5.9) as data: the count
// against the format's size, the commander, the composition (each kind of
// card), the average mana value and the lands. The size, the average and
// the lands are the deck's breakdown's (computeDeckAnalytics, playable
// boards); the composition is THE status count the chips and the breakdown
// say too (deckStatusCountsOf, lib/decks/deck-view.ts) — so the bar, the
// chips and the breakdown never disagree. The format check's verdict and
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
  composition: Array<{ badge: EntryBadge; count: number }>;
  averageManaValue: number | null;
  lands: number;
};

export function deckSummaryOf(
  format: DeckFormat,
  analytics: Pick<DeckAnalytics, "total" | "byBoard" | "averageManaValue" | "lands">,
  /** The commander zone's names as the viewer's list shows them. */
  commanderNames: readonly string[],
  /** The deck's cards per badge (deckStatusCountsOf). */
  statusCounts: Record<StatusFilter, number>,
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
    composition: statusCountRows(statusCounts),
    averageManaValue: analytics.averageManaValue,
    lands: analytics.lands,
  };
}
