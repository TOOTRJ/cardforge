import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CreatorLabAdmin } from "@/components/admin/creator-lab-admin";
import { getCreatorLabMode } from "@/lib/creator/lab";
import { getCurrentProfile } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Creator lab admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CreatorLabAdminPage() {
  // Non-admins get a 404 (don't reveal the route exists); the action
  // re-checks is_admin and RLS blocks non-admin writes independently.
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) notFound();
  const mode = await getCreatorLabMode();
  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin"
        title="Creator lab"
        description="Preview and test the alternative card creator before deciding whether anyone else gets it."
      />
      <CreatorLabAdmin mode={mode} />
    </DashboardShell>
  );
}
