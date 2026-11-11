import Link from "next/link";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import { CreditGrantsPanel } from "@/components/admin/credit-grants-panel";
import {
  AnalyticsTable,
  ChartCard,
  DailyColumns,
  EmptyNote,
  KpiRow,
  KpiTile,
  RankedBars,
  TablePanel,
} from "@/components/admin/analytics/charts";
import {
  analyticsHref,
  analyticsPeriod,
  periodLabel,
  previousPeriodLabel,
  type AnalyticsParams,
} from "@/lib/admin/analytics/params";
import { formatCount, formatRate } from "@/lib/admin/analytics/series";
import {
  creditDaySeries,
  getAiGenerationCounts,
  getCreditFlow,
  spendingByLabel,
  spendingByTool,
  type AiGenerationCounts,
  type CreditFlow,
  type CreditSpendGroup,
  type CreditTotals,
} from "@/lib/admin/analytics/credits";
import { getCreditGrantStats, type CreditGrantStats } from "@/lib/admin/credit-grant-stats";
import { formatUtcDate } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// /admin/analytics — the "Credits and AI" tab: what was spent, given back
// and granted in the period (the credit ledger, summed by
// admin_credit_flow, migration 0201), where it went, what each beta tool
// cost, and how many AI jobs were started.
//
// <CreditsTab> reads; <CreditsView> draws from what it is handed, so the
// view renders from fixed data in a test. Each read fails on its own: a
// block whose read failed says so (AdminLoadError), the others still show.
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;
// A refund is counted in the period it was WRITTEN in (0201), so a charge
// made just before the period began and refunded inside it leaves a line
// below zero — the tables say so (KEPT_NOTE) instead of hiding the number.
const kept = (row: { spent: number; refunded: number }) => row.spent - row.refunded;
const KEPT_NOTE =
  "Kept is spent less refunded; a refund counts in the period it was written, so a charge from just before the period can leave a line below zero.";

/** Spent · charges · given back · kept — the columns of both spend tables. */
const spendCells = (row: CreditSpendGroup) => [
  formatCount(row.spent),
  formatCount(row.spends),
  formatCount(row.refunded),
  formatCount(kept(row)),
];

export type CreditsViewProps = {
  params: AnalyticsParams;
  /** The period's UTC days, oldest first. */
  dayKeys: readonly string[];
  /** The ledger's flow for the period; null when the read failed. */
  flow: CreditFlow | null;
  /** The period before's totals; null when that read failed (no comparison). */
  previous: CreditTotals | null;
  generations: AiGenerationCounts | null;
  grants: CreditGrantStats | null;
};

export function CreditsView({ params, dayKeys, flow, previous, generations, grants }: CreditsViewProps) {
  const period = periodLabel(params.days);
  const previousLabel = previousPeriodLabel(params.days);
  const generationsTile = (
    <KpiTile
      label="AI generations"
      value={generations ? formatCount(generations.current) : "—"}
      {...(generations ? { current: generations.current, previous: generations.previous, previousLabel } : {})}
      hint={
        generations
          ? "AI jobs started: a card, a card fill, a deck. One job can make many cards."
          : "Couldn't be counted this time. Reload to try again."
      }
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {flow ? (
        <KpiRow className="xl:grid-cols-4">
          <KpiTile
            label="Credits spent"
            value={formatCount(flow.totals.spent)}
            {...(previous ? { current: flow.totals.spent, previous: previous.spent, previousLabel } : {})}
            hint={`${plural(flow.totals.spends, "charge", "charges")}. ${formatCount(kept(flow.totals))} kept after refunds.`}
          />
          <KpiTile
            label="Credits granted"
            value={formatCount(flow.totals.granted)}
            {...(previous ? { current: flow.totals.granted, previous: previous.granted, previousLabel } : {})}
            hint={`${plural(flow.totals.grants, "grant", "grants")}: plans, packs, welcome credits, the team's grants.`}
          />
          <KpiTile
            label="Credits refunded"
            value={formatCount(flow.totals.refunded)}
            {...(previous ? { current: flow.totals.refunded, previous: previous.refunded, previousLabel } : {})}
            upIsGood={false}
            hint={
              flow.totals.spent > 0
                ? `${formatRate(flow.totals.refunded, flow.totals.spent)} of what was spent. A refund gives back the charge of a generation that failed.`
                : "A refund gives back the charge of a generation that failed."
            }
          />
          {generationsTile}
        </KpiRow>
      ) : (
        <>
          <AdminLoadError what="the credits spent, refunded and granted" />
          <KpiRow className="xl:grid-cols-4">{generationsTile}</KpiRow>
        </>
      )}

      {flow ? <SpendCharts dayKeys={dayKeys} flow={flow} period={period} /> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {flow ? <ToolSpendTable params={params} flow={flow} period={period} /> : null}
        {grants ? <CreditGrantsPanel stats={grants} days={params.days} /> : <AdminLoadError what="the credits granted by reason" />}
      </div>

      <p className="max-w-[80ch] text-xs leading-5 text-muted">
        Every number here but &ldquo;AI generations&rdquo; is read from the credit ledger; days are UTC.{" "}
        {params.admins
          ? "Admin accounts are included. An admin's AI use is free and writes nothing to the ledger, so what this adds is the credits granted to them."
          : "Admin accounts are left out. An admin's AI use is free and writes nothing to the ledger, so “Include admins” only adds the credits granted to them."}{" "}
        A deleted account takes its ledger with it.
        {flow && flow.totals.takenBack > 0
          ? ` ${plural(flow.totals.takenBack, "credit was", "credits were")} taken back with refunded credit packs; that is not spending and is in no number above.`
          : ""}
      </p>
    </div>
  );
}

/** The two charts: credits spent per day, and what they were spent on. */
function SpendCharts({ dayKeys, flow, period }: { dayKeys: readonly string[]; flow: CreditFlow; period: string }) {
  const spentPerDay = creditDaySeries(dayKeys, flow.days, "spent");
  const dayRows = [...flow.days].reverse().filter((day) => day.spent > 0 || day.refunded > 0 || day.granted > 0);
  const groups = spendingByLabel(flow.spentByReason);
  const unattributed = flow.refundedUnattributed.credits;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ChartCard
        title="Credits spent per day"
        description={`Credits charged on each UTC day of ${period}. A charge that was later refunded is still counted on its day.`}
        chart={<DailyColumns points={spentPerDay} unit={["credit spent", "credits spent"]} />}
        table={
          dayRows.length === 0 ? (
            <EmptyNote>Nothing in this period.</EmptyNote>
          ) : (
            <div className="max-h-72 overflow-auto">
              <AnalyticsTable
                caption="Credits spent, refunded and granted per day"
                columns={["Day (UTC)", "Spent", "Refunded", "Granted"]}
                rows={dayRows.map((day) => ({
                  key: day.day,
                  cells: [
                    formatUtcDate(day.day, "short"),
                    formatCount(day.spent),
                    formatCount(day.refunded),
                    formatCount(day.granted),
                  ],
                }))}
              />
            </div>
          )
        }
      />
      <ChartCard
        title="Where credits went"
        description={`What the credits of ${period} were charged for, most first. ${KEPT_NOTE}`}
        chart={
          <RankedBars
            rows={groups
              .filter((group) => group.spent > 0)
              .map((group) => ({
                key: group.key,
                label: group.label,
                value: group.spent,
                note: plural(group.spends, "charge", "charges"),
              }))}
            empty="No credits were spent in this period."
          />
        }
        table={
          groups.length === 0 ? (
            <EmptyNote>Nothing in this period.</EmptyNote>
          ) : (
            <div className="min-w-0 overflow-x-auto">
              <AnalyticsTable
                caption="Where credits went"
                columns={["Spent on", "Credits spent", "Charges", "Refunded", "Kept"]}
                rows={groups.map((group) => ({ key: group.key, cells: [group.label, ...spendCells(group)] }))}
              />
            </div>
          )
        }
        footer={
          unattributed > 0 ? (
            <p className="text-xs leading-5 text-muted">
              {plural(unattributed, "refunded credit", "refunded credits")} could not be matched to a charge: counted in
              &ldquo;Credits refunded&rdquo;, in no row here.
            </p>
          ) : undefined
        }
      />
    </div>
  );
}

/** What each beta tool's AI cost, from the ledger's reasons. */
function ToolSpendTable({ params, flow, period }: { params: AnalyticsParams; flow: CreditFlow; period: string }) {
  const byTool = spendingByTool(flow.spentByReason);
  return (
    <TablePanel
      title="Credits spent by tool"
      description={`What each beta tool's AI cost its users in ${period}, from the credit ledger. ${KEPT_NOTE}`}
    >
      <AnalyticsTable
        caption="Credits spent by tool"
        columns={["Tool", "Credits spent", "Charges", "Refunded", "Kept"]}
        rows={[
          ...byTool.tools.map((tool) => ({
            key: tool.slug,
            cells: [
              <Link
                key="tool"
                href={analyticsHref(params, { tab: "tools", tool: tool.slug })}
                className="font-medium text-primary-bright hover:underline"
              >
                {tool.label}
              </Link>,
              ...spendCells(tool),
            ],
          })),
          { key: byTool.other.key, cells: [byTool.other.label, ...spendCells(byTool.other)] },
        ]}
      />
      <p className="mt-3 text-xs leading-5 text-muted">
        Token Kit&rsquo;s AI art is charged as an &ldquo;AI card fill&rdquo;, the same as a fill in the card creator, so the
        ledger cannot tell the two apart. It is counted in the last row, not as a tool&rsquo;s.
      </p>
    </TablePanel>
  );
}

export async function CreditsTab({ params }: { params: AnalyticsParams }) {
  const period = analyticsPeriod(params.days);
  const [flow, previous, generations, grants] = await Promise.all([
    getCreditFlow({ since: period.since, until: period.until }, params.admins),
    getCreditFlow({ since: period.previousSince, until: period.previousUntil }, params.admins),
    getAiGenerationCounts(period, params.admins),
    getCreditGrantStats({ since: period.since, includeAdmins: params.admins }),
  ]);
  return (
    <CreditsView
      params={params}
      dayKeys={period.dayKeys}
      flow={flow}
      previous={previous?.totals ?? null}
      generations={generations}
      grants={grants}
    />
  );
}
