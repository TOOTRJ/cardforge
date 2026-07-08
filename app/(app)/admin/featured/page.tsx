import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { FeaturedManager } from "@/components/admin/featured-manager";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Featured creators",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminFeaturedPage() {
  const profile = await getCurrentProfile();
  // Non-admins get a 404 (don't reveal the route exists).
  if (!profile?.is_admin) notFound();

  let featured: { username: string; displayName: string | null }[] = [];
  if (isAdminConfigured()) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("profiles")
      .select("username, display_name")
      .not("featured_at", "is", null)
      .not("username", "is", null)
      .order("featured_at", { ascending: false });
    featured = (data ?? []).map((p) => ({
      username: p.username as string,
      displayName: p.display_name,
    }));
  }

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin · Featured"
        title="Featured creators"
        description="Spotlight a creator on the gallery and challenges pages. Most recently featured leads; the banners update immediately."
      />
      <SurfaceCard className="mt-6 p-6">
        <FeaturedManager featured={featured} />
      </SurfaceCard>
    </DashboardShell>
  );
}
