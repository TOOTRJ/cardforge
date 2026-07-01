import Link from "next/link";
import { Repeat2, Sparkles } from "lucide-react";
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

  // Remix indicator: a corner badge linking to the original this was made from
  // — another PipGlyph card (parent_card_id) or a real card on Scryfall. Opens
  // in a new tab. Rendered as an absolute sibling (not nested in the tile Link)
  // to keep the HTML valid. The /go redirect resolves the id → canonical URL.
  const RemixIcon = card.parent_card_id ? Repeat2 : Sparkles;
  const remixHref = card.parent_card_id
    ? `/go/card/${card.parent_card_id}`
    : card.source_scryfall_id
      ? `/go/scryfall/${card.source_scryfall_id}`
      : null;
  const remixLabel = card.parent_card_id
    ? "Remixed from another card — view the original"
    : "Based on a real card — view on Scryfall";

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Link
          href={buildCardPath(card)}
          className="block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={`Open ${card.title}`}
          style={{ viewTransitionName: `card-${card.id}` }}
        >
          <CardHoverEffect>
            <BakedCardThumbnail
              renderedImageUrl={card.rendered_image_url}
              title={card.title}
              alt={`${card.title} — custom MTG-style ${card.card_type ?? "card"}${card.rarity ? `, ${card.rarity} rarity` : ""}`}
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
        {remixHref ? (
          <a
            href={remixHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={remixLabel}
            title={remixLabel}
            className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background/85 text-muted shadow-sm backdrop-blur-sm transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
          >
            <RemixIcon className="h-3.5 w-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
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
