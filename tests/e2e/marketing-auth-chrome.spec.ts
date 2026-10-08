import { test, expect, type Page } from "@playwright/test";

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
// A missing card is only a 404 where there is a database to miss it in.
const hasDatabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

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

// The other kind of document. A notFound() thrown above every Suspense
// boundary (the SEO contract: a missing card is a real HTTP 404) is answered
// with Next's empty error shell, and the BROWSER renders the whole document,
// root layout included. React creates the <head> script there but never runs
// it, and writes <html data-theme="dark"> from the layout's props — so a
// light-theme visitor got a dark 404, and dark pages after it until a full
// reload. ThemeRestore (components/layout/theme-restore.tsx) puts the saved
// theme back in the commit that draws the page.
test.describe("saved theme on a 404 the browser renders", () => {
  test.skip(!hasDatabase, "needs the local Supabase stack (.env.e2e)");

  const MISSING_CARD = "/card/nobody-here/no-such-card";

  type Frame = { theme: string | null; drawn: boolean };
  const framesOf = (page: Page) =>
    page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);

  test.beforeEach(async ({ page }) => {
    // Every frame the browser is about to paint: the theme, and whether the
    // page has drawn its content yet (the shell before it is blank).
    await page.addInitScript(() => {
      const frames: { theme: string | null; drawn: boolean }[] = [];
      (window as unknown as { __frames: typeof frames }).__frames = frames;
      const tick = () => {
        frames.push({
          theme: document.documentElement?.getAttribute("data-theme") ?? null,
          drawn: document.querySelector("h1") !== null,
        });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });

  test("a missing card is light from its first frame, and so is the page after it", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "cardforge-theme", value: "light", url: baseURL! },
    ]);
    const response = await page.goto(MISSING_CARD);
    expect(response?.status()).toBe(404);
    // The premise: this HTML carries no theme and nothing that could set one.
    expect(await response!.text()).toContain('<html id="__next_error__">');

    const html = page.locator("html");
    await expect(page.getByRole("heading", { name: /^404/ })).toBeVisible();
    await expect(html).toHaveAttribute("data-theme", "light");
    const frames = await framesOf(page);
    expect(frames.some((frame) => frame.drawn)).toBe(true);
    expect(frames.filter((frame) => frame.drawn && frame.theme !== "light")).toEqual([]);

    // A soft navigation keeps <html>: nothing would set the theme again.
    await page.evaluate(() => {
      (window as unknown as { __sameDocument: boolean }).__sameDocument = true;
    });
    await page.getByRole("link", { name: "Browse gallery", exact: true }).click();
    await page.waitForURL("**/gallery");
    expect(
      await page.evaluate(
        () => (window as unknown as { __sameDocument?: boolean }).__sameDocument,
      ),
    ).toBe(true);
    await expect(html).toHaveAttribute("data-theme", "light");
  });

  test("with no saved theme it stays dark on a light OS; \"system\" follows the OS", async ({
    page,
    context,
    baseURL,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(MISSING_CARD);
    const html = page.locator("html");
    await expect(page.getByRole("heading", { name: /^404/ })).toBeVisible();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect((await framesOf(page)).filter((frame) => frame.drawn && frame.theme !== "dark")).toEqual([]);

    await context.addCookies([
      { name: "cardforge-theme", value: "system", url: baseURL! },
    ]);
    await page.reload();
    await expect(page.getByRole("heading", { name: /^404/ })).toBeVisible();
    await expect(html).toHaveAttribute("data-theme", "light");
    expect((await framesOf(page)).filter((frame) => frame.drawn && frame.theme !== "light")).toEqual([]);
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
