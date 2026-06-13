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
  tags: string[];
  /** Rough read time from word count — display sugar only. */
  readingMinutes: number;
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
