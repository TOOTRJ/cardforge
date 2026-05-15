import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CardCreatorForm } from "@/components/creator/card-creator-form";
import { ExportButton } from "@/components/creator/export-button";
import { PrintButton } from "@/components/creator/print-button";
import { AddToSetButton } from "@/components/sets/add-to-set-button";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  getFantasyGameSystem,
  getMyCardBySlug,
  getTemplatesForGameSystem,
} from "@/lib/cards/queries";
import { listMySetsForCard } from "@/lib/sets/queries";
import { isAIConfigured } from "@/lib/ai/card-assistant";

type EditCardPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: EditCardPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `Edit ${slug.replace(/-/g, " ")}`,
    description: "Edit your custom card.",
  };
}

export default async function EditCardPage({ params }: EditCardPageProps) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
        <SurfaceCard className="flex flex-col gap-3 p-8 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Supabase isn&apos;t configured
          </h1>
          <p className="text-sm leading-6 text-muted">
            Set the Supabase env vars to enable editing.
          </p>
        </SurfaceCard>
      </div>
    );
  }

  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(`/card/${slug}/edit`)}`);
  }

  const card = await getMyCardBySlug(slug);
  if (!card) {
    // The card doesn't exist OR isn't owned by the current user. RLS prevents
    // us from disclosing which one — both surface as a 404.
    notFound();
  }

  const [gameSystem, mySets] = await Promise.all([
    getFantasyGameSystem(),
    listMySetsForCard(card.id),
  ]);
  const templates = gameSystem
    ? await getTemplatesForGameSystem(gameSystem.id)
    : [];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Editing"
        title={card.title}
        description={`Slug: /card/${card.slug}`}
        actions={
          <>
            <Badge
              variant={card.visibility === "public" ? "primary" : "outline"}
            >
              {card.visibility === "public"
                ? "Public"
                : card.visibility === "unlisted"
                  ? "Unlisted"
                  : "Private"}
            </Badge>
            <AddToSetButton
              cardId={card.id}
              cardSlug={card.slug}
              sets={mySets.map((s) => ({
                id: s.id,
                slug: s.slug,
                title: s.title,
                cards_count: s.cards_count,
                contains_card: s.contains_card,
              }))}
            />
            <ExportButton
              cardId={card.id}
              cardSlug={card.slug}
              variant="outline"
              label="Download HD PNG"
            />
            <PrintButton
              cardId={card.id}
              cardSlug={card.slug}
              variant="outline"
            />
            <Button asChild variant="ghost">
              <Link href={`/card/${card.slug}`}>
                <ArrowLeft className="h-4 w-4" aria-hidden /> View public page
              </Link>
            </Button>
          </>
        }
      />

      <div className="mt-10">
        <CardCreatorForm
          mode="edit"
          userId={user.id}
          gameSystems={gameSystem ? [gameSystem] : []}
          templates={templates}
          card={card}
          aiConfigured={isAIConfigured()}
        />
      </div>
    </div>
  );
}
