import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { FrameRequestsPanel } from "@/components/admin/frame-requests-panel";
import {
  FRAME_REQUEST_WINDOW_LABELS,
  getFrameRequestSummary,
  parseFrameRequestWindow,
} from "@/lib/frames/frame-request-queries";

// ---------------------------------------------------------------------------
// Admin — the most-requested missing frames (TODO 1.6). Every Scryfall
// import whose printing PipGlyph can't reproduce exactly writes a
// frame_requests row (migration 0123); this page counts them per frame
// signature + set, most distinct users first, in two groups: missing frames
// for the frame factory to build (frames plan 4.7 / 4.11) and exact frames
// not yet verified in the card's colour (owner decisions D1 / D4,
// 2026-09-29). Its own route, apart from /admin/frame-compare; the admin
// rail and the avatar menu both link it.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Frame requests",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminFrameRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const range = parseFrameRequestWindow(Array.isArray(raw.window) ? raw.window[0] : raw.window);
  const summary = await getFrameRequestSummary(range);
  // Non-admins get a 404 (don't reveal the route exists).
  if (summary === null) notFound();

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin"
        title="Most-requested missing frames"
        description="Imports PipGlyph couldn’t reproduce exactly, per frame signature and set, most distinct users first: frames PipGlyph doesn’t have yet (build from the top), and exact frames not yet verified in the card’s colour (verify them)."
        actions={
          <>
            <Badge variant="primary">
              {summary.totalRequests} logged · {FRAME_REQUEST_WINDOW_LABELS[range]}
            </Badge>
            <Link
              href="/admin/frame-compare"
              className="text-sm text-primary-bright underline-offset-2 hover:underline"
            >
              Frame compare
            </Link>
          </>
        }
      />
      <div className="mt-8">
        <FrameRequestsPanel summary={summary} />
      </div>
    </DashboardShell>
  );
}
