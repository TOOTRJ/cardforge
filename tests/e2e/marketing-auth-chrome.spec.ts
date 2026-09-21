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

// The header theme toggle is gone — Settings is the only place the theme
// changes (components/settings/theme-preference.tsx). What still matters on
// a STATIC page is unchanged: the server HTML is always dark, and the <head>
// no-flash script must restore the saved theme from the cookie before paint.
test.describe("saved theme on a static page", () => {
  test("restores light from the cookie although the HTML ships dark", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.goto("/about");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "dark");

    await context.addCookies([
      { name: "cardforge-theme", value: "light", url: baseURL! },
    ]);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "light");
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
    // The bell is a popover BUTTON (it marks everything seen on open), not a
    // link to /notifications.
    await expect(
      page.getByRole("button", { name: /^notifications/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^sign in$/i }),
    ).toHaveCount(0);

    // And on a fully static page too.
    await page.goto("/about");
    await expect(
      page.getByRole("button", { name: /open account menu/i }),
    ).toBeVisible();
  });

  test("the Settings theme control carries over to static marketing pages", async ({
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

    await page.goto("/settings");
    const html = page.locator("html");
    const theme = page.getByRole("radiogroup", { name: /^theme$/i });
    // Writes the cookie client-side and flips data-theme synchronously.
    await theme.getByRole("radio", { name: /^light$/i }).click();
    await expect(html).toHaveAttribute("data-theme", "light");

    await page.goto("/about");
    await expect(html).toHaveAttribute("data-theme", "light");

    // Put it back — the preference is a cookie, but keep the run tidy.
    await page.goto("/settings");
    await page
      .getByRole("radiogroup", { name: /^theme$/i })
      .getByRole("radio", { name: /^dark$/i })
      .click();
    await expect(html).toHaveAttribute("data-theme", "dark");
  });
});
