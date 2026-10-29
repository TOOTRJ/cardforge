import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// PageContainer — the ONE page frame (TODO WD1). Every page root draws its
// frame through it, never by hand (`mx-auto w-full max-w-7xl px-4 …`;
// tests/unit/components/page-container-structure.test.ts scans for one). A
// size per what the page DOES:
//
//   standard  1280 px — reading-first and marketing pages: home, pricing,
//             challenges, news, about, help, legal, the SEO landings, sign-in
//             and onboarding, the creator (owner decision D8: it keeps its
//             width until TODO 6.29).
//   wide      1920 px — the browse grids (the gallery, its browse and hubs,
//             community decks and their format hubs, profiles), the deck
//             page and the whole dashboard; and the site header and footer
//             ALWAYS (owner decision D7: the logo never moves between a
//             standard and a wide page).
//   full      no limit — a workspace that wants the whole window.
//
// Every size has the same side padding (16 / 24 / 32 px), so in a window up
// to 1280 px wide the three draw the same frame. The extra width of a wide page goes to MORE
// columns, never wider tiles (components/cards/card-grid.tsx), and running
// text never goes wide: a paragraph keeps its own measure (`max-w-2xl`, or
// <Measure> below for long reading).
// ---------------------------------------------------------------------------

/** Each size's cap — for a bar that lines its content up with a page's
 *  frame without being one (My Cards' fixed bulk bar). */
export const PAGE_CONTAINER_MAX_WIDTH = {
  standard: "max-w-7xl",
  wide: "max-w-[1920px]",
  full: "max-w-none",
} as const;

export type PageContainerSize = keyof typeof PAGE_CONTAINER_MAX_WIDTH;

const FRAME = "mx-auto w-full px-4 sm:px-6 lg:px-8";

/** The frame's classes, for a caller that can't render the component. */
export function pageContainerClass(size: PageContainerSize = "standard"): string {
  return `${FRAME} ${PAGE_CONTAINER_MAX_WIDTH[size]}`;
}

type FrameElement = "div" | "section" | "main" | "header" | "nav";

export type PageContainerProps = HTMLAttributes<HTMLElement> & {
  size?: PageContainerSize;
  /** The frame's element — a page root is a `div`; the homepage's bands are
   *  `section`s, the auth chrome's a `header` and a `main`. */
  as?: FrameElement;
};

export function PageContainer({ size = "standard", as: Tag = "div", className, ...rest }: PageContainerProps) {
  return <Tag className={cn(pageContainerClass(size), className)} {...rest} />;
}

/** The reading measure (TODO WD6): about 38rem — 65–75 characters a line at
 *  18 px — for article bodies, FAQ answers, legal text and landing copy. A
 *  block INSIDE a page's frame, never a frame of its own; on a wide page it
 *  keeps the text at a readable width while the grids around it grow. */
export const MEASURE_CLASS = "max-w-[38rem]";

type MeasureElement = "div" | "section" | "article" | "header" | "p";

export type MeasureProps = HTMLAttributes<HTMLElement> & {
  as?: MeasureElement;
};

export function Measure({ as: Tag = "div", className, ...rest }: MeasureProps) {
  return <Tag className={cn(MEASURE_CLASS, className)} {...rest} />;
}
