import type { Metadata } from "next";
import { GalleryView, parseGalleryFilters } from "./gallery-view";

export const metadata: Metadata = {
  title: "Gallery",
  description: "Browse public custom cards forged by the PipGlyph community.",
  alternates: { canonical: "/gallery" },
};

// ISR: the bare /gallery route is viewer-independent (anonymous public-client
// reads — RLS scopes anon to public rows) and never reads searchParams, so
// it's served from the CDN and re-baked at most every 5 minutes, same cadence
// as the homepage. Like-state degrades gracefully: tiles render the
// signed-out hint and QuickLikeButton re-checks the session cookie at click
// time.
//
// Requests WITH filter/search/page params are rewritten by proxy.ts to
// /gallery/browse (see lib/routing/browse-params.ts), which renders them
// per-request — reading searchParams here would make this route fully
// dynamic again, so don't.
export const revalidate = 300;

export default function GalleryPage() {
  return <GalleryView filters={parseGalleryFilters({})} />;
}
