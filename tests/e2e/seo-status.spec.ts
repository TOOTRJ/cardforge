import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Crawler-facing behaviour, no login needed: unknown public URLs must be real
// 404s (a 200 with a "not found" body is a soft-404 engines keep recrawling),
// retired URLs must redirect, and the crawler files must describe the live
// site. The 404 checks need a database — the seeded local stack in CI.
// ---------------------------------------------------------------------------

const hasDatabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

test.describe("unknown public pages are real 404s", () => {
  test.skip(!hasDatabase, "needs the local Supabase stack (.env.e2e)");
  for (const path of [
    "/card/nobody-here/no-such-card",
    "/card/no-such-legacy-slug",
    "/deck/no-such-deck",
    "/profile/nobody-here",
    "/challenges/no-such-challenge",
  ]) {
    test(path, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(404);
    });
  }
});

test.describe("browse hubs", () => {
  test.skip(!hasDatabase, "needs the local Supabase stack (.env.e2e)");
  test("type and format hubs render; unknown tags and the legacy type are 404s", async ({ request }) => {
    for (const path of ["/gallery/type/creature", "/decks/format/commander"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(await response.text()).toContain("<h1");
    }
    for (const path of ["/gallery/tag/no-such-tag-ever", "/gallery/type/spell", "/decks/format/nope"]) {
      expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
    }
  });
});

test("retired URLs 308 to living pages", async ({ request }) => {
  for (const [from, to] of [
    ["/preview", "/create"],
    ["/sets", "/decks"],
    ["/set/anything-at-all", "/decks"],
    ["/set/anything/edit", "/decks"],
  ]) {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status(), from).toBe(308);
    expect(new URL(response.headers()["location"], "http://x").pathname, from).toBe(to);
  }
});

test("robots.txt keeps /create crawlable, blocks auth surfaces, names the sitemap", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text).toContain("Sitemap:");
  expect(text).toContain("Disallow: /dashboard");
  expect(text).not.toContain("Disallow: /create");
  expect(text).not.toMatch(/\/sets?\b/);
});

test("sitemap.xml is query-free and lists the public surfaces", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  expect(xml).toContain("<urlset");
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  expect(locs.length).toBeGreaterThan(30);
  expect(locs.some((loc) => loc.endsWith("/news"))).toBe(true);
  expect(locs.some((loc) => loc.endsWith("/create"))).toBe(true);
  for (const loc of locs) {
    expect(loc, loc).not.toContain("?");
    expect(loc, loc).not.toMatch(/\/sets?(\/|$)/);
  }
});

test("llms.txt is generated from the live site map", async ({ request }) => {
  const response = await request.get("/llms.txt");
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text).toContain("/decks");
  expect(text).toContain("/articles/");
  expect(text).not.toMatch(/expansion[- ]set|\/preview\b/i);
});

test("the IndexNow key file stays private without a key", async ({ request }) => {
  const response = await request.get("/indexnow-key.txt");
  expect(response.status()).toBe(404);
});
