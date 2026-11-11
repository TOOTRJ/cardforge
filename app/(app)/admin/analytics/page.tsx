import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { AnalyticsNav } from "@/components/admin/analytics/analytics-nav";
import { OverviewTab } from "@/components/admin/analytics/tabs/overview-tab";
import { FunnelTab } from "@/components/admin/analytics/tabs/funnel-tab";
import { RevenueTab } from "@/components/admin/analytics/tabs/revenue-tab";
import { CreditsTab } from "@/components/admin/analytics/tabs/credits-tab";
import { ReferralsTab } from "@/components/admin/analytics/tabs/referrals-tab";
import { ToolsTab } from "@/components/admin/analytics/tabs/tools-tab";
import { ContentTab } from "@/components/admin/analytics/tabs/content-tab";
import { ANALYTICS_TABS, parseAnalyticsParams, type AnalyticsParams, type AnalyticsTabId } from "@/lib/admin/analytics/params";
import { getCurrentProfile } from "@/lib/supabase/server";
import { isAdminConfigured } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// /admin/analytics — every number the team reads about the product, in one
// place, by tab: Overview, Funnel, Revenue, Credits and AI, Referrals, Tools
// and Content (the 2026-11 analytics audit: these panels sat one under the
// other on the Users page, each with its own hard-coded windows).
//
// The address is the state (lib/admin/analytics/params.ts): the tab, the
// period and "Include admins" are links. ONLY THE OPEN TAB'S QUERIES RUN —
// a tab is an async server component that reads its own data, and this page
// renders exactly one of them.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Analytics",
  robots: { index: false, follow: false },
};

const TABS: Record<AnalyticsTabId, (props: { params: AnalyticsParams }) => Promise<React.ReactNode>> = {
  overview: OverviewTab,
  funnel: FunnelTab,
  revenue: RevenueTab,
  credits: CreditsTab,
  referrals: ReferralsTab,
  tools: ToolsTab,
  content: ContentTab,
};

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) notFound();
  if (!isAdminConfigured()) notFound();

  const params = parseAnalyticsParams(await searchParams);
  const Tab = TABS[params.tab];
  const label = ANALYTICS_TABS.find((tab) => tab.id === params.tab)?.label ?? "Overview";

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin · Analytics"
        title="Analytics"
        description="Signups, activation, money, credits, referrals, tools and content. Pick a section and a period; the address keeps both, so a view can be bookmarked or sent."
      />
      <div className="mt-6">
        <AnalyticsNav params={params} />
      </div>
      <div className="mt-6" aria-label={label} role="region">
        <Tab params={params} />
      </div>
    </DashboardShell>
  );
}
