import type { AnalyticsParams } from "@/lib/admin/analytics/params";
import { EmptyNote } from "@/components/admin/analytics/charts";

/** /admin/analytics — the Credits tab (placeholder until its build lands). */
export async function CreditsTab({ params }: { params: AnalyticsParams }) {
  return <EmptyNote>The Credits tab for the last {params.days} days is being built.</EmptyNote>;
}
