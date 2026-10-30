import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The card grids' columns (TODO WD3) — the gallery, its browse and hubs, a
// profile's cards, the feed, My Cards and the one-row strips
// (components/gallery/card-row.tsx). The count follows the width of the box
// the grid sits IN (a container query), not the window's, so the same grid
// gives a wide page five or six columns and a dashboard column or a standard
// page four, with no viewport arithmetic per page:
//
//   grid width   < 36rem   36–56rem   56–84rem   84–100rem   ≥ 100rem
//   columns          2          3          4           5           6
//
// A wide page's extra width goes to MORE columns, never wider tiles: the
// 600 px thumbnail is sharp up to a ~300 px tile on a 2× screen, and a tile
// here is never wider than 321 px (the top of the four-column band). The
// five-column step (owner 2026-10-29) keeps a common laptop near 260–280 px
// instead of dropping from 4 × 321 to 6 × 207: 1366 px window 4 × 311, 1440
// 5 × 259, 1536 5 × 278, 1680 6 × 253, 1920 (and up) 6 × 293. A 24-card page
// ends on a row of four in the five-column band. A phone gets two columns
// (~170 px tiles), not one.
//
// The grid needs a query container round it: <CardGrid> brings its own;
// a hand-placed `CARD_GRID_CLASS` sits inside an `@container` element.
//
// `sizes` (a card picture drawn from a bigger file than the tile's own
// 600 px thumbnail — the PNG fallback): each list below is what a tile
// measures in ONE frame, at every window width, and never less — so a grid
// passes the list of the frame it is in. A tile outside these grids keeps
// BakedCardThumbnail's generous default, WINDOW_GRID_SIZES.
// ---------------------------------------------------------------------------

export const CARD_GRID_CLASS =
  "grid grid-cols-2 gap-4 @xl:grid-cols-3 @xl:gap-5 @4xl:grid-cols-4 @min-[84rem]:grid-cols-5 @min-[100rem]:grid-cols-6";

/** A CARD_GRID_CLASS tile in a WIDE page frame (16 / 24 / 32 px gutters,
 *  1920 px cap): the gallery, its hubs, the strips, a profile. The window
 *  steps are the grid's: 608 (3 columns), 944 (4), 1408 (5), 1664 (6),
 *  1920 (cap). */
export const CARD_GRID_SIZES =
  "(min-width: 1920px) 300px, (min-width: 1664px) calc((100vw - 164px) / 6), (min-width: 1408px) calc((100vw - 144px) / 5), (min-width: 944px) calc((100vw - 108px) / 4), (min-width: 608px) calc((100vw - 72px) / 3), calc((100vw - 48px) / 2)";

/** A CARD_GRID_CLASS tile in the DASHBOARD's column — the wide frame less
 *  its 220 px rail and 32 px gap from 1024 px (DashboardShell): My Cards'
 *  large grid, the feed. Steps 608 / 944 (4) / 1024 (the rail: 3) / 1212
 *  (4) / 1660 (5) / 1916 (6). */
export const DASHBOARD_CARD_GRID_SIZES =
  "(min-width: 1916px) 251px, (min-width: 1660px) calc((100vw - 396px) / 5), (min-width: 1212px) calc((100vw - 376px) / 4), (min-width: 1024px) calc((100vw - 356px) / 3), (min-width: 944px) calc((100vw - 108px) / 4), (min-width: 608px) calc((100vw - 72px) / 3), calc((100vw - 48px) / 2)";

/** My Cards' "Compact grid" (TODO WD4): up to EIGHT columns of ~150–215 px
 *  tiles — 2 / 3 / 4 / 5 / 6 / 7 / 8 at 30 / 40 / 56 / 70 / 84 / 98rem of
 *  its container. Every step past four columns is a one-column step, so a
 *  tile loses at most a fifth at a step (the 4 → 6 and 6 → 8 jumps took
 *  231 px tiles to 150 and 230 to 170): 1280 px window 5 × 183 (main's), 1366
 *  5 × 200, 1440 6 × 177, 1536 6 × 193, 1680 7 × 185, 1920 8 × 190. Its
 *  48-card page ends short in the five- and seven-column bands. */
export const CARD_GRID_COMPACT_CLASS =
  "grid grid-cols-2 gap-3 @min-[30rem]:grid-cols-3 @min-[40rem]:grid-cols-4 @min-[56rem]:grid-cols-5 @min-[70rem]:grid-cols-6 @min-[84rem]:grid-cols-7 @min-[98rem]:grid-cols-8";

/** A CARD_GRID_COMPACT_CLASS tile in the dashboard's column. */
export const DASHBOARD_COMPACT_GRID_SIZES =
  "(min-width: 1920px) 190px, (min-width: 1884px) calc((100vw - 400px) / 8), (min-width: 1660px) calc((100vw - 388px) / 7), (min-width: 1436px) calc((100vw - 376px) / 6), (min-width: 1212px) calc((100vw - 364px) / 5), (min-width: 1024px) calc((100vw - 352px) / 4), (min-width: 944px) calc((100vw - 96px) / 5), (min-width: 688px) calc((100vw - 84px) / 4), (min-width: 512px) calc((100vw - 56px) / 3), calc((100vw - 44px) / 2)";

/** BakedCardThumbnail's default: a tile of a grid that counts its columns by
 *  the WINDOW (1 / 2 / 3 / 4 at sm / lg / xl, the card page's rows, a
 *  challenge's entries, the pinned-cards picker) — generous, never less than
 *  such a tile. */
export const WINDOW_GRID_SIZES =
  "(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";

export function CardGrid({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="@container">
      <div className={cn(CARD_GRID_CLASS, className)} {...rest} />
    </div>
  );
}
