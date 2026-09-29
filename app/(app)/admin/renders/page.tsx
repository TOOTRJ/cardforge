import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { AutoRebakePanel } from "@/components/admin/auto-rebake-panel";
import { getAutoRebakeOverview } from "@/lib/cards/auto-rebake-queries";
import { getCurrentProfile } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Admin — the automatic re-bake (/api/cron/auto-rebake): pending estimate,
// last run, breaker state, the cards that keep failing, Pause / Resume.
// Non-admins get a 404; the actions re-check is_admin themselves.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Automatic re-bake",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AutoRebakeAdminPage() {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) notFound();
  const overview = await getAutoRebakeOverview();
  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin"
        title="Automatic re-bake"
        description="After a deploy that changes how cards render, published cards are re-baked in the background — no script to run. This is its status and its off switch."
      />
      <AutoRebakePanel overview={overview} nowMs={overview.readAt} />
    </DashboardShell>
  );
}
