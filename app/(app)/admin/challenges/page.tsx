import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ChallengeAdmin } from "@/components/admin/challenge-admin";
import { listChallenges } from "@/lib/challenges/queries";
import { getCurrentProfile } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Challenges admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ChallengesAdminPage() {
  // Non-admins get a 404 (don't reveal the route exists) — same posture as
  // /admin/moderation. RLS independently blocks non-admin writes.
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) notFound();

  const challenges = await listChallenges();

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin"
        title="Design challenges"
        description="Author the briefs the community designs against. Entries are public cards wearing the challenge tag; the featured challenge also gets the gallery banner."
      />
      <ChallengeAdmin challenges={challenges} />
    </DashboardShell>
  );
}
