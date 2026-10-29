import type { Metadata } from "next";
import { CREATORS_DESCRIPTION, CreatorsLanding } from "./creators-view";
import { siteOpenGraph, siteTwitter } from "@/lib/seo/share-metadata";

const TITLE = "Creators — The Makers Behind PipGlyph's Custom MTG Cards";

export const metadata: Metadata = {
  title: TITLE,
  description: CREATORS_DESCRIPTION,
  alternates: { canonical: "/creators" },
  openGraph: siteOpenGraph({
    title: `${TITLE} · PipGlyph`,
    description: CREATORS_DESCRIPTION,
    type: "website",
    siteName: "PipGlyph",
    url: "/creators",
  }),
  twitter: siteTwitter({
    title: `${TITLE} · PipGlyph`,
    description: CREATORS_DESCRIPTION,
  }),
};

// ISR: the /creators landing is viewer-independent (anonymous public-client
// reads) and never reads searchParams, so it's CDN-cached and re-baked at
// most every 5 minutes, the gallery's cadence.
//
// Sorting and paging live on /creators/browse (the visible dynamic
// sibling); a landing request that still carries one of those params is
// 308'd there by proxy.ts (lib/routing/browse-params.ts). Reading
// searchParams here would make this route fully dynamic — don't.
export const revalidate = 300;

export default function CreatorsPage() {
  return <CreatorsLanding />;
}
