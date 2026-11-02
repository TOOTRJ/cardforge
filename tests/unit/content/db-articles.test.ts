import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, chainClient } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The public reads of composer articles (lib/content/db-articles.ts):
//   * the LIST cache keeps no body (an unstable_cache entry holds 2 MB at
//     most) — only the list columns and the word count;
//   * the page reads its one article, body included, by slug;
//   * a database without the table (0160 not applied) is "no articles",
//     quietly, whether Postgres (42P01) or PostgREST (PGRST205) says so.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("@/tests/stubs/supabase-chain").chainClient>,
  cached: [] as unknown[],
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => state.db.client }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.db.client }));
vi.mock("next/cache", () => ({
  // Record what the cache would KEEP.
  unstable_cache:
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A) => {
      const value = await fn(...args);
      state.cached.push(value);
      return value;
    },
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

import {
  getReleasedComposerArticle,
  isMissingArticlesTable,
  listReleasedComposerArticles,
} from "@/lib/content/db-articles";

const ROW = {
  id: "a1",
  slug: "a-guide",
  title: "A guide",
  seo_title: null,
  description: "A summary.",
  excerpt: null,
  body: Array.from({ length: 440 }, () => "craft").join(" "),
  tags: ["naming"],
  category: "design",
  faq: [],
  cover_url: null,
  cover_alt: null,
  cover_width: null,
  cover_height: null,
  author_id: null,
  is_published: true,
  publish_at: "2026-11-01T15:00:00Z",
  content_updated_at: null,
  announced_at: "2026-11-01T15:00:00Z",
  first_published_at: "2026-11-01T15:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};

beforeEach(() => {
  state.cached = [];
});

describe("composer article reads", () => {
  it("caches the list without any body, with each body's reading time", async () => {
    state.db = chainClient(() => ({ data: [ROW] }));
    const list = await listReleasedComposerArticles();
    expect(list[0].meta).toMatchObject({ slug: "a-guide", wordCount: 440, readingMinutes: 2 });
    expect(list[0].content).toBe("");
    expect(JSON.stringify(state.cached)).not.toContain("craft craft");
  });

  it("reads the page's article, body included, by slug", async () => {
    state.db = chainClient((_t, calls) => (called(calls, "maybeSingle") ? { data: ROW } : { data: null }));
    const article = await getReleasedComposerArticle("a-guide");
    expect(article?.content).toBe(ROW.body);
    expect(state.db.forTable("articles")[0].calls.find((c) => c.method === "eq")?.args).toEqual(["slug", "a-guide"]);
  });

  it.each(["42P01", "PGRST205"])("reads a missing table (%s) as no articles, without a warning", async (code) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.db = chainClient(() => ({ error: { message: "relation does not exist", code } }));
    expect(await listReleasedComposerArticles()).toEqual([]);
    expect(await getReleasedComposerArticle("a-guide")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("knows both codes, and nothing else", () => {
    expect(isMissingArticlesTable({ code: "42P01" })).toBe(true);
    expect(isMissingArticlesTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingArticlesTable({ code: "42501" })).toBe(false);
    expect(isMissingArticlesTable(null)).toBe(false);
  });
});
