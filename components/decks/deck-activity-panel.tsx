"use client";

import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Lock, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chip-group";
import { DeckChartCard } from "@/components/decks/deck-chart-card";
import { DataTable } from "@/components/decks/deck-chart-parts";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { getDeckActivityAction } from "@/lib/decks/activity-actions";
import {
  ACTIVITY_METRIC_LABELS,
  ACTIVITY_METRICS,
  ACTIVITY_PERIODS,
  activityChangeLabel,
  activityChangeSentence,
  bucketLabel,
  countNoun,
  DEFAULT_ACTIVITY_PERIOD,
  type ActivityPeriod,
  type ActivitySeries,
  type DeckActivity,
} from "@/lib/decks/deck-activity";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Deck activity (TODO DK7.4) — the OWNER's views and likes over 7 / 30 / 90
// days, Pro. Mounted only on the owner's page (DeckActivitySlot); a visitor
// never gets it. The numbers come from getDeckActivityAction, which checks
// the plan itself — `canView` only picks what is drawn first:
//   * Pro (an admin, or billing off, counts): a period switch, a total per
//     series with its change on the period before, and one bar chart per
//     series (two measures, two charts — never a shared axis) with its table
//     twin (DeckChartCard);
//   * anyone else: a locked preview — a sample chart, hidden from assistive
//     tech and marked as a sample — and an upgrade button that opens the
//     upgrade modal (its `upgrade_modal_open` funnel row, surface
//     "deck_activity").
// The charts follow the breakdown's marks: one series in chart-1, thin bars
// from one baseline with a 4 px round end, numbers in text colours, a
// tooltip per bar (aria-hidden: the table twin holds the same numbers).
// ---------------------------------------------------------------------------

export const DECK_ACTIVITY_HEADING_ID = "deck-activity-title";

type Load =
  | { state: "loading" }
  | { state: "ready"; activity: DeckActivity }
  | { state: "error"; message: string };

const PERIOD_OPTIONS = ACTIVITY_PERIODS.map((days) => ({ value: String(days), label: `${days} days` }));

export function DeckActivityPanel({
  deckId,
  canView,
  isPrivate,
}: {
  deckId: string;
  canView: boolean;
  isPrivate: boolean;
}) {
  return (
    <section aria-labelledby={DECK_ACTIVITY_HEADING_ID} className="mt-14 flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-1 border-b border-gold/20 pb-4">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">Only you see this · Pro</span>
        <h2 id={DECK_ACTIVITY_HEADING_ID} className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Deck activity
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted">
          How many people opened this deck and liked it, day by day, against the period before.
        </p>
      </div>
      {canView ? <ActivityBody deckId={deckId} isPrivate={isPrivate} /> : <LockedPreview />}
    </section>
  );
}

function ActivityBody({ deckId, isPrivate }: { deckId: string; isPrivate: boolean }) {
  const [days, setDays] = useState<ActivityPeriod>(DEFAULT_ACTIVITY_PERIOD);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let live = true;
    getDeckActivityAction(deckId, days)
      .then((result) => {
        if (!live) return;
        if (result.ok) setLoad({ state: "ready", activity: result.activity });
        else
          setLoad({
            state: "error",
            message:
              result.error === "not_pro"
                ? "Deck activity is part of Pro."
                : "Couldn't load this deck's activity. Try again in a moment.",
          });
      })
      .catch(() => {
        if (live) setLoad({ state: "error", message: "Couldn't load this deck's activity. Try again in a moment." });
      });
    return () => {
      live = false;
    };
  }, [deckId, days]);

  const activity = load.state === "ready" ? load.activity : null;
  // A period switch keeps the last numbers on screen until the new ones land.
  const stale = activity !== null && activity.days !== days;
  const nothingYet =
    activity !== null &&
    ACTIVITY_METRICS.every((metric) => activity[metric].total === 0 && activity[metric].previousTotal === 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChipGroup
          ariaLabel="Period"
          size="sm"
          keepCase
          options={PERIOD_OPTIONS}
          value={String(days)}
          onChange={(next) => {
            setDays(Number(next) as ActivityPeriod);
            setLoad((previous) => (previous.state === "ready" ? previous : { state: "loading" }));
          }}
        />
        <p className="text-xs text-subtle" aria-live="polite">
          {load.state === "loading" || stale ? "Loading…" : activity ? `Last ${activity.days} days, UTC.` : ""}
        </p>
      </div>

      {load.state === "error" ? (
        <p role="alert" className="rounded-md border border-border bg-background/40 px-4 py-3 text-sm text-muted">
          {load.message}
        </p>
      ) : null}

      {activity ? (
        <div className={cn("flex flex-col gap-5 transition-opacity", stale && "opacity-60")}>
          {nothingYet ? (
            <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm leading-6 text-muted">
              {isPrivate
                ? "This deck is private, so only you can open it — views count once it's unlisted or public. Likes show up here as people give them."
                : `No views or likes in the last ${activity.days * 2} days yet. Share the deck's link and they'll show up here, one view per person a day.`}
            </p>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
            {ACTIVITY_METRICS.map((metric) => (
              <StatTile key={metric} series={activity[metric]} />
            ))}
          </dl>
          <div className="grid gap-5 lg:grid-cols-2">
            {ACTIVITY_METRICS.map((metric) => (
              <SeriesChart key={metric} series={activity[metric]} />
            ))}
          </div>
          <p className="text-xs leading-5 text-subtle">
            A view counts once per person per day, never your own. Likes count on the day they were given; a removed
            like leaves the count.
          </p>
        </div>
      ) : load.state === "loading" ? (
        <div aria-hidden className="h-72 rounded-card border border-border/40 bg-surface/40" />
      ) : null}
    </div>
  );
}

function StatTile({ series }: { series: ActivitySeries }) {
  const { title } = ACTIVITY_METRIC_LABELS[series.metric];
  const change = series.change;
  const Icon =
    change.kind === "change" && change.delta > 0
      ? ArrowUpRight
      : change.kind === "change" && change.delta < 0
        ? ArrowDownRight
        : change.kind === "new"
          ? ArrowUpRight
          : change.kind === "change"
            ? Minus
            : null;
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border/70 bg-surface/80 px-4 py-3">
      <dt className="text-xs font-medium text-muted">{title}</dt>
      <dd className="font-mono text-2xl font-semibold tabular-nums text-foreground">{series.total}</dd>
      <dd className="flex items-center gap-1 text-xs text-muted">
        {Icon ? <Icon aria-hidden className="h-3.5 w-3.5" /> : null}
        <span aria-hidden>
          {activityChangeLabel(change)}
          <span className="text-subtle"> vs previous {series.days} days</span>
        </span>
        <span className="sr-only">{activityChangeSentence(change, series.previousTotal, series.days)}</span>
      </dd>
    </div>
  );
}

/** One series' table twin. */
export function ActivityTable({ series }: { series: ActivitySeries }) {
  const { title } = ACTIVITY_METRIC_LABELS[series.metric];
  return (
    <DataTable
      caption={`${title} ${series.bucketDays === 7 ? "per week" : "per day"}, last ${series.days} days`}
      columns={[series.bucketDays === 7 ? "Week" : "Day", title]}
      rows={series.buckets.map((bucket) => ({ key: bucket.start, cells: [bucketLabel(bucket), bucket.count] }))}
    />
  );
}

function SeriesChart({ series }: { series: ActivitySeries }) {
  const { title, many } = ACTIVITY_METRIC_LABELS[series.metric];
  const per = series.bucketDays === 7 ? "per week" : "per day";
  return (
    <DeckChartCard
      title={title}
      description={`${countNoun(series.metric, series.total)} in the last ${series.days} days, ${per}.`}
      chart={
        series.total === 0 ? (
          <p className="flex h-40 items-center justify-center rounded-md border border-dashed border-border text-xs text-subtle">
            No {many} in these {series.days} days.
          </p>
        ) : (
          <ActivityBars series={series} />
        )
      }
      table={<ActivityTable series={series} />}
    />
  );
}

function ActivityBars({ series }: { series: ActivitySeries }) {
  const max = series.buckets.reduce((m, bucket) => Math.max(m, bucket.count), 0);
  const first = series.buckets[0];
  const last = series.buckets[series.buckets.length - 1];
  const n = series.buckets.length;
  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex h-40 items-stretch">
        {/* The scale: one recessive line at the peak, its value at the left. */}
        <span className="pointer-events-none absolute inset-x-0 top-5 border-t border-dashed border-border/60" />
        <span className="pointer-events-none absolute left-0 top-0 font-mono text-[11px] tabular-nums text-subtle">{max}</span>
        {series.buckets.map((bucket, index) => {
          const height = max > 0 && bucket.count > 0 ? Math.max((bucket.count / max) * 100, 3) : 0;
          const side = index < n / 4 ? "left-0" : index > (n * 3) / 4 ? "right-0" : "left-1/2 -translate-x-1/2";
          return (
            <div key={bucket.start} className="group relative flex min-w-0 flex-1 items-end justify-center border-b border-border pt-5 hover:bg-foreground/[0.04]">
              <span className="flex h-full w-full items-end justify-center px-px">
                <span
                  className={cn("w-full rounded-t-[4px] bg-chart-1", n > 40 ? "max-w-1.5" : "max-w-2.5")}
                  style={{ height: `${height}%` }}
                />
              </span>
              <span
                className={cn(
                  "pointer-events-none absolute bottom-full z-20 mb-1 hidden w-max flex-col gap-0.5 rounded-md border border-border bg-elevated px-2.5 py-2 text-left text-xs shadow-lg group-hover:flex",
                  side,
                )}
              >
                <span className="font-semibold text-foreground">{countNoun(series.metric, bucket.count)}</span>
                <span className="text-subtle">{bucketLabel(bucket)}</span>
              </span>
            </div>
          );
        })}
      </div>
      {first && last ? (
        <div className="flex justify-between text-[11px] tabular-nums text-subtle">
          <span>{bucketLabel(first).split(" – ")[0]}</span>
          <span>{bucketLabel(last).split(" – ").pop()}</span>
        </div>
      ) : null}
    </div>
  );
}

/** A sample series for the locked preview — a shape, not anyone's numbers. */
const SAMPLE = [2, 3, 1, 4, 6, 5, 3, 7, 9, 6, 8, 11, 7, 9, 12, 10, 14, 9, 11, 13, 16, 12, 15, 18, 14, 17, 20, 16, 19, 22];

function LockedPreview() {
  const upgrade = useUpgradeModal();
  const max = Math.max(...SAMPLE);
  return (
    <div className="relative min-h-72 overflow-hidden rounded-card border border-border/70 bg-surface/80 p-4 sm:p-5">
      <div aria-hidden className="pointer-events-none select-none opacity-50 blur-[2px]">
        <div className="mb-4 grid max-w-md grid-cols-2 gap-3">
          {["Views", "Likes"].map((label) => (
            <div key={label} className="rounded-card border border-border/70 px-4 py-3">
              <div className="text-xs text-muted">{label}</div>
              <div className="font-mono text-2xl font-semibold text-foreground">··</div>
            </div>
          ))}
        </div>
        <div className="flex h-32 items-end gap-0 border-b border-border">
          {SAMPLE.map((value, index) => (
            <span key={index} className="flex flex-1 justify-center">
              <span className="w-full max-w-2.5 rounded-t-[4px] bg-chart-1" style={{ height: `${(value / max) * 8}rem` }} />
            </span>
          ))}
        </div>
      </div>
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-card border border-border bg-elevated/95 px-5 py-4 text-center shadow-lg">
          <Lock aria-hidden className="h-5 w-5 text-gold-strong" />
          <p className="text-sm leading-6 text-foreground">
            See this deck&rsquo;s views and likes over 7, 30 or 90 days, against the period before.
          </p>
          <p className="text-xs leading-5 text-muted">Deck activity is part of Pro. The chart behind this is a sample.</p>
          <Button size="sm" onClick={() => upgrade.open("deck_activity", "deck_activity")}>
            Upgrade to Pro
          </Button>
        </div>
      </div>
    </div>
  );
}
