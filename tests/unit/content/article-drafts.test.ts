import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileMDX } from "next-mdx-remote/rsc";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { articleMdxOptions, mdxComponents } from "@/components/content/mdx-components";
import { listArticles } from "@/lib/content/articles";
import { parseArticleDraft, readArticleDrafts } from "@/lib/content/article-drafts";
import { articleInputSchema, bodyImages } from "@/lib/content/article-shared";
import { articleSeoChecklist, IMAGE_PLACEHOLDER } from "@/lib/content/article-seo-checklist";
// @ts-expect-error — a plain .mjs module without types (the seed generator).
import { buildArticleDraftsSeed, parseDraftForSeed } from "@/scripts/lib/article-drafts-seed.mjs";

// ---------------------------------------------------------------------------
// The drafts shipped for the owner (content/article-drafts/): each parses
// as a composer article, renders through the article page's own MDX options,
// passes every ERROR of the SEO checklist but the marked image placeholders
// the owner fills, and leaves no advice unmet but the byline the owner picks.
// The preview seed is the generator's output of these very files.
// ---------------------------------------------------------------------------

const drafts = readArticleDrafts();
const fileSlugs = listArticles().map((a) => a.slug);
const knownSlugs = [...fileSlugs, ...drafts.map((d) => d.slug)];

describe("the shipped article drafts", () => {
  it("are the five drafts, none on an MDX guide's URL", () => {
    expect(drafts.map((d) => d.slug)).toEqual([
      "custom-cards-and-commander-brackets",
      "custom-cards-rule-0-conversation",
      "custom-mtg-card-gift-guide",
      "how-to-design-a-custom-mtg-keyword",
      "how-to-name-a-custom-mtg-card",
    ]);
    for (const d of drafts) expect(fileSlugs).not.toContain(d.slug);
  });

  it.each(drafts.map((d) => [d.slug, d] as const))("%s parses as a composer article", (_slug, draft) => {
    const parsed = articleInputSchema.safeParse(draft.input);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it.each(drafts.map((d) => [d.slug, d] as const))("%s meets the checklist", (_slug, draft) => {
    const parsed = articleInputSchema.parse(draft.input);
    const items = articleSeoChecklist(
      {
        slug: parsed.slug,
        title: parsed.title,
        seoTitle: parsed.seoTitle,
        description: parsed.description,
        body: parsed.body,
        tags: parsed.tags,
        category: parsed.category,
        faq: parsed.faq,
        coverUrl: parsed.coverUrl,
        coverAlt: parsed.coverAlt,
        authorId: parsed.authorId,
      },
      { fileSlugs, knownSlugs },
    );
    const failing = items.filter((i) => !i.ok).map((i) => i.id);
    const allowed = ["author", ...(IMAGE_PLACEHOLDER.test(parsed.body) ? ["no-placeholder"] : [])];
    expect(failing.filter((id) => !allowed.includes(id))).toEqual([]);
  });

  it.each(drafts.map((d) => [d.slug, d] as const))("%s renders, every picture ours and described", async (_slug, draft) => {
    const { content } = await compileMDX({ source: draft.input.body, options: articleMdxOptions, components: mdxComponents });
    const html = renderToStaticMarkup(content);
    const images = bodyImages(draft.input.body);
    expect(images.length).toBeGreaterThan(0);
    expect((html.match(/<img /g) ?? []).length).toBe(images.length);
    for (const img of html.match(/<img [^>]*>/g) ?? []) {
      expect(img).toMatch(/alt="[^"]+"/);
      expect(img).toMatch(/src="\/article-media\//);
    }
    expect(html).not.toContain("<p><figure");
    // Never a printed card's picture: no Scryfall scan in a draft.
    expect(draft.input.body).not.toMatch(/scryfall\.io|<CardScan/);
    // The cover and every figure exist in public/.
    for (const src of [draft.input.coverUrl, ...images.map((i) => i.src)]) {
      expect(() => readFileSync(join(process.cwd(), "public", String(src)))).not.toThrow();
    }
  });

  it("the preview seed is generated from these files", () => {
    const dir = join(process.cwd(), "content", "article-drafts");
    const seedDrafts = drafts.map((d) => {
      const raw = readFileSync(join(dir, `${d.slug}.mdx`), "utf8");
      const seed = parseDraftForSeed(`${d.slug}.mdx`, raw);
      const app = parseArticleDraft(`${d.slug}.mdx`, raw)!.input;
      // The two parsers agree on every column.
      expect(seed).toEqual({
        slug: app.slug,
        title: app.title,
        seo_title: app.seoTitle ?? null,
        description: app.description,
        excerpt: app.excerpt ?? null,
        body: app.body,
        tags: app.tags,
        category: app.category,
        faq: app.faq,
        cover_url: app.coverUrl ?? null,
        cover_alt: app.coverAlt ?? null,
        cover_width: app.coverWidth,
        cover_height: app.coverHeight,
      });
      return seed;
    });
    const committed = readFileSync(join(process.cwd(), "supabase/seeds/32_article_drafts.sql"), "utf8");
    expect(committed).toBe(buildArticleDraftsSeed(seedDrafts));
  });
});
