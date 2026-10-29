"use client";

import { useId, useMemo, useState } from "react";
import { ChipGroup } from "@/components/ui/chip-group";
import { deckLibraryOf, defaultDrawPick, drawPickOptions } from "@/lib/decks/deck-charts";
import { deckRowsOf } from "@/lib/decks/deck-view";
import { cardOddsByTurn, formatOdds, hypergeometricAtLeast, landOddsTable, OPENING_HAND } from "@/lib/decks/draw-odds";
import { PRIVATE_CARD_NAME } from "@/lib/decks/private-card-name";
import type { DeckItem, DeckPageCard } from "@/lib/decks/queries";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Draw odds (TODO DK7.2): the chance of at least N lands by each turn, and
// of drawing a picked card by each turn — hypergeometric, over the
// MAINBOARD as a library (lib/decks/draw-odds.ts; a commander waits in the
// command zone), on the play or on the draw. Both are real tables — the
// numbers ARE the chart — each cell washed in chart-1 by its chance (a
// one-hue sequential scale into the surface; the text stays the
// foreground colour, readable at the deepest step in both themes). The
// cards a visitor reads are the page's own rows (publicDeckItems): a
// private card's title never reaches the picker.
// ---------------------------------------------------------------------------

const TURNS = 7;
const MAX_LANDS = 7;

/** A cell's wash: chart-1 into the surface by the chance (up to 42 %). */
function washStyle(odds: number) {
  const mix = Math.round(Math.min(1, Math.max(0, odds)) * 42);
  return mix > 0 ? { backgroundColor: `color-mix(in oklab, var(--color-chart-1) ${mix}%, transparent)` } : undefined;
}

const CELL = "px-0.5 py-1.5 text-center font-mono text-[11px] tabular-nums text-foreground sm:px-1 sm:text-xs";
const HEAD = "px-0.5 pb-1.5 text-center text-[11px] font-medium text-subtle sm:px-1 sm:text-xs";

export function DeckDrawOdds({
  items,
  canManage,
  multiplayer,
}: {
  items: DeckItem<DeckPageCard>[];
  canManage: boolean;
  /** A commander format: every player draws on turn one in multiplayer. */
  multiplayer: boolean;
}) {
  const [onThePlay, setOnThePlay] = useState<"play" | "draw">(multiplayer ? "draw" : "play");
  const library = useMemo(() => deckLibraryOf(deckRowsOf(items, canManage)), [items, canManage]);
  const librarySize = library.reduce((sum, card) => sum + card.quantity, 0);
  const lands = library.reduce((sum, card) => sum + (card.isLand ? card.quantity : 0), 0);
  const options = useMemo(() => drawPickOptions(library, PRIVATE_CARD_NAME), [library]);
  // The spell with the most copies first — the question a player asks most.
  const defaultPick = useMemo(() => defaultDrawPick(options)?.key ?? "", [options]);
  const [picked, setPicked] = useState<string>("");
  const pick = options.find((option) => option.key === (picked || defaultPick)) ?? null;
  const play = onThePlay === "play";
  const landRows = useMemo(() => landOddsTable(librarySize, lands, { turns: TURNS, maxLands: MAX_LANDS, onThePlay: play }), [librarySize, lands, play]);
  const cardRows = useMemo(
    () => (pick ? cardOddsByTurn(librarySize, pick.copies, { turns: TURNS, onThePlay: play }) : []),
    [librarySize, pick, play],
  );
  const selectId = useId();
  const landsCaptionId = useId();

  if (librarySize === 0) return null;
  const when = play ? "on the play" : "on the draw";

  return (
    <section
      aria-labelledby="deck-draw-odds-title"
      className="flex min-w-0 flex-col gap-5 rounded-card border border-border/70 bg-surface/80 p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="deck-draw-odds-title" className="text-sm font-semibold text-foreground">
            Draw odds
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted">
            {multiplayer
              ? `From the ${librarySize}-card mainboard (the commander waits in the command zone), for a kept opening seven. In multiplayer every player draws on their first turn.`
              : `From the ${librarySize}-card mainboard, for a kept opening seven.`}
          </p>
        </div>
        <ChipGroup
          ariaLabel="Turn order"
          options={[
            { value: "play", label: "On the play" },
            { value: "draw", label: "On the draw" },
          ]}
          value={onThePlay}
          onChange={setOnThePlay}
          keepCase
        />
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-subtle">Lands by turn</h4>
          {lands === 0 ? (
            // A table of zeros says nothing a sentence doesn't.
            <p className="text-xs leading-5 text-muted">No lands in the mainboard yet: the odds fill in as lands join it.</p>
          ) : (
            <>
              <p id={landsCaptionId} className="text-xs leading-5 text-muted">
                {`The chance of at least that many lands among the cards seen by each turn, ${when} — ${lands} land${lands === 1 ? "" : "s"} in the library. Outlined: a land for every turn so far.`}
              </p>
              <table className="w-full table-fixed border-separate border-spacing-[2px]" aria-describedby={landsCaptionId}>
                <caption className="sr-only">
                  Chance of at least 1 to {MAX_LANDS} lands by turn, {when}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={cn(HEAD, "w-[4.25rem] text-left sm:w-20")}>
                      Turn
                    </th>
                    {Array.from({ length: MAX_LANDS }, (_, i) => (
                      <th key={i} scope="col" className={HEAD}>
                        {i + 1}+<span className="sr-only"> lands</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {landRows.map((row) => (
                    <tr key={row.turn}>
                      <th scope="row" className="py-1 pr-1 text-left text-[11px] font-normal leading-tight text-foreground sm:text-xs">
                        Turn {row.turn}
                        <span className="block text-[10px] text-subtle">{row.seen} cards</span>
                      </th>
                      {row.odds.map((odds, i) => (
                        <td
                          key={i}
                          className={cn(CELL, "rounded-[3px]", i + 1 === row.turn && "outline outline-1 -outline-offset-1 outline-foreground/60")}
                          style={washStyle(odds)}
                        >
                          {formatOdds(odds)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-subtle">Drawing a card</h4>
          {options.length === 0 ? (
            <p className="text-xs leading-5 text-muted">No card here to pick.</p>
          ) : (
            <>
              <label htmlFor={selectId} className="text-xs leading-5 text-muted">
                The chance of at least one copy by each turn, {when}:
              </label>
              <select
                id={selectId}
                value={pick?.key ?? ""}
                onChange={(event) => setPicked(event.target.value)}
                className="h-9 w-full min-w-0 rounded-md border border-border bg-background/60 px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
              >
                {options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.name} ({option.copies} {option.copies === 1 ? "copy" : "copies"})
                  </option>
                ))}
              </select>
              {pick ? (
                <table className="mt-1 w-full table-fixed border-separate border-spacing-[2px]">
                  <caption className="sr-only">
                    Chance to draw {pick.name} by turn, {when}
                  </caption>
                  <thead>
                    <tr>
                      {cardRows.map((row) => (
                        <th key={row.turn} scope="col" className={HEAD}>
                          <span className="sr-only">Turn </span>
                          <span aria-hidden>T</span>
                          {row.turn}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {cardRows.map((row) => (
                        <td key={row.turn} className={cn(CELL, "rounded-[3px]")} style={washStyle(row.odds)}>
                          {formatOdds(row.odds)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              ) : null}
              {pick ? (
                <p className="text-xs leading-5 text-muted">
                  In the opening seven:{" "}
                  <span className="font-medium text-foreground">
                    {formatOdds(hypergeometricAtLeast(librarySize, pick.copies, Math.min(OPENING_HAND, librarySize), 1))}
                  </span>
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
