import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Heart, Pin } from "lucide-react";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import { CardPreviewSkeleton } from "@/components/cards/card-preview-skeleton";
import { CardHoverEffect } from "@/components/cards/card-hover-effect";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SocialIcon } from "@/components/profile/social-icon";
import {
  getProfileByUsername,
  listPinnedCardsForProfile,
  listPublicCardsByOwner,
  type CardWithStats,
  type ProfileWithStats,
} from "@/lib/cards/queries";
import { buildCardPath } from "@/lib/cards/utils";
import { getCurrentUser } from "@/lib/supabase/server";
import { isFollowing, getFollowCounts } from "@/lib/follows/queries";
import { FollowButton } from "@/components/follows/follow-button";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/lib/auth/schemas";
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

  const profile = await getProfileByUsername(username);
  if (!profile) {
    notFound();
  }

  const viewer = await getCurrentUser();
  const isOwnProfile = Boolean(viewer && viewer.id === profile.id);
  const [following, followCounts] = await Promise.all([
    viewer && !isOwnProfile ? isFollowing(profile.id) : Promise.resolve(false),
    getFollowCounts(profile.id),
  ]);

  const displayName =
    profile.display_name?.trim() || profile.username || "Forgemaster";
  const initial = (displayName[0] ?? "?").toUpperCase();
  // CSS custom property at the page root lets children pick up the accent
  // via `var(--profile-accent)`. Falls back to the brand primary token when
  // the user hasn't picked a color.
  const accentStyle = profile.accent_color
    ? ({ "--profile-accent": profile.accent_color } as React.CSSProperties)
    : undefined;

  return (
    <div
      className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8"
      style={accentStyle}
    >
      <Link
        href="/gallery"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to gallery
      </Link>

      <ProfileHero
        profile={profile}
        displayName={displayName}
        initial={initial}
        followers={followCounts.followers}
        following={followCounts.following}
        isOwnProfile={isOwnProfile}
        viewerSignedIn={Boolean(viewer)}
        initialFollowing={following}
      />

      <Suspense fallback={<PinnedRowSkeleton />}>
        <PinnedRow
          pinnedIds={profile.pinned_card_ids ?? []}
          ownerUsername={profile.username ?? username}
        />
      </Suspense>

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

function ProfileHero({
  profile,
  displayName,
  initial,
  followers,
  following,
  isOwnProfile,
  viewerSignedIn,
  initialFollowing,
}: {
  profile: ProfileWithStats;
  displayName: string;
  initial: string;
  followers: number;
  following: number;
  isOwnProfile: boolean;
  viewerSignedIn: boolean;
  initialFollowing: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-frame border border-border bg-surface">
      <ProfileBanner bannerUrl={profile.banner_url} />
      <div className="flex flex-col gap-4 px-6 pb-6 pt-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <ProfileAvatar
            avatarUrl={profile.avatar_url}
            initial={initial}
            displayName={displayName}
          />
          <div className="flex flex-col gap-1 pt-2 sm:pt-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
              {displayName}
            </h1>
            <span className="font-mono text-sm text-muted">
              @{profile.username}
            </span>
            {profile.bio ? (
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
                {profile.bio}
              </p>
            ) : null}
            <ProfileLinks profile={profile} />
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{profile.public_cards_count} public</Badge>
            <Badge variant="outline">
              {followers} {followers === 1 ? "follower" : "followers"}
            </Badge>
            <Badge variant="outline">{following} following</Badge>
          </div>
          {isOwnProfile ? null : (
            <FollowButton
              targetUserId={profile.id}
              initialFollowing={initialFollowing}
              requiresSignIn={!viewerSignedIn}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileBanner({ bannerUrl }: { bannerUrl: string | null }) {
  if (bannerUrl) {
    return (
      <div className="relative h-32 w-full overflow-hidden sm:h-44">
        <Image
          src={bannerUrl}
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
          unoptimized
          priority
        />
      </div>
    );
  }
  // Gradient fallback uses the accent var when set, else the brand gradient.
  return (
    <div
      className="h-32 w-full sm:h-44"
      style={{
        background:
          "linear-gradient(135deg, var(--profile-accent, var(--color-primary)) 0%, var(--color-accent) 100%)",
      }}
      aria-hidden
    />
  );
}

function ProfileAvatar({
  avatarUrl,
  initial,
  displayName,
}: {
  avatarUrl: string | null;
  initial: string;
  displayName: string;
}) {
  // Pull the avatar partly above the banner so the hero feels like an
  // identity card rather than a header strip. -mt-12 puts the bottom of
  // the banner at the avatar's vertical midpoint on mobile.
  const ringClass =
    "rounded-full ring-4 ring-surface shadow-md -mt-12 sm:-mt-14";
  if (avatarUrl) {
    return (
      <div
        className={`relative h-24 w-24 overflow-hidden ${ringClass}`}
        aria-label={`${displayName} avatar`}
      >
        <Image
          src={avatarUrl}
          alt=""
          fill
          sizes="96px"
          className="object-cover"
          unoptimized
          priority
        />
      </div>
    );
  }
  return (
    <span
      className={`flex h-24 w-24 items-center justify-center bg-linear-to-br from-primary to-accent font-display text-3xl font-semibold text-primary-foreground ${ringClass}`}
      aria-label={`${displayName} avatar`}
    >
      {initial}
    </span>
  );
}

function ProfileLinks({ profile }: { profile: ProfileWithStats }) {
  const socialEntries = SOCIAL_PLATFORMS.flatMap((p) => {
    const url = profile[p.key as SocialPlatformKey];
    return url ? [{ ...p, url }] : [];
  });

  if (!profile.website_url && socialEntries.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {profile.website_url ? (
        <a
          href={profile.website_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          {profile.website_url.replace(/^https?:\/\//, "")}
        </a>
      ) : null}
      {socialEntries.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-1.5">
          {socialEntries.map((entry) => (
            <li key={entry.key}>
              <a
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${entry.label} profile`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-elevated/60 text-muted transition-colors hover:bg-elevated hover:text-[var(--profile-accent,var(--color-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <SocialIcon platform={entry.key} className="h-4 w-4" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

async function PinnedRow({
  pinnedIds,
  ownerUsername,
}: {
  pinnedIds: string[];
  ownerUsername: string;
}) {
  if (!pinnedIds || pinnedIds.length === 0) return null;
  const cards = await listPinnedCardsForProfile(pinnedIds);
  if (cards.length === 0) return null;

  return (
    <section className="mt-8" aria-labelledby="pinned-heading">
      <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--profile-accent,var(--color-primary))]">
        <Pin className="h-3.5 w-3.5" aria-hidden />
        <span id="pinned-heading">Pinned</span>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <ProfileCardTile
            key={card.id}
            card={card}
            ownerUsername={ownerUsername}
          />
        ))}
      </div>
    </section>
  );
}

function PinnedRowSkeleton() {
  return (
    <section className="mt-8" aria-busy="true">
      <Skeleton className="mb-3 h-3 w-16" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <CardPreviewSkeleton key={i} />
        ))}
      </div>
    </section>
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
  card: CardWithStats;
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
          <BakedCardThumbnail
            renderedImageUrl={card.rendered_image_url}
            title={card.title}
            previewData={{
              title: card.title,
              cost: card.cost,
              cardType: card.card_type,
              supertype: card.supertype,
              subtypes: card.subtypes,
              rarity: card.rarity,
              colorIdentity: card.color_identity,
              rulesText: card.rules_text,
              flavorText: card.flavor_text,
              power: card.power,
              toughness: card.toughness,
              loyalty: card.loyalty,
              defense: card.defense,
              artistCredit: card.artist_credit,
              artUrl: card.art_url,
              artPosition: card.art_position as ArtPosition,
              frameStyle: card.frame_style as FrameStyle,
              setIconUrl: card.set_icon_url,
              setIconCode: card.set_icon_code,
            }}
          />
        </CardHoverEffect>
      </Link>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted">{card.title}</span>
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
