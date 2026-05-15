import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Heart } from "lucide-react";
import { CardPreview } from "@/components/cards/card-preview";
import { CardPreviewSkeleton } from "@/components/cards/card-preview-skeleton";
import { CardHoverEffect } from "@/components/cards/card-hover-effect";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getProfileByUsername,
  listPublicCardsByOwner,
} from "@/lib/cards/queries";
import { buildCardPath } from "@/lib/cards/utils";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { ArtPosition, FrameStyle } from "@/types/card";

type Params = { username: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { username } = await params;
  if (!isSupabaseConfigured()) {
    return { title: `@${username}` };
  }
  const profile = await getProfileByUsername(username);
  return {
    title: profile
      ? (profile.display_name ?? `@${profile.username}`)
      : `@${username}`,
    description: profile?.bio ?? `Custom cards forged by @${username} on Spellwright.`,
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { username } = await params;

  if (!isSupabaseConfigured()) {
    return <NotConfigured username={username} />;
  }

  // Profile lookup blocks the page shell because the header + display name
  // depend on it. The cards grid suspends below with a skeleton fallback.
  const profile = await getProfileByUsername(username);
  if (!profile) {
    notFound();
  }

  const displayName =
    profile.display_name?.trim() || profile.username || "Forgemaster";
  const initial = (displayName[0] ?? "?").toUpperCase();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/gallery"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to gallery
      </Link>

      <SurfaceCard className="flex flex-col items-start gap-4 p-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br from-primary to-accent font-display text-xl font-semibold text-primary-foreground">
            {initial}
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
              {displayName}
            </h1>
            <span className="font-mono text-sm text-muted">
              @{profile.username ?? username}
            </span>
            {profile.bio ? (
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
                {profile.bio}
              </p>
            ) : null}
            {profile.website_url ? (
              <a
                href={profile.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
                {profile.website_url.replace(/^https?:\/\//, "")}
              </a>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{profile.public_cards_count} public</Badge>
        </div>
      </SurfaceCard>

      <PageHeader
        className="mt-10"
        eyebrow="Cards"
        title={`Forged by ${displayName}`}
        description="Public cards published by this creator."
      />

      <div className="mt-8">
        <Suspense fallback={<ProfileCardsSkeleton count={8} />}>
          <ProfileCards
            ownerId={profile.id}
            ownerUsername={profile.username ?? username}
            displayName={displayName}
          />
        </Suspense>
      </div>
    </div>
  );
}

async function ProfileCards({
  ownerId,
  ownerUsername,
  displayName,
}: {
  ownerId: string;
  ownerUsername: string;
  displayName: string;
}) {
  const cards = await listPublicCardsByOwner(ownerId, { limit: 24 });
  if (cards.length === 0) {
    return (
      <EmptyState
        icon={Heart}
        title="No public cards yet"
        description={`${displayName} hasn't published any cards publicly. Check back later or browse the gallery for other creators.`}
      />
    );
  }
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((card) => (
        <ProfileCardTile
          key={card.id}
          card={card}
          ownerUsername={ownerUsername}
        />
      ))}
    </div>
  );
}

function ProfileCardsSkeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <CardPreviewSkeleton />
          <div className="flex items-center justify-between gap-2 text-xs">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-8" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ProfileCardTile({
  card,
  ownerUsername,
}: {
  card: Awaited<ReturnType<typeof listPublicCardsByOwner>>[number];
  ownerUsername: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Link
        href={buildCardPath({ slug: card.slug, owner: { username: ownerUsername } })}
        className="block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Open ${card.title}`}
        style={{ viewTransitionName: `card-${card.id}` }}
      >
        <CardHoverEffect>
          <CardPreview
            title={card.title}
            cost={card.cost}
            cardType={card.card_type}
            supertype={card.supertype}
            subtypes={card.subtypes}
            rarity={card.rarity}
            colorIdentity={card.color_identity}
            rulesText={card.rules_text}
            flavorText={card.flavor_text}
            power={card.power}
            toughness={card.toughness}
            loyalty={card.loyalty}
            defense={card.defense}
            artistCredit={card.artist_credit}
            artUrl={card.art_url}
            artPosition={card.art_position as ArtPosition}
            frameStyle={card.frame_style as FrameStyle}
          />
        </CardHoverEffect>
      </Link>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted">
          {card.visibility === "public" ? "Public" : "Unlisted"}
        </span>
        <span className="inline-flex items-center gap-1 text-muted">
          <Heart className="h-3 w-3" aria-hidden />
          {card.likes_count}
        </span>
      </div>
    </div>
  );
}

function NotConfigured({ username }: { username: string }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <SurfaceCard className="flex flex-col gap-3 p-8 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          @{username}
        </h1>
        <p className="text-sm leading-6 text-muted">
          Supabase isn&apos;t configured for this deployment, so profile pages
          aren&apos;t loading real data yet.
        </p>
      </SurfaceCard>
    </div>
  );
}
