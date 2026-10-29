import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { OG_SIZE } from "@/lib/brand/constants";
import { HOME_OG_ALT } from "@/lib/og/home-card";
import {
  SITE_OG_IMAGE,
  SITE_TWITTER_IMAGE,
  siteOpenGraph,
  siteTwitter,
} from "@/lib/seo/share-metadata";

// ---------------------------------------------------------------------------
// The site's share image survives a page's own share metadata.
//
// Next merges metadata shallowly, so a page that sets `openGraph` or
// `twitter` replaces the root block and its file-based image with it (on
// main, /faq, /news and the landing pages unfurled with no picture). The
// helpers put the root images back; the scan below makes every marketing
// page that sets its own block either use them or bring an image of its
// own (a sibling opengraph-image.tsx, or `images:` it sets itself).
// ---------------------------------------------------------------------------

const APP = join(process.cwd(), "app");
const MARKETING = join(APP, "(marketing)");

/** Pages that still set a bare block, each in an area another branch owns
 *  today (gallery / decks hubs, the guest creator). Bring one in by using
 *  the helpers — and strike it here. Never add a page to this list. */
const KNOWN_BARE: readonly string[] = [
  "create-guest/page.tsx",
  "decks/format/[format]/page.tsx",
  "gallery/tag/[tag]/page.tsx",
  "gallery/type/[type]/page.tsx",
];

function pagesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pagesUnder(full);
    return name === "page.tsx" ? [full] : [];
  });
}

const hasOwnImage = (page: string) =>
  ["opengraph-image.tsx", "opengraph-image.png", "opengraph-image.jpg"].some((file) =>
    existsSync(join(dirname(page), file)),
  );

describe("siteOpenGraph / siteTwitter", () => {
  it("point at the root image routes, at the root image's size and alt", () => {
    expect(existsSync(join(APP, "opengraph-image.tsx"))).toBe(true);
    expect(existsSync(join(APP, "twitter-image.tsx"))).toBe(true);
    for (const [image, url] of [
      [SITE_OG_IMAGE, "/opengraph-image"],
      [SITE_TWITTER_IMAGE, "/twitter-image"],
    ] as const) {
      expect(image).toEqual({
        url,
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        alt: HOME_OG_ALT,
        type: "image/png",
      });
    }
  });

  it("keep the page's own fields and add the image", () => {
    expect(siteOpenGraph({ title: "T", description: "D", type: "article", url: "/x" })).toEqual({
      title: "T",
      description: "D",
      type: "article",
      url: "/x",
      images: [SITE_OG_IMAGE],
    });
    expect(siteTwitter({ title: "T", description: "D" })).toEqual({
      card: "summary_large_image",
      title: "T",
      description: "D",
      images: [SITE_TWITTER_IMAGE],
    });
  });
});

describe("marketing pages with their own share metadata", () => {
  const pages = pagesUnder(MARKETING);

  it("the scan sees the pages", () => {
    expect(pages.length).toBeGreaterThan(30);
  });

  it("keep a share image: the helpers, a sibling opengraph-image, or images of their own", () => {
    const bare: string[] = [];
    for (const page of pages) {
      const source = readFileSync(page, "utf8");
      const name = relative(MARKETING, page);
      if (hasOwnImage(page) || /\bimages:/.test(source)) continue;
      const openGraphBare = /\bopenGraph:\s*\{/.test(source);
      const twitterBare = /\btwitter:\s*\{/.test(source);
      if (openGraphBare || twitterBare) bare.push(name);
    }
    expect(bare.sort()).toEqual([...KNOWN_BARE].sort());
  });
});
