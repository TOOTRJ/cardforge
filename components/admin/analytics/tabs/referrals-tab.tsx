import type { AnalyticsParams } from "@/lib/admin/analytics/params";
import { EmptyNote } from "@/components/admin/analytics/charts";

/** /admin/analytics — the Referrals tab (placeholder until its build lands). */
export async function ReferralsTab({ params }: { params: AnalyticsParams }) {
  return <EmptyNote>The Referrals tab for the last {params.days} days is being built.</EmptyNote>;
}
