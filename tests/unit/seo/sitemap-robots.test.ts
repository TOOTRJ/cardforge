import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The crawler-facing files. The static layer of the sitemap must be a clean,
// query-free list of real indexable pages with honest dates, and robots.txt
// must never block a page that decides its own indexability with a noindex
// meta (a crawler can only read that tag if it may fetch the page).
// ---------------------------------------------------------------------------

const flags = vi.hoisted(() => ({ billing: true }));
// What /creators, /frames and /frames/requested read (their own pages decide
// their robots on the same answers): none, offline, unless a test sets them.
const community = vi.hoisted(() => ({
  creators: { creators: [] as unknown[], total: 0, error: "offline" as string | null },
  gallery: { sections: [] as Array<{ id: string; entries: unknown[] }>, error: "offline" as string | null },
  frames: { frames: [] as unknown[], error: "offline" as string | null },
}));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => false }));
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => {
    throw new Error("the static layer must not touch the database");
  },
}));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => flags.billing }));
vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));
vi.mock("@/lib/creators/queries", () => ({ listPublicCreators: async () => community.creators }));
vi.mock("@/lib/frames/requested-frames-queries", () => ({ getRequestedFrames: async () => community.frames }));
vi.mock("@/lib/frames/frame-gallery-queries", () => ({ getFrameGalleryFrames: async () => community.gallery }));

import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { listArticles, listCategoryShelves } from "@/lib/content/articles";
import { CATEGORY_MIN_ARTICLES } from "@/lib/content/article-categories";
import { HELP_SECTION_SLUGS } from "@/lib/content/help";

const BASE = "https://www.pipglyph.com";
const pathOf = (url: string) => url.slice(BASE.length) || "/";

describe("sitemap (static layer)", () => {
  it("emits only query-free absolute URLs on the site host", async () => {
    const entries = await sitemap();
    expect(entries.length).toBeGreaterThan(30);
    for (const entry of entries) {
      expect(entry.url.startsWith(BASE)).toBe(true);
      expect(entry.url).not.toContain("?");
      expect(entry.url).not.toContain("&");
    }
  });

  it("lists every public landing page, /news, /create and every guide", async () => {
    const paths = new Set((await sitemap()).map((e) => pathOf(e.url)));
    for (const path of [
      "/",
      "/mtg-card-maker",
      "/ai-mtg-card-generator",
      "/mana-pip-editor",
      "/best-mtg-card-makers",
      "/create",
      "/gallery",
      "/decks",
      "/challenges",
      "/help",
      "/articles",
      "/news",
      "/about",
    ]) {
      expect(paths.has(path), path).toBe(true);
    }
    for (const article of listArticles()) {
      expect(paths.has(`/articles/${article.slug}`), article.slug).toBe(true);
    }
  });

  it("lists /learn, /tools, /glossary and the indexable categories — never a thin one or a tag hub that 308s", async () => {
    const paths = new Set((await sitemap()).map((e) => pathOf(e.url)));
    expect(paths.has("/learn")).toBe(true);
    expect(paths.has("/tools")).toBe(true);
    expect(paths.has("/glossary")).toBe(true);
    for (const { category, articles } of listCategoryShelves()) {
      expect(paths.has(`/learn/${category.slug}`), category.slug).toBe(
        articles.length >= CATEGORY_MIN_ARTICLES,
      );
      expect(paths.has(`/articles/tag/${category.tagSlug}`), category.tagSlug).toBe(false);
    }
    // The hubs that still stand stay listed.
    expect(paths.has("/articles/tag/oracle-text")).toBe(true);
  });

  it("lists /creators and /frames/requested only while their own pages are indexable, never /creators/browse", async () => {
    const pathsNow = async () => new Set((await sitemap()).map((e) => pathOf(e.url)));
    // Offline (or the directory function missing): both pages are noindex.
    let paths = await pathsNow();
    expect(paths.has("/creators")).toBe(false);
    expect(paths.has("/frames/requested")).toBe(false);

    community.creators = { creators: [{ id: "x" }], total: 1, error: null };
    community.frames = { frames: [{}, {}], error: null };
    paths = await pathsNow();
    expect(paths.has("/creators")).toBe(true);
    expect(paths.has("/creators/browse")).toBe(false);
    // Two frames is below the bar (REQUESTED_FRAMES_MIN_INDEXED, 3).
    expect(paths.has("/frames/requested")).toBe(false);

    community.frames = { frames: [{}, {}, {}], error: null };
    expect((await pathsNow()).has("/frames/requested")).toBe(true);

    community.creators = { creators: [], total: 0, error: null };
    community.frames = { frames: [], error: "offline" };
    expect((await pathsNow()).has("/creators")).toBe(false);
  });

  it("lists /frames only while its own page is indexable", async () => {
    const pathsNow = async () => new Set((await sitemap()).map((e) => pathOf(e.url)));
    expect((await pathsNow()).has("/frames")).toBe(false);
    // Two frames is below the bar (FRAME_GALLERY_MIN_INDEXED, 3).
    community.gallery = { sections: [{ id: "m15", entries: [{}, {}] }], error: null };
    expect((await pathsNow()).has("/frames")).toBe(false);
    community.gallery = { sections: [{ id: "m15", entries: [{}, {}] }, { id: "retro", entries: [{}] }], error: null };
    expect((await pathsNow()).has("/frames")).toBe(true);
    community.gallery = { sections: [], error: "unavailable" };
    expect((await pathsNow()).has("/frames")).toBe(false);
  });

  it("lists the help centre and every section — never /faq, which 308s there", async () => {
    const paths = new Set((await sitemap()).map((e) => pathOf(e.url)));
    expect(paths.has("/help")).toBe(true);
    for (const slug of HELP_SECTION_SLUGS) expect(paths.has(`/help/${slug}`), slug).toBe(true);
    expect(paths.has("/faq")).toBe(false);
  });

  it("never lists a removed sets URL or an auth-only surface", async () => {
    const paths = (await sitemap()).map((e) => pathOf(e.url));
    for (const path of paths) {
      expect(path, path).not.toMatch(/^\/sets?(\/|$)/);
      expect(path, path).not.toMatch(/^\/(dashboard|settings|admin|api|onboarding)(\/|$)/);
    }
  });

  it("dates only what has a real date: guides carry frontmatter, static pages carry nothing", async () => {
    const entries = await sitemap();
    const byPath = new Map(entries.map((e) => [pathOf(e.url), e]));
    for (const path of ["/", "/mtg-card-maker", "/gallery", "/news", "/articles", "/about"]) {
      expect(byPath.get(path)?.lastModified, `${path} must not be stamped with "now"`).toBeUndefined();
    }
    const [article] = listArticles();
    const entry = byPath.get(`/articles/${article.slug}`);
    expect(entry?.lastModified).toEqual(new Date(article.updated ?? article.date));
  });

  it("advertises /pricing only while billing is on (it 404s otherwise)", async () => {
    flags.billing = true;
    expect((await sitemap()).some((e) => pathOf(e.url) === "/pricing")).toBe(true);
    flags.billing = false;
    expect((await sitemap()).some((e) => pathOf(e.url) === "/pricing")).toBe(false);
    flags.billing = true;
  });
});

describe("robots", () => {
  const config = robots();
  const rule = Array.isArray(config.rules) ? config.rules[0] : config.rules;
  const disallow = ([] as string[]).concat(rule.disallow ?? []);
  const allow = ([] as string[]).concat(rule.allow ?? []);

  it("addresses every crawler with one rule, so AI answer engines inherit it", () => {
    expect(Array.isArray(config.rules) ? config.rules : [config.rules]).toHaveLength(1);
    expect(rule.userAgent).toBe("*");
    expect(config.sitemap).toBe(`${BASE}/sitemap.xml`);
  });

  it("keeps the guest creator crawlable and blocks only auth-only surfaces", () => {
    expect(disallow).not.toContain("/create");
    for (const path of ["/api/", "/dashboard", "/settings", "/admin", "/card/*/edit", "/deck/*/edit"]) {
      expect(disallow, path).toContain(path);
    }
    for (const path of disallow) expect(path, path).not.toMatch(/\/sets?\b/);
    expect(allow).toEqual(expect.arrayContaining(["/", "/api/oembed", "/api/cards/*/og"]));
  });
});
