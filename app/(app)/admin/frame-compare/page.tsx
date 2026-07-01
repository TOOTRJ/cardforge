import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { FrameCompare } from "@/components/admin/frame-compare";
import {
  FRAME_REFERENCE_CARDS,
  getFrameReferenceCard,
} from "@/lib/cards/frame-reference-cards";
import { getCardById, pickPrintImageUrl } from "@/lib/scryfall/client";
import { getCurrentProfile } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Admin — frame-era comparison tool.
//
// Renders one hand-transcribed reference card through our CardPreview and
// overlays the official Scryfall scan of the same printing (745×1040 PNG)
// with opacity / side-by-side / difference modes. Used to verify that each
// frame era's geometry, text slots, and fonts match the real cards, and to
// guide nudge fixes to lib/cards/template-layout.ts.
//
// The scan URL is resolved server-side per request via getCardById. This
// is admin-only tooling, so the call isn't logged to scryfall_calls —
// that table backs per-USER quotas for the end-user import features; a
// couple of admin lookups would only add noise to the usage dashboard.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Frame compare",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminFrameComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const profile = await getCurrentProfile();
  // Non-admins get a 404 (don't reveal the route exists).
  if (!profile?.is_admin) notFound();

  const { ref } = await searchParams;
  const selected = getFrameReferenceCard(ref);

  // Best-effort: when the lookup fails the tool still renders our card
  // with a "scan unavailable" placeholder.
  const card = await getCardById(selected.scryfallId);
  const referenceImageUrl = card ? pickPrintImageUrl(card) : null;

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin"
        title="Frame compare"
        description="Overlay a real printing on our render to check frame alignment and fonts per era. Difference mode: aligned pixels go dark, drift glows."
        actions={<Badge variant="primary">{selected.era} frame</Badge>}
      />
      <div className="mt-10">
        <FrameCompare
          references={FRAME_REFERENCE_CARDS.map(({ key, label }) => ({
            key,
            label,
          }))}
          selected={selected}
          referenceImageUrl={referenceImageUrl}
        />
      </div>
    </DashboardShell>
  );
}
