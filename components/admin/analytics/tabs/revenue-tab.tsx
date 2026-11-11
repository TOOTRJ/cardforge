import { AdminLoadError } from "@/components/admin/admin-load-error";
import { RevenuePanel } from "@/components/admin/revenue-panel";
import { analyticsPeriod, type AnalyticsParams } from "@/lib/admin/analytics/params";
import { getRevenueSummary } from "@/lib/admin/revenue-queries";

/**
 * /admin/analytics — the Revenue tab: money taken in the period against the
 * one before, per day, by what was bought, and the period's payments. The
 * figures are lib/admin/revenue-queries.ts's; the drawing is RevenuePanel's.
 * "Include admins" does not apply: revenue is money taken, whoever paid it.
 */
export async function RevenueTab({ params }: { params: AnalyticsParams }) {
  const summary = await getRevenueSummary(analyticsPeriod(params.days));
  if (!summary) return <AdminLoadError what="revenue" />;
  return <RevenuePanel summary={summary} days={params.days} />;
}
