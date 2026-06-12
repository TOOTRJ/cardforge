import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { CardPreview } from "@/components/cards/card-preview";
import { getPipOverrides } from "@/lib/pips/queries";
import { CardComments } from "@/components/cards/card-comments";
import { DownloadModal } from "@/components/cards/download-modal";
import { LikeButton } from "@/components/cards/like-button";
import { RemixButton } from "@/components/cards/remix-button";
import { ShareTargets } from "@/components/cards/share-targets";
import { ReportCardDialog } from "@/components/cards/report-card-dialog";
import { GalleryCardTile } from "@/components/cards/gallery-card-tile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import {
  countCardLikes,
  getCardByOwnerAndSlug,
  hasUserLikedCard,
  listMoreFromOwner,
  listRelatedCards,
  type CardWithStats,
} from "@/lib/cards/queries";
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
  ]);

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
            pipOverrides={await getPipOverrides(card.owner_id)}
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
            <p className="text-sm leading-6 text-muted">
              Slug: <span className="font-mono text-foreground">{card.slug}</span>
            </p>
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

          <SurfaceCard className="grid gap-4 p-6 sm:grid-cols-2">
            <Detail
              label="Card type"
              value={card.card_type ? capitalize(card.card_type) : "—"}
            />
            <Detail
              label="Rarity"
              value={card.rarity ? capitalize(card.rarity) : "—"}
            />
            <Detail label="Cost" value={card.cost ?? "—"} />
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

          <SurfaceCard className="flex flex-col gap-3 p-6">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Rules text
            </h2>
            <p className="whitespace-pre-line text-sm leading-6 text-muted">
              {card.rules_text?.trim() || "No rules text yet."}
            </p>
          </SurfaceCard>

          {card.flavor_text?.trim() ? (
            <SurfaceCard className="flex flex-col gap-3 p-6">
              <h2 className="font-display text-lg font-semibold text-foreground">
                Flavor text
              </h2>
              <p className="text-sm leading-6 italic text-muted">
                {card.flavor_text}
              </p>
            </SurfaceCard>
          ) : null}

          <CardComments
            cardId={card.id}
            cardSlug={card.slug}
            ownerUsername={username}
            initialComments={comments}
            currentUserId={user?.id ?? null}
          />
        </div>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </span>
      <span className="text-sm text-foreground">{value}</span>
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
