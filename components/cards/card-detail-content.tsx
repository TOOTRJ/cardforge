import Link from "next/link";
import { tagSlug } from "@/lib/cards/tag-slug";
import { isHubType, TYPE_HUB_MIN_CARDS } from "@/lib/cards/hubs";
import {
  VISIBILITY_LABELS,
  CARD_TYPE_LABELS,
  isColorIdentity,
  type CardType,
} from "@/types/card";
import Image from "next/image";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  Flame,
  Pencil,
  Repeat2,
  Sparkles,
  Trophy,
} from "lucide-react";
import { CardHeroPreview } from "@/components/cards/card-hero-preview";
import { getPipOverrides, getSymbolMeanings } from "@/lib/pips/queries";
import type { SymbolMeanings } from "@/lib/symbols/symbol-token";
import type { PipOverrides } from "@/lib/pips/override";
import { CardTextBlock } from "@/components/cards/card-text-block";
import { cardTextFacesOf, colorWords } from "@/lib/cards/card-text-faces";
import { ColorPips, pipColorOfIdentity, toPipColor, type PipColor } from "@/components/cards/color-pip";
import { manaValueOfCost } from "@/lib/cards/mana-value";
import { cardPageRulesText } from "@/lib/cards/page-rules-text";
import { describeFrame } from "@/lib/creator/frame-resolve";
import { frameAnchorId } from "@/lib/frames/frame-gallery";
import { CardComments } from "@/components/cards/card-comments";
import { DownloadModal } from "@/components/cards/download-modal";
import { frameTemplateOf } from "@/lib/cards/print-export";
import { LikeButton } from "@/components/cards/like-button";
import { RemixButton } from "@/components/cards/remix-button";
import { AddToDeckButton } from "@/components/cards/add-to-deck-button";
import { BuildDeckAroundButton } from "@/components/decks/build-deck-around-button";
import { ShareTargets } from "@/components/cards/share-targets";
import { ReferralLandingNote } from "@/components/referrals/referral-landing-note";
import { ReportCardDialog } from "@/components/cards/report-card-dialog";
import { GalleryCardTile } from "@/components/cards/gallery-card-tile";
import { CARD_GRID_SIZES } from "@/components/cards/card-grid";
import { ROW_GRID_CLASS, ROW_MAX, rowTileClass } from "@/components/gallery/card-row";
import { FollowButton } from "@/components/follows/follow-button";
import { isFollowing } from "@/lib/follows/queries";
import { SocialIcon } from "@/components/profile/social-icon";
import { profileMediaSrc } from "@/lib/media/media-urls";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listCardChallengeWins } from "@/lib/challenges/queries";
import { challengeWinAward, placeLabel, type ChallengeWin } from "@/lib/challenges/winners-shared";
import { SurfaceCard } from "@/components/ui/surface-card";
import { PageContainer } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from "@/lib/auth/schemas";
import {
  countCardLikes,
  countRemixesOfCard,
  getCardById,
  getCardByOwnerAndSlug,
  getCardLikeStanding,
  getCardTrendingSignals,
  getProfileByUsername,
  getRemixParentLink,
  hasUserLikedCard,
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
import { DECK_GRID_SIZES, DeckGrid, DeckTile } from "@/components/decks/deck-tile";
import { buildTypeLine, describeManaCost, normalizeFrameTemplate } from "@/lib/cards/card-display";
import { collectorDrawn } from "@/lib/cards/collector-layout";
import { collectorNumberRuns } from "@/lib/cards/collector-line";
import { PRINTED_LANGS } from "@/lib/cards/collector-fields";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { cardPageFacesOf, cardPageName, cardTypeHasRarity } from "@/lib/cards/emblem";
import { backRulesTextWithSelfName } from "@/lib/cards/self-name";
import { cardNickname, nicknamePageLine } from "@/lib/cards/nickname";
import { rowHasBakedBack } from "@/lib/cards/faces";
import { isStoredRenderUrl, toRenderCdnUrl } from "@/lib/cards/render-cdn";
import { renderVersionOf } from "@/lib/cards/render-version";
import { isLandscapeTemplate, naturalRenderSize, RENDER_PRESETS } from "@/lib/render/card-image";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { countPublicRemixesBySource } from "@/lib/cards/source-queries";
import { countCommentsForCard, listCommentsForCard } from "@/lib/cards/comments-queries";
import { getCurrentUser } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { downloadDiffersFromGallery } from "@/lib/cards/layout-version";
import { getSiteBaseUrl } from "@/lib/site-url";
import { breadcrumbJsonLd, JsonLd, serializeJsonLd } from "@/components/seo/json-ld";
import type { CardBackFace, FrameStyle } from "@/types/card";
import { formatShortDate } from "@/lib/format/dates";
import { stripFlavorMarkup } from "@/lib/cards/flavor-markup";
import { aiProvenanceOf, aiProvenanceSentence, type AiProvenance } from "@/lib/cards/ai-provenance";
import { AiProvenanceTags } from "@/components/cards/ai-provenance-tags";
import { CardViewBeacon } from "@/components/cards/card-view-beacon";
import { AREA, CARD_PAGE_GRID } from "@/components/cards/card-page-grid";
import { likeStandingText, type LikeStanding } from "@/lib/cards/like-standing";

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
    symbolMeanings,
    creatorProfile,
    viewerFollows,
    remixCount,
    publicDeckCount,
    topRemixes,
    remixParent,
    likeStanding,
    trendingSignals,
    inDecks,
    deckTiles,
    challengeWins,
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
    listCommentsForCard(card.id, { limit: COMMENT_PAGE }),
    getEntitlements(),
    listMoreFromOwner(card.owner_id, card.id, ROW_MAX),
    listRelatedCards(
      { cardId: card.id, ownerId: card.owner_id, cardType: card.card_type },
      ROW_MAX,
    ),
    // The owner's custom pip icons for the card preview.
    getPipOverrides(card.owner_id),
    // …and what the owner's own symbols mean: a `{*CODE}` in the cost counts
    // its declared mana value in the details (one read with the pictures).
    getSymbolMeanings(card.owner_id),
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
    listTopRemixesOfCard(card.id, ROW_MAX),
    // Provenance: the original card this was remixed from (if any).
    card.parent_card_id
      ? getRemixParentLink(card.parent_card_id)
      : Promise.resolve(null),
    // The "most-liked" standing among public cards (0168).
    getCardLikeStanding(card.id),
    // 7-day velocity for the trending badge.
    getCardTrendingSignals(card.id, card.owner_id, card.created_at),
    // The public decks the card is in — ONE list (0144 / 0149's rule) for the
    // "In decks" row, the JSON-LD isPartOf and the "Decks with this card"
    // tiles (the same list hydrated: cache()-deduped, one RPC).
    listPublicDecksContaining(card.id),
    listPublicDeckTilesContaining(card.id),
    // The design challenges the card placed in (TODO NV12, 0172).
    listCardChallengeWins(card.id),
  ]);
  // The comments shown are the first COMMENT_PAGE; the count the stats and
  // the structured data say is all of them.
  const commentCount =
    comments.length < COMMENT_PAGE ? comments.length : ((await countCommentsForCard(card.id)) ?? comments.length);
  const deckTileArt = await listDeckTileArt(deckTiles, { anonymous: true });
  // "Build a deck around this card" (TODO DK8.3): where the card may join
  // the viewer's new deck — a PUBLIC card (anyone's, D3), or their own.
  const canBuildAround = card.visibility === "public" || isOwner;
  // The stat counts every deck the list stands for (it shows the newest few);
  // unread (a database 0149 hasn't reached), the list's own length.
  const deckCount = publicDeckCount ?? inDecks.length;

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
  // How much of the card AI made (TODO CP1, migration 0162): the stored
  // parts read against the card as it is — a tag under the byline, a line
  // in Card details, the image's source type in the JSON-LD.
  const aiProvenance = aiProvenanceOf(card);
  const jsonLd =
    isShareable
      ? buildCardJsonLd({
          inDecks,
          card,
          username,
          ownerDisplay:
            ownerProfile?.display_name || ownerProfile?.username || "Anonymous",
          siteBase,
          engagement: { likes: likesCount, comments: commentCount },
          basedOn: remixParent ? `${siteBase}${remixParent.path}` : null,
          awards: challengeWins.map(challengeWinAward),
        })
      : null;

  const cardPath = `/card/${username}/${card.slug}`;
  const isAuthed = Boolean(user);
  // The visibility badge is the OWNER's reminder, and a visitor's only where
  // it says something (an unlisted link); a public card needs no label.
  const showVisibility = isOwner || card.visibility !== "public";

  // The page (TODO CP2b, owner 2026-11-04 "All recommended"): ONE grid whose
  // areas move with the width, in one DOM order — the title, the card, the
  // actions, the card as text, then the side rail (the creator, the numbers,
  // the decks):
  //   phone   one column: title, card, text, rail; the actions a bar pinned
  //           to the bottom of the screen while the card's section is in view
  //   md      the card (280 px) beside the title, the actions and the text;
  //           the rail under both
  //   lg      the card (352 px) sticky beside them, the rail under the text
  //   xl      three columns — the card, the text (a reading measure), the
  //           rail — at 1366 px the default view shows all three at once
  //   2xl     the same, spread over the wide frame (TODO WD10)
  // Each column item starts at the top of its rows; the hero spans a last
  // 1fr row, so its height never pushes the rows beside it apart.
  // The breadcrumb names the card's type hub only where that hub is indexed:
  // a PUBLIC card is one of the public cards it counts, and one is its whole
  // threshold (TYPE_HUB_MIN_CARDS — raised, the crumb goes until it reads
  // the hub's count). An unlisted or private card's page never points at a
  // hub it may not be in.
  const typeHub =
    card.visibility === "public" && TYPE_HUB_MIN_CARDS <= 1 && card.card_type && isHubType(card.card_type)
      ? card.card_type
      : null;
  return (
    <PageContainer size="wide" className="py-6 sm:py-10">
      {/* One view ping when a visitor is shown a card they can open (TODO
          CP4): counted once per viewer and day, never the owner's. */}
      {isShareable && !isOwner ? <CardViewBeacon cardId={card.id} /> : null}
      {jsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      ) : null}
      {/* Breadcrumbs only for indexable cards — unlisted pages are noindex,
          so hierarchy signals there are wasted bytes. The type's hub sits
          between the gallery and the card, in both. */}
      {card.visibility === "public" ? (
        <JsonLd
          data={breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Gallery", path: "/gallery" },
            ...(typeHub ? [{ name: TYPE_HUB_CRUMBS[typeHub], path: `/gallery/type/${typeHub}` }] : []),
            { name: pageName, path: cardPath },
          ])}
        />
      ) : null}
      <CardBreadcrumbs pageName={pageName} typeHub={typeHub} />

      <div className={CARD_PAGE_GRID}>
        <header className={cn("flex min-w-0 flex-col gap-2", AREA.head)}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[11px] uppercase tracking-wider text-gold-strong">
              {cardEyebrow(card.card_type)}
            </p>
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
          </div>
          <h1 className="text-balance font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
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
          <AiProvenanceTags provenance={aiProvenance} />
          <ChallengeWinTags wins={challengeWins} />
          {/* The moderation lock (0156): the owner is told why the card
              stays private, and where to ask. */}
          {isOwner && isModerationLocked(card) ? (
            <p className="mt-1 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-sm leading-6 text-foreground">
              {MODERATION_LOCK_NOTE}{" "}
              <Link href={MODERATION_CONTACT_HREF} className="font-medium text-primary-bright underline-offset-4 hover:underline">
                Contact us
              </Link>{" "}
              if you have questions.
            </p>
          ) : null}
        </header>

        <div className={cn("min-w-0", AREA.hero)}>
          <div
            className="mx-auto w-full max-w-sm md:max-w-none"
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

        {/* ONE action row, in the order people reach for them: the card's
            own (the owner's Edit, download, remix, add to deck), then like,
            share and report. On a phone it is the bar pinned to the bottom
            of the screen (its buttons scroll sideways inside it, never the
            page). */}
        <div className={cn("min-w-0", AREA.actions)} data-testid="card-actions" data-card-action-bar="">
          {/* The phone's row scrolls sideways; its right edge fades while
              there is more to it (globals.css `[data-card-action-row]`). */}
          <div className="flex items-center gap-2 max-md:overflow-x-auto max-md:pb-0.5 md:flex-wrap" data-card-action-row="">
            {/* Two groups that wrap as wholes: the card's own actions, then
                the social ones. */}
            <div className="flex items-center gap-2 max-md:shrink-0 md:flex-wrap">
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
                downloadDiffersFromGallery={downloadDiffersFromGallery(card, entitlements.isPaid)}
                frameTemplate={frameTemplateOf(card.frame_style)}
                hasBackFace={hasBackFace}
                // Downloads are a signed-in viewer's: a visitor's button
                // signs in and comes back here.
                signInReturnTo={isAuthed ? undefined : cardPath}
                // The trigger's look as PROPS — never a <Button> element: the
                // modal puts its trigger under Radix's `DialogTrigger asChild`,
                // and an element sent from this server component can arrive
                // as a lazy reference Radix renders as nothing (a hydration
                // error, 2026-11-02; download-modal.tsx).
                trigger={{ variant: isOwner ? "outline" : "primary" }}
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
              />
              {!isOwner && card.visibility === "public" ? (
                <AddToDeckButton
                  cardId={card.id}
                  cardTitle={card.title}
                  cardPath={cardPath}
                  signedIn={isAuthed}
                />
              ) : null}
            </div>
            <div className="flex items-center gap-2 max-md:shrink-0 md:flex-wrap">
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
        </div>

        <div className={cn("flex min-w-0 flex-col gap-5", AREA.text)}>
          {/* A visitor who came through a friend's share link (`?ref=`) is
              told what the link gets them — a client island, nothing for
              anyone else (TODO SG1). */}
          <ReferralLandingNote />
          {/* Card details as TEXT. The rendered preview shows all of this,
              but a crawler or answer engine reads none of it from an image —
              this block is what makes the page citable for "custom MTG
              {type}" queries. */}
          <CardDetails card={card} aiProvenance={aiProvenance} pipOverrides={pipOverrides} symbolMeanings={symbolMeanings} />

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
        </div>

        {/* The side rail: who made it, how it is doing, where it is used —
            and, for a visitor from a shared link, the way to make one. */}
        <aside aria-label="About this card" className={cn("flex min-w-0 flex-col gap-4", AREA.rail)}>
          {creatorProfile ? (
            <CreatorFeature
              profile={creatorProfile}
              targetUserId={card.owner_id}
              isOwner={isOwner}
              initialFollowing={viewerFollows}
              requiresSignIn={!user}
            />
          ) : null}
          <div className="flex min-w-0 flex-col gap-4">
            <CardStats
              views={card.view_count}
              likes={likesCount}
              remixes={remixCount}
              decks={deckCount}
              comments={commentCount}
              trendingSignals={trendingSignals}
              likeStanding={likeStanding}
            />
            {inDecks.length > 0 ? <InDecksList decks={inDecks} total={deckCount} /> : null}
            {/* Share-traffic conversion: most anonymous visitors arrive from a
                shared link — meet the "I could make one of these" moment. */}
            {!user ? (
              <Link
                href="/signup"
                className="inline-flex w-fit items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:border-gold hover:bg-gold/15"
              >
                <Sparkles className="h-4 w-4 text-gold" aria-hidden />
                Forge your own card — free
              </Link>
            ) : null}
          </div>
        </aside>
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
            viewAllHref={typeHub ? `/gallery/type/${typeHub}` : "/gallery/browse"}
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

/** The breadcrumb's name for a type's hub page (/gallery/type/<type>). */
/** The comments the page loads at once (the newest). */
const COMMENT_PAGE = 50;

const TYPE_HUB_CRUMBS: Record<CardType, string> = {
  creature: "Creatures",
  instant: "Instants",
  sorcery: "Sorceries",
  artifact: "Artifacts",
  enchantment: "Enchantments",
  land: "Lands",
  planeswalker: "Planeswalkers",
  battle: "Battles",
  token: "Tokens",
  emblem: "Emblems",
  spell: "Spells",
};

/** The line over the H1: what the card is, in the words people search with. */
/** The design challenges the card placed in (TODO NV12): one badge each,
 *  linking the challenge. */
function ChallengeWinTags({ wins }: { wins: ChallengeWin[] }) {
  if (wins.length === 0) return null;
  return (
    <ul aria-label="Challenge wins" className="flex flex-wrap gap-2 pt-1" data-testid="challenge-wins">
      {wins.map((win) => (
        <li key={win.challenge.slug}>
          <Link href={`/challenges/${win.challenge.slug}`} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50">
            <Badge variant={win.place === 1 ? "gold" : "outline"} className="gap-1.5 hover:border-border-strong">
              <Trophy className="h-3.5 w-3.5" aria-hidden />
              {placeLabel(win.place)} · {win.challenge.title}
            </Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function cardEyebrow(cardType: string | null): string {
  if (!cardType || cardType === "spell") return "Custom MTG card";
  const label = CARD_TYPE_LABELS[cardType as CardType];
  return label ? `Custom MTG ${label.toLowerCase()}` : "Custom MTG card";
}

/** The rail's short list of the public decks the card is in — the same one
 *  list as the JSON-LD isPartOf and the tiles below (0144 / 0149's rule),
 *  its first few by name. */
function InDecksList({ decks, total }: { decks: Array<{ slug: string; title: string }>; total: number }) {
  const shown = decks.slice(0, 3);
  return (
    <section aria-labelledby="card-in-decks-heading" className="flex flex-col gap-1.5 text-sm">
      <h2 id="card-in-decks-heading" className="font-mono text-[11px] uppercase tracking-wider text-muted">
        In decks
      </h2>
      <ul className="flex flex-col gap-1">
        {shown.map((deck) => (
          <li key={deck.slug} className="min-w-0 truncate">
            <Link href={`/deck/${deck.slug}`} className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
              {deck.title}
            </Link>
          </li>
        ))}
      </ul>
      {total > shown.length ? (
        <a href="#decks-with-card-heading" className="w-fit text-xs font-semibold text-primary-bright underline-offset-4 hover:underline">
          All {total} decks
        </a>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// CardBreadcrumbs — "Gallery › Creatures › <card>", the visible twin of the
// breadcrumb JSON-LD (Home › Gallery › type hub › card). The current page is
// named for a screen reader and on a wide screen; a phone shows the way back
// alone (the H1 right below says the rest).
// ---------------------------------------------------------------------------

function CardBreadcrumbs({ pageName, typeHub }: { pageName: string; typeHub: CardType | null }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 sm:mb-6">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
        <li className="shrink-0">
          <Link href="/gallery" className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4 sm:hidden" aria-hidden />
            Gallery
          </Link>
        </li>
        {typeHub ? (
          <li className="flex shrink-0 items-center gap-1.5 max-sm:hidden">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
            <Link href={`/gallery/type/${typeHub}`} className="transition-colors hover:text-foreground">
              {TYPE_HUB_CRUMBS[typeHub]}
            </Link>
          </li>
        ) : null}
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
              sizes={DECK_GRID_SIZES}
              likeRedirect={cardPath}
            />
          ))}
        </DeckGrid>
      ) : null}
    </section>
  );
}

/** A one-row strip of up to ROW_MAX card tiles — the card grid's 2 → 6
 *  columns by the strip's width, the tiles past the last column hidden
 *  (components/gallery/card-row.tsx), in the wide frame's `sizes`. */
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
      <div className="@container">
        <div className={ROW_GRID_CLASS}>
          {cards.slice(0, ROW_MAX).map((card, index) => (
            <div key={card.id} className={cn("flex-col", rowTileClass(index))}>
              <GalleryCardTile card={card} isAuthed={isAuthed} sizes={CARD_GRID_SIZES} />
            </div>
          ))}
        </div>
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
  likeStanding,
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
  likeStanding: LikeStanding | null;
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
  const rankText = likeStandingText(likeStanding);

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
      {isTrending || rankText ? (
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
          {rankText ? (
            <span className="inline-flex items-center gap-1.5" data-testid="card-like-standing">
              <Trophy className="h-3.5 w-3.5 text-gold-strong" aria-hidden />
              <span className="font-semibold text-foreground">{rankText}</span>
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

/** schema.org's IPTC digital source type for an image composited from
 *  trained-algorithmic (AI) media — a card render with an AI picture. */
export const AI_COMPOSITE_SOURCE_TYPE = "https://schema.org/CompositeWithTrainedAlgorithmicMediaDigitalSource";

/** Exported for tests (tests/unit/cards/emblem-card-page.test.tsx). */
export function buildCardJsonLd({
  inDecks,
  card,
  username,
  ownerDisplay,
  siteBase,
  engagement,
  basedOn,
  awards = [],
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
    /** A walker / saga / station stored with its rows alone: `text`. */
    face_content?: unknown;
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
    /** The bake's 600 px thumbnail: the work's thumbnailUrl. */
    rendered_thumb_url?: string | null;
    owner_id?: string;
    /** AI provenance (TODO CP1): the parts AI made. */
    ai_fields?: string[] | null;
  };
  username: string;
  ownerDisplay: string;
  siteBase: string;
  /** The likes and comments the page shows (TODO CP2b): interactionStatistic. */
  engagement?: { likes: number; comments: number };
  /** The PipGlyph card it remixes (TODO CP2b): isBasedOn. (A Scryfall
   *  source has no stable page URL of its own — only its uuid is stored.) */
  basedOn?: string | null;
  /** Its design-challenge places (TODO NV12): award, as the page says them. */
  awards?: readonly string[];
}): Record<string, unknown> {
  const description =
    // The flavour's upright `*…*` spans as plain words (lib/cards/flavor-markup.ts).
    stripFlavorMarkup(card.flavor_text?.trim() ?? "") ||
    // Its text or its rows, CARDNAME / ~ as the name the card prints (TODO 6.2).
    cardPageRulesText({ ...card, rules_text: card.rules_text ?? null })?.trim() ||
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
      // The card image composites an AI picture (TODO CP1): IPTC's digital
      // source type as schema.org names it. Text-only AI has no property.
      ...(aiProvenanceOf(card).art ? { digitalSourceType: AI_COMPOSITE_SOURCE_TYPE } : {}),
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

  // The card's rules as words (TODO CP2b) — CARDNAME / ~ as the name it
  // prints (TODO 6.2) — whatever the description led with.
  const rulesText = cardPageRulesText({ ...card, rules_text: card.rules_text ?? null })?.trim();
  if (rulesText) schema.text = rulesText;
  if (awards.length > 0) schema.award = awards.length === 1 ? awards[0] : [...awards];
  const thumb =
    card.id && card.owner_id && isStoredRenderUrl(card.rendered_thumb_url, { ownerId: card.owner_id, cardId: card.id })
      ? toRenderCdnUrl(card.rendered_thumb_url)
      : null;
  if (thumb) schema.thumbnailUrl = `${siteBase}${thumb}`;
  if (engagement) {
    schema.commentCount = engagement.comments;
    schema.interactionStatistic = [
      { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: engagement.likes },
      { "@type": "InteractionCounter", interactionType: "https://schema.org/CommentAction", userInteractionCount: engagement.comments },
    ];
  }
  if (basedOn) schema.isBasedOn = basedOn;
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

/** The colour pips of a stored colour list. */
function colorPipsOf(colors: readonly string[]): PipColor[] {
  const pips = colors.flatMap((c) => {
    const pip = isColorIdentity(c) ? pipColorOfIdentity(c) : toPipColor(c);
    return pip ? [pip] : [];
  });
  return pips.length > 0 ? pips : ["C"];
}

/** Exported for tests (tests/unit/cards/emblem-card-page.test.tsx). */
export function CardDetails({
  card,
  aiProvenance,
  pipOverrides = null,
  symbolMeanings = null,
}: {
  card: {
    title: string;
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
    rules_text?: string | null;
    flavor_text?: string | null;
    /** What a station card's tiers are read from (TODO 4.27a): with no tier
     *  the picture shows no power / toughness, so the text lists none. */
    face_content?: unknown;
    /** The collector line (TODO 4.9b): its fields and the switch, shown
     *  only when the render draws the line. */
    set_code?: string | null;
    collector_number?: string | null;
    lang?: string | null;
    frame_style?: unknown;
    /** The back face (TODO 5.3): with a body of its own, its text is a
     *  block of its own under the front's. */
    back_face?: unknown;
  };
  /** What AI made of the card (TODO CP1): one row, absent for a card made
   *  by hand. */
  aiProvenance?: AiProvenance;
  /** The owner's custom pip icons — the costs draw the pips the card draws. */
  pipOverrides?: PipOverrides | null;
  /** What the owner's own symbols mean — a `{*CODE}` in the cost counts its
   *  declared mana value (lib/symbols/symbol-token.ts). */
  symbolMeanings?: SymbolMeanings | null;
}) {
  const frontTemplate = (card.frame_style as { template?: string | null } | null | undefined)?.template;
  // The faces as text — the ONE answer the exports read too
  // (lib/cards/card-text-faces.ts).
  const { front, back: backFace, secondPart, partWords } = cardTextFacesOf(card);

  // The facts the text block doesn't hold. The card's colour is its frame
  // colour as the creator models it — not MTG's Commander colour identity
  // (an imported Ajani, Nacatl Pariah is White, its identity R/W; TODO
  // 1.2), so the row says "Color".
  const colors = card.color_identity ?? [];
  const template = normalizeFrameTemplate(frontTemplate, { rulesText: card.rules_text ?? null });
  const manaValue = card.cost?.trim() ? manaValueOfCost(card.cost, symbolMeanings) : null;
  const rows: Array<[string, React.ReactNode]> = [];
  // The nickname it prints in its title bar (TODO 6.3).
  const nickname = cardNickname(card.nickname);
  if (nickname) rows.push(["Nickname", nickname]);
  if (manaValue != null) rows.push(["Mana value", String(manaValue)]);
  rows.push([
    "Color",
    <span key="color" className="inline-flex items-center gap-2">
      <ColorPips colors={colorPipsOf(colors)} size={16} decorative />
      <span>{colorWords(colors) || "Colorless"}</span>
    </span>,
  ]);
  rows.push([
    "Frame",
    <Link key="frame" href={`/frames#${frameAnchorId(template)}`} className="underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
      {describeFrame(template)}
    </Link>,
  ]);
  if (card.layout && card.layout !== "normal") rows.push(["Layout", card.layout]);
  if (card.set_icon_code) rows.push(["Set symbol", card.set_icon_code.toUpperCase()]);
  // The collector line as printed (TODO 4.9b): "Set · Number · Language",
  // only when the render draws the line — in step with the image.
  const collector = collectorLineText(card);
  if (collector) rows.push(["Collector line", collector]);
  // How much of it AI made (TODO CP1) — nothing for a card made by hand.
  const aiLine = aiProvenance ? aiProvenanceSentence(aiProvenance) : null;
  if (aiLine) rows.push(["Made with AI", aiLine]);
  // The byline carries the day it was made; an edit since is a row.
  if (Date.parse(card.updated_at) - Date.parse(card.created_at) > 60_000) {
    rows.push(["Updated", <time key="updated" dateTime={card.updated_at}>{formatShortDate(card.updated_at)}</time>]);
  }

  return (
    <section aria-labelledby="card-details-heading" className="flex flex-col gap-3">
      <h2 id="card-details-heading" className="font-mono text-[11px] uppercase tracking-wider text-muted">
        Card details
      </h2>
      <CardTextBlock
        face={front}
        pipOverrides={pipOverrides}
        label={backFace ? "Front face" : secondPart && partWords ? partWords.first : "Card text"}
      />
      {backFace ? (
        <CardTextBlock face={backFace} pipOverrides={pipOverrides} label="Back face" testId="card-back-details" />
      ) : null}
      {secondPart && partWords ? (
        <CardTextBlock face={secondPart} pipOverrides={pipOverrides} label={partWords.second} testId="card-second-part" />
      ) : null}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm" data-testid="card-facts">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="min-w-0 text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
