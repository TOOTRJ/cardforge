import { CardDetailSkeleton } from "@/components/cards/card-detail-skeleton";

// Streams a layout-matched skeleton the moment navigation starts, instead of
// blanking on the ~20-query detail block. The intercepted modal route has its
// own Suspense fallback; this covers direct/full-page loads.
export default function CardDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl py-4">
      <CardDetailSkeleton />
    </div>
  );
}
