import Link from "next/link";
import Image from "next/image";
import { Flame, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { rowTileClass, ROW_GRID_CLASS } from "@/components/gallery/card-row";
import { CardTile } from "@/components/cards/card-tile";
import { CardPreviewSkeleton } from "@/components/cards/card-preview-skeleton";
import { QuickLikeButton } from "@/components/cards/quick-like-button";
import { InDecksCount } from "@/components/cards/in-decks-count";
import { TrendingShareButton } from "@/components/gallery/trending-share-button";
import { Skeleton } from "@/components/ui/skeleton";
import { buildCardPath, buildCardUrl } from "@/lib/cards/utils";
import { getSiteBaseUrl } from "@/lib/site-url";
import type { CardWithStats } from "@/lib/cards/queries";
import { cardToPreviewData } from "@/lib/cards/preview-data";

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
  /** Whether the current viewer is signed in. Used to decide whether the
   *  quick-like button toggles directly or bounces through /login. */
  isAuthed: boolean;
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
  /** "hero" wraps the row in a glowing surface with rank badges and the
   *  week's stats on every tile — the gallery's headline block. "plain" is
   *  the quiet version the homepage uses. */
  variant?: "hero" | "plain";
  /** Rendered under the row, inside the surface — the landing page's
   *  "live from the forge" pulse + calls to action. */
  footer?: React.ReactNode;
  /** One control under each tile, outside its link (CardTile's rule) — the
   *  /decks row's "Build a deck around this card" (TODO DK8.3). */
  cardAction?: (card: CardWithStats) => React.ReactNode;
  /** The row's frame's `sizes` (components/cards/card-grid.tsx:
   *  CARD_GRID_SIZES on a wide page); else the thumbnail's generous default. */
  sizes?: string;
};

export function TrendingCardsSection({
  cards,
  isAuthed,
  eyebrow = "Trending now",
  heading = "Hot this week",
  description,
  action,
  priority = false,
  variant = "plain",
  footer,
  cardAction,
  sizes,
}: TrendingCardsSectionProps) {
  if (cards.length === 0) return null;

  // Resolved once for the section so per-tile renders don't each pay the
  // env-var lookup; falls back to localhost during local dev.
  const siteBase = getSiteBaseUrl();
  const hero = variant === "hero";

  return (
    <section
      aria-labelledby="trending-heading"
      className={cn(
        hero &&
          "relative overflow-hidden rounded-2xl border border-gold/35 bg-[radial-gradient(120%_80%_at_0%_0%,color-mix(in_oklab,var(--color-gold)_16%,transparent),transparent_60%),radial-gradient(90%_70%_at_100%_100%,color-mix(in_oklab,var(--color-accent)_14%,transparent),transparent_60%)] bg-surface/70 p-5 shadow-[0_30px_80px_-40px_color-mix(in_oklab,var(--color-gold)_45%,transparent)] sm:p-7",
      )}
    >
      <div className="mb-6 flex flex-col items-start justify-between gap-3 md:flex-row md:items-end">
        <div className="flex flex-col gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em]",
              hero ? "text-gold-strong" : "text-primary-bright",
            )}
          >
            <Flame className={cn("h-3.5 w-3.5", hero && "animate-pulse")} aria-hidden />
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
      {/* ONE row, always: the grid's column count follows the row's own
          width (its query container) and tiles past the last column are
          hidden, never wrapped. */}
      <div className="@container">
        <div className={ROW_GRID_CLASS}>
          {cards.map((card, index) => (
            <TrendingTile
              key={card.id}
              card={card}
              rank={hero ? index + 1 : null}
              priority={priority}
              siteBase={siteBase}
              isAuthed={isAuthed}
              className={rowTileClass(index)}
              action={cardAction?.(card)}
              sizes={sizes}
            />
          ))}
        </div>
      </div>
      {footer ? <div className="mt-6 border-t border-border/40 pt-5">{footer}</div> : null}
    </section>
  );
}

function TrendingStats({ stats }: { stats: NonNullable<CardWithStats["trending"]> }) {
  const bits: Array<{ icon: typeof Heart; value: number; label: string }> = [
    { icon: Heart, value: stats.likes7d, label: "likes this week" },
    { icon: MessageCircle, value: stats.comments7d, label: "comments this week" },
    { icon: Repeat2, value: stats.remixes7d, label: "remixes this week" },
  ].filter((b) => b.value > 0);
  if (bits.length === 0) {
    return <span className="text-[11px] text-subtle">New this week</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
      {bits.map((b) => (
        <span key={b.label} className="inline-flex items-center gap-1" title={`${b.value} ${b.label}`}>
          <b.icon className="h-3 w-3 text-gold" aria-hidden />
          <span className="tabular-nums">{b.value}</span>
          <span className="sr-only">{b.label}</span>
        </span>
      ))}
      <span className="text-subtle">this week</span>
    </span>
  );
}

function TrendingTile({
  card,
  rank,
  priority,
  siteBase,
  isAuthed,
  className,
  action,
  sizes,
}: {
  card: CardWithStats;
  rank: number | null;
  priority: boolean;
  siteBase: string;
  isAuthed: boolean;
  className?: string;
  action?: React.ReactNode;
  sizes?: string;
}) {
  const cardUrl = buildCardUrl(card, siteBase);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="group relative">
        {rank !== null ? (
          <span
            className="pointer-events-none absolute left-2 top-2 z-10 inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-gold/50 bg-background/85 px-2 font-display text-xs font-semibold text-gold-strong shadow backdrop-blur"
            aria-label={`Trending rank ${rank}`}
          >
            #{rank}
          </span>
        ) : null}
        <CardTile
          viewTransitionName={`trending-card-${card.id}`}
          body={(slot) => (
            <Link href={buildCardPath(card)} aria-label={`Open ${card.title}`} {...slot} />
          )}
          thumbnail={{
            renderedImageUrl: card.rendered_image_url,
            renderedThumbUrl: card.rendered_thumb_url,
            renderedBackThumbUrl: card.rendered_back_thumb_url,
            title: card.title,
            priority,
            previewData: cardToPreviewData(card, null),
            sizes,
          }}
        />
        <div className="absolute right-2 top-2 z-10">
          <TrendingShareButton
            cardId={card.id}
            cardTitle={card.title}
            cardUrl={cardUrl}
            siteBase={siteBase}
          />
        </div>
      </div>

      {rank !== null && card.trending ? <TrendingStats stats={card.trending} /> : null}
      <ProfileChip
        owner={card.owner}
        likeNode={
          <span className="flex shrink-0 items-center gap-2.5">
            {/* "In N decks" (TODO DK8.4) — as on every gallery tile: text,
                outside the tile's link. */}
            <InDecksCount count={card.public_deck_count} />
            <QuickLikeButton
              kind="card"
              cardId={card.id}
              cardSlug={card.slug}
              ownerUsername={card.owner?.username ?? null}
              initialLiked={card.liked_by_viewer}
              initialCount={card.likes_count}
              requiresSignIn={!isAuthed}
              redirectAfterLogin={buildCardPath(card)}
            />
          </span>
        }
      />
      {action}
    </div>
  );
}

function ProfileChip({
  owner,
  likeNode,
}: {
  owner: CardWithStats["owner"];
  likeNode: React.ReactNode;
}) {
  const displayName =
    owner?.display_name?.trim() || owner?.username || "Anonymous forger";
  const initial = (displayName[0] ?? "?").toUpperCase();
  const handle = owner?.username ? `@${owner.username}` : null;
  const chipClass =
    "inline-flex min-w-0 items-center gap-2 rounded-full border border-border/40 bg-elevated/40 py-1 pl-1 pr-2.5 text-xs transition-colors hover:border-border-strong hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50";

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
          <span className="truncate font-mono text-[10px] text-muted">
            {handle}
          </span>
        ) : null}
      </span>
    </>
  );

  // Wraps only in a phone's two-column row (a ~150 px tile, the row's query
  // container under 36rem): the counts drop under the chip instead of
  // squeezing the creator's name away. Wider tiles keep one line, the name
  // truncated as it always was.
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 @xl:flex-nowrap">
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
      {likeNode}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton matched to the section above so layout doesn't shift while the
// query streams in. Pass the row's ROW_MAX; the row's own columns hide the
// rest.
// ---------------------------------------------------------------------------

export function TrendingCardsSectionSkeleton({ count = 4 }: { count?: number }) {
  return (
    <section aria-busy="true">
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-7 w-56" />
      </div>
      <div className="@container">
        <div className={ROW_GRID_CLASS}>
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className={cn("flex flex-col gap-2", rowTileClass(i))}>
              <CardPreviewSkeleton />
              <div className="flex items-center justify-between gap-2 text-xs">
                <Skeleton shape="circle" className="h-6 w-6" />
                <Skeleton className="h-3 w-8" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
