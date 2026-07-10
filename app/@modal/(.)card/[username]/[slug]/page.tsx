import { Suspense } from "react";
import { CardDetailContent } from "@/components/cards/card-detail-content";
import { CardDetailModal } from "@/components/cards/card-detail-modal";
import { CardDetailSkeleton } from "@/components/cards/card-detail-skeleton";
import { HardNavigate } from "./hard-navigate";

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

export default async function InterceptedCardPage({
  params,
}: {
  params: Promise<Params>;
}) {
  // /card/[slug]/edit matches this interceptor too (the trailing "edit"
  // lands in the [slug] position), so a soft navigation to any edit link —
  // dashboard tiles, post-save redirects — silently opened a broken modal
  // over the current page instead of the editor. Hand those URLs back to
  // the real route via a hard navigation.
  const { slug } = await params;
  if (slug === "edit") {
    return <HardNavigate />;
  }

  return (
    <CardDetailModal>
      <Suspense fallback={<CardDetailSkeleton />}>
        <InterceptedCardContent params={params} />
      </Suspense>
    </CardDetailModal>
  );
}
