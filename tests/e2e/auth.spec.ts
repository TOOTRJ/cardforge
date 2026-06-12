import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Auth e2e (Phase 11 chunk 16 — scaffolded).
//
// Requires a Supabase test project. Skips unconditionally when
// SUPABASE_E2E_USER_EMAIL / PASSWORD aren't set. See tests/README.md
// for the env-var contract.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

test.describe("signup → login → logout", () => {
  test.skip(
    !hasCredentials,
    "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.",
  );

  test("signs in with seeded credentials and reaches the dashboard", async ({
    page,
  }) => {
    await page.goto("/login");
    await page
      .locator('input[type="email"]')
      .fill(process.env.SUPABASE_E2E_USER_EMAIL!);
    await page
      .locator('input[type="password"]')
      .fill(process.env.SUPABASE_E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL("**/dashboard");
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  });

  test("logout returns to the marketing home", async ({ page }) => {
    // Fresh context per test (storageState: undefined), so sign in first.
    await page.goto("/login");
    await page
      .locator('input[type="email"]')
      .fill(process.env.SUPABASE_E2E_USER_EMAIL!);
    await page
      .locator('input[type="password"]')
      .fill(process.env.SUPABASE_E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard");

    // Sign out lives inside the account-menu popover.
    await page.getByRole("button", { name: /open account menu/i }).click();
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL((url) => url.pathname === "/");
  });
});
