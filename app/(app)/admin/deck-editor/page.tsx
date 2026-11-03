import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { DeckInlineEditorAdmin } from "@/components/admin/deck-inline-editor-admin";
import { getDeckInlineEditorMode } from "@/lib/decks/inline-editor";
import { getCurrentProfile } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Deck editor admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DeckEditorAdminPage() {
  // Non-admins get a 404 (don't reveal the route exists); the action
  // re-checks is_admin and RLS blocks non-admin writes independently.
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) notFound();
  const mode = await getDeckInlineEditorMode();
  return (
    <DashboardShell readable>
      <PageHeader
        eyebrow="Admin"
        title="Deck editor"
        description="Test editing cards in a drawer on the deck page before everyone gets it (TODO DK5.18)."
      />
      <DeckInlineEditorAdmin mode={mode} />
    </DashboardShell>
  );
}
