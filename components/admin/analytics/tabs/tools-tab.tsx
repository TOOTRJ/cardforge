import { AdminLoadError } from "@/components/admin/admin-load-error";
import { ToolDetailView, UnknownTool } from "@/components/admin/analytics/tools-detail";
import { ToolsOverviewView } from "@/components/admin/analytics/tools-overview";
import { analyticsPeriod, type AnalyticsParams } from "@/lib/admin/analytics/params";
import { getToolNumbers, getToolUserLog, getToolUsers, getToolsOverview } from "@/lib/admin/analytics/tools";
import { toolBySlug } from "@/lib/tools/catalog";

// ---------------------------------------------------------------------------
// /admin/analytics — the Tools tab: which users used each beta tool, how
// often, and what happened (the owner's request, 2026-11-10). The tracking
// is `tool_events` (lib/tools/events.ts); this is where it is read, through
// migration 0204's functions, for the page's period and its "Include
// admins" switch.
//
// The address picks the view: no `tool` = every tool; `tool` = one tool,
// with `page` for its people and `user` for one person's event log. Each
// block's read stands alone: one that fails says so in its own place.
// ---------------------------------------------------------------------------

export async function ToolsTab({ params }: { params: AnalyticsParams }) {
  const period = analyticsPeriod(params.days);

  if (!params.tool) {
    const overview = await getToolsOverview(period, params.admins);
    return overview ? <ToolsOverviewView params={params} data={overview} /> : <AdminLoadError what="the tools’ numbers" />;
  }

  const tool = toolBySlug(params.tool);
  if (!tool) return <UnknownTool params={params} />;

  const [numbers, people, log] = await Promise.all([
    getToolNumbers(tool.slug, period, params.admins),
    getToolUsers(tool.slug, period, params.admins, params.page),
    params.user ? getToolUserLog(tool.slug, params.user) : Promise.resolve(undefined),
  ]);
  return <ToolDetailView params={params} tool={tool} numbers={numbers} people={people} log={log} />;
}
