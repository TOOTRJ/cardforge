import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import { KpiRow, KpiTile, Section } from "@/components/admin/analytics/charts";
import { EventKpi, SignupsPerDayCard } from "@/components/admin/funnel-panel";
import {
  ANALYTICS_TABS,
  analyticsHref,
  analyticsPeriod,
  previousPeriodLabel,
  type AnalyticsParams,
  type AnalyticsTabId,
} from "@/lib/admin/analytics/params";
import { getOverviewSummary, type CurrencyRevenue, type OverviewSummary } from "@/lib/admin/analytics/overview";
import { formatMoney } from "@/lib/admin/analytics/series";

/**
 * /admin/analytics — the Overview tab, the page's front door: the headline
 * numbers of the period against the one before, signups per day, and where
 * to read more. It reads three small things at once
 * (lib/admin/analytics/overview.ts) and nothing else, so it stays the
 * fastest tab.
 */
export async function OverviewTab({ params }: { params: AnalyticsParams }) {
  const summary = await getOverviewSummary(analyticsPeriod(params.days), params.admins);
  if (!summary) return <AdminLoadError what="the overview" />;
  return <OverviewPanel summary={summary} params={params} />;
}

type OtherTab = Exclude<AnalyticsTabId, "overview">;
const isOtherTab = (id: AnalyticsTabId): id is OtherTab => id !== "overview";

/** What each of the other tabs holds, in a line. */
const TAB_GUIDE: Record<OtherTab, string> = {
  funnel: "How far new accounts get — first card, first AI generation, first download, trial, paid plan — where signups come from, and what each trial did.",
  revenue: "Money taken, by day and by product, with refunds and the latest payments.",
  credits: "AI credits: how many were given out and spent, and on what.",
  referrals: "Invitations: who invited whom, and which ones earned free days.",
  tools: "The beta tools: who opens them, what they do there and what goes wrong.",
  content: "Cards and decks: what gets made, who can see it, and what gets looked at.",
};

/** The Overview's drawing, from plain data (so it renders in a test). */
export function OverviewPanel({ summary, params }: { summary: OverviewSummary; params: AnalyticsParams }) {
  const days = params.days;
  return (
    <div className="flex flex-col gap-8">
      {summary.counts || summary.revenue ? (
        <KpiRow className="xl:grid-cols-4">
          {summary.counts ? (
            <>
              <EventKpi counts={summary.counts} event="signup" label="Signups" days={days} />
              <EventKpi counts={summary.counts} event="first_card_saved" label="Activated" days={days} hint="Saved a first card." />
              <EventKpi counts={summary.counts} event="trial_started" label="Trials started" days={days} />
              <EventKpi counts={summary.counts} event="trial_converted" label="Trials converted" days={days} hint="A trial that became a paid plan." />
              <EventKpi counts={summary.counts} event="card_saved" label="Cards saved" days={days} />
              <EventKpi counts={summary.counts} event="ai_generation" label="AI generations" days={days} />
              <EventKpi counts={summary.counts} event="download" label="Downloads" days={days} />
            </>
          ) : null}
          {summary.revenue?.map((revenue) => (
            <RevenueKpi key={revenue.currency} revenue={revenue} days={days} only={summary.revenue?.length === 1} />
          ))}
        </KpiRow>
      ) : null}
      {summary.counts ? null : <AdminLoadError what="the headline numbers" />}
      {summary.revenue ? null : <AdminLoadError what="the revenue" />}

      <Section title="New accounts">
        {summary.signups ? <SignupsPerDayCard signups={summary.signups} days={days} /> : <AdminLoadError what="the signups per day" />}
      </Section>

      <Section title="Read more">
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ANALYTICS_TABS.map((tab) =>
            isOtherTab(tab.id) ? (
              <li key={tab.id} className="min-w-0">
                <Link
                  href={analyticsHref(params, { tab: tab.id })}
                  scroll={false}
                  className="group flex h-full flex-col gap-1 rounded-card border border-border/70 bg-surface/70 p-4 hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    {tab.label}
                    <ArrowRight className="h-3.5 w-3.5 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                  <span className="text-xs leading-5 text-muted">{TAB_GUIDE[tab.id]}</span>
                </Link>
              </li>
            ) : null,
          )}
        </ul>
      </Section>
    </div>
  );
}

// Revenue against the previous period, both written as money.
function RevenueKpi({ revenue, days, only }: { revenue: CurrencyRevenue; days: number; only: boolean }) {
  return (
    <KpiTile
      label={only ? "Revenue" : `Revenue (${revenue.currency.toUpperCase()})`}
      value={formatMoney(revenue.currentCents, revenue.currency)}
      current={revenue.currentCents}
      previous={revenue.previousCents}
      previousLabel={previousPeriodLabel(days)}
      formatPrevious={(cents) => formatMoney(cents, revenue.currency)}
      hint="Money taken, before refunds (the Revenue tab shows what was given back). Counts everyone: the Include admins switch does not change it."
    />
  );
}
