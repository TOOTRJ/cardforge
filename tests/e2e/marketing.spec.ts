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
  // Logo + "Start creating" CTA — defining elements of the marketing
  // header for an anonymous viewer.
  await expect(page.getByRole("link", { name: /cardforge/i }).first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: /start creating/i }).first(),
  ).toBeVisible();
});

test("gallery link routes from header", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /gallery/i }).first().click();
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
