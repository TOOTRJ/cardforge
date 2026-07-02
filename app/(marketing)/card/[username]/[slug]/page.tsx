import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { after } from "next/server";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Clock,
  ExternalLink,
  Eye,
  Flame,
  Heart,
  Layers,
  MessageCircle,
  Pencil,
  Repeat2,
  Trophy,
} from "lucide-react";
import { CardPreview } from "@/components/cards/card-preview";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { getPipOverrides } from "@/lib/pips/queries";
import { CardComments } from "@/components/cards/card-comments";
import { DownloadModal } from "@/components/cards/download-modal";
import { LikeButton } from "@/components/cards/like-button";
import { RemixButton } from "@/components/cards/remix-button";
import { ShareTargets } from "@/components/cards/share-targets";
import { ReportCardDialog } from "@/components/cards/report-card-dialog";
import { GalleryCardTile } from "@/components/cards/gallery-card-tile";
import { FollowButton } from "@/components/follows/follow-button";
import { isFollowing } from "@/lib/follows/queries";
import { SocialIcon } from "@/components/profile/social-icon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/lib/auth/schemas";
import {
  countCardLikes,
  countRemixesOfCard,
  countSetsForCard,
  getCardById,
  getCardByOwnerAndSlug,
  getCardLikeRankInSet,
  getCardLikeRankOverall,
  getCardTrendingSignals,
  getProfileByUsername,
  getRemixParentLink,
  getSetSummary,
  hasUserLikedCard,
  incrementCardView,
  listMoreFromOwner,
  listRelatedCards,
  listTopRemixesOfCard,
  type CardWithStats,
  type ProfileWithStats,
} from "@/lib/cards/queries";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { countPublicRemixesBySource } from "@/lib/cards/source-queries";
import { listCommentsForCard } from "@/lib/cards/comments-queries";
import { getCurrentUser } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { RENDER_PRESETS } from "@/lib/render/card-image";
import { getSiteBaseUrl } from "@/lib/site-url";
import { breadcrumbJsonLd, JsonLd } from "@/components/seo/json-ld";
import type { ArtPosition, CardBackFace, FrameStyle } from "@/types/card";
import { Sparkles } from "lucide-react";

// ---------------------------------------------------------------------------
// Canonical public card detail page (Phase 11 chunk 11).
//
// URL: /card/[username]/[slug]
//
// The username-namespaced URL eliminates slug ambiguity — two different
// owners can each have a card named "lightning-bolt" without one
// hijacking the other's public link. The legacy `/card/[slug]` route is
// preserved as a 301 redirector (see app/(marketing)/card/[slug]/page.tsx).
//
// RLS gates which cards the viewer can read: anonymous + non-owner
// viewers only see `public` / `unlisted` rows. Owners see their private
// cards via this URL too, which lets them preview the public-facing
// rendering before flipping visibility.
// ---------------------------------------------------------------------------

type Params = { username: string; slug: string };

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : ""))
    .join(" ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { username, slug } = await params;
  if (!isSupabaseConfigured()) {
    return { title: titleFromSlug(slug) };
  }
  const card = await getCardByOwnerAndSlug(username, slug);
  if (!card) {
    return { title: titleFromSlug(slug) };
  }

  const isShareable =
    card.visibility === "public" || card.visibility === "unlisted";
  const description =
    card.flavor_text?.trim() ||
    card.rules_text?.trim() ||
    "A custom trading card on PipGlyph.";

  const ogImageUrl = isShareable ? `/api/cards/${card.id}/og` : undefined;
  const { width, height } = RENDER_PRESETS.default;

  return {
    // Unlisted cards are reachable by link but shouldn't enter the index;
    // private renders only ever reach the owner, but belt-and-braces.
    robots: card.visibility !== "public" ? { index: false, follow: false } : undefined,
    title: card.title,
    description,
    openGraph: ogImageUrl
      ? {
          title: `${card.title} · PipGlyph`,
          description,
          type: "article",
          url: `/card/${username}/${card.slug}`,
          images: [
            {
              url: ogImageUrl,
              width,
              height,
              alt: `${card.title} card preview`,
            },
          ],
        }
      : undefined,
    twitter: ogImageUrl
      ? {
          card: "summary_large_image",
          title: `${card.title} · PipGlyph`,
          description,
          images: [ogImageUrl],
        }
      : undefined,
    alternates: {
      canonical: `/card/${username}/${card.slug}`,
    },
  };
}

export default async function CardDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { username, slug } = await params;
  const card = isSupabaseConfigured()
    ? await getCardByOwnerAndSlug(username, slug)
    : null;

  if (!card) {
    notFound();
  }

  // v2 back face: the referenced card, if any and if it's readable (RLS scopes
  // the anon client to shareable cards). Rendered on the flip.
  const backCard = card.back_card_id
    ? await getCardById(card.back_card_id)
    : null;

  const user = await getCurrentUser();
  const isOwner = Boolean(user && user.id === card.owner_id);

  const [
    likesCount,
    viewerLiked,
    otherRemixesCount,
    comments,
    entitlements,
    moreFromOwner,
    relatedCards,
    pipOverrides,
    creatorProfile,
    viewerFollows,
    remixCount,
    setCount,
    topRemixes,
    remixParent,
    overallRank,
    setSummary,
    inSetRank,
    trendingSignals,
  ] = await Promise.all([
    countCardLikes(card.id),
    user ? hasUserLikedCard(user.id, card.id) : Promise.resolve(false),
    // Chunk 13: count of OTHER public remixes of the same Scryfall card.
    // Returns 0 when this card wasn't imported from Scryfall.
    card.source_scryfall_id
      ? countPublicRemixesBySource(card.source_scryfall_id, card.id)
      : Promise.resolve(0),
    listCommentsForCard(card.id, { limit: 50 }),
    getEntitlements(),
    listMoreFromOwner(card.owner_id, card.id, 4),
    listRelatedCards(
      { cardId: card.id, ownerId: card.owner_id, cardType: card.card_type },
      4,
    ),
    // The owner's custom pip icons — shared by the preview AND the cost row.
    getPipOverrides(card.owner_id),
    // Full creator profile (bio + socials + avatar) for the featured card.
    getProfileByUsername(username),
    // Whether the viewer already follows the creator (drives the Follow button).
    user && !isOwner
      ? isFollowing(card.owner_id)
      : Promise.resolve(false),
    // Analytics: remix + set membership counts, and the top-liked remixes.
    countRemixesOfCard(card.id),
    countSetsForCard(card.id),
    listTopRemixesOfCard(card.id, 4),
    // Provenance: the original card this was remixed from (if any).
    card.parent_card_id
      ? getRemixParentLink(card.parent_card_id)
      : Promise.resolve(null),
    // Popularity rank overall + within the card's primary set.
    getCardLikeRankOverall(card.id),
    card.primary_set_id
      ? getSetSummary(card.primary_set_id)
      : Promise.resolve(null),
    card.primary_set_id
      ? getCardLikeRankInSet(card.id, card.primary_set_id)
      : Promise.resolve(null),
    // 7-day velocity for the trending badge.
    getCardTrendingSignals(card.id, card.owner_id, card.created_at),
  ]);

  // Bump the view tally after the response ships — never for the owner's own
  // views, and never blocking render. Uses a public client + SECURITY DEFINER
  // RPC, so it can't rotate the viewer's session (see incrementCardView).
  if (!isOwner) {
    after(() => incrementCardView(card.id));
  }

  const ownerProfile = card.owner;

  const createdAt = formatDate(card.created_at);

  const siteBase = getSiteBaseUrl();
  const isShareable =
    card.visibility === "public" || card.visibility === "unlisted";
  const jsonLd = isShareable
    ? buildCardJsonLd({
        card,
        username,
        ownerDisplay:
          ownerProfile?.display_name || ownerProfile?.username || "Anonymous",
        siteBase,
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      {jsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      ) : null}
      {/* Breadcrumbs only for indexable cards — unlisted pages are noindex,
          so hierarchy signals there are wasted bytes. */}
      {card.visibility === "public" ? (
        <JsonLd
          data={breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Gallery", path: "/gallery" },
            { name: card.title, path: `/card/${username}/${card.slug}` },
          ])}
        />
      ) : null}
      <Link
        href="/gallery"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to gallery
      </Link>

      <div className="flex flex-col gap-10">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,360px)_1fr]">
        <div
          className="mx-auto w-full max-w-sm"
          // Matches the gallery / dashboard / profile / set thumbnails'
          // view-transition-name so chromium-class browsers can animate a
          // shared-element transition between the grid tile and this hero.
          style={{ viewTransitionName: `card-${card.id}` }}
        >
          <CardPreview
            title={card.title}
            cost={card.cost}
            pipOverrides={pipOverrides}
            profileOverrides={await getFrameProfileOverrides()}
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
            setIconUrl={card.set_icon_url}
            setIconCode={card.set_icon_code}
            backFace={(card.back_face as CardBackFace | null) ?? null}
            backCard={backCard ? cardToPreviewData(backCard) : null}
          />
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={card.visibility === "public" ? "primary" : "outline"}
              >
                {visibilityLabel(card.visibility)}
              </Badge>
              {ownerProfile?.username ? (
                <Link
                  href={`/profile/${ownerProfile.username}`}
                  className="text-xs text-muted transition-colors hover:text-foreground"
                >
                  by{" "}
                  <span className="font-mono text-foreground">
                    @{ownerProfile.username}
                  </span>
                </Link>
              ) : null}
              <span className="text-xs text-subtle">· {createdAt}</span>
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {card.title}
            </h1>
            {/* Chunk 13: "Also remixed by N others" chip. Only renders
                when this card was imported from Scryfall AND at least
                one other public/unlisted remix exists. Click-through
                lands on the gallery filtered by the same source. */}
            {card.source_scryfall_id && otherRemixesCount > 0 ? (
              <Link
                href={`/gallery?source=${encodeURIComponent(card.source_scryfall_id)}`}
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-foreground transition-colors hover:border-accent hover:bg-accent/15"
              >
                <Sparkles className="h-3 w-3 text-accent" aria-hidden />
                Also remixed by {otherRemixesCount}{" "}
                {otherRemixesCount === 1 ? "other" : "others"}
              </Link>
            ) : null}

            {/* Provenance — a remix of another PipGlyph card, and/or based on a
                real card imported from Scryfall. Both open in a new tab. */}
            {remixParent ? (
              <p className="inline-flex flex-wrap items-center gap-1.5 text-sm text-muted">
                <Repeat2 className="h-4 w-4 text-primary-bright" aria-hidden />
                Remixed from{" "}
                <Link
                  href={remixParent.path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-2 hover:text-primary-bright hover:underline"
                >
                  {remixParent.title}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </p>
            ) : null}
            {card.source_scryfall_id ? (
              <a
                href={`/go/scryfall/${card.source_scryfall_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1.5 text-sm text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                <Sparkles className="h-4 w-4 text-accent" aria-hidden />
                Based on a real card — view on Scryfall
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <LikeButton
              cardId={card.id}
              cardSlug={card.slug}
              ownerUsername={username}
              initialLiked={viewerLiked}
              initialCount={likesCount}
              requiresSignIn={!user}
            />
            <RemixButton
              cardId={card.id}
              cardSlug={card.slug}
              ownerUsername={username}
              requiresSignIn={!user}
            />
            {isOwner ? (
              <Button asChild>
                <Link href={`/card/${card.slug}/edit`}>
                  <Pencil className="h-4 w-4" aria-hidden /> Edit card
                </Link>
              </Button>
            ) : null}
            <DownloadModal
              cardId={card.id}
              cardSlug={card.slug}
              isPaid={entitlements.isPaid}
              canBatch={entitlements.allowBatchExport}
            />
            <ShareTargets
              cardTitle={card.title}
              cardUrl={`${siteBase}/card/${username}/${card.slug}`}
            />
            {user && !isOwner ? <ReportCardDialog cardId={card.id} /> : null}
          </div>

          {creatorProfile ? (
            <CreatorFeature
              profile={creatorProfile}
              targetUserId={card.owner_id}
              isOwner={isOwner}
              initialFollowing={viewerFollows}
              requiresSignIn={!user}
            />
          ) : null}

          <SurfaceCard className="grid gap-4 p-6 sm:grid-cols-2">
            <Detail
              label="Card type"
              value={card.card_type ? capitalize(card.card_type) : "—"}
            />
            <Detail
              label="Rarity"
              value={card.rarity ? capitalize(card.rarity) : "—"}
            />
            <Detail
              label="Cost"
              value={
                card.cost?.trim() ? (
                  <ManaCostGlyphs
                    cost={card.cost}
                    size="sm"
                    overrides={pipOverrides}
                  />
                ) : (
                  "—"
                )
              }
            />
            <Detail
              label="Color identity"
              value={
                card.color_identity.length > 0
                  ? card.color_identity.map(capitalize).join(", ")
                  : "—"
              }
            />
            <Detail
              label="Power / Toughness"
              value={
                card.power || card.toughness
                  ? `${card.power ?? "—"} / ${card.toughness ?? "—"}`
                  : "—"
              }
            />
            <Detail label="Visibility" value={visibilityLabel(card.visibility)} />
          </SurfaceCard>

          {/* Discovery tags — at the bottom of the info card. */}
          {card.tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {card.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/gallery?tag=${encodeURIComponent(tag)}`}
                  className="inline-flex items-center rounded-full border border-border/60 bg-elevated/60 px-2.5 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        </div>

        {/* Full-width below the card + info: analytics and the comment thread
            get the whole content width for a bigger, more scannable display. */}
        <CardAnalytics
          views={card.view_count}
          likes={likesCount}
          remixes={remixCount}
          sets={setCount}
          comments={comments.length}
          createdAt={card.created_at}
          updatedAt={card.updated_at}
          trendingSignals={trendingSignals}
          overallRank={overallRank}
          setContext={
            setSummary
              ? {
                  title: setSummary.title,
                  slug: setSummary.slug,
                  cardsCount: setSummary.cardsCount,
                  rank: inSetRank,
                }
              : null
          }
          topRemixes={topRemixes}
          isAuthed={Boolean(user)}
        />

        <CardComments
          cardId={card.id}
          cardSlug={card.slug}
          ownerUsername={username}
          initialComments={comments}
          currentUserId={user?.id ?? null}
        />
      </div>

      {moreFromOwner.length > 0 || relatedCards.length > 0 ? (
        <div className="mt-14 flex flex-col gap-12">
          {moreFromOwner.length > 0 ? (
            <RelatedRow
              title={`More from @${username}`}
              viewAllHref={`/profile/${username}`}
              cards={moreFromOwner}
              isAuthed={Boolean(user)}
            />
          ) : null}
          {relatedCards.length > 0 ? (
            <RelatedRow
              title="More like this"
              viewAllHref={
                card.card_type ? `/gallery?type=${card.card_type}` : "/gallery"
              }
              cards={relatedCards}
              isAuthed={Boolean(user)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RelatedRow({
  title,
  viewAllHref,
  cards,
  isAuthed,
}: {
  title: string;
  viewAllHref: string;
  cards: CardWithStats[];
  isAuthed: boolean;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">
          {title}
        </h2>
        <Link
          href={viewAllHref}
          className="shrink-0 text-xs font-semibold text-primary-bright underline-offset-4 hover:underline"
        >
          View all →
        </Link>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <GalleryCardTile key={card.id} card={card} isAuthed={isAuthed} />
        ))}
      </div>
    </section>
  );
}

function visibilityLabel(visibility: "private" | "unlisted" | "public"): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "unlisted":
      return "Unlisted";
    default:
      return "Private";
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(value: string): string {
  try {
    const date = new Date(value);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  } catch {
    return "—";
  }
}

// ---------------------------------------------------------------------------
// CardAnalytics — "By the numbers": engagement + provenance stats for the
// card, plus its most-liked remixes. Replaces the old rules/flavor panels
// (that text already lives on the rendered card itself).
// ---------------------------------------------------------------------------

function CardAnalytics({
  views,
  likes,
  remixes,
  sets,
  comments,
  createdAt,
  updatedAt,
  trendingSignals,
  overallRank,
  setContext,
  topRemixes,
  isAuthed,
}: {
  views: number;
  likes: number;
  remixes: number;
  sets: number;
  comments: number;
  createdAt: string;
  updatedAt: string;
  trendingSignals: {
    likes_7d: number;
    comments_7d: number;
    remixes_7d: number;
    is_fresh: boolean;
  };
  overallRank: number | null;
  setContext: {
    title: string;
    slug: string;
    cardsCount: number;
    rank: number | null;
  } | null;
  topRemixes: CardWithStats[];
  isAuthed: boolean;
}) {
  const stats: {
    icon: typeof Heart;
    label: string;
    value: number;
  }[] = [
    { icon: Eye, label: "Views", value: views },
    { icon: Heart, label: "Likes", value: likes },
    { icon: Repeat2, label: "Remixes", value: remixes },
    { icon: Layers, label: sets === 1 ? "Set" : "Sets", value: sets },
    { icon: MessageCircle, label: "Comments", value: comments },
  ];
  // "Trending" needs real momentum this week — freshness alone (a brand-new
  // card with no engagement) shouldn't earn the badge, even though it scores.
  const recentEngagement =
    trendingSignals.likes_7d +
    trendingSignals.comments_7d +
    trendingSignals.remixes_7d;
  const isTrending = recentEngagement > 0;
  const hasRankLines = (overallRank && likes > 0) || setContext;

  return (
    <SurfaceCard className="flex flex-col gap-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-foreground">
          By the numbers
        </h2>
        {isTrending ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            <Flame className="h-3.5 w-3.5" aria-hidden />
            Trending this week
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="flex flex-col items-center gap-1 rounded-lg border border-border/50 bg-elevated/40 p-4 text-center"
            >
              <Icon className="h-5 w-5 text-muted" aria-hidden />
              <span className="font-display text-3xl font-semibold tabular-nums text-foreground">
                {s.value}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
                {s.label}
              </span>
            </div>
          );
        })}
      </div>

      {isTrending ? (
        <p className="text-xs text-muted">
          Past 7 days: {trendingSignals.likes_7d} like
          {trendingSignals.likes_7d === 1 ? "" : "s"} ·{" "}
          {trendingSignals.comments_7d} comment
          {trendingSignals.comments_7d === 1 ? "" : "s"} ·{" "}
          {trendingSignals.remixes_7d} remix
          {trendingSignals.remixes_7d === 1 ? "" : "es"}
          {trendingSignals.is_fresh ? " · freshly forged" : ""}.
        </p>
      ) : null}

      {hasRankLines ? (
        <div className="flex flex-col gap-2 text-sm">
          {overallRank && likes > 0 ? (
            <span className="inline-flex items-center gap-2 text-muted">
              <Trophy className="h-4 w-4 text-gold-strong" aria-hidden />
              <span className="font-semibold text-foreground">
                #{overallRank}
              </span>{" "}
              most-liked card overall
            </span>
          ) : null}
          {setContext ? (
            <span className="inline-flex flex-wrap items-center gap-1.5 text-muted">
              <Layers className="h-4 w-4 text-subtle" aria-hidden />
              Part of{" "}
              <Link
                href={`/set/${setContext.slug}`}
                className="font-medium text-foreground underline-offset-2 hover:text-primary-bright hover:underline"
              >
                {setContext.title}
              </Link>{" "}
              ({setContext.cardsCount} card
              {setContext.cardsCount === 1 ? "" : "s"})
              {setContext.rank ? (
                <>
                  {" · "}
                  <span className="font-semibold text-foreground">
                    #{setContext.rank}
                  </span>{" "}
                  in the set
                </>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-subtle" aria-hidden />
          Created {formatDate(createdAt)}
        </span>
        {updatedAt !== createdAt ? (
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-subtle" aria-hidden />
            Updated {formatDate(updatedAt)}
          </span>
        ) : null}
      </div>

      {topRemixes.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">
            Top remixes
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {topRemixes.map((remix) => (
              <GalleryCardTile
                key={remix.id}
                card={remix}
                isAuthed={isAuthed}
              />
            ))}
          </div>
        </div>
      ) : null}
    </SurfaceCard>
  );
}

// ---------------------------------------------------------------------------
// CreatorFeature — the card's maker, featured beneath the card's own info.
// Avatar + name + bio + social links, with the profile's accent tint. Second
// in prominence to the card itself.
// ---------------------------------------------------------------------------

function CreatorFeature({
  profile,
  targetUserId,
  isOwner,
  initialFollowing,
  requiresSignIn,
}: {
  profile: ProfileWithStats;
  targetUserId: string;
  isOwner: boolean;
  initialFollowing: boolean;
  requiresSignIn: boolean;
}) {
  const displayName =
    profile.display_name?.trim() || profile.username || "Forgemaster";
  const initial = displayName.charAt(0).toUpperCase();
  const profileHref = profile.username ? `/profile/${profile.username}` : null;
  const cardsCount = profile.public_cards_count;

  const socialEntries = SOCIAL_PLATFORMS.flatMap((p) => {
    const url = profile[p.key as SocialPlatformKey];
    return url ? [{ ...p, url }] : [];
  });

  const accentStyle = profile.accent_color
    ? ({ "--profile-accent": profile.accent_color } as React.CSSProperties)
    : undefined;

  return (
    <SurfaceCard
      className="flex flex-col gap-4 border-t-2 border-t-[var(--profile-accent,var(--color-primary))] p-6"
      style={accentStyle}
    >
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        Creator
      </span>

      <div className="flex items-start gap-4">
        {profile.avatar_url ? (
          <Image
            src={profile.avatar_url}
            alt={`${displayName} avatar`}
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded-full border border-border/60 object-cover"
          />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border/60 bg-elevated text-xl font-semibold text-foreground">
            {initial}
          </span>
        )}

        <div className="flex min-w-0 flex-col gap-0.5">
          {profileHref ? (
            <Link
              href={profileHref}
              className="font-display text-lg font-semibold tracking-tight text-foreground transition-colors hover:text-primary-bright"
            >
              {displayName}
            </Link>
          ) : (
            <span className="font-display text-lg font-semibold tracking-tight text-foreground">
              {displayName}
            </span>
          )}
          {profile.username ? (
            <span className="font-mono text-xs text-muted">
              @{profile.username}
            </span>
          ) : null}
          <span className="text-xs text-subtle">
            {cardsCount} public card{cardsCount === 1 ? "" : "s"}
          </span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {!isOwner ? (
            <FollowButton
              targetUserId={targetUserId}
              initialFollowing={initialFollowing}
              requiresSignIn={requiresSignIn}
            />
          ) : null}
          {profileHref ? (
            <Button asChild variant="outline" size="sm">
              <Link href={profileHref}>View profile</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {profile.bio?.trim() ? (
        <p className="whitespace-pre-line text-sm leading-6 text-muted">
          {profile.bio}
        </p>
      ) : null}

      {profile.website_url || socialEntries.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          {profile.website_url ? (
            <a
              href={profile.website_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary-bright hover:underline"
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
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-elevated/60 text-muted transition-colors hover:bg-elevated hover:text-[var(--profile-accent,var(--color-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
                  >
                    <SocialIcon platform={entry.key} className="h-4 w-4" />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </SurfaceCard>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </span>
      <span className="flex min-h-6 items-center text-sm text-foreground">
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON-LD CreativeWork
//
// Lets Google / ChatGPT / Perplexity describe the card accurately when a
// user asks about it. We emit only the fields we actually have — no
// fabricated authors or licenses. The image URL points at the public OG
// renderer so social unfurls and search-result thumbnails match.
// ---------------------------------------------------------------------------

function buildCardJsonLd({
  card,
  username,
  ownerDisplay,
  siteBase,
}: {
  card: {
    id: string;
    title: string;
    slug: string;
    created_at: string;
    updated_at: string;
    flavor_text: string | null;
    rules_text: string | null;
    artist_credit: string | null;
  };
  username: string;
  ownerDisplay: string;
  siteBase: string;
}): Record<string, unknown> {
  const description =
    card.flavor_text?.trim() ||
    card.rules_text?.trim() ||
    "A custom Magic: The Gathering card forged on PipGlyph.";
  const truncatedDescription =
    description.length > 280 ? `${description.slice(0, 277)}…` : description;

  const canonical = `${siteBase}/card/${username}/${card.slug}`;

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: card.title,
    headline: card.title,
    description: truncatedDescription,
    url: canonical,
    mainEntityOfPage: canonical,
    datePublished: card.created_at,
    dateModified: card.updated_at,
    image: `${siteBase}/api/cards/${card.id}/og`,
    author: {
      "@type": "Person",
      name: ownerDisplay,
      url: `${siteBase}/profile/${username}`,
    },
    creator: {
      "@type": "Person",
      name: ownerDisplay,
      url: `${siteBase}/profile/${username}`,
    },
    publisher: {
      "@type": "Organization",
      name: "PipGlyph",
      url: siteBase,
    },
    inLanguage: "en",
    isAccessibleForFree: true,
    genre: "Fan-made custom Magic: The Gathering card",
  };

  if (card.artist_credit?.trim()) {
    schema.contributor = {
      "@type": "Person",
      name: card.artist_credit.trim(),
    };
  }

  return schema;
}
