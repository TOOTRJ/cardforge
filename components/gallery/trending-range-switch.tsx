"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  isTrendingRange,
  TRENDING_RANGE_WORDS,
  TRENDING_RANGES,
  type TrendingRange,
} from "@/lib/cards/trending";

// ---------------------------------------------------------------------------
// The gallery's "Hot this week / month / year / all time" switch. /gallery is
// a static ISR landing that never reads searchParams, so every range's row is
// rendered on the SERVER (four cached reads, one ISR bake) and handed in as
// `panels`; this island only shows the picked one. Only the default range's
// tiles are in the HTML — the others ride the RSC payload and mount (their
// images load) when their tab is picked. The tabs activate on focus (the
// shared Tabs primitive): the APG's automatic activation, right here because
// every panel is already loaded.
// ---------------------------------------------------------------------------

export function TrendingRangeSwitch({
  headingId,
  eyebrow,
  description,
  panels,
  defaultRange,
}: {
  /** The id the server's <section aria-labelledby> names. */
  headingId: string;
  /** The section's eyebrow, rendered by the server (its classes live with
   *  the hero surface's). */
  eyebrow: ReactNode;
  description?: string;
  panels: Record<TrendingRange, ReactNode>;
  defaultRange: TrendingRange;
}) {
  const [range, setRange] = useState<TrendingRange>(defaultRange);
  return (
    <Tabs
      value={range}
      onValueChange={(next) => {
        if (isTrendingRange(next)) setRange(next);
      }}
    >
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          {eyebrow}
          <h2
            id={headingId}
            className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
          >
            {TRENDING_RANGE_WORDS[range].heading}
          </h2>
          {description ? <p className="max-w-2xl text-sm text-muted">{description}</p> : null}
        </div>
        <TabsList ariaLabel="Trending period" className="shrink-0 self-start md:self-auto">
          {TRENDING_RANGES.map((value) => (
            <TabsTrigger key={value} value={value} className="normal-case tracking-normal">
              {TRENDING_RANGE_WORDS[value].tab}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {TRENDING_RANGES.map((value) => (
        <TabsContent key={value} value={value}>
          {panels[value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
