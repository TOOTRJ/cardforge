import type { Metadata } from "next";
import { GalleryBrowse, parseGalleryFilters } from "../gallery-view";
import { GALLERY_FILTER_PARAMS, hasAnyParamKey } from "@/lib/routing/browse-params";

// ---------------------------------------------------------------------------
// /gallery/browse — search, filters, sort and paging for the whole gallery.
//
// The visible dynamic sibling of the static /gallery landing. Reading
// searchParams makes THIS route dynamic per-request while the landing stays
// on the CDN. Every control on the page navigates within this route
// (useSearchParamPatch / buildHref) — see lib/routing/browse-params.ts for
// why the landing can't host them.
// ---------------------------------------------------------------------------

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const params = await searchParams;
  // The bare page (every public card, discover order) is the one
  // self-canonical, indexable variant. Filtered/searched/paged URLs
  // canonicalize back to it and stay out of the index — the discover seed
  // alone mints an unbounded URL space — while crawlers still follow the
  // card links they contain.
  const filtered = hasAnyParamKey(params, GALLERY_FILTER_PARAMS);
  return {
    title: "Browse cards",
    description:
      "Search every public custom MTG-style card in the PipGlyph gallery by name, rules or flavor text, and filter by type, rarity, color and tag.",
    alternates: { canonical: "/gallery/browse" },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export default async function GalleryBrowsePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <GalleryBrowse filters={parseGalleryFilters(await searchParams)} />;
}
