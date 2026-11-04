import { AREA, CARD_PAGE_GRID } from "@/components/cards/card-page-grid";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CardDetailSkeleton — the card page's loading.tsx fallback. Draws the page's
// own grid (components/cards/card-page-grid.ts, TODO CP2b) area for area —
// the title, the card, the action row, the card text and the side rail — so
// the swap to real content doesn't jump at any width. Draws inside the
// page's own PageContainer. Uses the shared `.skeleton` shimmer from
// globals.css.
// ---------------------------------------------------------------------------

export function CardDetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading card">
      <div className="mb-4 h-5 sm:mb-6">
        <div className="skeleton h-4 w-28 rounded-md" />
      </div>
      <div className={CARD_PAGE_GRID}>
        <div className={cn("flex min-w-0 flex-col gap-2", AREA.head)}>
          <div className="skeleton h-3 w-32 rounded-md" />
          <div className="skeleton h-9 w-2/3 max-w-xs rounded-md" />
          <div className="skeleton h-4 w-44 rounded-md" />
        </div>
        <div className={cn("min-w-0", AREA.hero)}>
          <div className="mx-auto w-full max-w-sm md:max-w-none">
            <div className="skeleton aspect-[5/7] w-full card-corners" />
          </div>
        </div>
        <div className={cn("min-w-0", AREA.actions)}>
          <div className="flex gap-2">
            <div className="skeleton h-9 w-28 rounded-md" />
            <div className="skeleton h-9 w-24 rounded-md" />
            <div className="skeleton h-9 w-16 rounded-md" />
            <div className="skeleton h-9 w-20 rounded-md" />
          </div>
        </div>
        <div className={cn("flex min-w-0 flex-col gap-5", AREA.text)}>
          <div className="skeleton h-56 w-full rounded-card" />
          <div className="skeleton h-24 w-full rounded-card" />
        </div>
        <div className={cn("flex min-w-0 flex-col gap-4", AREA.rail)}>
          <div className="skeleton h-32 w-full rounded-card" />
          <div className="skeleton h-16 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
