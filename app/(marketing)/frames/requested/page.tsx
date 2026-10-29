import type { Metadata } from "next";
import Link from "next/link";
import { Hammer, MessageSquarePlus } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SurfaceCard } from "@/components/ui/surface-card";
import { getRequestedFrames } from "@/lib/frames/requested-frames-queries";
import {
  REQUEST_A_FRAME_HREF,
  REQUESTED_FRAME_STATUS_HINTS,
  REQUESTED_FRAME_STATUS_LABELS,
  REQUESTED_FRAMES_MIN_INDEXED,
  REQUESTED_FRAMES_WINDOW_LABEL,
  peopleLabel,
  type RequestedFrameStatus,
} from "@/lib/frames/requested-frames";
import { siteOpenGraph, siteTwitter } from "@/lib/seo/share-metadata";

// ---------------------------------------------------------------------------
// /frames/requested — the public "Requested frames" list (TODO NV12, part
// 1): the frames people asked PipGlyph for, most people first, and where
// each stands. The first piece of a public roadmap; it lives under /frames,
// where the frame gallery (NV8) will sit, so the two read as one place.
//
// The data is migration 0147's requested_frame_counts(): per frame, a count
// of distinct accounts (never an admin's) whose import PipGlyph couldn't
// draw exactly in the last six months. No name, card, printing, set or date
// reaches this page, and every frame's words are the registry's
// (lib/frames/requested-frames.ts), never a row's.
//
// ISR, cookie-free (the public client), re-baked at most every 5 minutes
// like the other marketing pages. Thin (fewer than
// REQUESTED_FRAMES_MIN_INDEXED frames) = noindex, and the sitemap applies
// the same bar.
// ---------------------------------------------------------------------------

export const revalidate = 300;

const TITLE = "Requested Frames — The PipGlyph Frame Roadmap";
const DESCRIPTION =
  "The Magic card frames and treatments people asked PipGlyph for, most requested first, and where each one stands: requested, or built and being checked.";

export async function generateMetadata(): Promise<Metadata> {
  const { frames } = await getRequestedFrames();
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/frames/requested" },
    robots: frames.length < REQUESTED_FRAMES_MIN_INDEXED ? { index: false, follow: true } : undefined,
    openGraph: siteOpenGraph({
      title: `${TITLE} · PipGlyph`,
      description: DESCRIPTION,
      type: "website",
      siteName: "PipGlyph",
      url: "/frames/requested",
    }),
    twitter: siteTwitter({
      title: `${TITLE} · PipGlyph`,
      description: DESCRIPTION,
    }),
  };
}

const STATUS_BADGE: Record<RequestedFrameStatus, "gold" | "primary"> = {
  requested: "gold",
  checking: "primary",
};

export default async function RequestedFramesPage() {
  const { frames, error } = await getRequestedFrames();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Learn", path: "/learn" },
          { name: "Requested frames", path: "/frames/requested" },
        ]}
      />
      <PageHeader
        eyebrow="Roadmap"
        title="Requested frames"
        description={`When someone imports a printing PipGlyph can't draw exactly yet, we count it. These are the frames people asked for in ${REQUESTED_FRAMES_WINDOW_LABEL}, most people first — the list decides what we build and check next.`}
        actions={
          <Button asChild>
            <Link href={REQUEST_A_FRAME_HREF}>
              <MessageSquarePlus className="h-4 w-4" aria-hidden />
              Request a frame
            </Link>
          </Button>
        }
      />

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="requested-frames-heading" className="min-w-0">
          <h2 id="requested-frames-heading" className="sr-only">
            Frames, most requested first
          </h2>
          {error || frames.length === 0 ? (
            <EmptyState
              icon={Hammer}
              title={error ? "The list isn't available right now" : "No requests yet"}
              description={
                error
                  ? "Requests couldn't be loaded. Try again in a little while."
                  : "Nobody has imported a printing PipGlyph can't draw in the last six months. Missing one? Ask for it."
              }
              action={
                <Button asChild variant="outline">
                  <Link href={REQUEST_A_FRAME_HREF}>Request a frame</Link>
                </Button>
              }
            />
          ) : (
            <ol className="flex flex-col divide-y divide-border/40 overflow-hidden rounded-card border border-border/70 bg-surface/80">
              {frames.map((frame, index) => (
                <li
                  key={frame.signature}
                  className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-4 py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-center sm:px-5"
                >
                  <span className="pt-0.5 font-mono text-sm text-subtle sm:pt-0" aria-hidden>
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium text-foreground">{frame.label}</span>
                    {frame.detail ? <span className="text-sm text-muted">{frame.detail}</span> : null}
                  </div>
                  <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-auto sm:justify-end">
                    <Badge variant={STATUS_BADGE[frame.status]}>
                      {REQUESTED_FRAME_STATUS_LABELS[frame.status]}
                    </Badge>
                    <span className="whitespace-nowrap text-sm tabular-nums text-muted">
                      {peopleLabel(frame.people)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <SurfaceCard className="flex flex-col gap-4 p-5">
            <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
              What the labels mean
            </h2>
            <dl className="flex flex-col gap-3 text-sm">
              {(Object.keys(REQUESTED_FRAME_STATUS_LABELS) as RequestedFrameStatus[]).map((status) => (
                <div key={status} className="flex flex-col gap-1">
                  <dt>
                    <Badge variant={STATUS_BADGE[status]}>{REQUESTED_FRAME_STATUS_LABELS[status]}</Badge>
                  </dt>
                  <dd className="leading-6 text-muted">{REQUESTED_FRAME_STATUS_HINTS[status]}</dd>
                </div>
              ))}
            </dl>
          </SurfaceCard>
          <SurfaceCard className="flex flex-col gap-2 p-5 text-sm leading-6 text-muted">
            <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
              How we count
            </h2>
            <p>
              Each person counts once per frame, however many cards they import. We show counts only —
              never who asked or which card. Staff accounts don&apos;t count.
            </p>
            <p>
              A frame you&apos;d like that isn&apos;t here?{" "}
              <Link
                href={REQUEST_A_FRAME_HREF}
                className="text-primary-bright underline-offset-4 hover:underline"
              >
                Tell us about it
              </Link>
              .
            </p>
          </SurfaceCard>
        </aside>
      </div>
    </div>
  );
}
