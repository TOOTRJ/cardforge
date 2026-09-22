import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The crawler-facing files. The static layer of the sitemap must be a clean,
// query-free list of real indexable pages with honest dates, and robots.txt
// must never block a page that decides its own indexability with a noindex
// meta (a crawler can only read that tag if it may fetch the page).
// ---------------------------------------------------------------------------

const flags = vi.hoisted(() => ({ billing: true }));

vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => false }));
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => {
    throw new Error("the static layer must not touch the database");
  },
}));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => flags.billing }));
vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://www.pipglyph.com" }));

import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { listArticles } from "@/lib/content/articles";

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
      "/faq",
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
