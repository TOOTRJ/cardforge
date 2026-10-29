"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DECK_CARDS_HEADING_ID } from "@/lib/decks/deck-view";

// ---------------------------------------------------------------------------
// The mana curve's filter (TODO DK7.1): a bar of the breakdown's curve
// filters the deck list ABOVE it to that mana value. The two live in two
// sections of the deck page, so the page wraps both in this provider and
// each reads it:
//
//   * the curve (DeckManaCurve) calls `show` with its column — the list is
//     filtered to the column's entries (its own ids from computeDeckCharts,
//     handed to this provider by the page: what the bar counts is what the
//     list shows) and the reader is taken to the list's filter notice,
//     focus and all;
//   * the list (DeckCardList) draws that notice — the mana value, its
//     count, "Clear filter" (the focus to the Cards heading) and "Back to
//     the curve" (the focus to the bar that set it);
//   * the curve's own "Clear filter" keeps the reader on the curve.
//
// The focus moves AFTER the commit that draws its target (an effect here,
// which runs after the children's): the notice does not exist until the
// filter does. A list rendered without the provider has no curve filter.
// ---------------------------------------------------------------------------

export type CurveFilter = {
  slot: number;
  /** "3", "7+". */
  label: string;
  entryIds: readonly string[];
};

type FocusTarget = "notice" | "heading" | "curve";

type CurveFilterContext = {
  filter: CurveFilter | null;
  /** Filter the list to a column (its slot) and take the reader to it. */
  show: (slot: number) => void;
  /** Clear the filter; the focus to the Cards heading or the curve. */
  clear: (focus: "heading" | "curve") => void;
  /** Back to the curve: the focus on the bar that set the filter. */
  backToCurve: () => void;
};

const Context = createContext<CurveFilterContext | null>(null);

/** The list's filter notice (the focus lands there after a pick). */
export const CURVE_FILTER_NOTICE_ID = "deck-curve-filter-notice";
/** The curve's toolbar (the focus comes back to its picked bar). */
export const MANA_CURVE_ID = "deck-mana-curve";

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function focusTarget(target: FocusTarget, slot: number | null) {
  let element: HTMLElement | null = null;
  if (target === "notice") element = document.getElementById(CURVE_FILTER_NOTICE_ID);
  else if (target === "heading") element = document.getElementById(DECK_CARDS_HEADING_ID);
  else {
    const curve = document.getElementById(MANA_CURVE_ID);
    element =
      (slot !== null ? curve?.querySelector<HTMLElement>(`[data-curve-slot="${slot}"]`) : null) ??
      curve?.querySelector<HTMLElement>('[tabindex="0"]') ??
      null;
  }
  if (!element) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView?.({ block: target === "curve" ? "center" : "start", behavior: reducedMotion() ? "auto" : "smooth" });
}

export function DeckCurveFilterProvider({ curve, children }: { curve: readonly CurveFilter[]; children: ReactNode }) {
  // Only the picked COLUMN is state: its entries are read from the page's
  // latest curve, so an edit's refresh (a card removed, one added at that
  // mana value) never leaves the list on a stale set.
  const [slot, setSlot] = useState<number | null>(null);
  const filter = useMemo(() => (slot === null ? null : (curve.find((column) => column.slot === slot) ?? null)), [curve, slot]);
  // A focus move waiting for the commit that draws its target; `moves`
  // re-runs the effect for each one.
  const pending = useRef<{ target: FocusTarget; slot: number | null } | null>(null);
  const [moves, setMoves] = useState(0);

  useEffect(() => {
    const move = pending.current;
    if (!move) return;
    pending.current = null;
    focusTarget(move.target, move.slot);
  }, [moves]);

  const moveFocus = useCallback((target: FocusTarget, slot: number | null) => {
    pending.current = { target, slot };
    setMoves((n) => n + 1);
  }, []);
  const show = useCallback(
    (next: number) => {
      setSlot(next);
      moveFocus("notice", next);
    },
    [moveFocus],
  );
  const clear = useCallback(
    (focus: "heading" | "curve") => {
      moveFocus(focus, slot);
      setSlot(null);
    },
    [slot, moveFocus],
  );
  const backToCurve = useCallback(() => moveFocus("curve", slot), [slot, moveFocus]);

  const value = useMemo(() => ({ filter, show, clear, backToCurve }), [filter, show, clear, backToCurve]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The curve filter — null outside the provider (a list on its own). */
export function useDeckCurveFilter(): CurveFilterContext | null {
  return useContext(Context);
}
