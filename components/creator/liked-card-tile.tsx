import Link from "next/link";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import { CardHoverEffect } from "@/components/cards/card-hover-effect";
import { QuickLikeButton } from "@/components/cards/quick-like-button";
import { buildCardPath } from "@/lib/cards/utils";
import type { CardWithStats } from "@/lib/cards/queries";
import type { ArtPosition, FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// LikedCardTile — one card the current user has liked, on the My Cards
// "Liked" tab. Read-only (the user doesn't own it) with a QuickLikeButton so
// they can unlike from here. Distinct from DashboardCardTile because the
// actions differ: no edit, no bulk selection.
// ---------------------------------------------------------------------------

export function LikedCardTile({
  card,
  profileOverrides = null,
}: {
  card: CardWithStats;
  profileOverrides?: FrameProfileOverridesMap | null;
}) {
  const ownerLabel =
    card.owner?.username ?? card.owner?.display_name ?? "Anonymous forger";

  return (
    <div className="flex flex-col gap-2">
      <Link
        href={buildCardPath(card)}
        className="block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Open ${card.title}`}
      >
        <CardHoverEffect>
          <BakedCardThumbnail
            renderedImageUrl={card.rendered_image_url}
            renderedThumbUrl={card.rendered_thumb_url}
            title={card.title}
            previewData={{
              profileOverrides,
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
              setIconUrl: card.set_icon_url,
              setIconCode: card.set_icon_code,
            }}
          />
        </CardHoverEffect>
      </Link>
      <div className="flex items-center justify-between gap-2 text-xs">
        {card.owner?.username ? (
          <Link
            href={`/profile/${card.owner.username}`}
            className="truncate font-mono text-muted transition-colors hover:text-foreground"
          >
            @{card.owner.username}
          </Link>
        ) : (
          <span className="truncate text-muted">{ownerLabel}</span>
        )}
        <QuickLikeButton
          kind="card"
          cardId={card.id}
          cardSlug={card.slug}
          ownerUsername={card.owner?.username ?? null}
          initialLiked={card.liked_by_viewer}
          initialCount={card.likes_count}
          redirectAfterLogin={buildCardPath(card)}
        />
      </div>
    </div>
  );
}
