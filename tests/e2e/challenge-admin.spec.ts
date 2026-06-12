import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Challenge admin e2e — the seeded e2e user is an admin on the LOCAL stack
// (scripts/seed-e2e.mjs sets profiles.is_admin), so this drives the real
// authoring flow: create through the UI → live on /challenges → close it.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

test.describe("challenge admin", () => {
  test.skip(
    !hasCredentials,
    "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.",
  );

  test("create through the UI → appears on /challenges → close it", async ({
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

    await page.goto("/admin/challenges");
    await expect(
      page.getByRole("heading", { name: /design challenges/i }),
    ).toBeVisible();

    // Unique title so reruns never collide on the derived slug.
    const stamp = Date.now();
    const title = `E2E Trial ${stamp}`;
    await page.locator('input[name="title"]').fill(title);
    // The tag auto-derives from the title; assert the derivation worked.
    await expect(page.locator('input[name="tag"]')).toHaveValue(
      `e2e-trial-${stamp}`,
    );
    await page
      .locator('textarea[name="description"]')
      .fill("An automated proving ground. Design anything; the suite is watching.");
    // Don't steal the gallery banner from the seeded featured challenge.
    await page.locator('input[name="featured"]').uncheck();
    await page.getByRole("button", { name: /create challenge/i }).click();
    await expect(page.getByText(/challenge created/i)).toBeVisible({
      timeout: 15_000,
    });

    // It's live on the public surfaces.
    await page.goto(`/challenges/e2e-trial-${stamp}`);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // Close it from the admin list so old runs don't pile up as "active".
    await page.goto("/admin/challenges");
    await page
      .getByRole("link", { name: title })
      .locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")
      .getByRole("button", { name: /close now/i })
      .click();
    await expect(page.getByText(/challenge closed/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
