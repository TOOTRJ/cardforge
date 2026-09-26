import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listArticles, listTags } from "@/lib/content/articles";

// ---------------------------------------------------------------------------
// Every guide: complete frontmatter, a FAQ block that mirrors the visible
// "## FAQ" section word for word (the FAQPage JSON-LD must never say something
// the page doesn't), internal links that resolve, and none of the product
// claims the 2026-09-22 content refresh retired (sets, tools that never
// shipped, the wrong Card Conjurer date). The same banned list guards the
// FAQ copy and the marketing landing pages.
// ---------------------------------------------------------------------------

const root = process.cwd();
const articlesDir = join(root, "content/articles");
const slugs = new Set(listArticles().map((a) => a.slug));
const tagSlugs = new Set(listTags().map((t) => t.slug));
const routeRoots = new Set(
  ["app/(marketing)", "app/(app)", "app/(auth)"].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("("))
      .map((d) => d.name),
  ),
);

/** Same markdown → plain-text rule the FAQ lift uses. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function faqFromBody(body: string): Array<{ q: string; a: string }> {
  const start = body.search(/^## (FAQ|Frequently asked questions)\s*$/m);
  if (start < 0) return [];
  let section = body.slice(start).replace(/^## [^\n]*\n/, "");
  const next = section.search(/^## /m);
  if (next >= 0) section = section.slice(0, next);
  const out: Array<{ q: string; a: string }> = [];
  let q: string | null = null;
  let buf: string[] = [];
  for (const line of [...section.split("\n"), "### END"]) {
    if (line.startsWith("### ")) {
      if (q !== null) out.push({ q: plain(q), a: plain(buf.join(" ")) });
      q = line.slice(4).trim();
      buf = [];
    } else if (q !== null && line.trim()) {
      buf.push(line.trim());
    }
  }
  return out;
}

const BANNED = [
  /booster simulator/i,
  /expansion[- ]set builder/i,
  /\bset building\b/i,
  /set management/i,
  /balance check/i,
  /late 2023/i,
  /Discontinued \(2023\)/,
  /\(\/preview\)/,
  /sets index/i,
  // The editor preview and the saved image come from two renderers kept in
  // step by parity tests (TODO 0.24) — never "one renderer", "the same
  // layout engine" or "pixel for pixel".
  /\bone renderer\b/i,
  /pixel[- ]for[- ]pixel/i,
  /same (layout engine|renderer)/i,
];

describe("guides", () => {
  const files = readdirSync(articlesDir).filter((f) => f.endsWith(".mdx"));

  it("are all indexed and each has complete frontmatter", () => {
    expect(files).toHaveLength(slugs.size);
    for (const article of listArticles()) {
      expect(article.title, article.slug).toBeTruthy();
      expect(article.description, article.slug).toBeTruthy();
      expect(article.date, article.slug).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(article.tags.length, article.slug).toBeGreaterThan(0);
      expect(article.faq?.length ?? 0, `${article.slug} has FAQPage entries`).toBeGreaterThan(0);
    }
  });

  it("carry a FAQ block that mirrors the visible FAQ section exactly", () => {
    for (const article of listArticles()) {
      const body = readFileSync(join(articlesDir, `${article.slug}.mdx`), "utf8").replace(
        /^---[\s\S]*?\n---\n/,
        "",
      );
      expect(article.faq, article.slug).toEqual(faqFromBody(body));
    }
  });

  it("use tags shared by at least one other guide, or a defined cluster", () => {
    const counts = new Map<string, number>();
    for (const article of listArticles()) {
      for (const tag of article.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    for (const [tag, count] of counts) {
      // "card makers" is a cluster with a single member today — allowed.
      if (tag === "card makers") continue;
      expect(count, `tag "${tag}" is a one-off hub`).toBeGreaterThanOrEqual(2);
    }
  });

  it("only link to pages that exist", () => {
    for (const file of files) {
      const raw = readFileSync(join(articlesDir, file), "utf8");
      for (const match of raw.matchAll(/\]\((\/[^)\s#?]*)/g)) {
        const path = match[1];
        const segments = path.split("/").filter(Boolean);
        if (segments[0] === "articles") {
          if (segments.length === 1) continue;
          if (segments[1] === "tag") {
            expect(tagSlugs.has(segments[2]), `${file} → ${path}`).toBe(true);
          } else {
            expect(slugs.has(segments[1]), `${file} → ${path}`).toBe(true);
          }
        } else if (segments.length > 0) {
          expect(routeRoots.has(segments[0]), `${file} → ${path}`).toBe(true);
        }
      }
    }
  });
});

describe("retired product claims", () => {
  const sources = [
    ...readdirSync(articlesDir).map((f) => join(articlesDir, f)),
    join(root, "lib/content/faq.ts"),
    join(root, "lib/billing/plans.ts"),
    ...readdirSync(join(root, "components/marketing"))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => join(root, "components/marketing", f)),
    ...["about", "press", "faq", "mtg-card-maker", "ai-mtg-card-generator", "best-mtg-card-makers", "privacy", "terms"].map(
      (page) => join(root, `app/(marketing)/${page}/page.tsx`),
    ),
  ].filter((p) => existsSync(p));

  it("appear nowhere in the guides, the FAQ copy, the landing pages or the marketing components", () => {
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const pattern of BANNED) {
        expect(text, `${file.slice(root.length + 1)} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
