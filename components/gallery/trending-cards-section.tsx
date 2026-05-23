import Link from "next/link";
import Image from "next/image";
import { Flame, Heart } from "lucide-react";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import { CardHoverEffect } from "@/components/cards/card-hover-effect";
import { CardPreviewSkeleton } from "@/components/cards/card-preview-skeleton";
import { TrendingShareButton } from "@/components/gallery/trending-share-button";
import { Skeleton } from "@/components/ui/skeleton";
import { buildCardPath, buildCardUrl } from "@/lib/cards/utils";
import { getSiteBaseUrl } from "@/lib/site-url";
import type { CardWithStats } from "@/lib/cards/queries";
import type { ArtPosition, FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TrendingCardsSection — header + grid of trending tiles. Each tile carries
// three click targets:
//   - the card image opens the card detail page
//   - the share icon (top-right overlay) opens the share-targets dialog
//   - the owner chip (avatar + handle, below the image) opens the profile
// Renders nothing when the list is empty so the home/gallery pages don't
// show an awkward empty header above no content.
// ---------------------------------------------------------------------------

type TrendingCardsSectionProps = {
  cards: CardWithStats[];
  /** Eyebrow text rendered above the heading. */
  eyebrow?: string;
  /** Main heading text for the section. */
  heading?: string;
  /** Optional supporting copy under the heading. */
  description?: string;
  /** Right-aligned slot — typically a "View gallery" link. */
  action?: React.ReactNode;
  /** Eager-load images for the first row when the section is above the fold. */
  priority?: boolean;
};

export function TrendingCardsSection({
  cards,
  eyebrow = "Trending now",
  heading = "Hot this week",
  description,
  action,
  priority = false,
}: TrendingCardsSectionProps) {
  if (cards.length === 0) return null;

  // Resolved once for the section so per-tile renders don't each pay the
  // env-var lookup; falls back to localhost during local dev.
  const siteBase = getSiteBaseUrl();

  return (
    <section aria-labelledby="trending-heading">
      <div className="mb-6 flex flex-col items-start justify-between gap-3 md:flex-row md:items-end">
        <div className="flex flex-col gap-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            <Flame className="h-3.5 w-3.5" aria-hidden />
            {eyebrow}
          </span>
          <h2
            id="trending-heading"
            className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
          >
            {heading}
          </h2>
          {description ? (
            <p className="max-w-2xl text-sm leading-6 text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => (
          <TrendingTile
            key={card.id}
            card={card}
            priority={priority}
            siteBase={siteBase}
          />
        ))}
      </div>
    </section>
  );
}

function TrendingTile({
  card,
  priority,
  siteBase,
}: {
  card: CardWithStats;
  priority: boolean;
  siteBase: string;
}) {
  const cardUrl = buildCardUrl(card, siteBase);

  return (
    <div className="flex flex-col gap-2">
      <div className="group relative">
        <Link
          href={buildCardPath(card)}
          className="block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={`Open ${card.title}`}
          style={{ viewTransitionName: `trending-card-${card.id}` }}
        >
          <CardHoverEffect>
            <BakedCardThumbnail
              renderedImageUrl={card.rendered_image_url}
              title={card.title}
              priority={priority}
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
              }}
            />
          </CardHoverEffect>
        </Link>
        <div className="absolute right-2 top-2 z-10">
          <TrendingShareButton cardTitle={card.title} cardUrl={cardUrl} />
        </div>
      </div>

      <ProfileChip
        owner={card.owner}
        likesCount={card.likes_count}
      />
    </div>
  );
}

function ProfileChip({
  owner,
  likesCount,
}: {
  owner: CardWithStats["owner"];
  likesCount: number;
}) {
  const displayName =
    owner?.display_name?.trim() || owner?.username || "Anonymous forger";
  const initial = (displayName[0] ?? "?").toUpperCase();
  const handle = owner?.username ? `@${owner.username}` : null;
  const chipClass =
    "inline-flex min-w-0 items-center gap-2 rounded-full border border-border/40 bg-elevated/40 py-1 pl-1 pr-2.5 text-xs transition-colors hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50";

  const chipInner = (
    <>
      <span className="relative flex h-6 w-6 shrink-0 overflow-hidden rounded-full bg-linear-to-br from-primary to-accent text-[10px] font-semibold text-primary-foreground">
        {owner?.avatar_url ? (
          <Image
            src={owner.avatar_url}
            alt=""
            fill
            sizes="24px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            {initial}
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium text-foreground">
          {displayName}
        </span>
        {handle ? (
          <span className="truncate font-mono text-[10px] text-subtle">
            {handle}
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <div className="flex items-center justify-between gap-2">
      {owner?.username ? (
        <Link
          href={`/profile/${owner.username}`}
          aria-label={`Visit ${displayName}'s profile`}
          className={chipClass}
        >
          {chipInner}
        </Link>
      ) : (
        <div className={chipClass}>{chipInner}</div>
      )}
      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
        <Heart className="h-3 w-3" aria-hidden />
        {likesCount}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton matched to the section above so layout doesn't shift while the
// query streams in. Defaults to 4 columns since both the home and gallery
// surfaces use the same grid breakpoints.
// ---------------------------------------------------------------------------

export function TrendingCardsSectionSkeleton({ count = 4 }: { count?: number }) {
  return (
    <section aria-busy="true">
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-7 w-56" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <CardPreviewSkeleton />
            <div className="flex items-center justify-between gap-2 text-xs">
              <Skeleton shape="circle" className="h-6 w-6" />
              <Skeleton className="h-3 w-8" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
