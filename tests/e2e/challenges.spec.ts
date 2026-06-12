import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Challenges smoke (Community Phase 1) — anonymous flows over the seeded
// "Arcane Frontiers" challenge (supabase/migrations/0040 seeds it, so the
// local stack always has it). No credentials required.
// ---------------------------------------------------------------------------

test("challenges index lists the seeded challenge", async ({ page }) => {
  await page.goto("/challenges");
  await expect(
    page.getByRole("heading", { name: /design challenges/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /arcane frontiers/i }),
  ).toBeVisible();
  // The entry mechanics are stated up front.
  await expect(page.getByText(/days? left/i).first()).toBeVisible();
});

test("challenge detail shows the brief, tag, and entry CTA", async ({
  page,
}) => {
  await page.goto("/challenges/arcane-frontiers");
  await expect(
    page.getByRole("heading", { name: /arcane frontiers/i }),
  ).toBeVisible();
  // The submission tag is displayed and the CTA pre-fills it on /create.
  await expect(page.getByText("arcane-frontiers").first()).toBeVisible();
  const cta = page.getByRole("link", { name: /start designing/i });
  await expect(cta).toHaveAttribute("href", "/create?tag=arcane-frontiers");
  // Entries section renders (empty state or grid).
  await expect(
    page.getByRole("heading", { name: /^entries$/i }),
  ).toBeVisible();
});

test("header navigates to challenges", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /^challenges$/i }).first().click();
  await expect(page).toHaveURL(/\/challenges/);
});
