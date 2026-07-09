import { Suspense } from "react";
import { CardDetailContent } from "@/components/cards/card-detail-content";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { CardDetailSkeleton } from "@/components/cards/card-detail-skeleton";

// ---------------------------------------------------------------------------
// Intercepted card detail — renders the public card view inside a dialog.
//
// Fires only on SOFT navigations to /card/[username]/[slug] (clicking a
// card tile anywhere in the app); direct visits, refreshes, and crawlers
// hit the real page at app/(marketing)/card/[username]/[slug] instead.
// The slot lives at the app root so clicks from every route group —
// (marketing) gallery/profile/set AND (app) feed/dashboard — intercept.
//
// The page itself is sync so the dialog chrome (overlay, panel, close
// button, scroll lock) appears instantly; the data-heavy content streams
// into the Suspense boundary behind a skeleton.
// ---------------------------------------------------------------------------

type Params = { username: string; slug: string };

async function InterceptedCardContent({
  params,
}: {
  params: Promise<Params>;
}) {
  const { username, slug } = await params;
  return <CardDetailContent username={username} slug={slug} variant="modal" />;
}

export default function InterceptedCardPage({
  params,
}: {
  params: Promise<Params>;
}) {
  return (
    <CardDetailModal>
      <Suspense fallback={<CardDetailSkeleton />}>
        <InterceptedCardContent params={params} />
      </Suspense>
    </CardDetailModal>
  );
}
