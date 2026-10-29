import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import {
  ARTICLE_CATEGORIES,
  ARTICLE_CATEGORY_SLUGS,
  CATEGORY_MIN_ARTICLES,
  categoryForTagSlug,
  categoryPath,
  getArticleCategory,
  isArticleCategory,
  isIndexableCategory,
} from "@/lib/content/article-categories";
import {
  listArticles,
  listArticlesInCategory,
  listCategoryShelves,
  listTags,
  tagHubHref,
} from "@/lib/content/articles";
import { getCluster } from "@/lib/content/clusters";

// ---------------------------------------------------------------------------
// Article categories (TODO NV3): every guide sits on exactly ONE /learn shelf
// — `category: design | reference | comparisons | lore` in its frontmatter —
// and the shelves' words live in one module (lib/content/article-categories).
// A guide without a valid category would drop off every /learn page and out
// of its breadcrumb, so this fails first.
// ---------------------------------------------------------------------------

const articlesDir = join(process.cwd(), "content/articles");
const files = readdirSync(articlesDir).filter((file) => file.endsWith(".mdx"));

describe("every guide's category", () => {
  it.each(files)("%s names exactly one valid category in its frontmatter", (file) => {
    const { data } = matter(readFileSync(join(articlesDir, file), "utf8"));
    expect(
      isArticleCategory(data.category),
      `${file}: category must be one of ${ARTICLE_CATEGORY_SLUGS.join(", ")} (got ${JSON.stringify(data.category)})`,
    ).toBe(true);
  });

  it("reaches the parsed metadata, so every guide is on one shelf", () => {
    const shelves = listCategoryShelves();
    const shelved = shelves.flatMap((shelf) => shelf.articles.map((a) => a.slug));
    expect(shelved.sort()).toEqual(listArticles().map((a) => a.slug).sort());
    for (const shelf of shelves) {
      expect(shelf.articles).toEqual(listArticlesInCategory(shelf.category.slug));
      for (const article of shelf.articles) expect(article.category).toBe(shelf.category.slug);
    }
  });
});

describe("the category definitions", () => {
  it("are the four shelves, in menu order, with the header's labels", () => {
    expect(ARTICLE_CATEGORIES.map((c) => [c.slug, c.label])).toEqual([
      ["design", "Design guides"],
      ["reference", "Rules & reference"],
      ["comparisons", "Reviews & comparisons"],
      ["lore", "MTG lore"],
    ]);
    expect(ARTICLE_CATEGORIES.map((c) => c.slug)).toEqual([...ARTICLE_CATEGORY_SLUGS]);
  });

  it("each carry the copy a page needs: one line, an H1, an intro, a short meta description, a tool", () => {
    for (const category of ARTICLE_CATEGORIES) {
      expect(category.description, category.slug).toMatch(/^\S.{10,70}\.$/);
      expect(category.title.length, category.slug).toBeGreaterThan(5);
      expect(category.intro.length, category.slug).toBeGreaterThan(150);
      expect(category.blurb.length, category.slug).toBeLessThanOrEqual(155);
      expect(category.toolHref, category.slug).toMatch(/^\/[a-z0-9-]*$/);
      expect(category.toolLabel, category.slug).toBeTruthy();
    }
  });

  it("each replace a tag hub that exists — and whose cluster copy moved here", () => {
    const tagSlugs = new Set(listTags().map((t) => t.slug));
    const replaced = ARTICLE_CATEGORIES.map((c) => c.tagSlug);
    expect(new Set(replaced).size).toBe(replaced.length);
    for (const category of ARTICLE_CATEGORIES) {
      expect(tagSlugs.has(category.tagSlug), category.tagSlug).toBe(true);
      expect(getCluster(category.tagSlug), `${category.tagSlug} still has a cluster in clusters.ts`).toBeNull();
      expect(categoryForTagSlug(category.tagSlug)).toBe(category);
    }
    expect(categoryForTagSlug("oracle-text")).toBeNull();
  });

  it("look up by slug, and nothing else", () => {
    for (const slug of ARTICLE_CATEGORY_SLUGS) {
      expect(getArticleCategory(slug)?.slug).toBe(slug);
      expect(categoryPath(slug)).toBe(`/learn/${slug}`);
    }
    for (const junk of ["", "Design", "designs", "card-design", "../design", "__proto__", "toString"]) {
      expect(getArticleCategory(junk), junk).toBeNull();
      expect(isArticleCategory(junk), junk).toBe(false);
    }
    expect(isArticleCategory(undefined)).toBe(false);
    expect(isArticleCategory(["design"])).toBe(false);
  });

  it(`index a shelf from ${CATEGORY_MIN_ARTICLES} guides (the deck format hubs' bar)`, () => {
    expect(CATEGORY_MIN_ARTICLES).toBe(3);
    expect(isIndexableCategory(2)).toBe(false);
    expect(isIndexableCategory(3)).toBe(true);
    expect(isIndexableCategory(0)).toBe(false);
  });
});

describe("tag badges", () => {
  it("link a tag that became a category straight to its shelf, never through the 308", () => {
    expect(tagHubHref("card design")).toBe("/learn/design");
    expect(tagHubHref("reference")).toBe("/learn/reference");
    expect(tagHubHref("card makers")).toBe("/learn/comparisons");
    expect(tagHubHref("lore")).toBe("/learn/lore");
  });

  it("link every other tag to its own hub", () => {
    expect(tagHubHref("oracle text")).toBe("/articles/tag/oracle-text");
    expect(tagHubHref("playtesting")).toBe("/articles/tag/playtesting");
  });
});
