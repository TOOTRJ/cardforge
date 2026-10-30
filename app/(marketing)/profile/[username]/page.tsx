import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ExternalLink,
  Heart,
  Pin,
  Plus,
  Search,
  Settings,
  Store,
} from "lucide-react";
import { CardTile } from "@/components/cards/card-tile";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { CardPreviewSkeleton } from "@/components/cards/card-preview-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { SocialIcon } from "@/components/profile/social-icon";
import { LinkIcon } from "@/components/profile/link-icon";
import { StoreCard } from "@/components/profile/store-card";
import { ProfileCardFilters } from "@/components/profile/profile-card-filters";
import {
  getProfileByUsername,
  listPinnedCardsForProfile,
  listProfileCards,
  type CardWithStats,
  type ProfileWithStats,
} from "@/lib/cards/queries";
import { buildCardPath } from "@/lib/cards/utils";
import { getCurrentUser } from "@/lib/supabase/server";
import { isFollowing, getFollowCounts } from "@/lib/follows/queries";
import {
  countPublicDecksByOwner,
  listPublicDecksByOwner,
} from "@/lib/decks/queries";
import { listDeckTileArt } from "@/lib/decks/tile-art";
import {
  DeckGrid,
  DECK_GRID_SIZES,
  DeckTile,
  DeckTileSkeleton,
} from "@/components/decks/deck-tile";
import { Button } from "@/components/ui/button";
import { FollowButton } from "@/components/follows/follow-button";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/lib/auth/schemas";
import { JsonLd } from "@/components/seo/json-ld";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import { profileMediaSrc } from "@/lib/media/media-urls";
import { PageContainer } from "@/components/layout/page-container";
import { CARD_GRID_SIZES, CardGrid } from "@/components/cards/card-grid";
import { listProfileLinks, listProfileStores } from "@/lib/profile/links-queries";
import { linkKindOf, profileLinkName, type ProfileLink } from "@/lib/profile/link-kinds";
import { USER_LINK_REL, type ProfileStore } from "@/lib/profile/store-platforms";
import { displayLink } from "@/lib/profile/https-link";
import { buildProfileJsonLd } from "@/lib/profile/json-ld";
import {
  isFilteredProfileView,
  parseProfileCardParams,
  profileCardsHref,
  PROFILE_CARDS_PAGE_SIZE,
  type ProfileCardParams,
} from "@/lib/profile/card-params";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /profile/[username] — a creator's public page: the hero (banner, avatar,
// bio, stats, every link), their STORE cards (migration 0153), pinned cards,
// ALL their public cards (searched, filtered and paged in the database —
// list_profile_cards; the query string is the state, lib/profile/
// card-params.ts) and their public decks.
//
// Dynamic per request (the follow state reads the viewer's cookie, the card
// section the query string); every viewer-independent read — links, stores,
// deck tile art — goes through the cookie-free client. SEO: an unknown
// handle is a real 404 before any Suspense boundary; a THIN profile (no
// public card, no bio) and every filtered / paged variant are noindex,
// follow; the canonical is always the bare profile.
// ---------------------------------------------------------------------------

type Params = { username: string };
type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { username } = await params;
  if (!isSupabaseConfigured()) {
    return { title: `@${username}` };
  }
  const profile = await getProfileByUsername(username);
  // An unknown handle is a real 404, never a titled 200 (soft 404).
  if (!profile) notFound();
  const title = profile.display_name ?? `@${profile.username}`;
  const description =
    profile.bio ?? `Custom cards forged by @${profile.username} on PipGlyph.`;
  const canonical = `/profile/${profile.username}`;
  // A handle-only profile (no public cards, no bio) is thin content: keep it
  // crawlable and followed, but out of the index until there is something
  // to rank. The sitemap applies the same bar. A searched, filtered or
  // paged view of the cards is the same page sliced: canonical to the bare
  // profile and out of the index, its card links still followed.
  const thin = profile.public_cards_count === 0 && !profile.bio;
  const filtered = isFilteredProfileView(parseProfileCardParams(await searchParams));
  return {
    title,
    description,
    alternates: { canonical },
    robots: thin || filtered ? { index: false, follow: true } : undefined,
    // Explicit OG/Twitter blocks (the sibling opengraph-image.tsx supplies
    // the image) so unfurls carry the profile description + site name
    // instead of inheriting the root layout's generic copy.
    openGraph: {
      title: `${title} · PipGlyph`,
      description,
      type: "profile",
      siteName: "PipGlyph",
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} · PipGlyph`,
      description,
    },
  };
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { username } = await params;

  if (!isSupabaseConfigured()) {
    return <NotConfigured username={username} />;
  }

  const profile = await getProfileByUsername(username);
  if (!profile) {
    notFound();
  }

  const cardParams = parseProfileCardParams(await searchParams);
  const handle = profile.username ?? username;
  const viewer = await getCurrentUser();
  const isOwnProfile = Boolean(viewer && viewer.id === profile.id);
  const [following, followCounts, publicDeckCount, extraLinks, stores] = await Promise.all([
    viewer && !isOwnProfile ? isFollowing(profile.id) : Promise.resolve(false),
    getFollowCounts(profile.id),
    countPublicDecksByOwner(profile.id),
    listProfileLinks(profile.id),
    listProfileStores(profile.id),
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
    <PageContainer size="wide" className="py-8 sm:py-12" style={accentStyle}>
      <JsonLd data={buildProfileJsonLd(profile, displayName, extraLinks)} />
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
        publicDeckCount={publicDeckCount}
        isOwnProfile={isOwnProfile}
        viewerSignedIn={Boolean(viewer)}
        initialFollowing={following}
        extraLinks={extraLinks}
      />

      <ProfileStores
        stores={stores}
        displayName={displayName}
        isOwnProfile={isOwnProfile}
      />

      <Suspense fallback={<PinnedRowSkeleton />}>
        <PinnedRow
          ownerId={profile.id}
          pinnedIds={profile.pinned_card_ids ?? []}
          ownerUsername={handle}
        />
      </Suspense>

      <section id="cards" aria-labelledby="cards-heading" className="mt-12 scroll-mt-24">
        <SectionTitle
          id="cards-heading"
          eyebrow="Cards"
          title={`Forged by ${displayName}`}
          count={profile.public_cards_count}
          noun="public card"
        />
        {profile.public_cards_count > 0 ? (
          <div className="mt-5">
            <ProfileCardFilters />
          </div>
        ) : null}
        <div className="mt-6">
          <Suspense
            key={`${cardParams.q}|${cardParams.color ?? ""}|${cardParams.type ?? ""}|${cardParams.sort}|${cardParams.page}`}
            fallback={<ProfileCardsSkeleton count={12} />}
          >
            <ProfileCards
              ownerId={profile.id}
              ownerUsername={handle}
              displayName={displayName}
              params={cardParams}
              totalPublic={profile.public_cards_count}
            />
          </Suspense>
        </div>
      </section>

      {publicDeckCount > 0 ? (
        <section id="decks" aria-labelledby="decks-heading" className="mt-14 scroll-mt-24">
          <SectionTitle
            id="decks-heading"
            eyebrow="Decks"
            title={`Decks by ${displayName}`}
            count={publicDeckCount}
            noun="public deck"
          />
          <div className="mt-6">
            <Suspense fallback={<ProfileDecksSkeleton />}>
              <ProfileDecks
                ownerId={profile.id}
                username={handle}
                total={publicDeckCount}
                owner={{ username: handle, display_name: profile.display_name }}
              />
            </Suspense>
          </div>
        </section>
      ) : null}
    </PageContainer>
  );
}

/** A section's heading: the gold eyebrow, an h2 (the page's one h1 is the
 *  creator's name) and its count. */
function SectionTitle({
  id,
  eyebrow,
  title,
  count,
  noun,
}: {
  id: string;
  eyebrow: string;
  title: string;
  count: number;
  noun: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-gold/20 pb-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
          {eyebrow}
        </span>
        <h2
          id={id}
          className="font-display text-2xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere] sm:text-3xl"
        >
          {title}
        </h2>
      </div>
      <span className="text-sm text-muted">
        {count} {noun}
        {count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The hero
// ---------------------------------------------------------------------------

function ProfileHero({
  profile,
  displayName,
  initial,
  followers,
  following,
  publicDeckCount,
  isOwnProfile,
  viewerSignedIn,
  initialFollowing,
  extraLinks,
}: {
  profile: ProfileWithStats;
  displayName: string;
  initial: string;
  followers: number;
  following: number;
  publicDeckCount: number;
  isOwnProfile: boolean;
  viewerSignedIn: boolean;
  initialFollowing: boolean;
  extraLinks: ProfileLink[];
}) {
  const joined = joinedLabel(profile.created_at);
  const stats: { label: string; value: number; href?: string }[] = [
    { label: profile.public_cards_count === 1 ? "Card" : "Cards", value: profile.public_cards_count, href: "#cards" },
    { label: publicDeckCount === 1 ? "Deck" : "Decks", value: publicDeckCount, href: publicDeckCount > 0 ? "#decks" : undefined },
    { label: followers === 1 ? "Follower" : "Followers", value: followers },
    { label: "Following", value: following },
  ];
  return (
    <section
      aria-labelledby="profile-name"
      className="overflow-hidden rounded-frame border border-border bg-surface"
    >
      {/* Only drawable profile pictures (migration 0127, lib/media/media-urls.ts). */}
      <ProfileBanner bannerUrl={profileMediaSrc("banner", profile.banner_url, profile.id)} />
      <div className="px-4 pb-6 sm:px-8 sm:pb-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <ProfileAvatar
            avatarUrl={profileMediaSrc("avatar", profile.avatar_url, profile.id)}
            initial={initial}
          />
          <div className="flex flex-wrap items-center gap-2 pt-3">
            {isOwnProfile ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/settings">
                  <Settings className="h-4 w-4" aria-hidden />
                  Edit profile
                </Link>
              </Button>
            ) : (
              <FollowButton
                targetUserId={profile.id}
                initialFollowing={initialFollowing}
                requiresSignIn={!viewerSignedIn}
              />
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="flex min-w-0 flex-col gap-2">
            <h1
              id="profile-name"
              className="font-display text-3xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere] sm:text-4xl"
            >
              {displayName}
            </h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <span className="font-mono">@{profile.username}</span>
              {joined ? (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                  Joined {joined}
                </span>
              ) : null}
            </p>
            {profile.bio ? (
              <p className="mt-1 max-w-[38rem] whitespace-pre-line text-base leading-7 text-foreground/90 [overflow-wrap:anywhere]">
                {profile.bio}
              </p>
            ) : null}
            <ProfileLinks profile={profile} extraLinks={extraLinks} />
          </div>

          <ul
            aria-label="Stats"
            className="grid grid-cols-4 overflow-hidden rounded-lg border border-border/70 bg-background/40 lg:min-w-[26rem]"
          >
            {stats.map((stat, i) => {
              const body = (
                <>
                  <span className="font-display text-xl font-semibold tabular-nums text-foreground sm:text-2xl">
                    {stat.value.toLocaleString("en-US")}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted sm:text-[11px]">
                    {stat.label}
                  </span>
                </>
              );
              const cell = "flex h-full flex-col items-center justify-center gap-0.5 px-1 py-3 text-center";
              return (
                <li key={stat.label} className={cn(i > 0 && "border-l border-border/70")}>
                  {stat.href ? (
                    <a
                      href={stat.href}
                      className={cn(
                        cell,
                        "transition-colors hover:bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-bright/60",
                      )}
                    >
                      {body}
                    </a>
                  ) : (
                    <div className={cell}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

function joinedLabel(createdAt: string | null | undefined): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

// The banner's box: 128 / 176 px tall, and from 1280 px a 7 : 1 strip — the
// shape it had in the standard frame (1216 × 176) — so the wide frame (up to
// 1856 px) shows the same ~57 % of a built-in 4 : 1 banner, not a thinner
// slice of it (TODO WD3).
const BANNER_BOX = "h-32 w-full sm:h-44 xl:aspect-[7/1] xl:h-auto";

function ProfileBanner({ bannerUrl }: { bannerUrl: string | null }) {
  if (bannerUrl) {
    return (
      <div className={`relative overflow-hidden ${BANNER_BOX}`}>
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
      className={BANNER_BOX}
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
}: {
  avatarUrl: string | null;
  initial: string;
}) {
  // Pulled up over the banner so the hero reads as an identity card. The
  // name sits in the h1 beside it, so the picture itself is decorative.
  const ringClass =
    "relative -mt-12 h-24 w-24 shrink-0 overflow-hidden rounded-full shadow-md ring-4 ring-surface sm:-mt-16 sm:h-32 sm:w-32";
  if (avatarUrl) {
    return (
      <div className={ringClass}>
        <Image
          src={avatarUrl}
          alt=""
          fill
          sizes="(min-width: 640px) 128px, 96px"
          className="object-cover"
          unoptimized
          priority
        />
      </div>
    );
  }
  return (
    <span
      className={`${ringClass} flex items-center justify-center bg-linear-to-br from-primary to-accent font-display text-4xl font-semibold text-primary-foreground`}
      aria-hidden
    >
      {initial}
    </span>
  );
}

const LINK_CHIP =
  "inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border border-border/70 bg-elevated/50 px-3 text-xs font-medium text-muted transition-colors hover:border-[var(--profile-accent,var(--color-primary))] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60";

/** Every link the creator added — website, the column socials, the 0153
 *  links — as labelled chips (the name is on screen, not only in a
 *  tooltip). The profile columns are host-gated by the profile schema; the
 *  0153 rows were re-checked by listProfileLinks. */
function ProfileLinks({
  profile,
  extraLinks,
}: {
  profile: ProfileWithStats;
  extraLinks: ProfileLink[];
}) {
  const socialEntries = SOCIAL_PLATFORMS.flatMap((p) => {
    const url = profile[p.key as SocialPlatformKey];
    return url ? [{ ...p, url }] : [];
  });

  if (!profile.website_url && socialEntries.length === 0 && extraLinks.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-wrap items-center gap-2" aria-label="Links">
      {profile.website_url ? (
        <li className="max-w-full">
          <a
            href={profile.website_url}
            target="_blank"
            rel={`me ${USER_LINK_REL}`}
            className={LINK_CHIP}
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{displayLink(profile.website_url)}</span>
          </a>
        </li>
      ) : null}
      {socialEntries.map((entry) => (
        <li key={entry.key}>
          <a href={entry.url} target="_blank" rel={`me ${USER_LINK_REL}`} className={LINK_CHIP}>
            <SocialIcon platform={entry.key} className="h-3.5 w-3.5 shrink-0" />
            {entry.label}
          </a>
        </li>
      ))}
      {extraLinks.map((link) => (
        <li key={link.id} className="max-w-full">
          <a href={link.url} target="_blank" rel={`me ${USER_LINK_REL}`} className={LINK_CHIP}>
            <LinkIcon kind={link.kind} className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {link.kind === "other" ? link.label : (linkKindOf(link.kind)?.label ?? profileLinkName(link))}
            </span>
            {link.kind !== "other" && link.label ? (
              <span className="sr-only"> — {link.label}</span>
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Store cards
// ---------------------------------------------------------------------------

function ProfileStores({
  stores,
  displayName,
  isOwnProfile,
}: {
  stores: ProfileStore[];
  displayName: string;
  isOwnProfile: boolean;
}) {
  if (stores.length === 0) {
    // The owner alone is told the section exists.
    if (!isOwnProfile) return null;
    return (
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-frame border border-dashed border-border px-5 py-4">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Store className="h-4 w-4 shrink-0" aria-hidden />
          Sell cards on TCGplayer, eBay or Whatnot? Add a store card and it shows here.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/settings#stores">
            <Plus className="h-4 w-4" aria-hidden />
            Add a store
          </Link>
        </Button>
      </div>
    );
  }
  return (
    <section aria-labelledby="stores-heading" className="mt-8">
      <h2
        id="stores-heading"
        className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--profile-accent,var(--color-primary-bright))]"
      >
        <Store className="h-3.5 w-3.5" aria-hidden />
        Shop with {displayName}
      </h2>
      <ul
        className={cn(
          "grid gap-4 sm:grid-cols-2",
          stores.length >= 3 && "xl:grid-cols-3",
          stores.length >= 4 && "2xl:grid-cols-4",
        )}
      >
        {stores.map((store) => (
          <li key={store.id} className="min-w-0">
            <StoreCard store={store} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pinned cards
// ---------------------------------------------------------------------------

async function PinnedRow({
  ownerId,
  pinnedIds,
  ownerUsername,
}: {
  ownerId: string;
  pinnedIds: string[];
  ownerUsername: string;
}) {
  if (!pinnedIds || pinnedIds.length === 0) return null;
  const [profileOverrides, cards] = await Promise.all([
    getFrameProfileOverrides(),
    listPinnedCardsForProfile(ownerId, pinnedIds),
  ]);
  if (cards.length === 0) return null;

  return (
    <section className="mt-10" aria-labelledby="pinned-heading">
      <h2
        id="pinned-heading"
        className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--profile-accent,var(--color-primary-bright))]"
      >
        <Pin className="h-3.5 w-3.5" aria-hidden />
        Pinned
      </h2>
      <CardGrid>
        {cards.map((card) => (
          <ProfileCardTile
            profileOverrides={profileOverrides}
            key={card.id}
            card={card}
            ownerUsername={ownerUsername}
          />
        ))}
      </CardGrid>
    </section>
  );
}

function PinnedRowSkeleton() {
  return (
    <section className="mt-10" aria-busy="true">
      <Skeleton className="mb-3 h-3 w-16" />
      <CardGrid>
        {[0, 1, 2].map((i) => (
          <CardPreviewSkeleton key={i} />
        ))}
      </CardGrid>
    </section>
  );
}

// ---------------------------------------------------------------------------
// All cards (searched, filtered, paged in the database)
// ---------------------------------------------------------------------------

async function ProfileCards({
  ownerId,
  ownerUsername,
  displayName,
  params,
  totalPublic,
}: {
  ownerId: string;
  ownerUsername: string;
  displayName: string;
  params: ProfileCardParams;
  totalPublic: number;
}) {
  if (totalPublic === 0) {
    return (
      <EmptyState
        icon={Heart}
        title="No public cards yet"
        description={`${displayName} hasn't published any cards publicly. Check back later or browse the gallery for other creators.`}
      />
    );
  }
  const offset = (params.page - 1) * PROFILE_CARDS_PAGE_SIZE;
  const [profileOverrides, { cards, total }] = await Promise.all([
    getFrameProfileOverrides(),
    listProfileCards(ownerId, {
      search: params.q,
      colorIdentity: params.color ?? undefined,
      cardType: params.type ?? undefined,
      sort: params.sort,
      limit: PROFILE_CARDS_PAGE_SIZE,
      offset,
    }),
  ]);
  const filtered = Boolean(params.q || params.color || params.type);

  if (cards.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title={filtered ? "No cards match" : "Nothing on this page"}
        description={
          filtered
            ? `None of ${displayName}'s public cards match these filters.`
            : "This page is past the last card."
        }
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={`/profile/${encodeURIComponent(ownerUsername)}#cards`} scroll={false}>
              Show all cards
            </Link>
          </Button>
        }
      />
    );
  }

  const pages = Math.max(1, Math.ceil(total / PROFILE_CARDS_PAGE_SIZE));
  const from = offset + 1;
  const to = offset + cards.length;
  return (
    <>
      <p className="mb-4 text-sm text-muted" aria-live="polite">
        {filtered
          ? `${total.toLocaleString("en-US")} ${total === 1 ? "card matches" : "cards match"}`
          : `Showing ${from}–${to} of ${total.toLocaleString("en-US")}`}
      </p>
      <CardGrid>
        {cards.map((card) => (
          <ProfileCardTile
            profileOverrides={profileOverrides}
            key={card.id}
            card={card}
            ownerUsername={ownerUsername}
          />
        ))}
      </CardGrid>
      {pages > 1 ? (
        <nav
          aria-label="Card pages"
          className="mt-10 flex items-center justify-between gap-3 border-t border-border/40 pt-6"
        >
          <span className="text-xs text-subtle">
            Page {params.page} of {pages}
          </span>
          <div className="flex items-center gap-2">
            {params.page > 1 ? (
              <Button asChild variant="outline" size="sm">
                <Link href={profileCardsHref(ownerUsername, params, params.page - 1)} rel="prev">
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Previous
                </Link>
              </Button>
            ) : null}
            {params.page < pages ? (
              <Button asChild size="sm">
                <Link href={profileCardsHref(ownerUsername, params, params.page + 1)} rel="next">
                  Next
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            ) : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}

function ProfileCardsSkeleton({ count }: { count: number }) {
  return (
    <CardGrid aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <CardPreviewSkeleton />
          <div className="flex items-center justify-between gap-2 text-xs">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-8" />
          </div>
        </div>
      ))}
    </CardGrid>
  );
}

function ProfileCardTile({
  card,
  ownerUsername,
  profileOverrides = null,
}: {
  card: CardWithStats;
  ownerUsername: string;
  profileOverrides?: FrameProfileOverridesMap | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <CardTile
        viewTransitionName={`card-${card.id}`}
        body={(slot) => (
          <Link
            href={buildCardPath({ slug: card.slug, owner: { username: ownerUsername } })}
            aria-label={`Open ${card.title}`}
            {...slot}
          />
        )}
        thumbnail={{
          renderedImageUrl: card.rendered_image_url,
          renderedThumbUrl: card.rendered_thumb_url,
          renderedBackThumbUrl: card.rendered_back_thumb_url,
          title: card.title,
          previewData: cardToPreviewData(card, profileOverrides),
          // Every profile tile sits in a CardGrid on the wide page.
          sizes: CARD_GRID_SIZES,
        }}
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted">{card.title}</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-muted">
          <Heart className="h-3 w-3" aria-hidden />
          <span className="sr-only">Likes:</span>
          {card.likes_count}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

/** How many decks the profile shows; past it, "See all decks". Eight fills
 *  the DeckGrid's rows at 1, 2 and 4 columns (a phone, a tablet, every
 *  window from 1408 px) and ends 3 + 3 + 2 at 3 — never a lone tile; six
 *  ended 4 + 2 on every wide screen, and twelve would double the section
 *  for a list that already links to all of them. */
const PROFILE_DECKS_MAX = 8;

async function ProfileDecks({
  ownerId,
  username,
  total,
  owner,
}: {
  ownerId: string;
  username: string;
  /** countPublicDecksByOwner — the decks listPublicDecksByOwner lists. */
  total: number;
  owner: { username: string; display_name: string | null };
}) {
  const decks = await listPublicDecksByOwner(ownerId, PROFILE_DECKS_MAX);
  if (decks.length === 0) return null;
  // Cookie-free like the list (the page's like states hydrate client-side).
  const art = await listDeckTileArt(decks, { anonymous: true });

  return (
    <>
      {/* DeckGrid is grid-cols-1 (minmax(0, 1fr)) and DeckTile is
          min-w-0: a long one-word deck title wraps instead of widening a
          390 px page. */}
      <DeckGrid>
        {decks.map((deck) => (
          <DeckTile
            key={deck.id}
            deck={{ ...deck, owner }}
            art={art.get(deck.id)}
            sizes={DECK_GRID_SIZES}
            likeRedirect={`/profile/${username}`}
          />
        ))}
      </DeckGrid>
      {total > decks.length ? (
        <div className="mt-6">
          <Button asChild variant="outline" size="sm">
            <Link href={`/decks/browse?owner=${encodeURIComponent(username)}`}>
              See all {total} decks
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
      ) : null}
    </>
  );
}

function ProfileDecksSkeleton() {
  return (
    <DeckGrid>
      {Array.from({ length: 3 }).map((_, i) => (
        <DeckTileSkeleton key={i} />
      ))}
    </DeckGrid>
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
