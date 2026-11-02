import "server-only";

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { ArticleInput } from "@/lib/content/article-shared";

// ---------------------------------------------------------------------------
// Draft articles shipped in git — content/article-drafts/*.mdx — for the
// composer's "Import drafts" (lib/content/article-actions.ts) and the seed
// that shows them on previews. They are NOT guides: nothing on the public
// site reads this folder (the MDX guides live in content/articles/). An
// import writes each as a DRAFT composer article; the owner edits, schedules
// and publishes from /admin/articles.
//
// Frontmatter: title, description, tags, category, faq (q/a), and the
// optional seoTitle, excerpt and cover { src, alt, width, height } — the
// composer's own fields. The file name is the slug.
// next.config.ts traces the folder into the /admin/articles function.
// ---------------------------------------------------------------------------

export const ARTICLE_DRAFTS_DIR = path.join(process.cwd(), "content", "article-drafts");

export type ArticleDraftFile = { slug: string; input: ArticleInput };

function faqOf(value: unknown): ArticleInput["faq"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { q: unknown; a: unknown } => typeof item === "object" && item !== null)
    .map((item) => ({ q: String(item.q ?? "").trim(), a: String(item.a ?? "").trim() }))
    .filter((item) => item.q && item.a);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function parseArticleDraft(filename: string, raw: string): ArticleDraftFile | null {
  const slug = filename.replace(/\.mdx$/, "");
  const { data, content } = matter(raw);
  if (!data.title || !data.description) return null;
  const cover = (data.cover ?? null) as Record<string, unknown> | null;
  return {
    slug,
    input: {
      slug,
      title: String(data.title),
      seoTitle: data.seoTitle ? String(data.seoTitle) : undefined,
      description: String(data.description),
      excerpt: data.excerpt ? String(data.excerpt) : undefined,
      body: content.replace(/^\n+/, ""),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      category: typeof data.category === "string" ? (data.category as ArticleInput["category"]) : null,
      faq: faqOf(data.faq),
      coverUrl: cover && typeof cover.src === "string" ? cover.src : undefined,
      coverAlt: cover && typeof cover.alt === "string" ? cover.alt : undefined,
      coverWidth: cover ? numberOrNull(cover.width) : null,
      coverHeight: cover ? numberOrNull(cover.height) : null,
      authorId: null,
    },
  };
}

/** Every draft in the folder, by file name. An unreadable one is skipped. */
export function readArticleDrafts(): ArticleDraftFile[] {
  let files: string[];
  try {
    files = fs.readdirSync(ARTICLE_DRAFTS_DIR).filter((f) => /^[a-z0-9-]+\.mdx$/.test(f)).sort();
  } catch {
    return [];
  }
  const drafts: ArticleDraftFile[] = [];
  for (const file of files) {
    try {
      const draft = parseArticleDraft(file, fs.readFileSync(path.join(ARTICLE_DRAFTS_DIR, file), "utf8"));
      if (draft) drafts.push(draft);
    } catch {
      // skipped
    }
  }
  return drafts;
}
