import type { AnalyticsParams } from "@/lib/admin/analytics/params";
import { EmptyNote } from "@/components/admin/analytics/charts";

/** /admin/analytics — the Overview tab (placeholder until its build lands). */
export async function OverviewTab({ params }: { params: AnalyticsParams }) {
  return <EmptyNote>The Overview tab for the last {params.days} days is being built.</EmptyNote>;
}
