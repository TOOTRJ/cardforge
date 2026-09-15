import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";
import { CardCreatorForm } from "@/components/creator/card-creator-form";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  getFantasyGameSystem,
  getTemplatesForGameSystem,
} from "@/lib/cards/queries";
import { isAIConfigured } from "@/lib/ai/card-assistant";
import { getVerifiedFrameKeysPublic } from "@/lib/cards/frame-reviews";

// ---------------------------------------------------------------------------
// The GUEST card creator — served at /create for signed-out visitors.
//
// proxy.ts rewrites anonymous /create requests here (and 308s the old
// /preview URL and this internal path to /create), so the creator has ONE
// public URL: signed-in visitors get app/(app)/create, everyone else this
// page. It renders the full creator with live preview, mana pip builder and
// oracle text — no account required; the action bar shows "Sign in to save"
// instead of Save when userId is null. It reads only seeded reference data
// through the cookie-free public client, so it stays ISR.
// ---------------------------------------------------------------------------

// ISR: the guest creator only reads seeded reference data (game system +
// templates via the cookie-free public client) — re-bake hourly.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Create a Custom MTG Card — Free Card Creator",
  description:
    "Design a custom MTG-style card in PipGlyph's free card creator — no signup needed. Build any card type, pick mana costs, write oracle text, and see a live preview instantly.",
  alternates: { canonical: "/create" },
  openGraph: {
    title: "Try the MTG Card Creator — No Account Needed | PipGlyph",
    description:
      "Design custom Magic: The Gathering cards in seconds. Live preview, visual mana pip builder, full card type support. Free, no signup required.",
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
  const [templates, verifiedFrameKeys] = gameSystem
    ? await Promise.all([
        getTemplatesForGameSystem(gameSystem.id),
        getVerifiedFrameKeysPublic(),
      ])
    : [[], []];

  if (!gameSystem) {
    return <SchemaUnseeded />;
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Guest banner */}
      <div className="mb-6 flex items-center gap-3 rounded-frame border border-accent/30 bg-accent/10 px-4 py-3">
        <Eye className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <p className="text-sm text-foreground">
          <span className="font-semibold text-accent">Guest mode</span> — your
          card is visible here but won&apos;t be saved.{" "}
          <Link
            href="/signup"
            className="font-medium text-primary-bright underline-offset-2 hover:underline"
          >
            Create a free account
          </Link>{" "}
          to save, publish, and build full expansion sets.
        </p>
      </div>

      <PageHeader
        eyebrow="Try it free"
        title="Forge a custom card"
        description="No account required. Design any card type — creatures, instants, planeswalkers — with a live preview. Sign in when you're ready to save."
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
          templates={templates}
          verifiedFrameKeys={verifiedFrameKeys}
          aiConfigured={isAIConfigured()}
        />
      </div>
    </div>
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
          Set <code className="font-mono text-foreground">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
          and{" "}
          <code className="font-mono text-foreground">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>{" "}
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
