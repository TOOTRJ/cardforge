import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ARTICLE_LIMITS,
  articleInputSchema,
  articleStatus,
  bodyImages,
  bodyLinks,
  firstParagraph,
  isSafeArticleHref,
  nextOpenSlot,
  slugFromTitle,
} from "@/lib/content/article-shared";
import { ARTICLE_CATEGORY_SLUGS } from "@/lib/content/article-categories";

// ---------------------------------------------------------------------------
// Composer articles' shared half: the form schema mirrors migration 0153's
// CHECKs, the release rule is RLS's, and the Markdown readers the checklist
// and the publish gate share find what the page draws.
// ---------------------------------------------------------------------------

const dir = join(process.cwd(), "supabase/migrations");
const SQL = readFileSync(join(dir, readdirSync(dir).find((f) => /^\d{4}_admin_articles\.sql$/.test(f))!), "utf8");

const VALID = {
  slug: "a-good-slug",
  title: "A title",
  description: "A summary.",
  body: "Body.",
  tags: ["card design"],
  category: "design" as const,
  faq: [],
};

describe("articleInputSchema", () => {
  it("parses a minimal draft and drops empty optionals to null", () => {
    const parsed = articleInputSchema.parse({ ...VALID, seoTitle: "", excerpt: "", coverUrl: "" });
    expect(parsed).toMatchObject({ seoTitle: null, excerpt: null, coverUrl: null, coverAlt: null, authorId: null });
  });

  it("refuses a malformed slug, a cover without alt text and too many tags", () => {
    expect(articleInputSchema.safeParse({ ...VALID, slug: "Not A Slug" }).success).toBe(false);
    expect(articleInputSchema.safeParse({ ...VALID, slug: "double--hyphen" }).success).toBe(false);
    const cover = articleInputSchema.safeParse({ ...VALID, coverUrl: "/article-media/x/y.svg" });
    expect(cover.success).toBe(false);
    expect(cover.error?.issues[0]?.path).toEqual(["coverAlt"]);
    expect(articleInputSchema.safeParse({ ...VALID, tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }).success).toBe(false);
  });

  it("mirrors the migration's CHECKs", () => {
    expect(SQL).toContain(`char_length(slug) between ${ARTICLE_LIMITS.slug.min} and ${ARTICLE_LIMITS.slug.max}`);
    expect(SQL).toContain(`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`);
    expect(SQL).toContain(`char_length(title) between ${ARTICLE_LIMITS.title.min} and ${ARTICLE_LIMITS.title.max}`);
    expect(SQL).toContain(`char_length(seo_title) between ${ARTICLE_LIMITS.seoTitle.min} and ${ARTICLE_LIMITS.seoTitle.max}`);
    expect(SQL).toContain(`char_length(description) between ${ARTICLE_LIMITS.description.min} and ${ARTICLE_LIMITS.description.max}`);
    expect(SQL).toContain(`char_length(excerpt) <= ${ARTICLE_LIMITS.excerpt}`);
    expect(SQL).toContain(`char_length(body) <= ${ARTICLE_LIMITS.body}`);
    expect(SQL).toContain(`cardinality(tags) <= ${ARTICLE_LIMITS.tags}`);
    expect(SQL).toContain(`jsonb_array_length(faq) <= ${ARTICLE_LIMITS.faq}`);
    expect(SQL).toContain(`char_length(cover_alt) <= ${ARTICLE_LIMITS.coverAlt}`);
    expect(SQL).toContain(`char_length(cover_url) <= ${ARTICLE_LIMITS.coverUrl}`);
    expect(SQL).toContain(
      `category in (${ARTICLE_CATEGORY_SLUGS.map((s) => `'${s}'`).join(", ")})`,
    );
  });
});

describe("articleStatus — the RLS release rule", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  it("draft, scheduled, live", () => {
    expect(articleStatus({ is_published: false, publish_at: "2026-10-01T00:00:00Z" }, now)).toBe("draft");
    expect(articleStatus({ is_published: true, publish_at: null }, now)).toBe("draft");
    expect(articleStatus({ is_published: true, publish_at: "2026-11-02T00:00:00Z" }, now)).toBe("scheduled");
    expect(articleStatus({ is_published: true, publish_at: "2026-11-01T12:00:00Z" }, now)).toBe("live");
  });
  it("is the migration's read policy", () => {
    expect(SQL).toContain("using (is_published and publish_at <= now());");
  });
});

describe("the Markdown readers", () => {
  const body = [
    "Lead paragraph here.",
    "",
    "## A section",
    "![Alt one](/article-media/a/b.svg \"Caption\") and [a link](/create).",
    '<Figure src="/article-media/a/c.svg" alt="Alt two" caption="Two" />',
    "```",
    "![not an image](/ignored.png)",
    "```",
  ].join("\n");

  it("finds images (Markdown and <Figure>), skipping fences", () => {
    expect(bodyImages(body)).toEqual([
      { alt: "Alt one", src: "/article-media/a/b.svg", title: "Caption", kind: "markdown" },
      { alt: "Alt two", src: "/article-media/a/c.svg", title: "Two", kind: "figure" },
    ]);
  });

  it("finds links but not images", () => {
    expect(bodyLinks(body)).toEqual([{ text: "a link", href: "/create" }]);
  });

  it("reads the first paragraph, or null when a heading comes first", () => {
    expect(firstParagraph(body)).toBe("Lead paragraph here.");
    expect(firstParagraph("## Heading\n\nText")).toBeNull();
  });

  it("allows https, site paths and anchors only", () => {
    for (const ok of ["https://scryfall.com", "/create", "#faq", "mailto:hi@pipglyph.com"]) {
      expect(isSafeArticleHref(ok), ok).toBe(true);
    }
    for (const bad of ["javascript:alert(1)", "http://x.com", "//evil.example", "/\\evil.example"]) {
      expect(isSafeArticleHref(bad), bad).toBe(false);
    }
  });
});

describe("slugFromTitle and nextOpenSlot", () => {
  it("makes a URL slug from a title", () => {
    expect(slugFromTitle("Naming Custom Cards: What’s in a Name?")).toBe("naming-custom-cards-whats-in-a-name");
    expect(slugFromTitle("Éclair & Ève")).toBe("eclair-eve");
  });

  it("suggests tomorrow when the backlog is empty, else a cadence after the last", () => {
    const now = new Date("2026-11-01T18:30:00Z");
    expect(nextOpenSlot([], now)).toBe("2026-11-02T15:00:00.000Z");
    expect(nextOpenSlot(["2026-11-05T15:00:00Z", "2026-10-01T15:00:00Z"], now)).toBe("2026-11-08T15:00:00.000Z");
  });
});
