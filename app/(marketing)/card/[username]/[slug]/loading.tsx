import { CardDetailSkeleton } from "@/components/cards/card-detail-skeleton";

// Streams a layout-matched skeleton the moment navigation starts, instead of
// blanking on the ~20-query detail block — on a direct load and on every
// soft navigation from a tile alike.
export default function CardDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl py-4">
      <CardDetailSkeleton />
    </div>
  );
}
