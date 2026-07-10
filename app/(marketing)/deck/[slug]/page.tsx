import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { AlertTriangle, ArrowLeft, BookOpen, Pencil } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DeckAnalyticsPanel } from "@/components/decks/deck-analytics-panel";
import { DeckCardList } from "@/components/decks/deck-card-list";
import { QuickLikeButton } from "@/components/cards/quick-like-button";
import { ShareTargets } from "@/components/cards/share-targets";
import {
  getDeckBySlugWithOwner,
  incrementDeckView,
  listDeckCards,
  viewerLikesDeck,
} from "@/lib/decks/queries";
import { computeDeckAnalytics } from "@/lib/decks/analytics";
import { validateDeck } from "@/lib/decks/format-rules";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getSiteBaseUrl } from "@/lib/site-url";
import { breadcrumbJsonLd, JsonLd } from "@/components/seo/json-ld";
import { DECK_FORMAT_LABELS, type DeckFormat } from "@/types/deck";

type Params = { slug: string };

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
  const { slug } = await params;
  if (!isSupabaseConfigured()) {
    return { title: titleFromSlug(slug) };
  }
  const deck = await getDeckBySlugWithOwner(slug);
  if (!deck) return { title: titleFromSlug(slug) };

  const isShareable =
    deck.visibility === "public" || deck.visibility === "unlisted";
  const description =
    deck.description?.trim() ||
    `A ${DECK_FORMAT_LABELS[deck.format]} deck rebuilt with custom cards on PipGlyph.`;

  // og:image comes from the sibling opengraph-image.tsx file route.
  return {
    title: deck.title,
    description,
    // Unlisted decks are reachable by link but shouldn't enter the index.
    robots:
      deck.visibility !== "public"
        ? { index: false, follow: false }
        : undefined,
    alternates: { canonical: `/deck/${deck.slug}` },
    openGraph: isShareable
      ? {
          title: `${deck.title} · PipGlyph`,
          description,
          type: "article",
          siteName: "PipGlyph",
          url: `/deck/${deck.slug}`,
        }
      : undefined,
    twitter: isShareable
      ? {
          card: "summary_large_image",
          title: `${deck.title} · PipGlyph`,
          description,
        }
      : undefined,
  };
}

export default async function DeckDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  // Deck + auth are needed to render the header / owner chip — keep them on
  // the page shell. The entry list + analytics live behind a Suspense
  // boundary so the cover + title paint immediately.
  const [deck, user] = await Promise.all([
    isSupabaseConfigured() ? getDeckBySlugWithOwner(slug) : null,
    getCurrentUser(),
  ]);
  if (!deck) notFound();

  const isOwner = Boolean(user && user.id === deck.owner_id);
  const isPublic = deck.visibility === "public";
  const likedByViewer = user ? await viewerLikesDeck(deck.id) : false;

  // Best-effort lifetime view tally, off the request path; owner views don't
  // count (matches increment_card_view's posture).
  if (!isOwner) {
    after(() => incrementDeckView(deck.id));
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Structured data only for indexable (public) decks — unlisted pages
          are noindex, so schema there is dead weight. */}
      {isPublic ? (
        <>
          <JsonLd
            data={breadcrumbJsonLd([
              { name: "Home", path: "/" },
              { name: "Community decks", path: "/decks" },
              { name: deck.title, path: `/deck/${deck.slug}` },
            ])}
          />
          <JsonLd
            data={buildDeckCollectionJsonLd({
              title: deck.title,
              description: deck.description,
              slug: deck.slug,
              format: deck.format,
              ownerUsername: deck.owner?.username ?? null,
              ownerDisplay:
                deck.owner?.display_name || deck.owner?.username || null,
            })}
          />
        </>
      ) : null}
      <Link
        href="/decks"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to decks
      </Link>

      {/* Cover + header */}
      <SurfaceCard className="overflow-hidden p-0">
        {deck.cover_url ? (
          <div className="relative aspect-[5/2] w-full overflow-hidden bg-elevated">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={deck.cover_url}
              alt={`${deck.title} cover`}
              className="h-full w-full object-cover"
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-4 p-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="primary">{DECK_FORMAT_LABELS[deck.format]}</Badge>
              {deck.visibility !== "public" ? (
                <Badge variant="outline">{deck.visibility}</Badge>
              ) : null}
              {deck.owner?.username ? (
                <Link
                  href={`/profile/${deck.owner.username}`}
                  className="text-xs text-muted transition-colors hover:text-foreground"
                >
                  by{" "}
                  <span className="font-mono text-foreground">
                    @{deck.owner.username}
                  </span>
                </Link>
              ) : null}
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {deck.title}
            </h1>
            {deck.description ? (
              <p className="max-w-2xl text-sm leading-6 text-muted">
                {deck.description}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <QuickLikeButton
              kind="deck"
              deckId={deck.id}
              deckSlug={deck.slug}
              ownerUsername={deck.owner?.username ?? null}
              initialLiked={likedByViewer}
              initialCount={deck.likes_count}
              requiresSignIn={!user}
              redirectAfterLogin={`/deck/${deck.slug}`}
              className="h-9 border border-border px-3"
            />
            <ShareTargets
              title={deck.title}
              url={`${getSiteBaseUrl()}/deck/${deck.slug}`}
              entity="deck"
              itemId={deck.id}
            />
            {isOwner ? (
              <Button asChild>
                <Link href={`/deck/${deck.slug}/edit`}>
                  <Pencil className="h-4 w-4" aria-hidden /> Edit deck
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </SurfaceCard>

      <Suspense fallback={<DeckBodySkeleton />}>
        <DeckBody
          deckId={deck.id}
          deckSlug={deck.slug}
          format={deck.format}
          ownerUsername={deck.owner?.username ?? null}
          isOwner={isOwner}
        />
      </Suspense>
    </div>
  );
}

async function DeckBody({
  deckId,
  deckSlug,
  format,
  ownerUsername,
  isOwner,
}: {
  deckId: string;
  deckSlug: string;
  format: DeckFormat;
  ownerUsername: string | null;
  isOwner: boolean;
}) {
  const items = await listDeckCards(deckId);
  const analytics = computeDeckAnalytics(items);
  const warnings = validateDeck(
    format,
    items.map((i) => i.entry),
  );

  return (
    <>
      {warnings.length > 0 ? (
        <SurfaceCard className="mt-8 flex flex-col gap-2 border-gold/40 bg-gold/5 p-5">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            Format check — {DECK_FORMAT_LABELS[format]}
          </span>
          <ul className="flex flex-col gap-1 text-sm leading-6 text-muted">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </SurfaceCard>
      ) : null}

      <section className="mt-10">
        <PageHeader
          eyebrow="Analytics"
          title="Deck breakdown"
          description="Mana curve, colors, and remix progress across the deck."
        />
        <div className="mt-6">
          <DeckAnalyticsPanel analytics={analytics} />
        </div>
      </section>

      <section className="mt-12">
        <PageHeader
          eyebrow="Cards"
          title={`${analytics.total} card${analytics.total === 1 ? "" : "s"}`}
          description="Remixed cards link to their custom proxies; originals link to Scryfall."
        />

        <div className="mt-6">
          {items.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No cards yet"
              description={
                isOwner
                  ? "Add cards from the deck editor to start building."
                  : "This deck is empty for now."
              }
              action={
                isOwner ? (
                  <Button asChild>
                    <Link href={`/deck/${deckSlug}/edit`}>Manage deck</Link>
                  </Button>
                ) : null
              }
            />
          ) : (
            <DeckCardList items={items} ownerUsername={ownerUsername} />
          )}
        </div>
      </section>
    </>
  );
}

function DeckBodySkeleton() {
  return (
    <>
      <section className="mt-10">
        <header className="mb-6">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Deck breakdown
          </h2>
        </header>
        <SurfaceCard className="p-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
        </SurfaceCard>
      </section>

      <section className="mt-12">
        <header className="mb-6">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Cards
          </h2>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SurfaceCard key={i} className="flex flex-col gap-2 p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </SurfaceCard>
          ))}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// CollectionPage JSON-LD — mirrors buildSetCollectionJsonLd on set pages.
// ---------------------------------------------------------------------------

function buildDeckCollectionJsonLd({
  title,
  description,
  slug,
  format,
  ownerUsername,
  ownerDisplay,
}: {
  title: string;
  description: string | null;
  slug: string;
  format: DeckFormat;
  ownerUsername: string | null;
  ownerDisplay: string | null;
}): Record<string, unknown> {
  const base = getSiteBaseUrl();
  const canonical = `${base}/deck/${slug}`;
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description:
      description?.trim() ||
      `A ${DECK_FORMAT_LABELS[format]} deck rebuilt with custom cards on PipGlyph.`,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: "PipGlyph", url: base },
  };
  if (ownerDisplay) {
    schema.author = {
      "@type": "Person",
      name: ownerDisplay,
      ...(ownerUsername ? { url: `${base}/profile/${ownerUsername}` } : {}),
    };
  }
  return schema;
}
