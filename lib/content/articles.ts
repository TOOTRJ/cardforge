import "server-only";

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Articles — long-form guides as MDX files in content/articles/.
//
// Filesystem-as-CMS: each .mdx file's name is its slug, frontmatter
// carries the metadata, and everything renders fully static at build
// time (generateStaticParams reads this same directory). Adding a guide
// is: drop a file, ship a deploy.
// ---------------------------------------------------------------------------

export type ArticleMeta = {
  slug: string;
  title: string;
  description: string;
  /** ISO date string from frontmatter (publication date). */
  date: string;
  /** ISO date string from optional `updated` frontmatter — feeds
   *  schema.org dateModified so a revised guide signals freshness. */
  updated?: string;
  tags: string[];
  /** Rough read time from word count — display sugar only. */
  readingMinutes: number;
};

/** A tag aggregated across all articles — the unit a cluster hub is built on. */
export type TagInfo = {
  /** Original casing of the first article that used the tag (display label). */
  tag: string;
  /** URL-safe slug, e.g. "card design" → "card-design". */
  slug: string;
  /** How many articles carry the tag. */
  count: number;
};

/** A heading lifted from an article body for the table of contents. */
export type TocItem = {
  depth: 2 | 3;
  text: string;
  /** Anchor id — matches the id the rendered <h2>/<h3> receives. */
  id: string;
};

export type Article = {
  meta: ArticleMeta;
  /** Raw MDX body (frontmatter stripped) for MDXRemote. */
  content: string;
};

const ARTICLES_DIR = path.join(process.cwd(), "content", "articles");

function readArticleFile(filename: string): Article | null {
  const slug = filename.replace(/\.mdx$/, "");
  try {
    const raw = fs.readFileSync(path.join(ARTICLES_DIR, filename), "utf8");
    const { data, content } = matter(raw);
    if (!data.title || !data.description || !data.date) return null;
    const words = content.split(/\s+/).filter(Boolean).length;
    return {
      meta: {
        slug,
        title: String(data.title),
        description: String(data.description),
        date: new Date(data.date as string | Date).toISOString(),
        updated: data.updated
          ? new Date(data.updated as string | Date).toISOString()
          : undefined,
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        readingMinutes: Math.max(1, Math.round(words / 220)),
      },
      content,
    };
  } catch {
    return null;
  }
}

/** All articles, newest first. */
export function listArticles(): ArticleMeta[] {
  let files: string[];
  try {
    files = fs.readdirSync(ARTICLES_DIR).filter((f) => f.endsWith(".mdx"));
  } catch {
    return [];
  }
  return files
    .map(readArticleFile)
    .filter((a): a is Article => a !== null)
    .map((a) => a.meta)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** One article by slug. Slug is validated against the directory listing —
 *  no path segments from user input ever reach the filesystem. */
export function getArticle(slug: string): Article | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    if (!fs.existsSync(path.join(ARTICLES_DIR, `${slug}.mdx`))) return null;
  } catch {
    return null;
  }
  return readArticleFile(`${slug}.mdx`);
}

// ---------------------------------------------------------------------------
// Tags & clusters — the hub-and-spoke layer. A tag is shared across articles
// to form a topical cluster; /articles/tag/[slug] renders the hub. Slugs use
// the GitHub-style algorithm so the SAME function ids article headings (TOC)
// and tag URLs — one source of truth, no drift between the link and the anchor.
// ---------------------------------------------------------------------------

/** Lowercase, collapse non-alphanumerics to single hyphens, trim hyphens. */
export function slugifyTag(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Every tag across all articles, most-used first. */
export function listTags(): TagInfo[] {
  const bySlug = new Map<string, TagInfo>();
  for (const article of listArticles()) {
    for (const tag of article.tags) {
      const slug = slugifyTag(tag);
      if (!slug) continue;
      const existing = bySlug.get(slug);
      if (existing) existing.count += 1;
      else bySlug.set(slug, { tag, slug, count: 1 });
    }
  }
  return Array.from(bySlug.values()).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  );
}

/** Articles carrying a tag (by slug), newest first, plus the display label.
 *  Returns null for an unknown or malformed tag slug so the route can 404. */
export function getArticlesByTag(
  tagSlug: string,
): { label: string; articles: ArticleMeta[] } | null {
  if (!/^[a-z0-9-]+$/.test(tagSlug)) return null;
  const articles = listArticles().filter((a) =>
    a.tags.some((t) => slugifyTag(t) === tagSlug),
  );
  if (articles.length === 0) return null;
  const label = listTags().find((t) => t.slug === tagSlug)?.tag ?? tagSlug;
  return { label, articles };
}

/** Related guides for an article, ranked by shared-tag overlap then recency.
 *  Backfills with newest articles so it always returns up to `limit`. */
export function getRelatedArticles(slug: string, limit = 3): ArticleMeta[] {
  const all = listArticles();
  const current = all.find((a) => a.slug === slug);
  const currentTags = new Set((current?.tags ?? []).map(slugifyTag));
  return all
    .filter((a) => a.slug !== slug)
    .map((a) => ({
      article: a,
      shared: a.tags.reduce(
        (n, t) => n + (currentTags.has(slugifyTag(t)) ? 1 : 0),
        0,
      ),
    }))
    .sort((x, y) => y.shared - x.shared || (x.article.date < y.article.date ? 1 : -1))
    .slice(0, limit)
    .map((s) => s.article);
}

// ---------------------------------------------------------------------------
// Table of contents — parsed from the raw MDX body. We line-scan rather than
// walk a remark AST so there's no extra parse pass and no plugin dependency;
// ids come from slugifyTag, the same function the rendered headings use.
// ---------------------------------------------------------------------------

/** Strip inline Markdown (code, bold, italic, links) to the visible text so
 *  the TOC label and the slug match what the rendered heading shows. */
function stripInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

/** Extract h2/h3 headings from an MDX body, skipping fenced code blocks. */
export function extractToc(content: string): TocItem[] {
  const items: TocItem[] = [];
  let inFence = false;
  for (const raw of content.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = stripInlineMarkdown(match[2]);
    if (!text) continue;
    items.push({
      depth: match[1].length as 2 | 3,
      text,
      id: slugifyTag(text),
    });
  }
  return items;
}
