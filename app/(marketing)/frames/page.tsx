import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Frame, MessageSquarePlus, PenTool } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SurfaceCard } from "@/components/ui/surface-card";
import { collectionPageJsonLd, JsonLd } from "@/components/seo/json-ld";
import { FrameGalleryTile } from "@/components/frames/frame-gallery-tile";
import { getFrameGallery, getFrameGalleryFrames } from "@/lib/frames/frame-gallery-queries";
import {
  FRAME_GALLERY_MIN_INDEXED,
  FRAME_GALLERY_SECTIONS,
  frameAnchorId,
  galleryEntries,
  type FrameGallerySection,
} from "@/lib/frames/frame-gallery";
import type { FrameExample } from "@/lib/frames/frame-gallery-queries";
import { REQUEST_A_FRAME_HREF } from "@/lib/frames/requested-frames";
import { siteOpenGraph, siteTwitter } from "@/lib/seo/share-metadata";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// /frames — the frame gallery (TODO NV8): every frame the creator offers
// (verified in at least one colour — the creator's only gate), grouped as
// its Card step groups them, each with the colours it is verified in and a
// public card made on it, or its empty master while there is none. The
// parent of /frames/requested (NV12), the frames people asked for.
//
// The frames and their groups are the creator's own answer
// (lib/frames/frame-gallery.ts); the reads go through the cookie-free public
// client (lib/frames/frame-gallery-queries.ts), so the page is ISR: re-baked
// at most every 5 minutes like the other marketing pages (the header's
// "What's new" feed holds them all to that window anyway), and at once when
// a card changes (lib/cards/revalidate.ts purges /frames with the other tile
// pages, so a card made private leaves its tile on the next request). Thin
// — fewer than FRAME_GALLERY_MIN_INDEXED frames, or a failed read — =
// noindex, and the sitemap applies the same bar.
//
// A frame's "Make a card" opens the creator: it takes no starting frame from
// its URL yet (lib/frames/frame-gallery.ts creatorHrefForFrame), so each
// group says where in the Card step its frames are.
// ---------------------------------------------------------------------------

export const revalidate = 300;

const TITLE = "MTG Card Frames — Every Frame in the PipGlyph Creator";
const DESCRIPTION =
  "Every Magic card frame you can design on in PipGlyph, from the 1993 border to borderless, layouts and showcases — checked color by color against printed cards.";
/** The CollectionPage's own description: its ItemList holds only the first
 *  ITEM_LIST_CAP frames in page order (the older borders come last and are
 *  cut), so it names no group the list may leave out. */
const COLLECTION_DESCRIPTION =
  "Card frames you can design on in PipGlyph, each checked color by color against printed cards.";

export async function generateMetadata(): Promise<Metadata> {
  const { sections, error } = await getFrameGalleryFrames();
  const count = galleryEntries(sections).length;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: "/frames" },
    robots: error !== null || count < FRAME_GALLERY_MIN_INDEXED ? { index: false, follow: true } : undefined,
    openGraph: siteOpenGraph({
      title: `${TITLE} · PipGlyph`,
      description: DESCRIPTION,
      type: "website",
      siteName: "PipGlyph",
      url: "/frames",
    }),
    twitter: siteTwitter({
      title: `${TITLE} · PipGlyph`,
      description: DESCRIPTION,
    }),
  };
}

/** A group's anchor (the jump links). */
function sectionAnchorId(id: FrameGallerySection["id"]): string {
  return `frames-${id}`;
}

export default async function FramesPage() {
  const { sections, error, examples } = await getFrameGallery();
  const entries = galleryEntries(sections);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      <JsonLd
        data={collectionPageJsonLd({
          name: "Card frames on PipGlyph",
          description: COLLECTION_DESCRIPTION,
          path: "/frames",
          items: entries.map((entry) => ({
            name: `${entry.fullName} frame`,
            path: `/frames#${frameAnchorId(entry.template)}`,
          })),
        })}
      />
      <Breadcrumbs
        items={[
          { name: "Home", path: "/" },
          { name: "Learn", path: "/learn" },
          { name: "Frames", path: "/frames" },
        ]}
      />
      <PageHeader
        eyebrow="Frames"
        title="Every frame in the creator"
        description={
          entries.length > 0
            ? `The ${entries.length} frames you can design on today, from the 1993 border to borderless, double-faced and full-art cards. A frame is offered in a color only once it has been checked against printed cards, and each is shown on a public card made with it, where there is one.`
            : "Every frame you can design on, from the 1993 border to borderless, double-faced and full-art cards — each checked color by color against printed cards."
        }
        actions={
          <>
            <Button asChild>
              <Link href="/create">
                <PenTool className="h-4 w-4" aria-hidden />
                Open the creator
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/frames/requested">Requested frames</Link>
            </Button>
          </>
        }
      />

      {entries.length === 0 ? (
        <EmptyState
          className="mt-10"
          icon={Frame}
          headingLevel={2}
          title={error ? "The frames aren't available right now" : "No frames to show yet"}
          description={
            error
              ? "The frame list couldn't be loaded. Try again in a little while — the creator itself is open."
              : "Frames appear here once they are checked against printed cards."
          }
          action={
            <Button asChild variant="outline">
              <Link href="/create">Open the creator</Link>
            </Button>
          }
        />
      ) : (
        <>
          <nav aria-label="Frame groups" className="mt-8 flex flex-col gap-3">
            <ul className="flex flex-wrap gap-2">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${sectionAnchorId(section.id)}`}
                    className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface/60 px-3.5 py-1.5 text-sm text-foreground transition-colors hover:border-border-strong hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                  >
                    {FRAME_GALLERY_SECTIONS[section.id].title}
                    <span className="text-xs tabular-nums text-subtle">
                      {section.entries.length}
                      <span className="sr-only"> {section.entries.length === 1 ? "frame" : "frames"}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-xs leading-5 text-subtle">
              The dots under a frame are the colors it is verified in; gold is a multicolor card.
            </p>
          </nav>

          {sections.map((section) => (
            <FrameSection key={section.id} section={section} examples={examples} />
          ))}
        </>
      )}

      <SurfaceCard className="mt-16 flex flex-col gap-5 p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
        <div className="flex max-w-2xl flex-col gap-2">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">Missing a frame?</h2>
          <p className="text-sm leading-6 text-muted">
            When someone imports a printing PipGlyph can&apos;t draw exactly yet, we count it. The
            requested frames list shows what people asked for and where each one stands.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/frames/requested">
              Requested frames
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href={REQUEST_A_FRAME_HREF}>
              <MessageSquarePlus className="h-4 w-4" aria-hidden />
              Request a frame
            </Link>
          </Button>
        </div>
      </SurfaceCard>
    </div>
  );
}

function FrameSection({
  section,
  examples,
}: {
  section: FrameGallerySection;
  examples: Partial<Record<FrameTemplate, FrameExample>>;
}) {
  const copy = FRAME_GALLERY_SECTIONS[section.id];
  const anchor = sectionAnchorId(section.id);
  const count = section.entries.length;
  return (
    <section id={anchor} aria-labelledby={`${anchor}-heading`} className="mt-14 scroll-mt-24">
      <div className="mb-6 flex flex-col gap-2 border-b border-gold/20 pb-4 md:flex-row md:items-end md:justify-between md:gap-8">
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id={`${anchor}-heading`}
            className="flex flex-wrap items-baseline gap-x-3 font-display text-2xl font-semibold tracking-tight text-foreground"
          >
            {copy.title}
            <span className="font-sans text-sm font-normal tabular-nums text-subtle">
              {count} {count === 1 ? "frame" : "frames"}
            </span>
          </h2>
          <p className="text-sm leading-6 text-muted">{copy.hint}</p>
        </div>
        <p className="text-xs leading-5 text-subtle md:max-w-sm md:text-right">{copy.whereInCreator}</p>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 xl:grid-cols-5">
        {section.entries.map((entry) => (
          <FrameGalleryTile key={entry.template} entry={entry} example={examples[entry.template] ?? null} />
        ))}
      </ul>
    </section>
  );
}
