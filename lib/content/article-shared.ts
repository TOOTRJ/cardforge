import { z } from "zod";
import { ARTICLE_CATEGORY_SLUGS, type ArticleCategorySlug } from "@/lib/content/article-categories";

// ---------------------------------------------------------------------------
// Composer articles — the shared (client-safe) half: the row type, the form
// schema the composer and the server actions both parse (mirroring migration
// 0153's CHECKs), the release status, and the Markdown readers the SEO
// checklist and the server's publish gate share (images, links, headings).
//
// A composer article lives beside the MDX guides in content/articles/: same
// /articles/<slug> URL space, same shelves and tags (lib/content/
// article-catalog.ts merges them). Its body is MDX run with next-mdx-remote's
// default blockJS (components and Markdown, no JS expressions).
// ---------------------------------------------------------------------------

export type ArticleFaqItem = { q: string; a: string };

export type ArticleRow = {
  id: string;
  slug: string;
  title: string;
  seo_title: string | null;
  description: string;
  excerpt: string | null;
  body: string;
  tags: string[];
  category: ArticleCategorySlug | null;
  faq: ArticleFaqItem[];
  cover_url: string | null;
  cover_alt: string | null;
  cover_width: number | null;
  cover_height: number | null;
  author_id: string | null;
  is_published: boolean;
  publish_at: string | null;
  content_updated_at: string | null;
  announced_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The columns every read selects (one list, so a new column is a choice). */
export const ARTICLE_COLUMNS =
  "id, slug, title, seo_title, description, excerpt, body, tags, category, faq, cover_url, cover_alt, cover_width, cover_height, author_id, is_published, publish_at, content_updated_at, announced_at, created_at, updated_at";

// The CHECK constraints of migration 0153, in one place.
export const ARTICLE_LIMITS = {
  slug: { min: 3, max: 90 },
  title: { min: 3, max: 120 },
  seoTitle: { min: 3, max: 70 },
  description: { min: 3, max: 300 },
  excerpt: 400,
  body: 100_000,
  tags: 8,
  tagLength: 40,
  faq: 12,
  faqQuestion: 200,
  faqAnswer: 1200,
  coverAlt: 250,
  coverUrl: 1024,
} as const;

export const ARTICLE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type ArticleStatus = "draft" | "scheduled" | "live";

/** Draft (not published), scheduled (published, release time ahead) or live —
 *  the public rule is migration 0153's RLS: is_published AND publish_at <= now(). */
export function articleStatus(
  row: Pick<ArticleRow, "is_published" | "publish_at">,
  now: Date = new Date(),
): ArticleStatus {
  if (!row.is_published || !row.publish_at) return "draft";
  return new Date(row.publish_at) > now ? "scheduled" : "live";
}

/** A title → a slug candidate (the composer's "from title" button). */
export function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ARTICLE_LIMITS.slug.max)
    .replace(/-+$/g, "");
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

/** What the composer submits (save as draft, schedule, publish). The status
 *  fields are separate actions' business, never this schema's. */
export const articleInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(ARTICLE_LIMITS.slug.min, "The slug needs at least 3 characters.")
    .max(ARTICLE_LIMITS.slug.max)
    .regex(ARTICLE_SLUG, "Lowercase letters, digits and single hyphens only."),
  title: z.string().trim().min(ARTICLE_LIMITS.title.min, "Give it a title.").max(ARTICLE_LIMITS.title.max),
  seoTitle: z
    .string()
    .trim()
    .max(ARTICLE_LIMITS.seoTitle.max, "Search titles are cut past about 60 characters — 70 at most.")
    .optional()
    .transform((v) => (v && v.length >= ARTICLE_LIMITS.seoTitle.min ? v : null)),
  description: z
    .string()
    .trim()
    .min(ARTICLE_LIMITS.description.min, "Write the summary (the meta description).")
    .max(ARTICLE_LIMITS.description.max),
  excerpt: optionalText(ARTICLE_LIMITS.excerpt),
  body: z.string().max(ARTICLE_LIMITS.body),
  tags: z
    .array(z.string().trim().min(1).max(ARTICLE_LIMITS.tagLength))
    .max(ARTICLE_LIMITS.tags, `At most ${ARTICLE_LIMITS.tags} tags.`)
    .transform((tags) => [...new Set(tags)]),
  category: z.enum(ARTICLE_CATEGORY_SLUGS).nullable(),
  faq: z
    .array(
      z.object({
        q: z.string().trim().min(1).max(ARTICLE_LIMITS.faqQuestion),
        a: z.string().trim().min(1).max(ARTICLE_LIMITS.faqAnswer),
      }),
    )
    .max(ARTICLE_LIMITS.faq, `At most ${ARTICLE_LIMITS.faq} questions.`),
  coverUrl: optionalText(ARTICLE_LIMITS.coverUrl),
  coverAlt: optionalText(ARTICLE_LIMITS.coverAlt),
  coverWidth: z.number().int().min(1).max(10_000).nullable().optional().transform((v) => v ?? null),
  coverHeight: z.number().int().min(1).max(10_000).nullable().optional().transform((v) => v ?? null),
  authorId: z.uuid().nullable().optional().transform((v) => v ?? null),
}).refine((v) => !v.coverUrl || Boolean(v.coverAlt), {
  path: ["coverAlt"],
  message: "A cover needs its alt text.",
});

export type ArticleInput = z.input<typeof articleInputSchema>;
export type ParsedArticleInput = z.output<typeof articleInputSchema>;

// ---------------------------------------------------------------------------
// Markdown readers. A line scan, not a parser: the checklist runs on every
// keystroke and the body is the guides' plain Markdown + a few components.
// Fenced code blocks are skipped.
// ---------------------------------------------------------------------------

function withoutFences(body: string): string {
  let inFence = false;
  return body
    .split("\n")
    .filter((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return false;
      }
      return !inFence;
    })
    .join("\n");
}

export type BodyImage = { alt: string; src: string; title: string | null; kind: "markdown" | "figure" };

/** Every picture in a body: Markdown `![alt](src "caption")` and the
 *  `<Figure src="…" alt="…" />` component. */
export function bodyImages(body: string): BodyImage[] {
  const text = withoutFences(body);
  const images: BodyImage[] = [];
  for (const m of text.matchAll(/!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+"([^"]*)")?\s*\)/g)) {
    images.push({ alt: m[1].trim(), src: m[2], title: m[3] ?? null, kind: "markdown" });
  }
  for (const m of text.matchAll(/<Figure\b([^>]*)\/?>/g)) {
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(m[1])?.[1] ?? null;
    images.push({ alt: (attr("alt") ?? "").trim(), src: attr("src") ?? "", title: attr("caption"), kind: "figure" });
  }
  return images;
}

export type BodyLink = { text: string; href: string };

/** Every Markdown link `[text](href)` that isn't an image. */
export function bodyLinks(body: string): BodyLink[] {
  const text = withoutFences(body);
  return [...text.matchAll(/(?<!!)\[([^\]]+)\]\(\s*([^\s)]+)[^)]*\)/g)].map((m) => ({
    text: m[1].trim(),
    href: m[2],
  }));
}

export type BodyHeading = { depth: 1 | 2 | 3 | 4 | 5 | 6; text: string };

export function bodyHeadings(body: string): BodyHeading[] {
  const text = withoutFences(body);
  return [...text.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((m) => ({
    depth: m[1].length as BodyHeading["depth"],
    text: m[2].trim(),
  }));
}

/** The body's prose, roughly as a reader sees it (for word counts and the
 *  answer-first paragraph): no fences, components, images or link targets. */
export function bodyPlainText(body: string): string {
  return withoutFences(body)
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#|]/g, " ");
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/** The first paragraph of prose — the "answer first" a reader (and an
 *  answer engine) meets before any heading. Null when a heading comes first. */
export function firstParagraph(body: string): string | null {
  const blocks = withoutFences(body)
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  for (const block of blocks) {
    if (/^#{1,6}\s/.test(block)) return null;
    if (/^(<|!\[|import |export )/.test(block)) continue;
    return block;
  }
  return null;
}

/** An https URL or a site path (never "//host" or "/\host"). */
export function isSafeArticleHref(href: string): boolean {
  return /^(https:\/\/[^\s]+|\/(?![/\\])[^\s]*|#[^\s]*|mailto:[^\s]+)$/.test(href);
}

/** The backlog's rhythm: one article every few days, at a fixed hour. */
export const BACKLOG_CADENCE_DAYS = 3;
export const BACKLOG_HOUR_UTC = 15;

/**
 * The next open release slot (UTC ISO): BACKLOG_CADENCE_DAYS after the latest
 * scheduled article — or tomorrow when nothing is queued — at
 * BACKLOG_HOUR_UTC. A suggestion; the admin picks any time.
 */
export function nextOpenSlot(scheduledTimes: readonly string[], now: Date = new Date()): string {
  const day = 86_400_000;
  const future = scheduledTimes
    .map((t) => new Date(t).getTime())
    .filter((t) => Number.isFinite(t) && t > now.getTime());
  const base = future.length > 0 ? Math.max(...future) + BACKLOG_CADENCE_DAYS * day : now.getTime() + day;
  const slot = new Date(base);
  slot.setUTCHours(BACKLOG_HOUR_UTC, 0, 0, 0);
  if (slot.getTime() <= now.getTime()) slot.setTime(slot.getTime() + day);
  return slot.toISOString();
}
