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

test("the /learn categories render, index from three guides, and an unknown one is a real 404", async ({
  request,
}) => {
  // Static pages — no database needed.
  const design = await request.get("/learn/design");
  expect(design.status()).toBe(200);
  const html = await design.text();
  expect(html).toMatch(/rel="canonical" href="[^"]*\/learn\/design"/);
  expect(html).not.toMatch(/name="robots" content="noindex/);
  expect(html).toContain('aria-label="Breadcrumb"');
  // One guide on the lore shelf today: rendered, noindex + follow.
  const lore = await (await request.get("/learn/lore")).text();
  expect(lore).toMatch(/name="robots" content="noindex, follow"/);
  for (const path of ["/learn/nope", "/learn/card-design"]) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  }
});

test("the glossary is indexable, self-canonical, and anchors every term", async ({ request }) => {
  // Static — no database needed.
  const response = await request.get("/glossary");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toMatch(/rel="canonical" href="[^"]*\/glossary"/);
  expect(html).not.toMatch(/name="robots" content="noindex/);
  expect(html).toContain('"@type":"DefinedTermSet"');
  expect(html).toContain('aria-label="Breadcrumb"');
  for (const id of ["proxy", "import", "remix", "original", "pip", "mana-value"]) {
    expect(html, id).toContain(`id="${id}"`);
  }
});

test("the glossary filter narrows the terms and a hidden anchor brings them back", async ({ page }) => {
  await page.goto("/glossary");
  const filter = page.getByLabel("Filter terms");
  await filter.fill("cmc");
  await expect(page.locator("#glossary-status")).toHaveText(/^1 of \d+ terms match\.$/);
  await expect(page.locator("#mana-value")).toBeVisible();
  await expect(page.locator("#proxy")).toHaveCount(0);
  // A link to an entry the filter hides clears the filter and lands there.
  await page.evaluate(() => {
    window.location.hash = "proxy";
  });
  await expect(filter).toHaveValue("");
  await expect(page.locator("#proxy")).toBeInViewport();
});

test("retired URLs 308 to living pages", async ({ request }) => {
  for (const [from, to] of [
    ["/preview", "/create"],
    ["/sets", "/decks"],
    ["/set/anything-at-all", "/decks"],
    ["/set/anything/edit", "/decks"],
    ["/pricing-member", "/pricing"],
    // The guide tag hubs that became /learn categories (TODO NV4).
    ["/articles/tag/card-design", "/learn/design"],
    ["/articles/tag/reference", "/learn/reference"],
    ["/articles/tag/card-makers", "/learn/comparisons"],
    ["/articles/tag/lore", "/learn/lore"],
  ]) {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status(), from).toBe(308);
    expect(new URL(response.headers()["location"], "http://x").pathname, from).toBe(to);
  }
});

test("filtered landing URLs 308 to the browse sibling with the query intact; junk params stay on the static page", async ({
  request,
}) => {
  for (const [from, to] of [
    ["/gallery?type=creature&page=2", "/gallery/browse?type=creature&page=2"],
    ["/gallery?q=dragon", "/gallery/browse?q=dragon"],
    ["/decks?format=commander", "/decks/browse?format=commander"],
  ]) {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status(), from).toBe(308);
    const location = new URL(response.headers()["location"], "http://x");
    expect(location.pathname + location.search, from).toBe(to);
  }
  for (const path of ["/gallery?utm_source=x&fbclid=y", "/decks?utm_medium=social"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(200);
  }
  // The bare browse pages are indexable, self-canonical listings; a filtered
  // variant is noindex + follow.
  const bare = await (await request.get("/gallery/browse")).text();
  expect(bare).toMatch(/rel="canonical" href="[^"]*\/gallery\/browse"/);
  expect(bare).not.toMatch(/name="robots" content="noindex/);
  const filtered = await (await request.get("/gallery/browse?type=creature")).text();
  expect(filtered).toMatch(/name="robots" content="noindex, follow"/);
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
