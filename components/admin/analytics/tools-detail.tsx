import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import {
  AnalyticsTable,
  ChartCard,
  DailyColumns,
  DailyTable,
  EmptyNote,
  RankedBars,
  RankedTable,
  Section,
  TablePanel,
  type RankedRow,
} from "@/components/admin/analytics/charts";
import { NothingCounted, TOOL_WORDS, ToolKpis, Words, toolsLinkClass } from "@/components/admin/analytics/tools-parts";
import { ToolEventLog, ToolPeople } from "@/components/admin/analytics/tools-people";
import { analyticsHref, periodLabel, type AnalyticsParams } from "@/lib/admin/analytics/params";
import { formatCount } from "@/lib/admin/analytics/series";
import type { ToolNumbers } from "@/lib/admin/analytics/tools";
import {
  eventWords,
  failureLabel,
  orderToolEvents,
  type ToolBreakdown,
  type ToolUserLog,
  type ToolUsersPage,
} from "@/lib/admin/analytics/tools-view";
import { adminToolHref, type ToolDefinition } from "@/lib/tools/catalog";

// ---------------------------------------------------------------------------
// /admin/analytics — the Tools tab with ONE tool open: its six numbers, uses
// and opens per day (two charts: one measure each), every event it recorded,
// why its failures failed, and everyone who used it — with one person's
// event log above that list when the address names them.
// ---------------------------------------------------------------------------

export function ToolDetailView({
  params,
  tool,
  numbers,
  people,
  log,
}: {
  params: AnalyticsParams;
  tool: ToolDefinition;
  /** null = the read failed. */
  numbers: ToolNumbers | null;
  people: ToolUsersPage | null;
  /** undefined = no person's log is open; null = its read failed. */
  log: ToolUserLog | null | undefined;
}) {
  const current = numbers?.current ?? null;
  const quiet = current !== null && current.events.length === 0;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href={analyticsHref(params, { tool: null })} className="inline-flex items-center gap-1 self-start rounded-sm text-xs font-medium text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to all tools
          </Link>
          <h2 className="font-display text-lg font-semibold text-foreground">{tool.name}</h2>
          <p className="max-w-[70ch] text-sm leading-6 text-muted">{tool.tagline}</p>
        </div>
        <Link href={adminToolHref(tool.slug)} className={`text-sm ${toolsLinkClass}`}>
          Release and testers
        </Link>
      </header>

      {numbers === null || current === null ? (
        <AdminLoadError what={`${tool.name}’s numbers`} />
      ) : quiet ? (
        <NothingCounted params={params} what={tool.name} />
      ) : (
        <ToolNumbersView params={params} tool={tool} current={current} previous={numbers.previous} />
      )}

      {params.user ? <ToolEventLog params={params} tool={tool} userId={params.user} log={log ?? null} /> : null}

      {quiet && people !== null && people.total === 0 ? null : <ToolPeople params={params} tool={tool} people={people} />}
    </div>
  );
}

function ToolNumbersView({
  params,
  tool,
  current,
  previous,
}: {
  params: AnalyticsParams;
  tool: ToolDefinition;
  current: ToolBreakdown;
  previous: ToolNumbers["previous"];
}) {
  const period = periodLabel(params.days);
  const uses = current.daily.map((d) => ({ day: d.day, value: d.uses }));
  const opens = current.daily.map((d) => ({ day: d.day, value: d.opens }));
  const events = orderToolEvents(tool.slug, current.events);
  const reasons: RankedRow[] = current.reasons.map((row) => ({
    key: `${row.event}/${row.reason}`,
    label: <span title={failureLabel(row)}>{failureLabel(row)}</span>,
    value: row.count,
  }));
  const unexplained = current.totals.failures - current.reasons.reduce((sum, row) => sum + row.count, 0);

  return (
    <>
      <Section title="In numbers" description={`${TOOL_WORDS} Counted over ${period}.`}>
        <ToolKpis days={params.days} totals={current.totals} previous={previous} one slug={tool.slug} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Uses per day"
          description={`How often ${tool.name} did one of its jobs, each UTC day.`}
          chart={<DailyColumns points={uses} unit={["use", "uses"]} />}
          table={<DailyTable points={uses} caption={`${tool.name}: uses per day in ${period}`} column="Uses" />}
        />
        <ChartCard
          title="Opens per day"
          description="Visits to its page, each UTC day. A visit counts once however often the page reloads."
          chart={<DailyColumns points={opens} unit={["open", "opens"]} />}
          table={<DailyTable points={opens} caption={`${tool.name}: opens per day in ${period}`} column="Opens" />}
        />
      </div>

      <TablePanel title="What happened" description="Everything the tool recorded: what it did for people first, then what failed, then the steps on the way.">
        <AnalyticsTable
          className="whitespace-nowrap"
          caption={`${tool.name}: every event in ${period}`}
          columns={["What", <Words key="kind">Kind</Words>, "Times", "People"]}
          rows={events.map((row) => ({
            key: row.event,
            cells: [
              <span key="what" title={row.event}>
                {eventWords(row.event)}
              </span>,
              <Words key="kind">{row.kindWords}</Words>,
              formatCount(row.count),
              formatCount(row.users),
            ],
          }))}
        />
        {current.totals.visitorEvents > 0 ? (
          <p className="mt-3 text-xs text-subtle">
            {formatCount(current.totals.visitorEvents)} of these {current.totals.visitorEvents === 1 ? "has no account behind it" : "have no account behind them"}{" "}
            (a shared sheet&rsquo;s visitors, or an account since deleted), so {current.totals.visitorEvents === 1 ? "it is" : "they are"} in
            nobody&rsquo;s &ldquo;People&rdquo; count.
          </p>
        ) : null}
      </TablePanel>

      <ChartCard
        title="Why things failed"
        description="Each failure by what was tried and the reason it gave, most frequent first."
        chart={<RankedBars rows={reasons} empty={current.totals.failures > 0 ? "No failure gave a reason." : "Nothing failed in this period."} />}
        table={
          reasons.length > 0 ? (
            <RankedTable rows={reasons} caption={`${tool.name}: why things failed in ${period}`} columns={["What failed and why", "Times"]} />
          ) : (
            <EmptyNote>{current.totals.failures > 0 ? "No failure gave a reason." : "Nothing failed in this period."}</EmptyNote>
          )
        }
        footer={
          unexplained > 0 && reasons.length > 0 ? (
            <p className="text-xs text-subtle">
              {formatCount(unexplained)} more {unexplained === 1 ? "failure" : "failures"} gave no reason.
            </p>
          ) : null
        }
      />
    </>
  );
}

/** A tool the catalog doesn't know (a mistyped address). */
export function UnknownTool({ params }: { params: AnalyticsParams }) {
  return (
    <EmptyNote>
      There is no tool called &ldquo;{params.tool}&rdquo;.{" "}
      <Link href={analyticsHref(params, { tool: null })} className={toolsLinkClass}>
        Back to all tools
      </Link>
    </EmptyNote>
  );
}
