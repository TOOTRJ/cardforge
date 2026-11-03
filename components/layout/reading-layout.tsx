import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ReadingLayout — a reading page inside the WIDE frame (TODO WD10 / WD6):
// the text keeps its measure in the first column and the extra width goes to
// a RAIL beside it (a call to action, related pages, "On this page"), never
// to longer lines. Below 2xl it is left-aligned with the frame, so the page's
// first word sits under the logo as on every other page; from 2xl (1536 px)
// the WHOLE group — nav, main and rail as one unit — is centred in the frame
// (owner 2026-11-02: at 1920 px a left-aligned page left ~40 % of the screen
// empty on the right). The measure never changes; only the free space moves.
//
//   main      "measure"  38rem — running text at READING_TEXT_CLASS (legal,
//                         about, FAQ answers);
//             "column"   48rem — a page of headed blocks (help answers, a
//                         landing page's sections and cards).
//   rail      16rem from lg (1024 px), 18rem from 2xl, sticky under the
//             header; on a phone it follows the content, or is hidden when
//             the page shows its own copy of it there (`railOnPhone`).
//
//   nav       (optional) a section list to the LEFT from 2xl (1536 px), where
//             the frame has the room for three columns — the page keeps its
//             own copy of it lower down for narrower windows.
//
// A page that wants no rail renders its column inside a plain PageContainer.
// ---------------------------------------------------------------------------

/** Running text at the reading measure: 16 px on a phone, 18 px from `sm`
 *  (TODO WD6). Put it on the block that holds the paragraphs, inside
 *  <Measure> or a "measure" ReadingLayout. */
export const READING_TEXT_CLASS = "text-base leading-7 sm:text-lg sm:leading-8";

// `2xl:justify-center`: the tracks are capped (38 / 48rem, 14 / 18rem), so
// the space left over in the frame is shared either side of the group — the
// columns keep their widths, the grid is centred as one unit.
const GRID = {
  measure:
    "lg:grid lg:grid-cols-[minmax(0,38rem)_16rem] lg:gap-x-14 xl:gap-x-20 2xl:grid-cols-[minmax(0,38rem)_18rem] 2xl:gap-x-24 2xl:justify-center",
  column:
    "lg:grid lg:grid-cols-[minmax(0,48rem)_16rem] lg:gap-x-12 xl:gap-x-16 2xl:grid-cols-[minmax(0,48rem)_18rem] 2xl:gap-x-20 2xl:justify-center",
} as const;

/** Three columns from 2xl: nav | main | rail (the DOM order stays main, rail,
 *  nav — the text comes first to a keyboard and a screen reader). */
const GRID_WITH_NAV = {
  measure: "2xl:grid-cols-[14rem_minmax(0,38rem)_18rem] 2xl:gap-x-16",
  column: "2xl:grid-cols-[14rem_minmax(0,48rem)_18rem] 2xl:gap-x-16",
} as const;

export type ReadingLayoutProps = {
  children: ReactNode;
  rail?: ReactNode;
  /** The rail's landmark name ("Related pages", "On this page"…). */
  railLabel?: string;
  main?: keyof typeof GRID;
  /** "after": the rail follows the content on a phone; "hidden": the page
   *  shows its own copy of it there (an inline table of contents). */
  railOnPhone?: "after" | "hidden";
  /** A section list to the left from 2xl (see above) — a <nav> of its own
   *  (RailLinks), so its wrapper is no landmark. */
  nav?: ReactNode;
  className?: string;
};

export function ReadingLayout({
  children,
  rail,
  railLabel,
  main = "column",
  railOnPhone = "after",
  nav,
  className,
}: ReadingLayoutProps) {
  const withNav = Boolean(rail && nav);
  return (
    <div className={cn(rail ? GRID[main] : null, withNav && GRID_WITH_NAV[main], className)}>
      <div className={cn("min-w-0", withNav && "2xl:col-start-2 2xl:row-start-1")}>{children}</div>
      {rail ? (
        <aside
          aria-label={railLabel}
          className={cn(
            "min-w-0",
            railOnPhone === "hidden" ? "hidden lg:block" : "mt-14 lg:mt-0",
            withNav && "2xl:col-start-3 2xl:row-start-1",
          )}
        >
          <div className="flex flex-col gap-6 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:-mx-1 lg:overflow-y-auto lg:px-1 lg:pb-6">
            {rail}
          </div>
        </aside>
      ) : null}
      {withNav ? (
        <div className="hidden min-w-0 2xl:col-start-1 2xl:row-start-1 2xl:block">
          <div className="sticky top-24 -mx-1 max-h-[calc(100vh-7rem)] overflow-y-auto px-1 pb-6">{nav}</div>
        </div>
      ) : null}
    </div>
  );
}
