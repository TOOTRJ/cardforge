import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { CardCreatorForm } from "@/components/creator/card-creator-form";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getFantasyGameSystem } from "@/lib/cards/queries";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { getVerifiedFrameKeysPublic } from "@/lib/cards/frame-reviews";
import { PageContainer } from "@/components/layout/page-container";
import { guestAuthHref } from "@/lib/creator/guest-draft";

// ---------------------------------------------------------------------------
// The GUEST card creator — served at /create for signed-out visitors.
//
// proxy.ts rewrites anonymous /create requests here (and 308s the old
// /preview URL and this internal path to /create), so the creator has ONE
// public URL: signed-in visitors get app/(app)/create, everyone else this
// page. A guest MAKES a card here (TODO HM3, owner 2026-11-04 — it reversed
// 2026-09-16's read-only creator): every step and the live preview work,
// pictures stay in the browser, the card waits in this browser
// (lib/creator/guest-draft.ts) and Save asks for an account — the
// signed-in /create puts the card back, ready to save. AI, Scryfall imports
// and custom pips need an account. It reads only seeded reference data
// through the cookie-free public client, so it stays ISR.
// ---------------------------------------------------------------------------

// ISR: the guest creator only reads seeded reference data (game system +
// templates via the cookie-free public client) — re-bake hourly.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Create a Custom MTG Card — Free Card Creator",
  description:
    "Design custom MTG-style cards in PipGlyph's free card creator — no account needed to start. Build any card type, pick mana costs, write oracle text, add art and watch the live preview, then sign up free to save.",
  alternates: { canonical: "/create" },
  openGraph: {
    title: "The Free MTG Card Creator | PipGlyph",
    description:
      "Design custom Magic: The Gathering cards in minutes. Live preview, visual mana pip builder, every card type, AI that writes and paints. Start now — sign up free when you save.",
  },
};

export default async function PreviewPage() {
  if (!isSupabaseConfigured()) {
    return <NotConfigured />;
  }

  const gameSystem = await getFantasyGameSystem();
  // Published (template, color) combos gate every kind chip and frame tile;
  // read through the public client so the page stays ISR. Without these
  // the guest creator offered only Creature — every other kind sat behind a
  // "Soon" badge — which contradicted the copy above.
  const verifiedFrameKeys = gameSystem ? await getVerifiedFrameKeysPublic() : [];

  if (!gameSystem) {
    return <SchemaUnseeded />;
  }

  return (
    // The creator keeps the standard frame until its redesign (TODO WD7,
    // owner decision D8; page-container-structure.test.ts lists it).
    <PageContainer size="standard" className="py-10">
      {/* Guest banner */}
      <div className="mb-6 flex items-center gap-3 rounded-frame border border-accent/30 bg-accent/10 px-4 py-3">
        <Sparkles className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <p className="text-sm text-foreground">
          <span className="font-semibold text-accent">No account needed to start.</span>{" "}
          Your card waits in this browser while you make it —{" "}
          <Link
            href={guestAuthHref("signup")}
            className="font-medium text-primary-bright underline-offset-2 hover:underline"
          >
            sign up free
          </Link>{" "}
          when you save, and it saves, publishes and shares from any device.
        </p>
      </div>

      <PageHeader
        eyebrow="Free card creator"
        title="Forge a custom card"
        description="Every card type — creatures, instants, planeswalkers, sagas — with three decades of frames and a live preview. Start right here; sign up free when you save, and AI that writes and paints comes with your account."
        actions={
          <Button asChild variant="ghost">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back
            </Link>
          </Button>
        }
      />

      <div className="mt-10">
        <CardCreatorForm
          mode="create"
          userId={null}
          gameSystems={[gameSystem]}
          verifiedFrameKeys={verifiedFrameKeys}
          aiConfigured={isDesignAiConfigured()}
          guestDraft="guest"
        />
      </div>
    </PageContainer>
  );
}

function NotConfigured() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <SurfaceCard className="flex flex-col gap-3 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Preview unavailable
        </h1>
        <p className="text-sm leading-6 text-muted">
          The card creator requires a Supabase connection to load card templates.
          Set <code className="break-all font-mono text-foreground">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
          and{" "}
          <code className="break-all font-mono text-foreground">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>{" "}
          in your environment.
        </p>
      </SurfaceCard>
    </div>
  );
}

function SchemaUnseeded() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <SurfaceCard className="flex flex-col gap-3 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Templates not seeded
        </h1>
        <p className="text-sm leading-6 text-muted">
          The <code className="font-mono text-foreground">fantasy</code> game
          system row is missing. Apply the DB migrations to seed it.
        </p>
      </SurfaceCard>
    </div>
  );
}
