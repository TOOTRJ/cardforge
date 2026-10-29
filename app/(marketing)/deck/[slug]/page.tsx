import type { Metadata } from "next";
import { DeckOwnerTools, DeckToolButton } from "@/components/decks/deck-owner-tools";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { DeckRegenerateBar } from "@/components/decks/deck-regenerate-bar";
import { getActiveDeckJob, getLatestFailedDeckJob } from "@/lib/ai/generation-jobs";
import { DeckLiveProgress } from "@/components/decks/deck-live-progress";
import { commanderBracket, deckTypeByKey } from "@/lib/decks/deck-types";
import Link from "next/link";
import { Suspense, cache } from "react";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { after, userAgent } from "next/server";
import { AlertTriangle, ArrowLeft, ImagePlus, Pencil } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { DeckAnalyticsPanel } from "@/components/decks/deck-analytics-panel";
import { DeckCardList } from "@/components/decks/deck-card-list";
import { CommanderSlot, DeckStartDoors } from "@/components/decks/deck-start-doors";
import { DeckPrivateCardsNotice } from "@/components/decks/deck-private-cards-notice";
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
  getDeckBySlugWithOwner,
  incrementDeckView,
  listDeckPageCards,
  viewerLikesDeck,
  type DeckItem,
  type DeckPageCard,
} from "@/lib/decks/queries";
import { computeDeckAnalytics } from "@/lib/decks/analytics";
import { formatHasCommander, validateDeck } from "@/lib/decks/format-rules";
import {
  DECK_CARDS_HEADING_ID,
  DECK_VIEW_COOKIE,
  deckRowsOf,
  deckStatusCountsOf,
  defaultDeckViewPrefs,
  ENTRY_BADGE_COUNT_LABELS,
  parseDeckViewPrefs,
  statusCountRows,
} from "@/lib/decks/deck-view";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getSiteBaseUrl } from "@/lib/site-url";
import { breadcrumbJsonLd, JsonLd } from "@/components/seo/json-ld";
import { WIDE_FRAME_CLASS } from "@/components/layout/wide-frame";
import { DECK_FORMAT_LABELS, type DeckFormat } from "@/types/deck";
import { VISIBILITY_LABELS } from "@/types/card";
import { getCardCapacity } from "@/lib/cards/capacity";
import { deckCoverColors, deckCoverOf } from "@/lib/decks/cover";
import { featuredCardsOf } from "@/lib/decks/featured";
import { DeckHero, HeroChip } from "@/components/decks/deck-hero";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The deck page (TODO DK5.1) — ONE URL, read-only for visitors, the owner's
// tools inline. Top to bottom: the hero (cover, featured cards, title, the
// actions anyone has), the owner's bar, the CARDS — first, in the viewer's
// view with the sticky summary bar — then the breakdown (the owner's format
// check with it) and the guide. The whole page is the WIDE frame (TODO WD5,
// components/layout/wide-frame.ts: up to 1920 px, aligned with the header):
// the cards spread across it; running text keeps its own measure.
//
// Reads: the deck and the viewer first (everything hangs on them), then ONE
// parallel wave — the rows (listDeckPageCards: only the columns the page
// draws, TODO DK5.11), the viewer's like, their entitlements, the view
// cookie and the request headers — while the guide and the owner's AI job
// state start alongside and stream in under their own Suspense boundaries.
// The page stays dynamic: the rows are read as the VIEWER may see them (an
// owner reads their private cards, a visitor gets a "Private card" tile),
// and the view is the viewer's cookie.
// ---------------------------------------------------------------------------

type Params = { slug: string };

// The deck's rows as THIS viewer reads them (RLS: a private card linked
// into the deck is null for a visitor), read once per request.
const listDeckPageCardsOnce = cache(listDeckPageCards);

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

/** The owner's own cards in the deck that are private (D11), once each. */
function ownPrivateCards(items: readonly DeckItem<DeckPageCard>[], ownerId: string): Array<{ id: string; title: string }> {
  const seen = new Map<string, string>();
  for (const { card } of items) {
    if (card && card.owner_id === ownerId && card.visibility === "private") seen.set(card.id, card.title);
  }
  return [...seen].map(([id, title]) => ({ id, title }));
}

export default async function DeckDetailPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ import?: string }>;
}) {
  const { slug } = await params;
  const [deck, user] = await Promise.all([
    isSupabaseConfigured() ? getDeckBySlugWithOwner(slug) : null,
    getCurrentUser(),
  ]);
  if (!deck) notFound();

  const isOwner = Boolean(user && user.id === deck.owner_id);
  const isPublic = deck.visibility === "public";

  // Started now, awaited where they're drawn (their own Suspense
  // boundaries): the guide, and the owner's AI job state (deck AI is
  // paused, but a job already running finishes — D6).
  const guide = getDeckGuide(deck.id).catch(() => null);
  const jobs = isOwner
    ? Promise.all([getLatestFailedDeckJob(deck.id), getActiveDeckJob(deck.id)]).catch(() => [null, null] as const)
    : null;
  const [items, likedByViewer, entitlements, cookieStore, requestHeaders, search, cardCapacity] = await Promise.all([
    listDeckPageCardsOnce(deck.id),
    user ? viewerLikesDeck(deck.id) : false,
    getEntitlements(),
    cookies(),
    headers(),
    searchParams,
    // The owner's saved-card slots: the import's forecast (D2).
    isOwner ? getCardCapacity() : null,
  ]);

  // The rows as this viewer's list shows them: a private card's title never
  // reaches a visitor — not in the list, its pop-up, the copied text or the
  // fan.
  const shownItems = publicDeckItems(items, isOwner);
  // The owner's upload, else the default its colours pick (lib/decks/cover.ts);
  // the fan as any viewer may see it (no private card — lib/decks/featured.ts).
  const cover = deckCoverOf(deck, deckCoverColors(items));
  const featured = featuredCardsOf(shownItems, deck);
  const analytics = computeDeckAnalytics(items);
  // The breakdown's "Card status": THE status count the list's chips and the
  // summary bar say (the viewer's rows, each card under the badge it wears).
  const statusCounts = statusCountRows(deckStatusCountsOf(deckRowsOf(shownItems, isOwner))).map(({ badge, count }) => ({
    key: badge,
    label: ENTRY_BADGE_COUNT_LABELS[badge],
    count,
  }));
  const { total: cardCount, linked: madeCount } = analytics;
  const deckType = deckTypeByKey(deck.deck_type);
  const bracket = deck.format === "commander" ? commanderBracket(deck.bracket) : null;
  const hasCards = items.length > 0;
  const usesCommander = formatHasCommander(deck.format);

  // The format check is the owner's to-do list (TODO DK0.9): a visitor
  // never sees it, and an empty deck has nothing to check (validateDeck).
  const warnings = isOwner
    ? validateDeck(
        deck.format,
        items.map((i) => i.entry),
      ).map((warning) => publicDeckWarning(warning, isOwner))
    : [];
  // D11 (TODO DK5.17): the owner's private cards in a deck others can open.
  const privateCards =
    isOwner && deck.visibility !== "private" ? ownPrivateCards(items, deck.owner_id) : [];

  // The viewer's view: their cookie, else the List on a phone, Stacks
  // elsewhere — decided on the server, so the first paint is right.
  const phone = userAgent({ headers: requestHeaders }).device.type === "mobile";
  const viewPrefs = parseDeckViewPrefs(cookieStore.get(DECK_VIEW_COOKIE)?.value, defaultDeckViewPrefs(phone));

  // "Copy decklist" (TODO DK0.7): free for the owner on every plan and for
  // every visitor who can open the deck. Both texts come from the rows this
  // viewer read (lib/decks/export-text.ts). Nothing to copy outside the
  // maybeboard → no button.
  const copyEntries = shownItems.some((item) => item.entry.board !== "maybe") ? exportEntriesOf(shownItems) : null;
  // The export menu (owner-only, its file builds Pro).
  const exportMenu =
    isOwner && hasCards ? (
      <DeckExportMenu
        deckId={deck.id}
        deckSlug={deck.slug}
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

  // Best-effort lifetime view tally, off the request path; owner views don't
  // count (matches increment_card_view's posture).
  if (!isOwner) {
    after(() => incrementDeckView(deck.id));
  }

  return (
    <div className={cn(WIDE_FRAME_CLASS, "py-6 sm:py-8")}>
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
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to decks
      </Link>
      <DeckBetaBanner deckId={deck.id} signedIn={Boolean(user)} className="mb-6" />

      {/* The hero (TODO DK6.5): the cover — the same 16:9 picture every
          deck tile draws (lib/decks/cover.ts) — with the featured cards and
          the title block; the actions anyone has on its bottom strip. */}
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
              {/* The tiles' "made on PipGlyph" (lib/decks/tile-counts.ts),
                  from the rows the page already read. */}
              {madeCount > 0 ? ` · ${madeCount} made on PipGlyph` : ""}
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
            {/* Free for every viewer (TODO DK0.7). */}
            {copyEntries ? (
              <DeckCopyDecklist
                plainText={deckToText({ title: deck.title }, copyEntries, { style: "plain", useProxyNames: true })}
                arenaText={deckToText({ title: deck.title }, copyEntries, { style: "arena", useProxyNames: true })}
              />
            ) : null}
            {exportMenu}
          </div>
        }
      />

      {isOwner && user ? (
        <div className="mt-4 flex flex-col gap-4">
          {/* The owner's bar: import, add, details, delete — and the AI
              tools, greyed while deck AI is paused (TODO DK1). */}
          <div className="rounded-frame border border-border/60 bg-surface/60 px-3 py-3 sm:px-4">
            <DeckOwnerTools
              deck={deck}
              userId={user.id}
              defaultCoverSrc={cover.kind === "default" ? cover.src : null}
              capacity={cardCapacity}
              openImport={search.import === "1"}
            />
          </div>
          {jobs ? (
            <Suspense fallback={null}>
              <DeckJobsSlot deckId={deck.id} jobs={jobs} />
            </Suspense>
          ) : null}
          {privateCards.length > 0 ? (
            <DeckPrivateCardsNotice cards={privateCards} deckVisibility={deck.visibility === "public" ? "public" : "unlisted"} />
          ) : null}
        </div>
      ) : null}

      {/* The cards, first (TODO DK5.1). */}
      <section aria-labelledby={DECK_CARDS_HEADING_ID} className="mt-6">
        {/* tabIndex -1: where a dialog hands the focus back when the control
            that opened it is gone (DeckOwnerTools). */}
        <h2
          id={DECK_CARDS_HEADING_ID}
          tabIndex={-1}
          className="mb-3 flex items-baseline gap-2 font-display text-xl font-semibold tracking-tight text-foreground focus:outline-none"
        >
          Cards
          <span className="font-sans text-sm font-normal tabular-nums text-subtle">
            <span className="sr-only">, </span>
            {cardCount} in the deck
          </span>
        </h2>
        {isOwner ? (
          // The owner's deck is its editor (TODO DK5 part 2): the add box
          // first, then the doors of an empty deck or its cards — drawn at
          // once as they change (components/decks/use-deck-editor).
          <DeckCardList
            items={shownItems}
            ownerUsername={deck.owner?.username ?? null}
            canManage
            deck={{ id: deck.id, slug: deck.slug, title: deck.title, format: deck.format }}
            initialPrefs={viewPrefs}
            summary={{
              format: deck.format,
              analytics,
              formatIssues: warnings.length,
            }}
            emptyState={<DeckStartDoors commander={usesCommander} />}
            commanderSlot={usesCommander ? <CommanderSlot compact /> : null}
          />
        ) : !hasCards ? (
          <EmptyState title="No cards yet" description="This deck is empty for now — check back soon." />
        ) : (
          <DeckCardList
            items={shownItems}
            ownerUsername={deck.owner?.username ?? null}
            canManage={false}
            initialPrefs={viewPrefs}
            summary={{
              format: deck.format,
              analytics,
              formatIssues: null,
            }}
          />
        )}
      </section>

      {/* Stats after the cards: the owner's format check, the breakdown —
          a reading width, not the page's. */}
      {hasCards ? (
        <section aria-labelledby="deck-breakdown-title" className="mt-14 flex max-w-7xl flex-col gap-6">
          <div className="flex flex-col gap-1 border-b border-gold/20 pb-4">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">Analytics</span>
            <h2 id="deck-breakdown-title" className="font-display text-2xl font-semibold tracking-tight text-foreground">
              Deck breakdown
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-muted">
              Mana curve, colors, and every card by status: imported, edited, remixed or original.
            </p>
          </div>
          {warnings.length > 0 ? (
            <SurfaceCard id="format-check" className="flex scroll-mt-24 flex-col gap-2 border-gold/40 bg-gold/5 p-5">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gold">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Format check — {DECK_FORMAT_LABELS[deck.format]}
              </h3>
              <ul className="flex flex-col gap-1 text-sm leading-6 text-muted">
                {warnings.map((warning, index) => (
                  <li key={`${warning.code}-${index}`}>{warning.message}</li>
                ))}
              </ul>
            </SurfaceCard>
          ) : null}
          <DeckAnalyticsPanel analytics={analytics} statusCounts={statusCounts} />
        </section>
      ) : null}

      <div className="max-w-7xl">
        <Suspense fallback={null}>
          <DeckGuideSlot
            deckId={deck.id}
            guide={guide}
            isOwner={isOwner}
            viewerIsPro={entitlements.effectiveTier === "pro"}
            hasCards={hasCards}
          />
        </Suspense>
      </div>
      <DeckFeedbackFooter deckId={deck.id} signedIn={Boolean(user)} />
    </div>
  );
}

/** The owner's AI job state: a job still running (deck AI is paused, but
 *  one already started finishes — D6), or the last one's failures. */
async function DeckJobsSlot({
  deckId,
  jobs,
}: {
  deckId: string;
  jobs: Promise<readonly [Awaited<ReturnType<typeof getLatestFailedDeckJob>>, Awaited<ReturnType<typeof getActiveDeckJob>>]>;
}) {
  const [failedJob, activeJob] = await jobs;
  return (
    <>
      <DeckLiveProgress deckId={deckId} pendingJob={activeJob} />
      {failedJob && !activeJob ? (
        <DeckRegenerateBar
          jobId={failedJob.jobId}
          failedCount={failedJob.failedCount}
          failedLabels={failedJob.failedLabels}
        />
      ) : null}
    </>
  );
}

async function DeckGuideSlot({
  deckId,
  guide,
  isOwner,
  viewerIsPro,
  hasCards,
}: {
  deckId: string;
  guide: ReturnType<typeof getDeckGuide>;
  isOwner: boolean;
  viewerIsPro: boolean;
  hasCards: boolean;
}) {
  return (
    <DeckGuideSection
      deckId={deckId}
      guide={await guide}
      isOwner={isOwner}
      viewerIsPro={viewerIsPro}
      aiConfigured={isDesignAiConfigured()}
      hasCards={hasCards}
    />
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
