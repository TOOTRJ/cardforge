import type { AnalyticsParams } from "@/lib/admin/analytics/params";
import { EmptyNote } from "@/components/admin/analytics/charts";

/** /admin/analytics — the Revenue tab (placeholder until its build lands). */
export async function RevenueTab({ params }: { params: AnalyticsParams }) {
  return <EmptyNote>The Revenue tab for the last {params.days} days is being built.</EmptyNote>;
}
