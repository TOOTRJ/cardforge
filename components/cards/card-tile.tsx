import type { CSSProperties, ReactElement, ReactNode } from "react";
import {
  BakedCardThumbnail,
  type BakedCardThumbnailProps,
} from "@/components/cards/baked-card-thumbnail";
import { CardHoverEffect } from "@/components/cards/card-hover-effect";
import { tileBackThumbOf } from "@/lib/cards/tile-faces";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CardTile — a card's picture with the thing a click on it does (its BODY: a
// link to the card's page, or My Cards' role="button" that opens or selects
// it), inside the gallery tilt. The ONE place that decides how the two nest
// (TODO 5.17), for every gallery-style surface: the gallery / browse / hub /
// feed / related tile, the trending row, a profile's grid, My Cards' own and
// liked tiles.
//
// A ONE-FACED tile is what it always was — the body wraps the picture:
//
//   <a | div role="button">            ← body (focus ring, view transition)
//     <CardHoverEffect> <BakedCardThumbnail/> </CardHoverEffect>
//
// A TWO-FACED tile (lib/cards/tile-faces.ts: a back picture to turn to) has a
// "2 faces" BUTTON on its picture, and a button may not sit inside a link or
// inside another button (invalid HTML; axe "nested-interactive", serious;
// assistive tech reads one control or the other). There the body is an EMPTY
// element UNDER the picture, and the button comes after it in the document:
//
//   <div>                              ← shell (view transition)
//     <CardHoverEffect>                ← .card-hover-effect: the tile's box
//       <a | div role="button" />      ← body: absolute inset-0, empty
//       rotor (the tilt)               ← takes NO pointer events…
//         <BakedCardThumbnail>
//           faces
//           <button>2 faces</button>   ← …but for the button
//
// The body fills the very box the wrapping link used to be (so its focus
// ring, and every point a click opened the card from — the picture, its 1 px
// border, the sliver the tilt uncovers — are the same). The picture above it
// lets the pointer through (`pointer-events: none`, inherited from the
// rotor), so a click anywhere on the card lands on the body — a real link:
// Cmd / middle click open a new tab — and only the button, still drawn
// inside the tilt where it always was, takes its own. Nothing is lifted or
// re-layered (see `.tile-flip-stage` in app/globals.css for why not), and
// the button is the one thing inside the tilt a pointer can hit. The
// keyboard goes body → "2 faces" → whatever follows the tile.
//
// Never put a BakedCardThumbnail with a back thumb inside a link or a button
// by hand: without `backFaceButton` (set here alone) it draws no button.
// ---------------------------------------------------------------------------

/** What the wrapper's `body` must spread on its element. */
export type CardTileBodySlot = {
  className: string;
  style?: CSSProperties;
  /** The picture, on a one-faced tile; nothing on a two-faced one. */
  children?: ReactNode;
  /** Marks the body of a two-faced tile (an empty element under the picture). */
  "data-tile-body"?: "under";
};

const BODY_CLASS =
  "card-corners focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function CardTile({
  thumbnail,
  body,
  className,
  viewTransitionName,
}: {
  thumbnail: BakedCardThumbnailProps;
  /** Draws the body element — a `Link`, or the dashboard's role="button" —
   *  from the slot it is handed. Called once. */
  body: (slot: CardTileBodySlot) => ReactElement;
  /** Extra classes of the body (the dashboard's `group cursor-pointer`). */
  className?: string;
  viewTransitionName?: string;
}) {
  const style = viewTransitionName ? { viewTransitionName } : undefined;
  const twoFaced = Boolean(
    tileBackThumbOf({
      rendered_image_url: thumbnail.renderedImageUrl,
      rendered_thumb_url: thumbnail.renderedThumbUrl,
      rendered_back_thumb_url: thumbnail.renderedBackThumbUrl,
      frame_style: thumbnail.previewData.frameStyle,
    }),
  );

  if (!twoFaced) {
    return body({
      className: cn("block", BODY_CLASS, className),
      style,
      children: (
        <CardHoverEffect>
          <BakedCardThumbnail {...thumbnail} />
        </CardHoverEffect>
      ),
    });
  }

  return (
    <div className="block card-corners" style={style} data-testid="card-tile-shell">
      <CardHoverEffect
        under={body({
          className: cn("absolute inset-0", BODY_CLASS, className),
          "data-tile-body": "under",
        })}
      >
        <BakedCardThumbnail
          {...thumbnail}
          backFaceButton
          className={cn(thumbnail.className, "pointer-events-none")}
        />
      </CardHoverEffect>
    </div>
  );
}
