import Link from "next/link";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import { QuickLikeButton } from "@/components/cards/quick-like-button";
import { CardHoverEffect } from "@/components/cards/card-hover-effect";
import { buildCardPath } from "@/lib/cards/utils";
import type { CardWithStats } from "@/lib/cards/queries";
import type { ArtPosition, FrameStyle } from "@/types/card";

// Public card thumbnail + owner/like footer. Shared by the gallery grid and the
// following feed so they stay visually identical.
export function GalleryCardTile({
  card,
  isAuthed,
}: {
  card: CardWithStats;
  isAuthed: boolean;
}) {
  const ownerLabel =
    card.owner?.username ?? card.owner?.display_name ?? "Anonymous forger";

  return (
    <div className="flex flex-col gap-2">
      <Link
        href={buildCardPath(card)}
        className="block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Open ${card.title}`}
        style={{ viewTransitionName: `card-${card.id}` }}
      >
        <CardHoverEffect>
          <BakedCardThumbnail
            renderedImageUrl={card.rendered_image_url}
            title={card.title}
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
          requiresSignIn={!isAuthed}
          redirectAfterLogin={buildCardPath(card)}
        />
      </div>
    </div>
  );
}
