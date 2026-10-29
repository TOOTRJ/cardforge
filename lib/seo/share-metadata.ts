import type { Metadata } from "next";
import { OG_SIZE } from "@/lib/brand/constants";
import { HOME_OG_ALT } from "@/lib/og/home-card";

// ---------------------------------------------------------------------------
// Share metadata that keeps the site's share image.
//
// Next merges metadata SHALLOWLY: a page that sets its own `openGraph` (or
// `twitter`) object replaces the root layout's whole object — and with it
// the images app/opengraph-image.tsx and app/twitter-image.tsx put there. A
// page that only wanted its own title and description in an unfurl lost the
// picture (og:image / twitter:image gone; on main, /faq and the landing
// pages had shipped that way). Every such page builds the block here, and
// the block always carries the root images. A page with an image of its own
// (a card, a deck, a profile, a guide — a sibling opengraph-image.tsx) does
// not need this: its file-based image wins in its own segment.
//
// The paths are the root image routes themselves; `metadataBase` (the root
// layout) makes them absolute. They lack the content hash Next appends to a
// file-based image it emits itself ("?bade4…"), so a social cache may keep
// an old picture a little longer after the root image is redrawn — the
// image is the same route either way.
// ---------------------------------------------------------------------------

type OpenGraph = NonNullable<Metadata["openGraph"]>;
type Twitter = NonNullable<Metadata["twitter"]>;

/** app/opengraph-image.tsx — the site-wide Open Graph image. */
export const SITE_OG_IMAGE = {
  url: "/opengraph-image",
  width: OG_SIZE.width,
  height: OG_SIZE.height,
  alt: HOME_OG_ALT,
  type: "image/png",
} as const;

/** app/twitter-image.tsx — the site-wide Twitter/X card image. */
export const SITE_TWITTER_IMAGE = {
  url: "/twitter-image",
  width: OG_SIZE.width,
  height: OG_SIZE.height,
  alt: HOME_OG_ALT,
  type: "image/png",
} as const;

/** A page's own `openGraph` block, with the site's share image added. */
export function siteOpenGraph<T extends OpenGraph>(openGraph: T): T {
  return { ...openGraph, images: [SITE_OG_IMAGE] };
}

/** A page's own `twitter` block (a large-image card), with the site's
 *  Twitter image added. */
export function siteTwitter(twitter: Omit<Twitter, "images" | "card">): Twitter {
  return { ...twitter, card: "summary_large_image", images: [SITE_TWITTER_IMAGE] };
}
