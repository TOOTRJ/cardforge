import type { AnalyticsParams } from "@/lib/admin/analytics/params";
import { EmptyNote } from "@/components/admin/analytics/charts";

/** /admin/analytics — the Funnel tab (placeholder until its build lands). */
export async function FunnelTab({ params }: { params: AnalyticsParams }) {
  return <EmptyNote>The Funnel tab for the last {params.days} days is being built.</EmptyNote>;
}
