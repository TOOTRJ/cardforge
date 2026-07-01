import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CardCreatorForm } from "@/components/creator/card-creator-form";
import { DownloadModal } from "@/components/cards/download-modal";
import { AddToSetButton } from "@/components/sets/add-to-set-button";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { getPipOverrides } from "@/lib/pips/queries";
import { getCurrentChallenge } from "@/lib/challenges/queries";
import { getEntitlements } from "@/lib/billing/entitlements";
import {
  getFantasyGameSystem,
  getMyCardBySlug,
  getTemplatesForGameSystem,
  listMyCards,
} from "@/lib/cards/queries";
import { buildCardPath } from "@/lib/cards/utils";
import { listMySets, listMySetsForCard } from "@/lib/sets/queries";
import { isAIConfigured } from "@/lib/ai/card-assistant";

// File-system param name is `username` because the sibling
// `(marketing)/card/[username]/[slug]` route uses the same first
// segment — Next.js requires consistent dynamic-segment names across
// the route tree at the same depth. The value at the URL position is
// still a card slug (the owner's own card), so we destructure as
// `slug` for clarity downstream.
type EditCardPageProps = {
  params: Promise<{ username: string }>;
};

export async function generateMetadata({
  params,
}: EditCardPageProps): Promise<Metadata> {
  const { username: slug } = await params;
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

  const { username: slug } = await params;
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

  const [gameSystem, mySets, profile, userSets, entitlements, allMyCards] =
    await Promise.all([
      getFantasyGameSystem(),
      listMySetsForCard(card.id),
      getCurrentProfile(),
      listMySets(),
      getEntitlements(),
      listMyCards(),
    ]);
  // Back-face picker candidates: every owned card except this one (can't be its
  // own back). Includes the currently-linked back card so the flip renders.
  const myCards = allMyCards.filter((c) => c.id !== card.id);
  const templates = gameSystem
    ? await getTemplatesForGameSystem(gameSystem.id)
    : [];
  const ownerUsername = profile?.username ?? null;
  const publicPath = buildCardPath({
    slug: card.slug,
    owner: { username: ownerUsername },
  });

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Editing"
        title={card.title}
        description={`Slug: ${publicPath}`}
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
              ownerUsername={ownerUsername}
              sets={mySets.map((s) => ({
                id: s.id,
                slug: s.slug,
                title: s.title,
                cards_count: s.cards_count,
                contains_card: s.contains_card,
              }))}
            />
            <DownloadModal
              cardId={card.id}
              cardSlug={card.slug}
              isPaid={entitlements.isPaid}
              canBatch={entitlements.allowBatchExport}
            />
            <Button asChild variant="ghost">
              <Link href={publicPath}>
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
          ownerUsername={ownerUsername}
          gameSystems={gameSystem ? [gameSystem] : []}
          templates={templates}
          card={card}
          mySets={userSets}
          myCards={myCards}
          aiConfigured={isAIConfigured()}
          pipOverrides={await getPipOverrides(user.id)}
          activeChallenge={await getCurrentChallenge()}
        />
      </div>
    </div>
  );
}
