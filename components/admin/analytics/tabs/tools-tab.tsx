import type { AnalyticsParams } from "@/lib/admin/analytics/params";
import { EmptyNote } from "@/components/admin/analytics/charts";

/** /admin/analytics — the Tools tab (placeholder until its build lands). */
export async function ToolsTab({ params }: { params: AnalyticsParams }) {
  return <EmptyNote>The Tools tab for the last {params.days} days is being built.</EmptyNote>;
}
