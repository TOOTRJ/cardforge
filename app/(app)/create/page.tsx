import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CardCreatorForm } from "@/components/creator/card-creator-form";
import {
  StartWithHero,
  FORM_SCROLL_TARGET_ID,
} from "@/components/creator/start-with-hero";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { getPipOverrides } from "@/lib/pips/queries";
import { getCurrentChallenge } from "@/lib/challenges/queries";
import {
  getFantasyGameSystem,
  getTemplatesForGameSystem,
} from "@/lib/cards/queries";
import { listMySets } from "@/lib/sets/queries";
import { isAIConfigured } from "@/lib/ai/card-assistant";

export const metadata: Metadata = {
  title: "Create",
  description:
    "Forge a new custom trading card with a live preview, art upload, and visibility controls.",
};

const CHALLENGE_TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const { tag: tagParam } = await searchParams;
  const initialTag =
    tagParam && CHALLENGE_TAG_PATTERN.test(tagParam) ? tagParam : null;
  // Re-checked here in addition to the proxy/(app) layout — defense in depth.
  if (!isSupabaseConfigured()) {
    return <NotConfigured />;
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirectTo=/create");
  }

  const [gameSystem, profile] = await Promise.all([
    getFantasyGameSystem(),
    getCurrentProfile(),
  ]);
  const templates = gameSystem
    ? await getTemplatesForGameSystem(gameSystem.id)
    : [];
  const mySets = await listMySets();

  if (!gameSystem) {
    return <SchemaUnseeded />;
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Creator"
        title="Forge a new card"
        description="Type on the left, watch the card take shape on the right. Save when you like the result."
        actions={
          <>
<Button asChild variant="ghost">
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
              </Link>
            </Button>
          </>
        }
      />

      <div className="mt-10">
        <StartWithHero />
      </div>

      <div id={FORM_SCROLL_TARGET_ID} className="mt-10 scroll-mt-24">
        <CardCreatorForm
          mode="create"
          userId={user.id}
          ownerUsername={profile?.username ?? null}
          gameSystems={[gameSystem]}
          templates={templates}
          mySets={mySets}
          aiConfigured={isAIConfigured()}
          pipOverrides={await getPipOverrides(user.id)}
          initialTag={initialTag}
          activeChallenge={await getCurrentChallenge()}
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
          Supabase isn&apos;t configured
        </h1>
        <p className="text-sm leading-6 text-muted">
          Set <code className="font-mono text-foreground">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
          and{" "}
          <code className="font-mono text-foreground">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>{" "}
          in your environment to enable the creator.
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
          No game system seeded yet
        </h1>
        <p className="text-sm leading-6 text-muted">
          The <code className="font-mono text-foreground">fantasy</code> game system
          row is missing. Apply{" "}
          <code className="font-mono text-foreground">
            supabase/migrations/0003_card_data_model.sql
          </code>{" "}
          to seed it.
        </p>
      </SurfaceCard>
    </div>
  );
}
