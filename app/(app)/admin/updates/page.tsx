import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SiteUpdatesAdmin } from "@/components/admin/site-updates-admin";
import { isBannerEnabled, listAllUpdatesForAdmin } from "@/lib/updates/queries";
import { getCurrentProfile } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Site updates admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function UpdatesAdminPage() {
  // Non-admins get a 404 (don't reveal the route exists). RLS independently
  // blocks non-admin writes and hides drafts/scheduled rows.
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) notFound();
  const [updates, bannerEnabled] = await Promise.all([listAllUpdatesForAdmin(), isBannerEnabled()]);
  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin"
        title="Site updates & upcoming features"
        description="Post what shipped, tease what's next, schedule a release for later, put it on the ribbon (homepage or every page), notify everyone, or make it a must-read every signed-in user has to dismiss once."
      />
      <SiteUpdatesAdmin updates={updates} bannerEnabled={bannerEnabled} />
    </DashboardShell>
  );
}
