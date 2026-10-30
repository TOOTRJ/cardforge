import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// What every guide carries by default (docs/research/article-seo-2026-10.md):
// Article JSON-LD with the cover and the share card as images, the author as
// a Person with an author page and sameAs (else the PipGlyph organization),
// dateModified only from an honest update, and wordCount.
// ---------------------------------------------------------------------------

vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));

import { buildArticleJsonLd } from "@/components/content/article-view";
import type { ArticleMeta } from "@/lib/content/articles";

const META: ArticleMeta = {
  slug: "naming-custom-cards",
  title: "Naming custom cards",
  description: "How to name a custom card.",
  date: "2026-11-03T15:00:00.000Z",
  tags: ["naming", "card design"],
  category: "design",
  readingMinutes: 7,
  wordCount: 1500,
  source: "composer",
};

describe("buildArticleJsonLd", () => {
  it("credits the organization and lists the share card when there is no author or cover", () => {
    const data = buildArticleJsonLd(META);
    expect(data).toMatchObject({
      "@type": "Article",
      headline: "Naming custom cards",
      datePublished: META.date,
      dateModified: META.date,
      wordCount: 1500,
      author: { "@type": "Organization", name: "PipGlyph" },
      image: ["https://www.pipglyph.com/articles/naming-custom-cards/opengraph-image"],
      articleSection: "Design guides",
    });
  });

  it("credits a Person with an author page and draws the cover first", () => {
    const data = buildArticleJsonLd({
      ...META,
      updated: "2026-12-01T00:00:00.000Z",
      author: { name: "Dev Admin", path: "/profile/dev_admin", bio: null, sameAs: ["https://bsky.app/profile/x"] },
      cover: { src: "/article-media/naming-custom-cards/cover.svg", alt: "A title bar", width: 1600, height: 900 },
    });
    expect(data.dateModified).toBe("2026-12-01T00:00:00.000Z");
    expect(data.author).toEqual({
      "@type": "Person",
      name: "Dev Admin",
      url: "https://www.pipglyph.com/profile/dev_admin",
      sameAs: ["https://bsky.app/profile/x"],
    });
    expect(data.image).toEqual([
      {
        "@type": "ImageObject",
        url: "https://www.pipglyph.com/article-media/naming-custom-cards/cover.svg",
        caption: "A title bar",
        width: 1600,
        height: 900,
      },
      "https://www.pipglyph.com/articles/naming-custom-cards/opengraph-image",
    ]);
  });
});
