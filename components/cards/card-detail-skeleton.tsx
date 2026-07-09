// ---------------------------------------------------------------------------
// CardDetailSkeleton — Suspense fallback while the intercepted card route
// fetches. Mirrors CardDetailContent's modal-variant layout (hero card left,
// info column right, full-width analytics panel below) so the swap to real
// content doesn't jump. Uses the shared `.skeleton` shimmer from globals.css.
// ---------------------------------------------------------------------------

export function CardDetailSkeleton() {
  return (
    <div
      className="w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      aria-busy="true"
      aria-label="Loading card"
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,360px)_1fr]">
        <div className="mx-auto w-full max-w-sm">
          <div className="skeleton aspect-[5/7] w-full rounded-frame" />
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="skeleton h-5 w-44 rounded-full" />
            <div className="skeleton h-9 w-2/3 max-w-xs rounded-md" />
            <div className="skeleton h-4 w-52 rounded-md" />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="skeleton h-9 w-24 rounded-md" />
            <div className="skeleton h-9 w-24 rounded-md" />
            <div className="skeleton h-9 w-28 rounded-md" />
            <div className="skeleton h-9 w-9 rounded-md" />
          </div>
          <div className="skeleton h-40 w-full rounded-card" />
          <div className="skeleton h-48 w-full rounded-card" />
        </div>
      </div>

      <div className="mt-10 flex flex-col gap-10">
        <div className="skeleton h-56 w-full rounded-card" />
      </div>
    </div>
  );
}
