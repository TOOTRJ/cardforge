import type { Metadata } from "next";
import { GalleryView, parseGalleryFilters } from "../gallery-view";

// ---------------------------------------------------------------------------
// /gallery/browse — the dynamic twin of /gallery.
//
// Reached via the proxy.ts rewrite whenever /gallery is requested with a
// known filter/search/pagination param (the visitor's URL stays
// /gallery?…). Reading searchParams makes THIS route dynamic per-request
// while the bare /gallery stays static/ISR on the CDN.
//
// Direct hits are harmless: the canonical points at /gallery, matching the
// posture every filtered gallery variant always had.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Gallery",
  description: "Browse public custom cards forged by the PipGlyph community.",
  alternates: { canonical: "/gallery" },
};

type GalleryBrowsePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function GalleryBrowsePage({
  searchParams,
}: GalleryBrowsePageProps) {
  return <GalleryView filters={parseGalleryFilters(await searchParams)} />;
}
