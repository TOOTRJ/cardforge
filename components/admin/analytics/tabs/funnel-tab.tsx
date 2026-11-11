import { AdminLoadError } from "@/components/admin/admin-load-error";
import { FunnelPanel } from "@/components/admin/funnel-panel";
import { analyticsPeriod, type AnalyticsParams } from "@/lib/admin/analytics/params";
import { getFunnelSummary } from "@/lib/admin/funnel-queries";

/**
 * /admin/analytics — the Funnel tab: signups, activation, trials and the
 * money steps for the page's period, each beside the period before, and the
 * people who signed up in it followed to today. The reads are
 * lib/admin/funnel-queries.ts (all at once); the drawing is FunnelPanel.
 */
export async function FunnelTab({ params }: { params: AnalyticsParams }) {
  const summary = await getFunnelSummary(analyticsPeriod(params.days), params.admins);
  if (!summary) return <AdminLoadError what="the funnel" />;
  return <FunnelPanel summary={summary} days={params.days} />;
}
