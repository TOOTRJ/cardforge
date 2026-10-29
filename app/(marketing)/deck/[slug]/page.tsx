import type { Metadata } from "next";
import { DeckOwnerTools, DeckToolButton } from "@/components/decks/deck-owner-tools";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { batchCardLimit } from "@/lib/ai/generation-limits";
import { getDeckAiSeed } from "@/lib/ai/generation-jobs";
import { DeckRegenerateBar } from "@/components/decks/deck-regenerate-bar";
import { getActiveDeckJob, getLatestFailedDeckJob } from "@/lib/ai/generation-jobs";
import { DeckLiveProgress } from "@/components/decks/deck-live-progress";
import { commanderBracket, deckTypeByKey } from "@/lib/decks/deck-types";
import Link from "next/link";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { AlertTriangle, ArrowLeft, BookOpen, ImagePlus, Pencil } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { DeckAnalyticsPanel } from "@/components/decks/deck-analytics-panel";
import { DeckCardList } from "@/components/decks/deck-card-list";
import { publicDeckItems, publicDeckWarning } from "@/lib/decks/private-card-name";
import { DeckExportMenu } from "@/components/decks/deck-export-menu";
import { DeckCopyDecklist } from "@/components/decks/deck-copy-decklist";
import { rowHasBakedBack } from "@/lib/cards/faces";
import { DeckGuideSection } from "@/components/decks/deck-guide-section";
import { getDeckGuide } from "@/lib/decks/guides";
import { deckToText, exportEntriesOf } from "@/lib/decks/export-text";
import { getEntitlements } from "@/lib/billing/entitlements";
import { QuickLikeButton } from "@/components/cards/quick-like-button";
import { ShareTargets } from "@/components/cards/share-targets";
import { DeckFeedbackButton, DeckFeedbackFooter } from "@/components/feedback/deck-feedback-dialog";
import { DeckBetaBanner } from "@/components/decks/deck-beta-banner";
import {
  countDeckEntries,
  countRemixableDeckCards,
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
import { VISIBILITY_LABELS } from "@/types/card";
import { getCardCapacity } from "@/lib/cards/capacity";
import { deckCoverColors, deckCoverOf } from "@/lib/decks/cover";
import { featuredCardsOf } from "@/lib/decks/featured";
import { DeckHero, HeroChip } from "@/components/decks/deck-hero";

type Params = { slug: string };

// The deck's rows as THIS viewer reads them (RLS: a private card linked
// into the deck is null for a visitor), read once per request — the
// header's "Copy decklist" and the body's list share the one read.
const listDeckCardsOnce = cache(listDeckCards);

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
  // A missing/unreadable deck is a real 404, never a titled 200 (soft 404).
  if (!deck) notFound();
  const entryCount = deck.visibility === "public" ? await countDeckEntries(deck.id) : 0;

  const isShareable =
    deck.visibility === "public" || deck.visibility === "unlisted";
  const description =
    deck.description?.trim() ||
    `A ${DECK_FORMAT_LABELS[deck.format]} deck rebuilt with custom cards on PipGlyph.`;

  // og:image comes from the sibling opengraph-image.tsx file route.
  return {
    title: deck.title,
    description,
    // Unlisted decks are reachable by link but shouldn't enter the index;
    // an EMPTY public deck is thin content — crawlable, followed, not
    // indexed until it holds cards.
    robots:
      deck.visibility !== "public"
        ? { index: false, follow: false }
        : entryCount === 0
          ? { index: false, follow: true }
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
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ import?: string }>;
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
  // The hero needs the rows too (the default cover's colours, the fan); the
  // read is cache()d, so the body below streams from the same one.
  const [items, likedByViewer] = await Promise.all([
    listDeckCardsOnce(deck.id),
    user ? viewerLikesDeck(deck.id) : false,
  ]);
  // The owner's upload, else the default its colours pick (lib/decks/cover.ts);
  // the fan as any viewer may see it (no private card — lib/decks/featured.ts).
  const cover = deckCoverOf(deck, deckCoverColors(items));
  const featured = featuredCardsOf(publicDeckItems(items, isOwner), deck.id);
  const { total: cardCount, remixed: customCount } = computeDeckAnalytics(items);
  const deckType = deckTypeByKey(deck.deck_type);
  const bracket = deck.format === "commander" ? commanderBracket(deck.bracket) : null;

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
      <DeckBetaBanner deckId={deck.id} signedIn={Boolean(user)} className="mb-6" />

      {/* The hero (TODO DK6.5): the cover — the same 16:9 picture every
          deck tile draws (lib/decks/cover.ts) — with the featured cards and
          the title block; the actions on its bottom strip. */}
      <DeckHero
        cover={cover}
        title={deck.title}
        titleAction={
          isOwner ? (
            <DeckToolButton tool="details" label="Edit deck details" className="text-base text-white/70 hover:text-white" />
          ) : null
        }
        chips={
          <>
            <HeroChip tone="gold">{DECK_FORMAT_LABELS[deck.format]}</HeroChip>
            {deckType?.label ? <HeroChip>{deckType.label}</HeroChip> : null}
            {bracket ? (
              <HeroChip title={bracket.blurb}>
                Bracket {deck.bracket} · {bracket.name}
              </HeroChip>
            ) : null}
            {deck.visibility !== "public" ? <HeroChip>{VISIBILITY_LABELS[deck.visibility]}</HeroChip> : null}
          </>
        }
        byline={
          <>
            {deck.owner?.username ? (
              <Link
                href={`/profile/${deck.owner.username}`}
                className="rounded-sm transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                by <span className="font-mono text-white">@{deck.owner.username}</span>
              </Link>
            ) : null}
            <span>
              {cardCount} card{cardCount === 1 ? "" : "s"}
              {customCount > 0 ? ` · ${customCount} custom` : ""}
            </span>
          </>
        }
        description={
          deck.description ? (
            <p>
              {deck.description}
              {isOwner ? (
                <DeckToolButton tool="details" label="Edit description" className="ml-1.5 align-middle text-white/70 hover:text-white" />
              ) : null}
            </p>
          ) : isOwner ? (
            <DeckToolButton tool="details" label="Add a description" className="text-xs text-white/70 hover:text-white">
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Add a description
            </DeckToolButton>
          ) : null
        }
        coverAction={
          isOwner ? (
            <DeckToolButton
              tool="details"
              label={cover.kind === "upload" ? "Change cover" : "Upload a cover"}
              className="rounded-full border border-white/25 bg-black/45 px-3 py-1 text-xs font-medium text-white backdrop-blur hover:bg-black/60 hover:text-white"
            >
              {cover.kind === "upload" ? <Pencil className="h-3.5 w-3.5" aria-hidden /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden />}
              {cover.kind === "upload" ? "Change cover" : "Upload a cover"}
            </DeckToolButton>
          ) : null
        }
        featured={featured}
        actions={
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
            <DeckFeedbackButton deckId={deck.id} signedIn={Boolean(user)} className="h-9" />
            {/* Free for every viewer (TODO DK0.7); streams in with the
                card list, so the header still paints at once. */}
            <Suspense fallback={null}>
              <DeckCopyDecklistSlot deckId={deck.id} deckTitle={deck.title} isOwner={isOwner} />
            </Suspense>
            {isOwner && user ? (
              <DeckOwnerTools
                deck={deck}
                userId={user.id}
                defaultCoverSrc={cover.kind === "default" ? cover.src : null}
                aiConfigured={isDesignAiConfigured()}
                maxCards={await batchCardLimit()}
                capacity={await getCardCapacity()}
                remixableCount={await countRemixableDeckCards(deck.id)}
                aiSeed={await getDeckAiSeed(deck.id)}
                openImport={(await searchParams).import === "1"}
              />
            ) : null}
          </div>
        }
      />

      <Suspense fallback={<DeckBodySkeleton />}>
        <DeckBody
          deckId={deck.id}
          deckSlug={deck.slug}
          format={deck.format}
          ownerUsername={deck.owner?.username ?? null}
          isOwner={isOwner}
        />
      </Suspense>
      <DeckFeedbackFooter deckId={deck.id} signedIn={Boolean(user)} />
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
  const [items, failedJob, activeJob, guide, entitlements] = await Promise.all([
    listDeckCardsOnce(deckId),
    isOwner ? getLatestFailedDeckJob(deckId) : Promise.resolve(null),
    isOwner ? getActiveDeckJob(deckId) : Promise.resolve(null),
    getDeckGuide(deckId),
    getEntitlements(),
  ]);
  const viewerIsPro = entitlements.effectiveTier === "pro";
  const analytics = computeDeckAnalytics(items);
  // The format check is the owner's to-do list (TODO DK0.9): a visitor
  // never sees it, and an empty deck has nothing to check (validateDeck).
  // A card the strong-language rule kept private shows a neutral name to
  // anyone but the owner (lib/decks/private-card-name.ts) — in the list, its
  // pop-up and a warning that quotes it. Judged on the real entries.
  const warnings = isOwner
    ? validateDeck(
        format,
        items.map((i) => i.entry),
      ).map((warning) => publicDeckWarning(warning, isOwner))
    : [];
  const shownItems = publicDeckItems(items, isOwner);

  // The export menu (owner-only, its file builds Pro) gets the viewer's
  // batch-export entitlement. Copying the list is the header's, for all.
  const exportMenu =
    isOwner && items.length > 0 ? (
      <DeckExportMenu
        deckId={deckId}
        deckSlug={deckSlug}
        allowBatchExport={entitlements.allowBatchExport}
        customCardCount={new Set(items.filter((i) => i.card && i.entry.board !== "maybe").map((i) => i.card!.id)).size}
        realCardCount={items.filter((i) => !i.card && i.entry.board !== "maybe").length}
        // Every deck has a cover since DK6.2 (an upload or its default).
        hasCover
        doubleFacedCount={
          new Set(items.filter((i) => i.card && i.entry.board !== "maybe" && rowHasBakedBack(i.card)).map((i) => i.card!.id)).size
        }
      />
    ) : null;

  return (
    <>
      {isOwner ? <DeckLiveProgress deckId={deckId} pendingJob={activeJob} /> : null}
      {failedJob && !activeJob ? (
        <DeckRegenerateBar
          jobId={failedJob.jobId}
          failedCount={failedJob.failedCount}
          failedLabels={failedJob.failedLabels}
        />
      ) : null}
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

      <DeckGuideSection
        deckId={deckId}
        guide={guide}
        isOwner={isOwner}
        viewerIsPro={viewerIsPro}
        aiConfigured={isDesignAiConfigured()}
        hasCards={items.length > 0}
      />

      <section className="mt-12">
        <PageHeader
          eyebrow="Cards"
          title={`${analytics.total} card${analytics.total === 1 ? "" : "s"}`}
          description="Click any card for details — customize the real cards, flip between versions, and track what's left."
          actions={exportMenu}
        />

        <div className="mt-6">
          {items.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No cards yet"
              description={
                isOwner
                  ? "Import a decklist or link your own creations."
                  : "This deck is empty for now."
              }
              action={
                isOwner ? (
                  <span className="text-sm text-muted">Use Import decklist above to fill it.</span>
                ) : null
              }
            />
          ) : (
            <DeckCardList
              items={shownItems}
              ownerUsername={ownerUsername}
              canManage={isOwner}
            />
          )}
        </div>
      </section>
    </>
  );
}

/** "Copy decklist" (TODO DK0.7): free for the owner on every plan and for
 *  every visitor who can open the deck. Both texts come from the rows this
 *  viewer read: real cards by their real name and printing, a custom card
 *  with no real card by the title the viewer's list shows, a private card
 *  they can't read by its entry name (lib/decks/export-text.ts). Nothing
 *  to copy outside the maybeboard → no button. */
async function DeckCopyDecklistSlot({
  deckId,
  deckTitle,
  isOwner,
}: {
  deckId: string;
  deckTitle: string;
  isOwner: boolean;
}) {
  // The rows as this viewer's list shows them: a private card's name the
  // strong-language rule hides stays hidden in the copied text too.
  const items = publicDeckItems(await listDeckCardsOnce(deckId), isOwner);
  if (!items.some((item) => item.entry.board !== "maybe")) return null;
  const entries = exportEntriesOf(items);
  return (
    <DeckCopyDecklist
      plainText={deckToText({ title: deckTitle }, entries, { style: "plain", useProxyNames: true })}
      arenaText={deckToText({ title: deckTitle }, entries, { style: "arena", useProxyNames: true })}
    />
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
