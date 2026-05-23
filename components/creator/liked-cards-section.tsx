import Link from "next/link";
import { Heart } from "lucide-react";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import { CardHoverEffect } from "@/components/cards/card-hover-effect";
import { QuickLikeButton } from "@/components/cards/quick-like-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { buildCardPath } from "@/lib/cards/utils";
import type { CardWithStats } from "@/lib/cards/queries";
import type { ArtPosition, FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// LikedCardsSection — dashboard view of the cards the current user has
// liked. Renders read-only tiles (the user doesn't own these cards) with a
// QuickLikeButton so they can unlike from here. Distinct from the bulk-
// selectable "my cards" sections above because the actions differ.
// ---------------------------------------------------------------------------

type LikedCardsSectionProps = {
  likedCards: CardWithStats[];
};

export function LikedCardsSection({ likedCards }: LikedCardsSectionProps) {
  return (
    <section className="mt-12">
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Liked cards
          </h2>
          <p className="max-w-2xl text-sm text-muted">
            Cards from other forgers you&apos;ve hearted. Click any heart to
            unlike.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/gallery">Browse gallery</Link>
        </Button>
      </header>

      {likedCards.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="No liked cards yet"
          description="Tap the heart on any card in the gallery or trending section to save it here."
          action={
            <Button asChild>
              <Link href="/gallery">Browse the gallery</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {likedCards.map((card) => (
            <LikedCardTile key={card.id} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}

function LikedCardTile({ card }: { card: CardWithStats }) {
  const ownerLabel =
    card.owner?.username ?? card.owner?.display_name ?? "Anonymous forger";

  return (
    <div className="flex flex-col gap-2">
      <Link
        href={buildCardPath(card)}
        className="block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Open ${card.title}`}
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
