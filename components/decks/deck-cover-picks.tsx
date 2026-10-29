"use client";

import { useId } from "react";
import { ArrowDown, ArrowUp, ImageMinus, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FEATURED_PICKS_MAX, type CoverPickRow } from "@/lib/decks/featured";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// "Feature on cover" (TODO DK6.4) — the owner's part of a deck entry's
// pop-up (DeckCardModal): pick the card for the deck's cover fan, take it
// off, or move it earlier / later among the picks, with the picks' order
// shown. Buttons, never a drag (WCAG 2.5.7). Every change sends the deck's
// WHOLE list, rank 1 first (setDeckCoverPicksAction → migration 0150's
// set_deck_featured_entries). The fan is commanders → picks → the seeded
// fill (lib/decks/featured.ts): a pick the fan can't show (a private card,
// one with no picture) stays picked and says so.
//
// Focus: the toggle is ONE button whose words change ("Feature on cover" ⇄
// "Remove from cover"), so the focus stays on it across the refresh; at an
// end of the list "Earlier" / "Later" are aria-disabled, never removed or
// `disabled` (a focused control that disappears drops the focus to <body>).
// The same holds on the commander zone and the maybeboard: the toggle stays,
// aria-disabled with no click handler and the board's note as its
// description — so "Remove from cover" on a pick that moved there leaves the
// focus on the same button once the refresh unpicks it.
// ---------------------------------------------------------------------------

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];

export function DeckCoverPicks({
  entryId,
  board,
  picks,
  shown,
  pending,
  onChange,
}: {
  entryId: string;
  board: string;
  /** The deck's picks, rank 1 first (coverPickRowsOf). */
  picks: readonly CoverPickRow[];
  /** Whether THIS entry can stand in the fan (standsInFan). */
  shown: boolean;
  pending: boolean;
  /** The deck's new list of picks, rank 1 first. */
  onChange: (entryIds: string[]) => void;
}) {
  const labelId = useId();
  const statusId = useId();
  const ids = picks.map((pick) => pick.entryId);
  const index = ids.indexOf(entryId);
  const picked = index >= 0;
  const full = !picked && ids.length >= FEATURED_PICKS_MAX;

  // The commander leads the fan by itself; the maybeboard isn't the deck.
  // An entry already picked there can still be taken off; one that isn't
  // keeps the toggle, off, its reason the board's note.
  const offBoard = board === "commander" || board === "maybe";
  const boardNote =
    board === "commander"
      ? "Commanders always lead the cover."
      : board === "maybe"
        ? "The maybeboard isn't shown on the cover."
        : null;
  const noPick = offBoard && !picked;

  const move = (by: -1 | 1) => {
    const next = [...ids];
    const to = index + by;
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  };
  const toggle = () => onChange(picked ? ids.filter((id) => id !== entryId) : [...ids, entryId]);
  const blocked = pending || full || noPick;

  const status = noPick
    ? boardNote
    : picked
      ? `On the cover — ${ORDINALS[index]} of ${ids.length} pick${ids.length === 1 ? "" : "s"}, after the commanders. ${boardNote ?? ""}`.trim()
      : full
        ? `${FEATURED_PICKS_MAX} cards are featured — remove one to feature this.`
        : ids.length > 0
          ? `${ids.length} of ${FEATURED_PICKS_MAX} cover picks used.`
          : `Pick up to ${FEATURED_PICKS_MAX} cards for the deck's cover; the rest are chosen for you.`;

  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2 rounded-md border border-border/50 bg-background/40 p-3">
      <span id={labelId} className="text-xs font-semibold uppercase tracking-wider text-subtle">
        Cover
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          key="toggle"
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={blocked || undefined}
          aria-describedby={statusId}
          onClick={blocked ? undefined : toggle}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          {picked ? <ImageMinus className="h-3.5 w-3.5" aria-hidden /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden />}
          {picked ? "Remove from cover" : "Feature on cover"}
        </Button>
        {picked && ids.length > 1 ? (
          <>
            <Button
              key="earlier"
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Move earlier on the cover"
              aria-disabled={pending || index === 0 || undefined}
              onClick={pending || index === 0 ? undefined : () => move(-1)}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              <ArrowUp className="h-3.5 w-3.5" aria-hidden /> Earlier
            </Button>
            <Button
              key="later"
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Move later on the cover"
              aria-disabled={pending || index === ids.length - 1 || undefined}
              onClick={pending || index === ids.length - 1 ? undefined : () => move(1)}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              <ArrowDown className="h-3.5 w-3.5" aria-hidden /> Later
            </Button>
          </>
        ) : null}
      </div>
      <p id={statusId} aria-live="polite" className="text-xs leading-5 text-muted">
        {status}
        {!noPick && (picked || !full) && !shown ? " This card can't be shown on the cover (a private card, or one with no picture) — the next card takes its place." : ""}
      </p>
      {ids.length > 0 ? (
        <ol aria-label="Cards on the cover, in order" className="flex flex-col gap-0.5 text-xs text-muted">
          {picks.map((pick, i) => (
            <li key={pick.entryId} className={cn("flex gap-1.5", pick.entryId === entryId && "font-semibold text-foreground")}>
              <span className="tabular-nums text-subtle">{i + 1}.</span>
              <span className="min-w-0 truncate">
                {pick.name}
                {pick.entryId === entryId ? <span className="sr-only"> (this card)</span> : null}
              </span>
              {pick.shown ? null : <span className="shrink-0 text-subtle">· not shown</span>}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
