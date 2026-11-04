import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The grid (TODO CP2b). Rows: head, actions, text, then the rail and a 1fr
// filler the hero's height goes into (a spanning item's extra height is
// given to the flexible track, never to the auto rows beside it). The page
// (card-detail-content.tsx) and its loading skeleton draw the same areas.
// ---------------------------------------------------------------------------

export const CARD_PAGE_GRID = cn(
  "grid grid-cols-1 items-start gap-x-8 gap-y-6",
  "md:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)] md:grid-rows-[auto_auto_auto_1fr_auto]",
  "lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:grid-rows-[auto_auto_auto_auto_1fr] lg:gap-x-10",
  "xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)_minmax(0,20rem)] xl:grid-rows-[auto_auto_auto_1fr]",
  "2xl:grid-cols-[minmax(0,30rem)_minmax(0,44rem)_minmax(0,21rem)] 2xl:justify-between 2xl:gap-x-12",
);

export const AREA = {
  // Phone: the title first, then the card.
  head: "order-1 md:order-none md:col-start-2 md:row-start-1",
  hero: cn(
    "order-2 md:order-none md:col-start-1 md:row-span-4 md:row-start-1",
    "lg:sticky lg:top-24 lg:row-span-5 xl:row-span-4",
  ),
  // Phone: last, and pinned to the bottom of the screen while the card's
  // section scrolls by (sticky — it settles under the rail at the end).
  actions: cn(
    "order-5 md:order-none md:col-start-2 md:row-start-2",
    "max-md:sticky max-md:bottom-0 max-md:z-20 max-md:-mx-4 sm:max-md:-mx-6 max-md:border-t max-md:border-border/60",
    "max-md:bg-background/95 max-md:px-4 sm:max-md:px-6 max-md:pt-2 max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))] max-md:backdrop-blur",
  ),
  text: "order-3 md:order-none md:col-start-2 md:row-start-3",
  rail: cn(
    "order-4 md:order-none md:col-span-2 md:col-start-1 md:row-start-5 md:grid md:grid-cols-2 md:items-start",
    "lg:col-span-1 lg:col-start-2 lg:row-start-4",
    "xl:col-start-3 xl:row-span-4 xl:row-start-1 xl:flex xl:sticky xl:top-24",
  ),
} as const;

