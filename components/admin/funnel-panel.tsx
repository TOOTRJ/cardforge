import Link from "next/link";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import {
  AnalyticsTable,
  ChartCard,
  DailyColumns,
  DailyTable,
  EmptyNote,
  KpiRow,
  KpiTile,
  RankedBars,
  RankedTable,
  Section,
  TablePanel,
  type RankedRow,
} from "@/components/admin/analytics/charts";
import { formatUtcDate } from "@/lib/format/dates";
import { periodLabel, previousPeriodLabel } from "@/lib/admin/analytics/params";
import { changeOf, changeText, formatCount, formatRate } from "@/lib/admin/analytics/series";
import {
  buildFunnel,
  type CohortStep,
  type FunnelCounts,
  type FunnelSummary,
  type SignupsDaily,
  type TrialEngagementRow,
} from "@/lib/admin/funnel-queries";
import type { FunnelEvent } from "@/lib/analytics/funnel-events";
import { ctaSurfaceLabel } from "@/lib/marketing/create-cta";

// ---------------------------------------------------------------------------
// The Funnel tab of /admin/analytics, drawn from a FunnelSummary
// (lib/admin/funnel-queries.ts) for the page's period. Server components,
// no data read here: the tab reads, this draws — so it renders in a test
// from plain data.
//
// Top to bottom: the four headline numbers against the previous period; the
// COHORT (the people who signed up in the period and how far they have
// come — the only place a share of signups is shown); signups per day and
// by how the account was made; every step's count beside the previous
// period's; where signups came from; each trial over its own length; why
// plans ended; visitors' screen widths.
//
// There is no "Rate" column: a step's event count over the step before's
// compares different people (the 2026-11 analytics audit).
// A block whose read failed says so (AdminLoadError) — never zeros.
// ---------------------------------------------------------------------------

const TRIAL_ROW_LIMIT = 200;

/** One event's count in this period and the one before. */
export function eventCount(counts: { current: FunnelCounts; previous: FunnelCounts }, event: FunnelEvent) {
  return { current: counts.current[event]?.n ?? 0, previous: counts.previous[event]?.n ?? 0 };
}

/** A headline tile for one event's count against the previous period. */
export function EventKpi({
  counts,
  event,
  label,
  days,
  hint,
}: {
  counts: { current: FunnelCounts; previous: FunnelCounts };
  event: FunnelEvent;
  label: string;
  days: number;
  hint?: string;
}) {
  const { current, previous } = eventCount(counts, event);
  return (
    <KpiTile
      label={label}
      value={formatCount(current)}
      current={current}
      previous={previous}
      previousLabel={previousPeriodLabel(days)}
      hint={hint}
    />
  );
}

/** "Signups per day" — the Funnel tab's and the Overview's one chart of it. */
export function SignupsPerDayCard({ signups, days }: { signups: SignupsDaily; days: number }) {
  return (
    <ChartCard
      title="Signups per day"
      description={`${formatCount(signups.total)} new ${signups.total === 1 ? "account" : "accounts"} in ${periodLabel(days)}.`}
      chart={<DailyColumns points={signups.points} unit={["signup", "signups"]} />}
      table={<DailyTable points={signups.points} caption={`Signups per day, ${periodLabel(days)}`} column="Signups" />}
    />
  );
}

export function FunnelPanel({ summary, days }: { summary: FunnelSummary; days: number }) {
  return (
    <div className="flex flex-col gap-8">
      {summary.counts ? (
        <KpiRow className="xl:grid-cols-4">
          <EventKpi counts={summary.counts} event="signup" label="Signups" days={days} />
          <EventKpi counts={summary.counts} event="first_card_saved" label="Activated" days={days} hint="Saved a first card." />
          <EventKpi counts={summary.counts} event="trial_started" label="Trials started" days={days} />
          <EventKpi counts={summary.counts} event="trial_converted" label="Trials converted" days={days} hint="A trial that became a paid plan." />
        </KpiRow>
      ) : (
        <AdminLoadError what="the headline numbers" />
      )}

      <Section title="New accounts">
        {summary.cohort ? <CohortCard cohort={summary.cohort} days={days} /> : <AdminLoadError what="how far new accounts have come" />}
        {summary.signups ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SignupsPerDayCard signups={summary.signups} days={days} />
            <SignupMethodsCard signups={summary.signups} days={days} />
          </div>
        ) : (
          <AdminLoadError what="the signups per day" />
        )}
      </Section>

      <Section
        title="Every step, this period and the one before"
        description={`How often each step happened in ${periodLabel(days)} and in ${previousPeriodLabel(days)}. People is how many different signed-in people did it this period; a step visitors take before they have an account has none. These are counts only: for how many of the same people got from one step to the next, read the chart above.`}
      >
        {summary.counts ? <StepTables counts={summary.counts} /> : <AdminLoadError what="the step counts" />}
      </Section>

      <Section title="Where signups came from" description={`Accounts made in ${periodLabel(days)}.`}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          <TablePanel
            title="Signups by source"
            description="The campaign tag a visitor arrived with, else the site that linked here, else direct. Not recorded: an account whose arrival was never written down."
          >
            {summary.failed.signups ? (
              <AdminLoadError what="the signups by source" />
            ) : summary.signupSources.length === 0 ? (
              <EmptyNote>No signups in this period.</EmptyNote>
            ) : (
              <AnalyticsTable
                caption="Signups by source"
                columns={["Source", "Signups"]}
                rows={summary.signupSources.map((row) => ({ key: row.source, cells: [row.source, formatCount(row.n)] }))}
              />
            )}
          </TablePanel>
          <TablePanel title="Signups by last create button pressed" description="The last Make a card button a visitor pressed before signing up.">
            {summary.failed.signups ? (
              <AdminLoadError what="the signups by create button" />
            ) : summary.signupSurfaces.length === 0 ? (
              <EmptyNote>No signups in this period.</EmptyNote>
            ) : (
              <AnalyticsTable
                caption="Signups by last create button pressed"
                columns={["Button", "Signups"]}
                rows={summary.signupSurfaces.map((row) => ({ key: row.surface, cells: [ctaSurfaceLabel(row.surface), formatCount(row.n)] }))}
              />
            )}
          </TablePanel>
          {/* A guest's card through sign-up (TODO HM3). */}
          <TablePanel title="Guest creator cards" description="Visitors who made a card before they had an account.">
            {summary.failed.signups ? (
              <AdminLoadError what="the guest creator cards" />
            ) : (
              <div data-testid="funnel-guest-card">
                <AnalyticsTable
                  caption="Guest creator cards"
                  columns={["What happened", "Count"]}
                  rows={[
                    { key: "signups", cells: ["Signups with a guest card waiting", formatCount(summary.guestCard.signups)] },
                    {
                      key: "first-saves",
                      cells: [
                        "First cards saved from a guest card",
                        summary.guestCard.firstCardsSaved == null ? "—" : formatCount(summary.guestCard.firstCardsSaved),
                      ],
                    },
                  ]}
                />
                {summary.guestCard.firstCardsSaved == null ? <AdminLoadError what="the first cards saved from a guest card" className="mt-3" /> : null}
              </div>
            )}
          </TablePanel>
        </div>
      </Section>

      <Section title="Trials and cancellations">
        <TrialEngagement trials={summary.trials} days={days} />
        <TablePanel
          title="Cancellations by reason"
          description={`Plans that ended in ${periodLabel(days)}, by the reason the customer gave when cancelling (or Stripe's own reason when they gave none).`}
        >
          {summary.failed.cancellations ? (
            <AdminLoadError what="the cancellations by reason" />
          ) : summary.cancelReasons.length === 0 ? (
            <EmptyNote>No plan ended in this period.</EmptyNote>
          ) : (
            <AnalyticsTable
              caption="Cancellations by reason"
              columns={["Reason", "Plans ended"]}
              rows={summary.cancelReasons.map((row) => ({ key: row.reason, cells: [row.label, formatCount(row.n)] }))}
            />
          )}
        </TablePanel>
      </Section>

      <Section title="Visitors' screens">
        <ScreenWidthsTable rows={summary.screenWidths} days={days} />
      </Section>
    </div>
  );
}

// The people who signed up in the period, followed to today: the one place
// a share of signups is shown, because here it is the same people.
function CohortCard({ cohort, days }: { cohort: CohortStep[]; days: number }) {
  const total = cohort[0]?.users ?? 0;
  const rows: RankedRow[] = cohort.map((step) => ({
    key: step.key,
    label: step.label,
    value: step.users,
    note: `${formatRate(step.users, total)} of signups`,
  }));
  return (
    <ChartCard
      title={`From signup to paying — people who signed up in ${periodLabel(days)}`}
      description="This follows the same people: of everyone who signed up in this period, how many have since reached each step. The newest accounts are still on their way, so the later steps can keep growing. Accounts deleted since are not followed."
      chart={<RankedBars rows={total > 0 ? rows : []} max={total} empty="Nobody signed up in this period." />}
      table={
        total > 0 ? (
          <AnalyticsTable
            caption={`From signup to paying, people who signed up in ${periodLabel(days)}`}
            columns={["Step", "People", "Share of signups"]}
            rows={cohort.map((step) => ({ key: step.key, cells: [step.label, formatCount(step.users), formatRate(step.users, total)] }))}
          />
        ) : (
          <EmptyNote>Nobody signed up in this period.</EmptyNote>
        )
      }
    />
  );
}

// Nominal categories: ranked bars in the one hue, never a colour per method.
function SignupMethodsCard({ signups, days }: { signups: SignupsDaily; days: number }) {
  const rows: RankedRow[] = signups.methods.map((row) => ({
    key: row.method,
    label: row.label,
    value: row.n,
    note: `${formatRate(row.n, signups.total)} of signups`,
  }));
  return (
    <ChartCard
      title="How people signed up"
      description="With an email and password, or with Google or Discord. Accounts made before the way in was written down all used an email and password, and are counted there."
      chart={<RankedBars rows={rows} empty="No signups in this period." />}
      table={<RankedTable rows={rows} caption={`How people signed up, ${periodLabel(days)}`} columns={["How", "Signups", "Share"]} />}
    />
  );
}

function StepTables({ counts }: { counts: { current: FunnelCounts; previous: FunnelCounts } }) {
  const sections = buildFunnel(counts.current, counts.previous);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      {sections.map((section) => (
        <TablePanel key={section.title} title={section.title}>
          <AnalyticsTable
            caption={`${section.title}: this period and the previous period`}
            columns={["Step", "This period", "People", "Previous period", "Change"]}
            rows={section.steps.map((step) => ({
              key: step.key,
              cells: [
                step.label,
                formatCount(step.n),
                step.users > 0 ? formatCount(step.users) : "—",
                formatCount(step.previousN),
                changeText(changeOf(step.n, step.previousN)),
              ],
            }))}
          />
        </TablePanel>
      ))}
    </div>
  );
}

const OUTCOME_LABEL: Record<string, string> = {
  trial_converted: "Converted to paid",
  trial_lapsed: "Ended without paying",
  ongoing: "Still running",
  unknown: "End not recorded",
};

/** When a trial ended, or why there is no date. */
function trialEnd(trial: TrialEngagementRow): string {
  if (trial.endedAt) return formatUtcDate(trial.endedAt, "short");
  return trial.outcome === "ongoing" ? "still running" : "not recorded";
}

// Words in a table whose number cells are set in the mono face.
const words = (text: string) => <span className="font-sans text-foreground">{text}</span>;

function TrialEngagement({ trials, days }: { trials: FunnelSummary["trials"]; days: number }) {
  return (
    <TablePanel
      title="Trial engagement"
      description={`Trials that started in ${periodLabel(days)}. Each one is measured over its own length: from the day it started to the day it converted or ended, or to today while it is still running (60 days at most). Active days are the different days the person saved a card, made an AI generation or downloaded.`}
    >
      {trials == null ? (
        <AdminLoadError what="the trials" />
      ) : trials.length === 0 ? (
        <EmptyNote>No trial started in this period.</EmptyNote>
      ) : (
        <>
          <AnalyticsTable
            caption={`Trials started in ${periodLabel(days)}, each measured over its own length`}
            columns={["User", "Started", "Ended", "Days measured", "Outcome", "Active days", "Saves", "AI generations", "Downloads"]}
            rows={trials.map((t) => ({
              key: `${t.userId}-${t.startedAt}`,
              cells: [
                <Link key="user" href={`/admin/users?u=${t.userId}`} className="font-medium text-primary-bright hover:underline">
                  {t.username ? `@${t.username}` : t.userId.slice(0, 8)}
                </Link>,
                formatUtcDate(t.startedAt, "short"),
                trialEnd(t),
                formatCount(t.windowDays),
                words(OUTCOME_LABEL[t.outcome] ?? t.outcome),
                formatCount(t.activeDays),
                formatCount(t.saves),
                formatCount(t.generations),
                formatCount(t.downloads),
              ],
            }))}
          />
          {trials.length >= TRIAL_ROW_LIMIT ? (
            <p className="mt-2 text-xs text-subtle">The newest {TRIAL_ROW_LIMIT} trials of the period are listed.</p>
          ) : null}
        </>
      )}
    </TablePanel>
  );
}

// TODO WD9: our own visitors' viewport widths beside the StatCounter figures
// the width plan used — anonymous tab sessions per bucket, never a user.
function ScreenWidthsTable({ rows, days }: { rows: FunnelSummary["screenWidths"]; days: number }) {
  const total = rows?.reduce((sum, row) => sum + row.sessions, 0) ?? 0;
  return (
    <TablePanel
      title="Screen widths"
      description={`How wide visitors' browser windows were in ${periodLabel(days)}. One anonymous count per browser tab session: the viewport's width bucket, nothing else.`}
    >
      {rows == null ? (
        <AdminLoadError what="the screen widths" />
      ) : total === 0 ? (
        <EmptyNote>No screen widths recorded in this period.</EmptyNote>
      ) : (
        <AnalyticsTable
          caption={`Screen widths, ${periodLabel(days)}`}
          columns={["Width (CSS px)", "Sessions", "Share"]}
          rows={rows.map((row) => ({
            key: row.bucket,
            cells: [row.label, formatCount(row.sessions), row.share == null ? "—" : `${row.share}%`],
          }))}
        />
      )}
    </TablePanel>
  );
}
