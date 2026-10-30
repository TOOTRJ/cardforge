import { describe, expect, it, vi } from "vitest";
import type { Article } from "@/lib/content/articles";

// ---------------------------------------------------------------------------
// The site's one list of guides: the MDX files JOINED by the released
// composer articles. A file wins a slug clash; a composer article joins the
// shelves, the tag hubs and the related list like a file does.
// ---------------------------------------------------------------------------

const composed = vi.hoisted(() => ({ articles: [] as Article[] }));
vi.mock("@/lib/content/db-articles", () => ({
  listReleasedComposerArticles: async () => composed.articles,
}));

import { listArticles } from "@/lib/content/articles";
import {
  getPublishedArticle,
  getPublishedArticlesByTag,
  getPublishedRelatedArticles,
  listPublishedArticles,
  listPublishedArticlesInCategory,
  listPublishedTags,
} from "@/lib/content/article-catalog";

const composer = (slug: string, overrides: Partial<Article["meta"]> = {}): Article => ({
  meta: {
    slug,
    title: `Composer ${slug}`,
    description: "From the composer.",
    date: "2099-01-01T15:00:00.000Z",
    tags: ["brand-new-topic", "card design"],
    category: "design",
    readingMinutes: 4,
    source: "composer",
    ...overrides,
  },
  content: "Body.",
});

describe("the article catalog", () => {
  it("is the files alone when the composer has nothing", async () => {
    composed.articles = [];
    expect(await listPublishedArticles()).toEqual(listArticles());
  });

  it("joins a composer article, newest first, everywhere a file goes", async () => {
    composed.articles = [composer("fresh-guide")];
    const all = await listPublishedArticles();
    expect(all[0].slug).toBe("fresh-guide");
    expect(all).toHaveLength(listArticles().length + 1);
    expect((await listPublishedArticlesInCategory("design")).map((a) => a.slug)).toContain("fresh-guide");
    expect((await listPublishedTags()).find((t) => t.slug === "brand-new-topic")).toMatchObject({ count: 1 });
    expect((await getPublishedArticlesByTag("brand-new-topic"))?.articles.map((a) => a.slug)).toEqual(["fresh-guide"]);
    expect((await getPublishedArticle("fresh-guide"))?.meta.source).toBe("composer");
    expect((await getPublishedRelatedArticles(listArticles()[0].slug, 50)).map((a) => a.slug)).toContain("fresh-guide");
  });

  it("lets a file win a slug clash", async () => {
    const file = listArticles()[0];
    composed.articles = [composer(file.slug)];
    const all = await listPublishedArticles();
    expect(all.filter((a) => a.slug === file.slug)).toEqual([file]);
    expect((await getPublishedArticle(file.slug))?.meta.source).toBeUndefined();
  });

  it("never looks up a malformed slug", async () => {
    composed.articles = [composer("fresh-guide")];
    expect(await getPublishedArticle("../etc/passwd")).toBeNull();
    expect(await getPublishedArticle("missing")).toBeNull();
  });
});
