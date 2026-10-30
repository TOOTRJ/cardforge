import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ListOrdered, Megaphone, MessageSquarePlus } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SurfaceCard } from "@/components/ui/surface-card";
import { JsonLd, itemListJsonLd } from "@/components/seo/json-ld";
import {
  ROADMAP_COLUMNS,
  ROADMAP_SHIPPED,
  ROADMAP_STATUS_HINTS,
  ROADMAP_STATUS_LABELS,
  roadmapAnchorId,
  type RoadmapItem,
  type RoadmapStatus,
} from "@/lib/content/roadmap";
import { siteOpenGraph, siteTwitter } from "@/lib/seo/share-metadata";
import { PageContainer } from "@/components/layout/page-container";

// ---------------------------------------------------------------------------
// /roadmap — the public roadmap (TODO NV12, part 2): Now / Next / Later and
// what recently shipped, from the typed data file lib/content/roadmap.ts
// (no database; the owner edits it by PR). It links the two live lists
// beside it: the requested frames (part 1) and What's new.
//
// Fully static — no reads at all — so it is indexed and in the sitemap.
// ---------------------------------------------------------------------------

const TITLE = "Roadmap";
const DESCRIPTION =
  "What PipGlyph is building now, what comes next and what we're exploring for later — plus what recently shipped. No dates, just the order.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/roadmap" },
  openGraph: siteOpenGraph({
    title: `${TITLE} · PipGlyph`,
    description: DESCRIPTION,
    type: "website",
    siteName: "PipGlyph",
    url: "/roadmap",
  }),
  twitter: siteTwitter({
    title: `${TITLE} · PipGlyph`,
    description: DESCRIPTION,
  }),
};

// Three looks a glance tells apart, the requested-frames list's: thinking
// (neutral), in progress (gold), done (the brand's purple).
const STATUS_BADGE: Record<RoadmapStatus, "default" | "gold" | "primary"> = {
  exploring: "default",
  building: "gold",
  shipped: "primary",
};

function RoadmapEntry({ item }: { item: RoadmapItem }) {
  return (
    <li id={roadmapAnchorId(item)} className="flex scroll-mt-24 flex-col gap-2 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 font-medium text-foreground">{item.title}</h3>
        <Badge variant={STATUS_BADGE[item.status]}>{ROADMAP_STATUS_LABELS[item.status]}</Badge>
      </div>
      <p className="text-sm leading-6 text-muted">{item.summary}</p>
      {item.href ? (
        <Link
          href={item.href}
          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary-bright underline-offset-4 hover:underline"
        >
          {item.status === "shipped" ? "See it" : "Where it lives today"}
          <span className="sr-only">: {item.title}</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ) : null}
    </li>
  );
}

export default function RoadmapPage() {
  return (
    <PageContainer className="py-12 lg:py-16">
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Roadmap", path: "/roadmap" },
        ]}
      />
      <JsonLd
        data={itemListJsonLd({
          name: "PipGlyph roadmap",
          items: ROADMAP_COLUMNS.flatMap((column) =>
            column.items.map((item) => ({
              name: `${column.title}: ${item.title}`,
              path: `/roadmap#${roadmapAnchorId(item)}`,
            })),
          ),
        })}
      />
      <PageHeader
        eyebrow="Community"
        title="Roadmap"
        description="What we're building now, what comes next, and what we're exploring for later. No dates — just the order, and plain words about where each thing stands. It changes as we learn what you need."
        actions={
          <>
            <Button asChild>
              <Link href="/feedback">
                <MessageSquarePlus className="h-4 w-4" aria-hidden />
                Suggest something
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/news">
                <Megaphone className="h-4 w-4" aria-hidden />
                What&apos;s new
              </Link>
            </Button>
          </>
        }
      />

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {ROADMAP_COLUMNS.map((column) => (
          <section
            key={column.stage}
            aria-labelledby={`roadmap-${column.stage}-heading`}
            className="flex min-w-0 flex-col gap-3"
          >
            <div className="flex flex-col gap-1">
              <h2
                id={`roadmap-${column.stage}-heading`}
                className="font-display text-xl font-semibold tracking-tight text-foreground"
              >
                {column.title}
              </h2>
              <p className="text-sm text-muted">{column.description}</p>
            </div>
            <ul className="flex flex-col divide-y divide-border/40 overflow-hidden rounded-card border border-border/70 bg-surface/80">
              {column.items.map((item) => (
                <RoadmapEntry key={item.id} item={item} />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="roadmap-shipped-heading" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2
              id="roadmap-shipped-heading"
              className="font-display text-xl font-semibold tracking-tight text-foreground"
            >
              Recently shipped
            </h2>
            <p className="text-sm text-muted">
              The full story, update by update, is on{" "}
              <Link href="/news" className="text-primary-bright underline underline-offset-4 hover:text-foreground">
                What&apos;s new
              </Link>
              .
            </p>
          </div>
          <ul className="flex flex-col divide-y divide-border/40 overflow-hidden rounded-card border border-border/70 bg-surface/80">
            {ROADMAP_SHIPPED.map((item) => (
              <RoadmapEntry key={item.id} item={item} />
            ))}
          </ul>
        </section>

        <aside className="flex flex-col gap-4">
          <SurfaceCard className="flex flex-col gap-4 p-5">
            <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
              What the labels mean
            </h2>
            <dl className="flex flex-col gap-3 text-sm">
              {(Object.keys(ROADMAP_STATUS_LABELS) as RoadmapStatus[]).map((status) => (
                <div key={status} className="flex flex-col gap-1">
                  <dt>
                    <Badge variant={STATUS_BADGE[status]}>{ROADMAP_STATUS_LABELS[status]}</Badge>
                  </dt>
                  <dd className="leading-6 text-muted">{ROADMAP_STATUS_HINTS[status]}</dd>
                </div>
              ))}
            </dl>
          </SurfaceCard>
          <SurfaceCard className="flex flex-col gap-3 p-5 text-sm leading-6 text-muted">
            <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
              Frames have their own list
            </h2>
            <p>
              Which card frames we build and check next is decided by what people ask for. That list is counted
              from real requests and updates every day.
            </p>
            <Button asChild variant="outline" className="w-fit">
              <Link href="/frames/requested">
                <ListOrdered className="h-4 w-4" aria-hidden />
                Requested frames
              </Link>
            </Button>
          </SurfaceCard>
        </aside>
      </div>
    </PageContainer>
  );
}
