// ---------------------------------------------------------------------------
// CardDetailSkeleton — the card page's loading.tsx fallback. Mirrors
// CardDetailContent's layout (the breadcrumb, the card — beside the info
// column from lg — the title, the two action rows, the stats strip, the
// details and the creator) so the swap to real content doesn't jump. Draws
// inside the page's own PageContainer. Uses the shared `.skeleton` shimmer
// from globals.css.
// ---------------------------------------------------------------------------

export function CardDetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading card">
      <div className="mb-4 h-5 sm:mb-6">
        <div className="skeleton h-4 w-28 rounded-md" />
      </div>
      <div className="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-12">
        <div className="mx-auto w-full max-w-sm lg:max-w-none">
          <div className="skeleton aspect-[5/7] w-full card-corners" />
        </div>

        <div className="flex max-w-2xl flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="skeleton h-9 w-2/3 max-w-xs rounded-md" />
            <div className="skeleton h-4 w-44 rounded-md" />
          </div>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <div className="skeleton h-9 rounded-md sm:w-28" />
              <div className="skeleton h-9 rounded-md sm:w-24" />
              <div className="skeleton col-span-2 h-9 rounded-md sm:w-32" />
            </div>
            <div className="flex gap-2">
              <div className="skeleton h-9 w-16 rounded-md" />
              <div className="skeleton h-9 w-20 rounded-md" />
            </div>
          </div>
          <div className="skeleton h-16 w-full rounded-card" />
          <div className="skeleton h-48 w-full rounded-card" />
          <div className="skeleton h-32 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
