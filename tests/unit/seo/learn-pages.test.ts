import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The /learn pages' SEO contract (TODO NV4): the four categories are the only
// /learn/<category> pages — anything else is a real 404 (notFound() in the
// metadata AND the page) — each is self-canonical with OG + Twitter tags,
// and a shelf is indexed only from CATEGORY_MIN_ARTICLES guides.
// /news/feed.xml (TODO NV5) carries the released updates only, escaped,
// each linking to its entry on /news.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));
vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));
const feed = vi.hoisted(() => ({ empty: false }));
vi.mock("@/lib/updates/queries", () => ({
  getNewsFeed: async () => (feed.empty ? { updates: [], upcoming: [] } : {
    updates: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "update",
        title: "Frames & <tokens>",
        summary: "Arch tokens are \"three heights\" now.",
        publish_at: "2026-10-20T12:00:00.000Z",
      },
    ],
    upcoming: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        kind: "upcoming",
        title: "Not shipped yet",
        summary: "Soon.",
        publish_at: "2026-10-21T12:00:00.000Z",
      },
    ],
  }),
}));

/** robots.txt's Disallow rule as a matcher ("*" = one path segment). */
const disallows = (prefix: string, href: string) =>
  new RegExp(
    "^" + prefix.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+"),
  ).test(href);

import LearnCategoryPage, {
  generateMetadata,
  generateStaticParams,
} from "@/app/(marketing)/learn/[category]/page";
import { metadata as learnMetadata } from "@/app/(marketing)/learn/page";
import { metadata as toolsMetadata } from "@/app/(marketing)/tools/page";
import { metadata as newsMetadata } from "@/app/(marketing)/news/page";
import { GET as newsFeed } from "@/app/(marketing)/news/feed.xml/route";
import robots from "@/app/robots";
import { TOOL_COMPARISON, TOOLS } from "@/lib/content/tools";
import { SITE_OG_IMAGE, SITE_TWITTER_IMAGE } from "@/lib/seo/share-metadata";
import { ARTICLE_CATEGORY_SLUGS, CATEGORY_MIN_ARTICLES } from "@/lib/content/article-categories";
import { listArticlesInCategory } from "@/lib/content/articles";

const paramsOf = (category: string) => ({ params: Promise.resolve({ category }) });

describe("/learn/[category]", () => {
  it("builds exactly the four categories", () => {
    expect(generateStaticParams()).toEqual(ARTICLE_CATEGORY_SLUGS.map((category) => ({ category })));
  });

  it.each(ARTICLE_CATEGORY_SLUGS)("%s is self-canonical, shareable, and indexed only from the threshold", async (slug) => {
    const meta = await generateMetadata(paramsOf(slug));
    expect(meta.alternates?.canonical).toBe(`/learn/${slug}`);
    expect(meta.openGraph).toMatchObject({ url: `/learn/${slug}`, type: "website" });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
    // Its own share blocks still carry the site's images (Next merges
    // metadata shallowly — lib/seo/share-metadata.ts).
    expect(meta.openGraph?.images).toEqual([SITE_OG_IMAGE]);
    expect(meta.twitter?.images).toEqual([SITE_TWITTER_IMAGE]);
    const indexed = listArticlesInCategory(slug).length >= CATEGORY_MIN_ARTICLES;
    expect(meta.robots).toEqual(indexed ? undefined : { index: false, follow: true });
  });

  it("indexes today's two full shelves and keeps the one-guide shelves out", async () => {
    expect((await generateMetadata(paramsOf("design"))).robots).toBeUndefined();
    expect((await generateMetadata(paramsOf("reference"))).robots).toBeUndefined();
    expect((await generateMetadata(paramsOf("lore"))).robots).toEqual({ index: false, follow: true });
  });

  it("answers a real 404 for anything that is not a category, in the metadata and the page", async () => {
    for (const junk of ["nope", "card-design", "Design", "articles"]) {
      await expect(generateMetadata(paramsOf(junk)), junk).rejects.toThrow(/404/);
      await expect(LearnCategoryPage(paramsOf(junk)), junk).rejects.toThrow(/404/);
    }
  });
});

describe("/learn, /tools and /news", () => {
  it("are self-canonical with OG and Twitter tags that keep the share images", () => {
    for (const [meta, path] of [
      [learnMetadata, "/learn"],
      [toolsMetadata, "/tools"],
      [newsMetadata, "/news"],
    ] as const) {
      expect(meta.alternates?.canonical).toBe(path);
      expect(meta.openGraph).toMatchObject({ url: path, images: [SITE_OG_IMAGE] });
      expect(meta.twitter).toMatchObject({
        card: "summary_large_image",
        images: [SITE_TWITTER_IMAGE],
      });
      expect(meta.robots).toBeUndefined();
    }
  });

  it("/tools links public pages only — nothing robots.txt disallows (an account page)", () => {
    const rule = [robots().rules].flat()[0];
    const disallowed = [rule.disallow ?? []].flat();
    expect(disallowed).toContain("/dashboard");
    const hrefs = [...TOOLS, TOOL_COMPARISON].flatMap((tool) =>
      tool.more ? [tool.href, tool.more.href] : [tool.href],
    );
    for (const href of hrefs) {
      for (const prefix of disallowed) {
        expect(disallows(prefix, href), `${href} is disallowed by ${prefix}`).toBe(false);
      }
    }
  });
});

describe("/news/feed.xml", () => {
  it("lists released updates only, escaped, each linking to its entry on /news", async () => {
    const response = await newsFeed();
    expect(response.headers.get("content-type")).toContain("application/rss+xml");
    const xml = await response.text();
    expect(xml).toContain("<title>Frames &amp; &lt;tokens&gt;</title>");
    expect(xml).toContain("Arch tokens are &quot;three heights&quot; now.");
    expect(xml).toContain(
      "<link>https://www.pipglyph.com/news#update-11111111-1111-4111-8111-111111111111</link>",
    );
    expect(xml).toContain('<guid isPermaLink="false">11111111-1111-4111-8111-111111111111</guid>');
    expect(xml).not.toContain("Not shipped yet");
    expect(xml.match(/<item>/g)).toHaveLength(1);
    expect(xml).toContain("<lastBuildDate>Tue, 20 Oct 2026 12:00:00 GMT</lastBuildDate>");
  });

  it("with nothing released, is an empty channel with no made-up build date", async () => {
    feed.empty = true;
    try {
      const xml = await (await newsFeed()).text();
      expect(xml).toContain("<channel>");
      expect(xml).not.toContain("<item>");
      expect(xml).not.toContain("lastBuildDate");
      expect(xml).not.toContain("1970");
    } finally {
      feed.empty = false;
    }
  });
});
