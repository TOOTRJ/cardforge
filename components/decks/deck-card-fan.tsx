import type { CSSProperties } from "react";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import { cardCornersClass } from "@/lib/cards/card-orientation";
import type { FeaturableCard, FeaturedCard } from "@/lib/decks/featured";
import type { PreviewCardColumns } from "@/lib/cards/preview-data";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// DeckCardFan — the deck hero's 1–5 featured cards (lib/decks/featured.ts),
// fanned from one point under the middle card: the first card (a commander,
// else the seeded pick) stands in the middle and in front, the rest
// alternate right / left, each turned and dropped a little more.
//
// A picture, not a control: the cards are listed with links just below, so
// the fan has no link or button of its own (and so no CardTile: nothing
// here is clicked, and no tile with a back face is drawn — the front alone).
// A PipGlyph card is its 600 px bake thumb through BakedCardThumbnail (never
// the HD PNG); a real printing is Scryfall's image on its own 5:7 tile with
// the one card corner.
//
// Sizes are CSS variables per breakpoint, so five cards fit a 390 px phone
// (84 px cards, 46 px apart: 268 px wide before the turn) and the fan never
// pushes the page sideways (the hero clips anything turned past its edge).
// ---------------------------------------------------------------------------

const FAN_SIZES =
  "[--fan-card:84px] [--fan-step:46px] [--fan-drop:7px] sm:[--fan-card:112px] sm:[--fan-step:60px] md:[--fan-card:104px] md:[--fan-step:46px] lg:[--fan-card:136px] lg:[--fan-step:64px] lg:[--fan-drop:9px] xl:[--fan-card:156px] xl:[--fan-step:80px]";

/** A deck TILE's fan (components/decks/deck-tile.tsx, TODO DK8.1): sized by
 *  the tile's own width — the tile's picture is the query container — so a
 *  tile in a one-column phone grid and one in a four-column row hold the
 *  same composition (21 % of the tile per card, 58 % of a card apart). */
const TILE_FAN_SIZES =
  "[--fan-card:clamp(52px,21cqw,104px)] [--fan-step:calc(var(--fan-card)*0.58)] [--fan-drop:5px]";

/** The top card's z-index (the fan is its own stacking context's content). */
const FAN_MAX_LAYER = 10;

/** Slot offsets for n cards, centre first, then right / left outward. */
function slotsFor(n: number): number[] {
  const offsets = Array.from({ length: n }, (_, k) => k - (n - 1) / 2);
  return offsets.sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
}

export function DeckCardFan({
  cards,
  className,
  size = "hero",
}: {
  cards: readonly FeaturedCard<FeaturableCard & PreviewCardColumns>[];
  className?: string;
  /** "tile" = a deck tile's small fan, sized by its container (an
   *  `@container` ancestor) and never eager. */
  size?: "hero" | "tile";
}) {
  if (cards.length === 0) return null;
  const slots = slotsFor(cards.length);
  const tile = size === "tile";
  return (
    <ul
      aria-label="Featured cards"
      className={cn(
        tile ? TILE_FAN_SIZES : FAN_SIZES,
        "relative mx-auto h-[calc(var(--fan-card)*1.4_+_var(--fan-drop)*4_+_12px)] w-full max-w-full",
        className,
      )}
    >
      {cards.map((featured, index) => {
        const offset = slots[index];
        const reach = Math.abs(offset);
        const style: CSSProperties = {
          // Slots go centre-out in card order, so the order IS the stack:
          // the first card on top, even where two inner slots tie on reach.
          zIndex: FAN_MAX_LAYER - index,
          transform: `translateX(calc(-50% + ${offset} * var(--fan-step))) translateY(calc(${(reach * reach).toFixed(2)} * var(--fan-drop))) rotate(${(offset * 7).toFixed(1)}deg)`,
          transformOrigin: "50% 120%",
        };
        return (
          <li
            key={featured.key}
            className="absolute left-1/2 top-0 w-(--fan-card) drop-shadow-[0_14px_22px_rgba(0,0,0,0.55)]"
            style={style}
          >
            {featured.kind === "custom" ? (
              <BakedCardThumbnail
                renderedImageUrl={featured.card.rendered_image_url}
                renderedThumbUrl={featured.card.rendered_thumb_url}
                title={featured.title}
                previewData={cardToPreviewData(featured.card)}
                sizes={tile ? "104px" : "150px"}
                priority={!tile && index === 0}
                // The hero is dark in both themes: the card's own dark rim
                // and backdrop, never the theme's pale border / page colour
                // (the backdrop shows only at a rounded bake's corners).
                className="border-black/40 bg-[#101015]"
              />
            ) : (
              <div
                className={cn(
                  "relative aspect-[5/7] w-full overflow-hidden border border-black/40 bg-[#101015]",
                  cardCornersClass(false),
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Scryfall's own image host (deck-card-list draws it the same way) */}
                <img
                  src={featured.imageUrl}
                  alt={featured.title}
                  loading={!tile && index === 0 ? "eager" : "lazy"}
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
