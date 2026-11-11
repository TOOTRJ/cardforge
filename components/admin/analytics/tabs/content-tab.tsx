import type { AnalyticsParams } from "@/lib/admin/analytics/params";
import { EmptyNote } from "@/components/admin/analytics/charts";

/** /admin/analytics — the Content tab (placeholder until its build lands). */
export async function ContentTab({ params }: { params: AnalyticsParams }) {
  return <EmptyNote>The Content tab for the last {params.days} days is being built.</EmptyNote>;
}
