import { CardDetailSkeleton } from "@/components/cards/card-detail-skeleton";
import { PageContainer } from "@/components/layout/page-container";

// Streams a layout-matched skeleton the moment navigation starts, instead of
// blanking on the ~20-query detail block — on a direct load and on every
// soft navigation from a tile alike. The same frame and padding as the page.
export default function CardDetailLoading() {
  return (
    <PageContainer className="py-6 sm:py-10">
      <CardDetailSkeleton />
    </PageContainer>
  );
}
