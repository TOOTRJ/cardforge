import Link from "next/link";
import {
  AnalyticsTable,
  ChartCard,
  RankedBars,
  RankedTable,
  Section,
  TablePanel,
  type RankedRow,
} from "@/components/admin/analytics/charts";
import { NothingCounted, TOOL_WORDS, ToolKpis, Words, toolsLinkClass } from "@/components/admin/analytics/tools-parts";
import { analyticsHref, periodLabel, type AnalyticsParams } from "@/lib/admin/analytics/params";
import { formatCount } from "@/lib/admin/analytics/series";
import type { ToolsOverview } from "@/lib/admin/analytics/tools";
import { peopleText, successRate, toolListRows } from "@/lib/admin/analytics/tools-view";
import { ledgerCreditsOf } from "@/lib/admin/analytics/tools";
import { formatUtcDate } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// /admin/analytics — the Tools tab with no tool open: six numbers for every
// tool together, the tools ranked by uses, and one row per tool that opens
// its own view. Every built tool is listed, a quiet one with zeros.
// ---------------------------------------------------------------------------

export function ToolsOverviewView({ params, data }: { params: AnalyticsParams; data: ToolsOverview }) {
  const period = periodLabel(params.days);
  if (data.rows.length === 0) {
    return (
      <Section title="Tools" description={TOOL_WORDS}>
        <NothingCounted params={params} what="a tool" />
      </Section>
    );
  }

  // A tool with no event in the period still has a ledger figure (0, or
  // "not known" for Token Kit).
  const tools = toolListRows(data.rows).map((tool) => ({ ...tool, credits: tool.credits ?? ledgerCreditsOf(data.spend, tool.slug) }));
  const ranked: RankedRow[] = tools.map((tool) => ({
    key: tool.slug,
    label: tool.name,
    value: tool.uses,
    note: peopleText(tool.usingUsers),
  }));

  return (
    <div className="flex flex-col gap-6">
      <Section title="Tools" description={`${TOOL_WORDS} Counted over ${period}.`}>
        <ToolKpis days={params.days} totals={data.totals} previous={data.previous} one={false} />
      </Section>

      <ChartCard
        title="Uses by tool"
        description={`How often each tool did one of its jobs in ${period}, and for how many people.`}
        chart={<RankedBars rows={ranked} />}
        table={<RankedTable rows={ranked} caption={`Uses by tool in ${period}`} columns={["Tool", "Uses", "People who used it"]} />}
      />

      <TablePanel title="Every tool" description="Open a tool to see who used it, what they did and why things failed.">
        <AnalyticsTable
          className="whitespace-nowrap"
          caption={`Every tool in ${period}`}
          columns={[
            "Tool",
            "People",
            "People who used it",
            "Opens",
            "Uses",
            "Failures",
            "Success rate",
            "Credits spent",
            <Words key="last">Last activity</Words>,
          ]}
          rows={tools.map((tool) => ({
            key: tool.slug,
            cells: [
              tool.inCatalog ? (
                <Link key="tool" href={analyticsHref(params, { tool: tool.slug })} className={toolsLinkClass}>
                  {tool.name}
                </Link>
              ) : (
                // A slug the catalog no longer lists has numbers and no view.
                <span key="tool" title="No longer in the tools catalog">
                  {tool.name}
                </span>
              ),
              formatCount(tool.users),
              formatCount(tool.usingUsers),
              formatCount(tool.opens),
              formatCount(tool.uses),
              formatCount(tool.failures),
              successRate(tool.uses, tool.failures),
              tool.credits === null ? "—" : formatCount(tool.credits),
              <Words key="last">{tool.lastEventAt ? formatUtcDate(tool.lastEventAt) : "—"}</Words>,
            ],
          }))}
        />
        {data.totals.visitorEvents > 0 ? (
          <p className="mt-3 text-xs text-subtle">
            {formatCount(data.totals.visitorEvents)} {data.totals.visitorEvents === 1 ? "event has" : "events have"} no account behind
            {data.totals.visitorEvents === 1 ? " it" : " them"} (a shared sheet&rsquo;s visitors, or an account since deleted): they are
            nobody&rsquo;s, so they count in no &ldquo;People&rdquo; column.
          </p>
        ) : null}
      </TablePanel>
    </div>
  );
}
