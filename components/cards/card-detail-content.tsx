import Link from "next/link";
import { tagSlug } from "@/lib/cards/tag-slug";
import { isHubType } from "@/lib/cards/hubs";
import {
  VISIBILITY_LABELS,
  COLOR_IDENTITY_LABELS,
  RARITY_LABELS,
  type CardType,
  type ColorIdentity,
  type Rarity,
} from "@/types/card";
import Image from "next/image";
import { notFound } from "next/navigation";
import { after } from "next/server";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Download,
  ExternalLink,
  Flame,
  Pencil,
  Repeat2,
  Sparkles,
  Trophy,
} from "lucide-react";
import { CardHeroPreview } from "@/components/cards/card-hero-preview";
import { getPipOverrides } from "@/lib/pips/queries";
import { CardComments } from "@/components/cards/card-comments";
import { DownloadModal } from "@/components/cards/download-modal";
import { frameTemplateOf } from "@/lib/cards/print-export";
import { LikeButton } from "@/components/cards/like-button";
import { RemixButton } from "@/components/cards/remix-button";
import { AddToDeckButton } from "@/components/cards/add-to-deck-button";
import { BuildDeckAroundButton } from "@/components/decks/build-deck-around-button";
import { ShareTargets } from "@/components/cards/share-targets";
import { ReportCardDialog } from "@/components/cards/report-card-dialog";
import { GalleryCardTile } from "@/components/cards/gallery-card-tile";
import { FollowButton } from "@/components/follows/follow-button";
import { isFollowing } from "@/lib/follows/queries";
import { SocialIcon } from "@/components/profile/social-icon";
import { profileMediaSrc } from "@/lib/media/media-urls";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { PageContainer } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/lib/auth/schemas";
import {
  countCardLikes,
  countRemixesOfCard,
  getCardById,
  getCardByOwnerAndSlug,
  getCardLikeRankOverall,
  getCardTrendingSignals,
  getProfileByUsername,
  getRemixParentLink,
  hasUserLikedCard,
  incrementCardView,
  listMoreFromOwner,
  listRelatedCards,
  listTopRemixesOfCard,
  type CardWithStats,
  type ProfileWithStats,
} from "@/lib/cards/queries";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import {
  isModerationLocked,
  MODERATION_CONTACT_HREF,
  MODERATION_LOCK_NOTE,
  MODERATION_LOCKED_REMIX_MESSAGE,
  ownerVisibilityLabel,
} from "@/lib/moderation/lock";
import { sameOwnerBackCard } from "@/lib/cards/back-card";
import {
  countPublicDecksForCard,
  listPublicDeckTilesContaining,
  listPublicDecksContaining,
} from "@/lib/decks/queries";
import { listDeckTileArt } from "@/lib/decks/tile-art";
import { DECK_NARROW_FRAME_SIZES, DeckGrid, DeckTile } from "@/components/decks/deck-tile";
import { buildTypeLine, describeManaCost, normalizeFrameTemplate, printsPowerToughness } from "@/lib/cards/card-display";
import { frontDrawsPowerToughness, secondFaceDrawsPowerToughness } from "@/lib/cards/pt-drawn";
import { collectorDrawn } from "@/lib/cards/collector-layout";
import { collectorNumberRuns } from "@/lib/cards/collector-line";
import { PRINTED_LANGS } from "@/lib/cards/collector-fields";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { cardPageFacesOf, cardPageName, cardTypeHasRarity } from "@/lib/cards/emblem";
import { backRulesTextWithSelfName, storedRulesTextWithSelfName } from "@/lib/cards/self-name";
import { cardNickname, nicknamePageLine } from "@/lib/cards/nickname";
import { rowHasBakedBack } from "@/lib/cards/faces";
import { isStoredRenderUrl, toRenderCdnUrl } from "@/lib/cards/render-cdn";
import { renderVersionOf } from "@/lib/cards/render-version";
import { isLandscapeTemplate, naturalRenderSize, RENDER_PRESETS } from "@/lib/render/card-image";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { countPublicRemixesBySource } from "@/lib/cards/source-queries";
import { listCommentsForCard } from "@/lib/cards/comments-queries";
import { getCurrentUser } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { downloadDiffersFromGallery } from "@/lib/cards/layout-version";
import { getSiteBaseUrl } from "@/lib/site-url";
import { breadcrumbJsonLd, JsonLd, serializeJsonLd } from "@/components/seo/json-ld";
import type { CardBackFace, FrameStyle, FaceContent } from "@/types/card";
import { formatShortDate } from "@/lib/format/dates";
import { stripFlavorMarkup } from "@/lib/cards/flavor-markup";

// ---------------------------------------------------------------------------
// CardDetailContent — the body of the public card page,
// app/(marketing)/card/[username]/[slug]/page.tsx. It is the ONE card
// detail view: every tile, row and link opens this page (the intercepting
// route that drew a copy of it in a dialog, app/@modal, is gone — one
// canonical page, one back button, one URL that looks the same on a reload).
//
// RLS gates which cards the viewer can read: anonymous + non-owner
// viewers only see `public` / `unlisted` rows. Owners see their private
// cards via this URL too, which lets them preview the public-facing
// rendering before flipping visibility.
// ---------------------------------------------------------------------------

export async function CardDetailContent({
  username,
  slug,
}: {
  username: string;
  slug: string;
}) {
  const card = isSupabaseConfigured()
    ? await getCardByOwnerAndSlug(username, slug)
    : null;

  if (!card) notFound();

  const user = await getCurrentUser();
  const isOwner = Boolean(user && user.id === card.owner_id);

  const [
    backCard,
    profileOverrides,
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
    publicDeckCount,
    topRemixes,
    remixParent,
    overallRank,
    trendingSignals,
    inDecks,
    deckTiles,
  ] = await Promise.all([
    // v2 back face: the referenced card, if any and if it's readable (RLS
    // scopes the anon client to shareable cards) — and only the owner's own
    // (sameOwnerBackCard: a pre-0127 row could name someone else's card).
    // Rendered on the flip.
    card.back_card_id
      ? getCardById(card.back_card_id).then((back) => sameOwnerBackCard(card, back))
      : Promise.resolve(null),
    getFrameProfileOverrides(),
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
    // The owner's custom pip icons for the card preview.
    getPipOverrides(card.owner_id),
    // Full creator profile (bio + socials + avatar) for the featured card.
    getProfileByUsername(username),
    // Whether the viewer already follows the creator (drives the Follow button).
    user && !isOwner
      ? isFollowing(card.owner_id)
      : Promise.resolve(false),
    // Analytics: remix + deck membership counts, and the top-liked remixes.
    // The deck count is the public decks' (TODO DK8.4: the "In decks" list's
    // own rule — a count and the decks it stands for never disagree).
    countRemixesOfCard(card.id),
    countPublicDecksForCard(card.id),
    listTopRemixesOfCard(card.id, 4),
    // Provenance: the original card this was remixed from (if any).
    card.parent_card_id
      ? getRemixParentLink(card.parent_card_id)
      : Promise.resolve(null),
    // Popularity rank overall.
    getCardLikeRankOverall(card.id),
    // 7-day velocity for the trending badge.
    getCardTrendingSignals(card.id, card.owner_id, card.created_at),
    // The public decks the card is in — ONE list (0144 / 0149's rule) for the
    // "In decks" row, the JSON-LD isPartOf and the "Decks with this card"
    // tiles (the same list hydrated: cache()-deduped, one RPC).
    listPublicDecksContaining(card.id),
    listPublicDeckTilesContaining(card.id),
  ]);
  const deckTileArt = await listDeckTileArt(deckTiles, { anonymous: true });
  // "Build a deck around this card" (TODO DK8.3): where the card may join
  // the viewer's new deck — a PUBLIC card (anyone's, D3), or their own.
  const canBuildAround = card.visibility === "public" || isOwner;
  // The stat counts every deck the list stands for (it shows the newest few);
  // unread (a database 0149 hasn't reached), the list's own length.
  const deckCount = publicDeckCount ?? inDecks.length;

  // Bump the view tally after the response ships — never for the owner's own
  // views, and never blocking render. Uses a public client + SECURITY DEFINER RPC, so it
  // can't rotate the viewer's session (see incrementCardView).
  if (!isOwner) {
    after(() => incrementCardView(card.id));
  }

  const ownerProfile = card.owner;

  const createdAt = formatShortDate(card.created_at);

  const siteBase = getSiteBaseUrl();
  const isShareable =
    card.visibility === "public" || card.visibility === "unlisted";
  // The page's name for the card: an emblem is "<walker> Emblem", like
  // Scryfall's (cardPageName; the card itself prints the walker's name); a
  // double-faced card on the DFC bodies is "Front // Back" (TODO 5.3) —
  // the <title>, H1, breadcrumb, share copy and JSON-LD name alike.
  const pageName = cardPageName(card.title, card.card_type, cardPageFacesOf(card));
  // A back with a body of its own (lib/cards/faces.ts): the download modal
  // offers it, the details list it, the JSON-LD names it.
  const hasBackFace = rowHasBakedBack(card);
  const jsonLd =
    isShareable
      ? buildCardJsonLd({
          inDecks,
          card,
          username,
          ownerDisplay:
            ownerProfile?.display_name || ownerProfile?.username || "Anonymous",
          siteBase,
        })
      : null;

  const cardPath = `/card/${username}/${card.slug}`;
  const isAuthed = Boolean(user);
  // The visibility badge is the OWNER's reminder, and a visitor's only where
  // it says something (an unlisted link); a public card needs no label.
  const showVisibility = isOwner || card.visibility !== "public";

  // The page, mobile first (TODO card page refactor, 2026-10-30): the card,
  // then what you can DO with it (download, remix, add to deck — then like,
  // share), the numbers, the card as TEXT ("Card details"), its creator; below
  // the fold the decks it is in, its remixes, more cards, and the comments.
  // From lg the card stays in view (sticky) beside that column.
  return (
    <PageContainer className="py-6 sm:py-10">
      {jsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      ) : null}
      {/* Breadcrumbs only for indexable cards — unlisted pages are noindex,
          so hierarchy signals there are wasted bytes. */}
      {card.visibility === "public" ? (
        <JsonLd
          data={breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Gallery", path: "/gallery" },
            { name: pageName, path: cardPath },
          ])}
        />
      ) : null}
      <CardBreadcrumbs pageName={pageName} />

      {/* grid-cols-1 (not the implicit auto column) so the info column is
          viewport-bound on mobile instead of spreading to max-content. */}
      <div className="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-12">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div
            className="mx-auto w-full max-w-sm lg:max-w-none"
            // Matches the gallery / dashboard / profile thumbnails'
            // view-transition-name so chromium-class browsers can animate a
            // shared-element transition between the grid tile and this hero.
            style={{ viewTransitionName: `card-${card.id}` }}
          >
            {/* The ONE row → preview mapper (shared with the bake and every
                tile), so the hero carries the design watermark and the
                structured loyalty / saga content — a hand-built prop bag here
                used to drop both and diverge from the stored render. The
                hero is the live preview with its corner flip; `?face=back`
                opens it flipped (TODO 5.3) — read by the client island, never
                here, so the server render never varies on the query. */}
            <CardHeroPreview
              {...cardToPreviewData(card, profileOverrides)}
              pipOverrides={pipOverrides}
              backFace={(card.back_face as CardBackFace | null) ?? null}
              backCard={backCard ? cardToPreviewData(backCard, profileOverrides) : null}
            />
          </div>
        </div>

        {/* A reading width for the column (its text and its strip). */}
        <div className="flex min-w-0 max-w-2xl flex-col gap-6">
          <header className="flex flex-col gap-2">
            {showVisibility ? (
              <Badge
                className="w-fit"
                variant={card.visibility === "public" ? "primary" : "outline"}
              >
                {/* The moderation lock (0156) is the owner's to read; a
                    locked card is private, so only its owner (or an admin)
                    reaches this page. */}
                {isOwner ? ownerVisibilityLabel(card) : VISIBILITY_LABELS[card.visibility]}
              </Badge>
            ) : null}
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {pageName}
            </h1>
            {/* The nickname (TODO 6.3): the name the card prints in its
                title bar — the H1 stays the card's name; "Also known as"
                on a frame that prints no nickname. */}
            <NicknameLine nickname={card.nickname} frameStyle={card.frame_style} />
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
              {ownerProfile?.username ? (
                <>
                  by
                  <Link
                    href={`/profile/${ownerProfile.username}`}
                    className="font-mono text-foreground underline-offset-4 transition-colors hover:text-primary-bright hover:underline"
                  >
                    @{ownerProfile.username}
                  </Link>
                  <span aria-hidden>·</span>
                </>
              ) : null}
              <time dateTime={card.created_at}>{createdAt}</time>
            </p>
            <CardProvenance
              remixParent={remixParent}
              sourceScryfallId={card.source_scryfall_id}
              otherRemixesCount={otherRemixesCount}
            />
          </header>

          {/* The moderation lock (0156): the owner is told why the card
              stays private, and where to ask. */}
          {isOwner && isModerationLocked(card) ? (
            <p className="rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-sm leading-6 text-foreground">
              {MODERATION_LOCK_NOTE}{" "}
              <Link href={MODERATION_CONTACT_HREF} className="font-medium text-primary-bright underline-offset-4 hover:underline">
                Contact us
              </Link>{" "}
              if you have questions.
            </p>
          ) : null}

          {/* The actions, in the order people reach for them: the card's
              own (download, remix, add to deck — the owner's Edit first),
              then the social row. On a phone the first row is a two-column
              grid of full-width buttons. */}
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              {isOwner ? (
                <Button asChild className="w-full sm:w-auto">
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
                downloadDiffersFromGallery={downloadDiffersFromGallery(card, entitlements.isPaid)}
                frameTemplate={frameTemplateOf(card.frame_style)}
                hasBackFace={hasBackFace}
                trigger={
                  <Button variant={isOwner ? "outline" : "primary"} className="w-full sm:w-auto">
                    <Download className="h-4 w-4" aria-hidden /> Download
                  </Button>
                }
              />
              {/* Another creator's card into one of your decks (TODO DK9.4,
                  owner decision D3): a PUBLIC one by "Add to deck"; one that
                  isn't public only as a remix — the Remix button says so
                  (one button, never two to the same place). */}
              <RemixButton
                cardId={card.id}
                requiresSignIn={!user}
                label={!isOwner && card.visibility !== "public" ? "Remix into a deck" : undefined}
                unavailableReason={isModerationLocked(card) ? MODERATION_LOCKED_REMIX_MESSAGE : undefined}
                className={cn("w-full sm:w-auto", isOwner && "col-span-2 sm:col-auto")}
              />
              {!isOwner && card.visibility === "public" ? (
                <div className="col-span-2 sm:col-auto [&>*]:w-full sm:[&>*]:w-auto">
                  <AddToDeckButton
                    cardId={card.id}
                    cardTitle={card.title}
                    cardPath={cardPath}
                    signedIn={isAuthed}
                  />
                </div>
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
              <ShareTargets
                title={pageName}
                url={`${siteBase}${cardPath}`}
                entity="card"
                itemId={card.id}
                imageUrl={
                  isShareable ? `${siteBase}/api/cards/${card.id}/og` : undefined
                }
              />
              {user && !isOwner ? <ReportCardDialog cardId={card.id} /> : null}
            </div>
          </div>

          {/* Share-traffic conversion: most anonymous visitors arrive from a
              shared link — meet the "I could make one of these" moment with
              the create CTA right under the card actions. */}
          {!user ? (
            <Link
              href="/signup"
              className="inline-flex w-fit items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:border-gold hover:bg-gold/15"
            >
              <Sparkles className="h-4 w-4 text-gold" aria-hidden />
              Forge your own card — free
            </Link>
          ) : null}

          <CardStats
            views={card.view_count}
            likes={likesCount}
            remixes={remixCount}
            decks={deckCount}
            comments={comments.length}
            trendingSignals={trendingSignals}
            overallRank={overallRank}
          />

          {/* Card details as TEXT. The rendered preview shows all of this, but
              a crawler or answer engine reads none of it from an image — this
              block is what makes the page citable for "custom MTG {type}"
              queries. */}
          <CardDetails card={card} inDecks={inDecks} />

          {/* Discovery tags — under the details they describe. */}
          {card.tags.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="Tags">
              {card.tags.map((tag) => (
                <li key={tag}>
                  <Link
                    href={`/gallery/tag/${tagSlug(tag)}`}
                    className="inline-flex items-center rounded-full border border-border/60 bg-elevated/60 px-2.5 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground"
                  >
                    #{tag}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          {creatorProfile ? (
            <CreatorFeature
              profile={creatorProfile}
              targetUserId={card.owner_id}
              isOwner={isOwner}
              initialFollowing={viewerFollows}
              requiresSignIn={!user}
            />
          ) : null}
        </div>
      </div>

      {/* Below the card: where it is used, what it became, more to look at —
          and the conversation last. */}
      <div className="mt-12 flex flex-col gap-12 sm:mt-16 sm:gap-14">
        {deckTiles.length > 0 || canBuildAround ? (
          <DecksWithCard
            decks={deckTiles}
            art={deckTileArt}
            total={Math.max(deckCount, deckTiles.length)}
            cardPath={cardPath}
            buildAround={canBuildAround ? { cardId: card.id, cardTitle: card.title } : null}
          />
        ) : null}

        {topRemixes.length > 0 ? (
          <RelatedRow title="Top remixes" cards={topRemixes} isAuthed={isAuthed} />
        ) : null}
        {moreFromOwner.length > 0 ? (
          <RelatedRow
            title={`More from @${username}`}
            viewAllHref={`/profile/${username}`}
            cards={moreFromOwner}
            isAuthed={isAuthed}
          />
        ) : null}
        {relatedCards.length > 0 ? (
          <RelatedRow
            title="More like this"
            viewAllHref={
              card.card_type && isHubType(card.card_type)
                ? `/gallery/type/${card.card_type}`
                : "/gallery/browse"
            }
            cards={relatedCards}
            isAuthed={isAuthed}
          />
        ) : null}

        {/* The comment thread keeps a reading measure; `#comments` is where
            the stats' count points. */}
        <div id="comments" className="max-w-3xl scroll-mt-24">
          <CardComments
            cardId={card.id}
            cardSlug={card.slug}
            ownerUsername={username}
            initialComments={comments}
            currentUserId={user?.id ?? null}
          />
        </div>
      </div>
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// CardBreadcrumbs — "Gallery › <card>", the visible twin of the breadcrumb
// JSON-LD (Home › Gallery › card). The current page is named for a screen
// reader and on a wide screen; a phone shows the way back alone (the H1
// right below says the rest).
// ---------------------------------------------------------------------------

function CardBreadcrumbs({ pageName }: { pageName: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 sm:mb-6">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
        <li className="shrink-0">
          <Link href="/gallery" className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4 sm:hidden" aria-hidden />
            Gallery
          </Link>
        </li>
        <li className="flex min-w-0 items-center gap-1.5">
          <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-subtle sm:block" aria-hidden />
          <span aria-current="page" className="sr-only truncate text-foreground sm:not-sr-only">
            {pageName}
          </span>
        </li>
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// CardProvenance — where the card came from: a remix of another PipGlyph
// card, a real card imported from Scryfall (both open in a new tab), and how
// many others remixed that same real card (chunk 13: only when another
// public/unlisted remix exists; it lands on the gallery filtered by source).
// ---------------------------------------------------------------------------

function CardProvenance({
  remixParent,
  sourceScryfallId,
  otherRemixesCount,
}: {
  remixParent: { path: string; title: string } | null;
  sourceScryfallId: string | null;
  otherRemixesCount: number;
}) {
  if (!remixParent && !sourceScryfallId) return null;
  return (
    <div className="flex flex-col gap-1.5 pt-1">
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
      {sourceScryfallId ? (
        <a
          href={`/go/scryfall/${sourceScryfallId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          Based on a real card — view on Scryfall
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      ) : null}
      {sourceScryfallId && otherRemixesCount > 0 ? (
        <Link
          href={`/gallery/browse?source=${encodeURIComponent(sourceScryfallId)}`}
          className="inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-foreground transition-colors hover:border-accent hover:bg-accent/15"
        >
          <Sparkles className="h-3 w-3 text-accent" aria-hidden />
          Also remixed by {otherRemixesCount}{" "}
          {otherRemixesCount === 1 ? "other" : "others"}
        </Link>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DecksWithCard — "Decks with this card" (TODO DK8.4):
// the public decks the card's page names (listPublicDecksContaining — the
// one list, by its one rule; the JSON-LD isPartOf reads it too) as
// DeckTiles. The heading counts every such deck; the tiles are the newest.
// "Build a deck around this card" (DK8.3) sits beside the heading wherever
// the card may join the viewer's deck — then the section shows with no deck
// yet too, as the way to make the first.
// ---------------------------------------------------------------------------

function DecksWithCard({
  decks,
  art,
  total,
  cardPath,
  buildAround,
}: {
  decks: Awaited<ReturnType<typeof listPublicDeckTilesContaining>>;
  art: Awaited<ReturnType<typeof listDeckTileArt>>;
  total: number;
  cardPath: string;
  buildAround: { cardId: string; cardTitle: string } | null;
}) {
  return (
    <section aria-labelledby="decks-with-card-heading" className="scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="decks-with-card-heading" className="scroll-mt-24 font-display text-lg font-semibold text-foreground">
            Decks with this card
          </h2>
          <p className="text-xs text-muted">
            {decks.length === 0
              ? "Not in any public deck yet."
              : `In ${total} public deck${total === 1 ? "" : "s"}${total > decks.length ? ` — the newest ${decks.length}` : ""}.`}
          </p>
        </div>
        {buildAround ? <BuildDeckAroundButton cardId={buildAround.cardId} cardTitle={buildAround.cardTitle} /> : null}
      </div>
      {decks.length > 0 ? (
        <DeckGrid>
          {decks.map((deck) => (
            <DeckTile
              key={deck.id}
              deck={deck}
              art={art.get(deck.id)}
              sizes={DECK_NARROW_FRAME_SIZES}
              likeRedirect={cardPath}
            />
          ))}
        </DeckGrid>
      ) : null}
    </section>
  );
}

/** A row of up to four card tiles — two columns on a phone, four from sm.
 *  The tiles keep BakedCardThumbnail's window-grid `sizes` (generous, never
 *  less than a tile here). */
function RelatedRow({
  title,
  viewAllHref,
  cards,
  isAuthed,
}: {
  title: string;
  viewAllHref?: string;
  cards: CardWithStats[];
  isAuthed: boolean;
}) {
  const headingId = `related-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return (
    <section aria-labelledby={headingId}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={headingId} className="font-display text-lg font-semibold text-foreground">
          {title}
        </h2>
        {viewAllHref ? (
          <Link
            href={viewAllHref}
            className="shrink-0 text-xs font-semibold text-primary-bright underline-offset-4 hover:underline"
          >
            View all<span className="sr-only">: {title}</span> →
          </Link>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5">
        {cards.map((card) => (
          <GalleryCardTile key={card.id} card={card} isAuthed={isAuthed} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CardStats — "By the numbers" as ONE compact strip under the actions: views,
// likes, remixes, decks and comments, then the trending and rank lines when
// they say something. (It was a full-width panel of five large tiles below
// the fold; the remixes it listed are their own row now.) The deck and
// comment counts link to their sections.
// ---------------------------------------------------------------------------

const COMPACT_COUNT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** 9,999 and under as written; past it "12.3K". Exported for tests. */
export function formatStatCount(value: number): string {
  return value < 10_000 ? value.toLocaleString("en") : COMPACT_COUNT.format(value);
}

function CardStats({
  views,
  likes,
  remixes,
  decks,
  comments,
  trendingSignals,
  overallRank,
}: {
  views: number;
  likes: number;
  remixes: number;
  decks: number;
  comments: number;
  trendingSignals: {
    likes_7d: number;
    comments_7d: number;
    remixes_7d: number;
    is_fresh: boolean;
  };
  overallRank: number | null;
}) {
  const stats: { label: string; value: number; href?: string }[] = [
    { label: views === 1 ? "View" : "Views", value: views },
    { label: likes === 1 ? "Like" : "Likes", value: likes },
    { label: remixes === 1 ? "Remix" : "Remixes", value: remixes },
    { label: decks === 1 ? "Deck" : "Decks", value: decks, href: decks > 0 ? "#decks-with-card-heading" : undefined },
    { label: comments === 1 ? "Comment" : "Comments", value: comments, href: "#comments" },
  ];
  // "Trending" needs real momentum this week — freshness alone (a brand-new
  // card with no engagement) shouldn't earn the badge, even though it scores.
  const recentEngagement =
    trendingSignals.likes_7d +
    trendingSignals.comments_7d +
    trendingSignals.remixes_7d;
  const isTrending = recentEngagement > 0;
  const showRank = Boolean(overallRank && likes > 0);

  return (
    <section aria-labelledby="card-stats-heading" className="flex flex-col gap-2">
      <h2 id="card-stats-heading" className="sr-only">
        By the numbers
      </h2>
      <dl className="grid grid-cols-5 overflow-hidden rounded-card border border-border/60 bg-surface/60">
        {stats.map((s, i) => {
          const value = (
            <span className="font-display text-lg font-semibold tabular-nums text-foreground sm:text-xl">
              {formatStatCount(s.value)}
            </span>
          );
          return (
            <div
              key={s.label}
              className={cn(
                "flex min-w-0 flex-col items-center gap-0.5 px-1 py-2.5 text-center",
                i > 0 && "border-l border-border/60",
              )}
            >
              {/* The number reads first on screen; the label first to a
                  screen reader (a <dt> before its <dd>). */}
              <dt className="order-2 truncate text-[11px] text-muted sm:text-xs">{s.label}</dt>
              <dd className="order-1">
                {s.href ? (
                  <a href={s.href} className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50">
                    {value}
                    {/* A link is named by its own text: the bare number
                        alone says nothing out of the list's context. */}
                    <span className="sr-only"> {s.label}</span>
                  </a>
                ) : (
                  value
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {isTrending || showRank ? (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {isTrending ? (
            <span className="inline-flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-accent" aria-hidden />
              <span>
                <span className="font-semibold text-foreground">Trending this week</span>
                {" — "}
                {trendingSignals.likes_7d} like{trendingSignals.likes_7d === 1 ? "" : "s"},{" "}
                {trendingSignals.comments_7d} comment{trendingSignals.comments_7d === 1 ? "" : "s"},{" "}
                {trendingSignals.remixes_7d} remix{trendingSignals.remixes_7d === 1 ? "" : "es"}
                {trendingSignals.is_fresh ? " · freshly forged" : ""}
              </span>
            </span>
          ) : null}
          {showRank ? (
            <span className="inline-flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-gold-strong" aria-hidden />
              <span>
                <span className="font-semibold text-foreground">#{overallRank}</span> most-liked card overall
              </span>
            </span>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// CreatorFeature — the card's maker, at the end of the info column: avatar,
// name, Follow / View profile, a short bio (clamped — the profile has it
// whole) and social links, with the profile's accent tint.
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
  // Only a drawable avatar (migration 0127, lib/media/media-urls.ts).
  const avatarSrc = profileMediaSrc("avatar", profile.avatar_url, profile.id);
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
      as="section"
      aria-labelledby="card-creator-heading"
      className="flex flex-col gap-4 border-t-2 border-t-[var(--profile-accent,var(--color-primary))] p-4 sm:p-5"
      style={accentStyle}
    >
      <h2 id="card-creator-heading" className="text-xs font-semibold uppercase tracking-wider text-subtle">
        Creator
      </h2>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {avatarSrc ? (
          <Image
            src={avatarSrc}
            alt={`${displayName} avatar`}
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 rounded-full border border-border/60 object-cover"
            // Avatars can be OAuth-provider URLs (not in remotePatterns) or a
            // /defaults path — never worth an optimizer variant at 48px.
            unoptimized
          />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border/60 bg-elevated text-lg font-semibold text-foreground">
            {initial}
          </span>
        )}

        <div className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
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

        {/* Its own row on a phone, so the name keeps its width. */}
        <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
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
        <p className="line-clamp-4 whitespace-pre-line text-sm leading-6 text-muted">
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

// ---------------------------------------------------------------------------
// JSON-LD CreativeWork
//
// Lets Google / ChatGPT / Perplexity describe the card accurately when a
// user asks about it. We emit only the fields we actually have — no
// fabricated authors or licenses. The image URL points at the public OG
// renderer so social unfurls and search-result thumbnails match.
// ---------------------------------------------------------------------------

/** The nickname's line under the H1 (TODO 6.3): "Printed as" where the
 *  card's frame prints it, "Also known as" where it doesn't
 *  (lib/cards/nickname.ts nicknamePageLine). Exported for tests. */
export function NicknameLine({ nickname, frameStyle }: { nickname?: string | null; frameStyle: unknown }) {
  const template = (frameStyle as { template?: string } | null | undefined)?.template;
  const line = nicknamePageLine(nickname, getFrameProfile(normalizeFrameTemplate(template)));
  if (!line) return null;
  return (
    <p className="text-sm text-muted" data-testid="card-nickname">
      {line.label} <span className="font-medium text-foreground">“{line.nickname}”</span>
    </p>
  );
}

/** Exported for tests (tests/unit/cards/emblem-card-page.test.tsx). */
export function buildCardJsonLd({
  inDecks,
  card,
  username,
  ownerDisplay,
  siteBase,
}: {
  inDecks: Array<{ slug: string; title: string }>;
  card: {
    id: string;
    title: string;
    slug: string;
    created_at: string;
    updated_at: string;
    rendered_at: string | null;
    flavor_text: string | null;
    rules_text: string | null;
    artist_credit: string | null;
    card_type: string | null;
    supertype: string | null;
    printed_types?: string | null;
    nickname?: string | null;
    subtypes: string[] | null;
    rarity: string | null;
    color_identity: string[] | null;
    cost: string | null;
    tags: string[];
    frame_style: unknown;
    set_code?: string | null;
    collector_number?: string | null;
    lang?: string | null;
    /** The back face (TODO 5.3): with a body of its own, the work gains it
     *  as `hasPart` with its own ImageObject — the back's stored bake. */
    back_face?: unknown;
    rendered_back_image_url?: string | null;
    owner_id?: string;
  };
  username: string;
  ownerDisplay: string;
  siteBase: string;
}): Record<string, unknown> {
  const description =
    // The flavour's upright `*…*` spans as plain words (lib/cards/flavor-markup.ts).
    stripFlavorMarkup(card.flavor_text?.trim() ?? "") ||
    // CARDNAME / ~ as the name the card prints (TODO 6.2).
    storedRulesTextWithSelfName(card)?.trim() ||
    "A custom Magic: The Gathering card forged on PipGlyph.";
  const truncatedDescription =
    description.length > 280 ? `${description.slice(0, 277)}…` : description;

  const canonical = `${siteBase}/card/${username}/${card.slug}`;
  // An emblem's name is "<walker> Emblem" (cardPageName, owner decision
  // 2026-09-29); a double-faced card's "Front // Back" (TODO 5.3).
  const faces = cardPageFacesOf({ frame_style: card.frame_style, back_face: card.back_face ?? null });
  const name = cardPageName(card.title, card.card_type, faces);
  // The back face with a body of its own (lib/cards/faces.ts): its words
  // join the keywords and it becomes a part of the work, below.
  const back = rowHasBakedBack({ frame_style: card.frame_style, back_face: card.back_face ?? null })
    ? ((card.back_face as CardBackFace | null) ?? null)
    : null;
  const backTypeLine = back
    ? buildTypeLine({ supertype: back.supertype, cardType: back.card_type ?? null, subtypes: back.subtypes ?? [], printedTypes: back.printed_types })
    : null;
  const typeLine = buildTypeLine({
    supertype: card.supertype,
    cardType: card.card_type as CardType | null,
    subtypes: card.subtypes ?? [],
    printedTypes: card.printed_types,
  });
  const version = renderVersionOf(card);
  const imageSize = naturalRenderSize(isLandscapeTemplate(card.frame_style));
  // An emblem names no rarity (CR 114; its stored "common" only inks the
  // set symbol).
  const rarity = cardTypeHasRarity(card.card_type) ? card.rarity : null;
  // The collector line's words, only when the render draws it (4.9b).
  const collector = collectorLineText(card);
  const keywords = Array.from(
    new Set(
      [
        ...card.tags,
        rarity ?? "",
        collector && card.set_code ? card.set_code.trim() : "",
        ...typeLine.split(/[\s—–-]+/),
        ...(card.color_identity ?? []),
        // The back face's words (TODO 5.3): "Werewolf", "Land" — what a
        // reader searching the other side would ask for.
        ...(backTypeLine ? backTypeLine.split(/[\s—–-]+/) : []),
        ...(back?.color_identity ?? []),
        "custom MTG card",
      ]
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 1),
    ),
  );

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name,
    // The nickname it prints in its title bar (TODO 6.3).
    ...(cardNickname(card.nickname) ? { alternateName: cardNickname(card.nickname) } : {}),
    headline: name,
    description: truncatedDescription,
    url: canonical,
    mainEntityOfPage: canonical,
    datePublished: card.created_at,
    // Edits only — a re-render no longer bumps updated_at (migration 0108).
    dateModified: card.updated_at,
    image: {
      "@type": "ImageObject",
      url: `${siteBase}/api/cards/${card.id}/og${version ? `?v=${version}` : ""}`,
      width: imageSize.width,
      height: imageSize.height,
      // The image's own words: the name it prints (the walker's, on an
      // emblem) and its type line.
      caption: `${card.title} — custom MTG-style ${typeLine}${rarity ? `, ${rarity}` : ""}${
        card.cost ? `, mana cost ${describeManaCost(card.cost)}` : ""
      }${collector ? `, collector line ${collector}` : ""}`,
    },
    keywords: keywords.join(", "),
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
  if (inDecks.length > 0) {
    schema.isPartOf = inDecks.map((deck) => ({
      "@type": "CollectionPage",
      name: deck.title,
      url: `${siteBase}/deck/${deck.slug}`,
    }));
  }
  // The back face as a PART of the work (TODO 5.3): its name, type line
  // and description, and its own ImageObject — the back's stored bake,
  // served from this site's /render-cdn path (one tag with the front's;
  // purged with the card), only when the row carries THIS card's own
  // `.back.png`. The OG image stays the front.
  if (back) {
    // Its rules with CARDNAME / ~ as ITS name (TODO 6.2), as the back draws.
    const backDescription =
      stripFlavorMarkup(back.flavor_text?.trim() ?? "") || backRulesTextWithSelfName(back, card.frame_style as { selfName?: string } | null)?.trim() || "";
    const backName = back.title?.trim() || "Back face";
    const part: Record<string, unknown> = {
      "@type": "CreativeWork",
      name: backName,
      position: 2,
      ...(backDescription ? { description: backDescription.length > 280 ? `${backDescription.slice(0, 277)}…` : backDescription } : {}),
      ...(back.artist_credit?.trim() ? { contributor: { "@type": "Person", name: back.artist_credit.trim() } } : {}),
    };
    const backBake =
      card.id && card.owner_id && isStoredRenderUrl(card.rendered_back_image_url, { ownerId: card.owner_id, cardId: card.id })
        ? toRenderCdnUrl(card.rendered_back_image_url)
        : null;
    if (backBake) {
      // The stored bake is the HD PNG (every DFC body is portrait).
      part.image = {
        "@type": "ImageObject",
        url: `${siteBase}${backBake}`,
        width: RENDER_PRESETS.hd.width,
        height: RENDER_PRESETS.hd.height,
        caption: `${backName} — the back face of ${card.title}, custom MTG-style ${backTypeLine}`,
      };
    }
    schema.hasPart = [part];
  }

  return schema;
}

// ---------------------------------------------------------------------------
// The details block — every fact the rendered card shows, as text.
// ---------------------------------------------------------------------------

/**
 * The collector line's words (TODO 4.9b): "DMU · 107/281 · English" — the
 * printed set code, the number as the card's style prints it and the
 * language's name — only when the card DRAWS the line (its switch names a
 * style and its template has the slot: collectorDrawn), else null. The
 * details block and the CreativeWork's caption carry it; a card whose line
 * is off or absent says nothing about its printing.
 */
export function collectorLineText(card: {
  card_type?: string | null;
  supertype?: string | null;
  rarity?: string | null;
  set_code?: string | null;
  collector_number?: string | null;
  lang?: string | null;
  frame_style?: unknown;
}): string | null {
  const frameStyle = (card.frame_style ?? {}) as FrameStyle;
  const style = collectorDrawn(getFrameProfile(normalizeFrameTemplate(frameStyle.template)), frameStyle);
  if (!style) return null;
  const parts: string[] = [];
  const setCode = (card.set_code ?? "").trim().toUpperCase();
  if (setCode) parts.push(setCode);
  const number = collectorNumberRuns(card.collector_number, style)
    .map((run) => (run.kind === "text" ? run.text : "★"))
    .join("");
  if (number) parts.push(number);
  const lang = PRINTED_LANGS.find((entry) => entry.code === card.lang);
  if (lang) parts.push(lang.label);
  return parts.length ? parts.join(" · ") : null;
}

/** Exported for tests (tests/unit/cards/emblem-card-page.test.tsx). */
export function CardDetails({
  card,
  inDecks,
}: {
  card: {
    cost: string | null;
    card_type: string | null;
    supertype: string | null;
    printed_types?: string | null;
    /** The nickname (TODO 6.3): a row when the card has one. */
    nickname?: string | null;
    subtypes: string[] | null;
    rarity: string | null;
    color_identity: string[] | null;
    power: string | null;
    toughness: string | null;
    loyalty: string | null;
    defense: string | null;
    set_icon_code: string | null;
    layout: string | null;
    artist_credit: string | null;
    created_at: string;
    updated_at: string;
    /** What a station card's tiers are read from (TODO 4.27a): with no tier
     *  the picture shows no power / toughness, so the details list none. */
    rules_text?: string | null;
    face_content?: unknown;
    /** The collector line (TODO 4.9b): its fields and the switch, shown
     *  only when the render draws the line. */
    set_code?: string | null;
    collector_number?: string | null;
    lang?: string | null;
    frame_style?: unknown;
    /** The back face (TODO 5.3): with a body of its own, its facts are
     *  listed under the front's. */
    back_face?: unknown;
  };
  inDecks: Array<{ slug: string; title: string }>;
}) {
  const typeLine = buildTypeLine({
    supertype: card.supertype,
    cardType: card.card_type as CardType | null,
    subtypes: card.subtypes ?? [],
    printedTypes: card.printed_types,
  });
  const costWords = describeManaCost(card.cost);
  const colors = (card.color_identity ?? [])
    .map((c) => COLOR_IDENTITY_LABELS[c as ColorIdentity] ?? c)
    .join(", ");
  // The stats the render prints (printsPowerToughness): a Treasure token
  // carrying a stray P/T prints none, so its details list none (TODO 3b.15).
  // And only on a frame that draws one (lib/cards/pt-drawn.ts): a saga whose
  // type says Creature keeps its 9/9 in the row, the picture shows none, so
  // the details list none either — the stored value is untouched. (So does
  // a station card with no tier: its P/T is printed on a tier's plate.)
  const frontTemplate = (card.frame_style as { template?: string | null } | null | undefined)?.template;
  const stats = frontDrawsPowerToughness(frontTemplate, { rulesText: card.rules_text ?? null, faceContent: (card.face_content ?? null) as FaceContent | null }) && printsPowerToughness({
    cardType: card.card_type as CardType | null,
    supertype: card.supertype,
    subtypes: card.subtypes ?? [],
    power: card.power,
    toughness: card.toughness,
  })
    ? `${card.power ?? "?"}/${card.toughness ?? "?"}`
      : card.loyalty != null
        ? `Loyalty ${card.loyalty}`
        : card.defense != null
          ? `Defense ${card.defense}`
          : null;
  const rows: Array<[string, React.ReactNode]> = [
    // The nickname it prints in its title bar (TODO 6.3).
    ...(cardNickname(card.nickname) ? [["Nickname", cardNickname(card.nickname)] as [string, React.ReactNode]] : []),
    ["Type", typeLine],
    ["Mana cost", card.cost ? `${card.cost} (${costWords})` : "None"],
    // An emblem has no rarity (CR 114): no row for its stored "common".
    ...(cardTypeHasRarity(card.card_type)
      ? [["Rarity", card.rarity ? RARITY_LABELS[card.rarity as Rarity] ?? card.rarity : "—"] as [string, React.ReactNode]]
      : []),
    // The card's colour as the creator models it — its frame colour, which
    // is not MTG's Commander colour identity (an imported Ajani, Nacatl
    // Pariah is White, its identity R/W; TODO 1.2), so the row says "Color".
    ["Color", colors || "Colorless"],
  ];
  if (stats) rows.push(["Stats", stats]);
  if (card.layout && card.layout !== "normal") rows.push(["Layout", card.layout]);
  if (card.set_icon_code) rows.push(["Set symbol", card.set_icon_code.toUpperCase()]);
  // The collector line as printed (TODO 4.9b): "Set · Number · Language",
  // only when the render draws the line — in step with the image.
  const collector = collectorLineText(card);
  if (collector) rows.push(["Collector line", collector]);
  if (card.artist_credit?.trim()) rows.push(["Art", card.artist_credit.trim()]);
  rows.push(["Created", formatShortDate(card.created_at)]);
  if (Date.parse(card.updated_at) - Date.parse(card.created_at) > 60_000) {
    rows.push(["Updated", formatShortDate(card.updated_at)]);
  }
  if (inDecks.length > 0) {
    rows.push([
      "In decks",
      <span key="decks" className="flex flex-wrap gap-x-2 gap-y-1">
        {inDecks.map((deck) => (
          <Link key={deck.slug} href={`/deck/${deck.slug}`} className="underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
            {deck.title}
          </Link>
        ))}
      </span>,
    ]);
  }
  // The back face with a body of its own (lib/cards/faces.ts): the facts
  // its render shows, under the front's — never a legacy back's (the page
  // flips to it, but the bake and the downloads are the front's).
  const back = rowHasBakedBack({ frame_style: card.frame_style, back_face: card.back_face ?? null })
    ? ((card.back_face as CardBackFace | null) ?? null)
    : null;
  const backRows: Array<[string, React.ReactNode]> = back
    ? backFaceRows(back, card.color_identity, frontTemplate)
    : [];
  return (
    <section aria-labelledby="card-details-heading" className="flex flex-col gap-2">
      <h2 id="card-details-heading" className="font-mono text-[11px] uppercase tracking-wider text-muted">
        Card details
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {back ? (
        <>
          <h3 id="card-back-details-heading" className="mt-2 font-mono text-[11px] uppercase tracking-wider text-muted">
            Back face{back.title?.trim() ? ` — ${back.title.trim()}` : ""}
          </h3>
          <dl aria-labelledby="card-back-details-heading" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm" data-testid="card-back-details">
            {backRows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
    </section>
  );
}

/** The back face's rows (TODO 5.3): its type line, mana cost (a modal
 *  back prints one; a transform back none), colour (its own, else the
 *  front's — the colour its body is drawn in, lib/cards/faces.ts
 *  backPreviewData), the stats its render prints and its artist — the same
 *  rules as the front's rows. */
function backFaceRows(
  back: CardBackFace,
  frontColors: string[] | null,
  frontTemplate: string | null | undefined,
): Array<[string, React.ReactNode]> {
  const typeLine = buildTypeLine({
    supertype: back.supertype,
    cardType: back.card_type ?? null,
    subtypes: back.subtypes ?? [],
    printedTypes: back.printed_types,
  });
  const colors = (back.color_identity ?? frontColors ?? [])
    .map((c) => COLOR_IDENTITY_LABELS[c as ColorIdentity] ?? c)
    .join(", ");
  // Its body's own P/T slot (a land back body has none).
  const stats = secondFaceDrawsPowerToughness(frontTemplate, back.frame_style?.template) && printsPowerToughness({
    cardType: back.card_type ?? null,
    supertype: back.supertype,
    subtypes: back.subtypes ?? [],
    power: back.power,
    toughness: back.toughness,
  })
    ? `${back.power ?? "?"}/${back.toughness ?? "?"}`
    : back.loyalty != null
      ? `Loyalty ${back.loyalty}`
      : back.defense != null
        ? `Defense ${back.defense}`
        : null;
  const rows: Array<[string, React.ReactNode]> = [["Type", typeLine]];
  if (back.cost?.trim()) rows.push(["Mana cost", `${back.cost} (${describeManaCost(back.cost)})`]);
  rows.push(["Color", colors || "Colorless"]);
  if (stats) rows.push(["Stats", stats]);
  if (back.artist_credit?.trim()) rows.push(["Art", back.artist_credit.trim()]);
  return rows;
}
