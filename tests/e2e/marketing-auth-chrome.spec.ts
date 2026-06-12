import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Marketing auth chrome (perf PR D).
//
// Marketing pages render a static anonymous header; the SiteHeaderClient
// island fetches /api/me post-hydration and swaps in the signed-in
// chrome. These specs pin both halves: anonymous visitors keep the
// sign-in CTA, and signed-in users get their account menu + bell on
// marketing routes even though the page HTML is anonymous.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

test.describe("marketing header — anonymous", () => {
  test("shows the sign-in CTA and no account menu", async ({ page }) => {
    await page.goto("/about");
    await expect(
      page.getByRole("link", { name: /sign in/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /open account menu/i }),
    ).toHaveCount(0);
  });
});

test.describe("theme toggle on a static page", () => {
  test("cycles to light, persists across reload via cookie", async ({
    page,
  }) => {
    await page.goto("/about");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "dark");

    // dark → light. The toggle writes the cookie client-side and updates
    // data-theme synchronously.
    await page.getByRole("button", { name: /theme: dark/i }).click();
    await expect(html).toHaveAttribute("data-theme", "light");

    // Reload: the server HTML is always dark; the <head> no-flash script
    // must restore light from the cookie before paint.
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(
      page.getByRole("button", { name: /theme: light/i }),
    ).toBeVisible();
  });
});

test.describe("marketing header — signed in", () => {
  test.skip(
    !hasCredentials,
    "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.",
  );

  test("auth island swaps in account menu + bell on marketing pages", async ({
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

    // Marketing home: HTML is anonymous; the island must swap in the
    // signed-in chrome after /api/me resolves.
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /open account menu/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /notifications/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^sign in$/i }),
    ).toHaveCount(0);

    // And on a fully static page too.
    await page.goto("/about");
    await expect(
      page.getByRole("button", { name: /open account menu/i }),
    ).toBeVisible();
  });
});
