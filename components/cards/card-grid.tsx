import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The card grids' columns (TODO WD3) — the gallery, its browse and hubs, a
// profile's cards, the feed and the one-row strips (components/gallery/
// card-row.tsx). The count follows the width of the box the grid sits IN (a
// container query), not the window's, so the same grid gives a wide page
// six columns and a dashboard column or a standard page four, with no
// viewport arithmetic per page:
//
//   grid width   < 36rem   36–56rem   56–84rem   ≥ 84rem
//   columns          2          3          4          6
//
// Every count divides a 24-card page (5 does not), so no page ends on a
// ragged row. A wide page's extra width goes to MORE columns, never wider
// tiles: the 600 px thumbnail is sharp up to a 300 px tile on a 2× screen,
// and a tile here stays under ~290 px but for the top of the four-column
// band (321 px just under the six-column step; 293 px on a full 1920 px
// page). A phone gets two columns (~170 px tiles), not one.
//
// The grid needs a query container round it: <CardGrid> brings its own;
// a hand-placed `CARD_GRID_CLASS` sits inside an `@container` element.
// ---------------------------------------------------------------------------

export const CARD_GRID_CLASS =
  "grid grid-cols-2 gap-4 @xl:grid-cols-3 @xl:gap-5 @4xl:grid-cols-4 @min-[84rem]:grid-cols-6";

/** What a tile of CARD_GRID_CLASS measures in a WIDE page frame (16 / 24 /
 *  32 px gutters, 1920 px cap) — the `sizes` of a card picture that is drawn
 *  from a bigger file than the tile's own thumbnail. The breakpoints are the
 *  grid's steps in window px: 608 (3 columns), 944 (4), 1408 (6), 1920 (cap).
 *  Inside a narrower box (a dashboard column, a standard page) it asks for
 *  a little more than the tile needs — never less. */
export const CARD_GRID_SIZES =
  "(min-width: 1920px) 300px, (min-width: 1408px) calc((100vw - 164px) / 6), (min-width: 944px) calc((100vw - 108px) / 4), (min-width: 608px) calc((100vw - 72px) / 3), calc((100vw - 48px) / 2)";

export function CardGrid({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="@container">
      <div className={cn(CARD_GRID_CLASS, className)} {...rest} />
    </div>
  );
}
