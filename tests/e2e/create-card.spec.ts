import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Create-card e2e (Phase 11 chunk 16 — scaffolded).
//
// Drives the form's text-only happy path (no upload). Auth-gated, so it
// skips when the Supabase test-user creds aren't set. See tests/README.md.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

test.describe("create a card (text fields only)", () => {
  test.skip(
    !hasCredentials,
    "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.",
  );

  test("fills the form and saves to dashboard", async ({ page }) => {
    // Sign in first.
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(
      process.env.SUPABASE_E2E_USER_EMAIL!,
    );
    await page.locator('input[type="password"]').fill(
      process.env.SUPABASE_E2E_USER_PASSWORD!,
    );
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard");

    // Open the creator.
    await page.goto("/create");
    await expect(
      page.getByRole("heading", { name: /forge a new card/i }),
    ).toBeVisible();

    // Navigate steps via the vertical step rail (xl+ — the default Desktop
    // Chrome viewport is 1280px wide) instead of walking "Next": the sticky
    // bar swaps Next → "Save card" IN PLACE on the last transition, so a
    // Next click racing that swap can land on Save and submit early. Free
    // step jumping is enabled (isStepEnabled: () => true).
    const rail = page.getByRole("navigation", { name: /card editor steps/i });
    await rail.getByRole("button", { name: /^details$/i }).click();

    // Generate a unique title so reruns don't collide on the slug.
    const title = `Test Card ${Date.now()}`;
    await page.locator('input[placeholder="Emberbound Wyrm"]').fill(title);

    // Jump to the Publish step and save.
    await rail.getByRole("button", { name: /^publish$/i }).click();
    const saveButton = page.getByRole("button", { name: /save card/i });
    await expect(saveButton).toBeVisible();

    // dispatchEvent fires the click exactly once: the label swaps to
    // "Saving…" on submit, which detaches the accessible name and would send
    // a regular click() into its retry loop hunting a button that no longer
    // exists.
    await saveButton.dispatchEvent("click");

    // After save, the editor redirects to the slug-edit URL.
    await page.waitForURL(/\/card\/.+\/edit/);
  });
});
