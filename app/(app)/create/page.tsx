import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { CardCreatorForm } from "@/components/creator/card-creator-form";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  getFantasyGameSystem,
  getTemplatesForGameSystem,
} from "@/lib/cards/queries";
import { isAIConfigured } from "@/lib/ai/card-assistant";

export const metadata: Metadata = {
  title: "Create",
  description:
    "Forge a new custom trading card with a live preview, art upload, and visibility controls.",
};

export default async function CreatePage() {
  // Re-checked here in addition to the proxy/(app) layout — defense in depth.
  if (!isSupabaseConfigured()) {
    return <NotConfigured />;
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirectTo=/create");
  }

  const gameSystem = await getFantasyGameSystem();
  const templates = gameSystem
    ? await getTemplatesForGameSystem(gameSystem.id)
    : [];

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
            <Badge variant="primary" className="gap-1.5">
              <Sparkles className="h-3 w-3" aria-hidden /> Phase 4 · Creator MVP
            </Badge>
            <Button asChild variant="ghost">
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" aria-hidden /> Dashboard
              </Link>
            </Button>
          </>
        }
      />

      <div className="mt-10">
        <CardCreatorForm
          mode="create"
          userId={user.id}
          gameSystems={[gameSystem]}
          templates={templates}
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
          Supabase isn&apos;t configured
        </h1>
        <p className="text-sm leading-6 text-muted">
          Set <code className="font-mono text-foreground">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
          and{" "}
          <code className="font-mono text-foreground">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
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
