import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Marketing smoke (Phase 11 chunk 16).
//
// The only e2e spec that runs unconditionally. Verifies the public site
// chrome (header, nav, footer) renders and a logged-out user can reach
// the gallery and the create-account CTA. No Supabase env vars needed
// — the app degrades gracefully when Supabase is unconfigured.
// ---------------------------------------------------------------------------

test("homepage renders the marketing chrome", async ({ page }) => {
  await page.goto("/");
  // Logo + "Create a card" — the header's one start button (TODO NV1; it
  // replaced "Create" and "Start creating") — and the grouped nav.
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: /pipglyph/i })).toBeVisible();
  await expect(header.getByRole("link", { name: "Create a card" })).toHaveAttribute("href", "/create");
  await expect(header.getByRole("button", { name: "Community" })).toBeVisible();
  await expect(header.getByRole("button", { name: "Learn" })).toBeVisible();
});

test("gallery link routes from the header's Community panel", async ({ page }) => {
  await page.goto("/");
  const header = page.getByRole("banner");
  const community = header.getByRole("button", { name: "Community" });
  await community.click();
  await expect(community).toHaveAttribute("aria-expanded", "true");
  await header.getByRole("link", { name: /card gallery/i }).click();
  await expect(page).toHaveURL(/\/gallery/);
  // The community gallery heading should land — even when no cards
  // populate the grid, the header renders.
  await expect(
    page.getByRole("heading", { name: /community gallery/i }),
  ).toBeVisible();
});

test("sign-in page loads and shows email input", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

// TODO HM5: on a phone the hero's "Make a card — free" button is on the
// FIRST screen, with no scrolling. Asserted at 390 × 844, where it clears the
// fold by about 70 px with the site-update ribbon showing (local stack,
// 2026-11-04: bottom at 773). 360 × 780 is on screen too, but by 7 px with
// the ribbon — too close for fonts that rasterise differently across
// platforms — and 320 × 640 never fits (bottom at 720 with neither the ribbon
// nor the hero card), so neither is asserted.
test("the hero's create button is on a 390 × 844 phone's first screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const create = page.getByRole("main").getByRole("link", { name: /make a card/i }).first();
  await expect(create).toBeVisible();
  const box = await create.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
});
