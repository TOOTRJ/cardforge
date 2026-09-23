import type { Metadata } from "next";
import { GalleryLanding } from "./gallery-view";

export const metadata: Metadata = {
  title: "Gallery",
  description:
    "Browse public custom cards forged by the PipGlyph community — by type, by tag, or search every card.",
  alternates: { canonical: "/gallery" },
};

// ISR: the /gallery landing is viewer-independent (anonymous public-client
// reads — RLS scopes anon to public rows) and never reads searchParams, so
// it's served from the CDN and re-baked at most every 5 minutes, same
// cadence as the homepage. Like-state degrades gracefully: tiles render the
// signed-out hint and QuickLikeButton re-checks the session cookie at click
// time.
//
// Searching, filtering, sorting and paging live on /gallery/browse (the
// visible dynamic sibling); a landing request that still carries one of
// those params is 308'd there by proxy.ts (lib/routing/browse-params.ts).
// Reading searchParams here would make this route fully dynamic — don't.
export const revalidate = 300;

export default function GalleryPage() {
  return <GalleryLanding />;
}
