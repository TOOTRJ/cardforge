import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Auth flows against the LOCAL Supabase stack: signup validation (reserved +
// taken usernames), signup → signed in, password reset through the branded
// email's token-hash link (/auth/confirm), and the redirect guards.
//
// Needs .env.e2e (see tests/README.md). The reset test reads the email from
// the local stack's Mailpit inbox and skips when it isn't reachable.
// ---------------------------------------------------------------------------

const hasStack =
  !!process.env.SUPABASE_E2E_USER_EMAIL && !!process.env.SUPABASE_E2E_USER_PASSWORD;

const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

const runId = Date.now().toString(36);
const newUser = {
  email: `flows-${runId}@example.com`,
  username: `flows_${runId}`,
  password: `first-pass-${runId}`,
  nextPassword: `second-pass-${runId}`,
};

async function fillSignup(
  page: Page,
  values: { email: string; username: string; password: string },
) {
  await page.goto("/signup");
  await page.locator('input[name="email"]').fill(values.email);
  await page.locator('input[name="username"]').fill(values.username);
  await page.locator('input[name="password"]').fill(values.password);
  await page.getByRole("button", { name: /create account/i }).click();
}

/** Newest Mailpit message to `address`, as HTML. */
async function latestEmailHtml(address: string): Promise<string | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    );
    if (search.ok) {
      const body = (await search.json()) as { messages?: { ID: string }[] };
      const id = body.messages?.[0]?.ID;
      if (id) {
        const message = await fetch(`${MAILPIT}/api/v1/message/${id}`);
        if (message.ok) return ((await message.json()) as { HTML: string }).HTML;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

test.describe("auth flows", () => {
  test.skip(!hasStack, "Needs the local Supabase stack (.env.e2e).");
  test.describe.configure({ mode: "serial" });

  test("signup refuses a reserved username", async ({ page }) => {
    await fillSignup(page, { ...newUser, username: "Admin" });
    await expect(page.getByText(/username is reserved/i)).toBeVisible();
  });

  test("signup refuses a username that is taken", async ({ page }) => {
    await fillSignup(page, { ...newUser, username: "e2e_forger" });
    await expect(page.getByText(/username is taken/i)).toBeVisible();
  });

  test("signup creates the account and signs in", async ({ page }) => {
    await fillSignup(page, newUser);
    // Local stack has email confirmation off, so signup signs straight in.
    await page.waitForURL(/\/(dashboard|onboarding)/);
  });

  test("password reset works from the emailed link in a fresh browser", async ({
    page,
    baseURL,
  }) => {
    const reachable = await fetch(`${MAILPIT}/api/v1/info`)
      .then((r) => r.ok)
      .catch(() => false);
    test.skip(!reachable, "Mailpit (local stack inbox) isn't reachable.");

    await page.goto("/forgot-password");
    await page.locator('input[name="email"]').fill(newUser.email);
    await page.getByRole("button", { name: /send reset link/i }).click();
    await page.waitForURL(/\/login\?notice=reset-sent/);

    const html = await latestEmailHtml(newUser.email);
    expect(html, "reset email arrived").toBeTruthy();
    // Branded template, token-hash link — not the default PKCE ?code= link.
    expect(html).toContain("PipGlyph");
    const link = /href="([^"]*\/auth\/confirm\?token_hash=[^"]+)"/.exec(html!)?.[1];
    expect(link, "email links to /auth/confirm").toBeTruthy();

    // The email's origin is the stack's site_url; the path + query are what
    // matter. This page context never requested the reset (no PKCE cookie) —
    // exactly the cross-device case the old flow failed.
    const url = new URL(link!.replace(/&amp;/g, "&"));
    await page.context().clearCookies();
    await page.goto(`${baseURL}${url.pathname}${url.search}`);

    // Nothing is consumed until the button is pressed (mail-scanner safety).
    await page.getByRole("button", { name: /choose a new password/i }).click();
    await page.waitForURL("**/reset-password");
    await page.locator('input[name="password"]').fill(newUser.nextPassword);
    await page.getByRole("button", { name: /update password/i }).click();
    await page.waitForURL(/\/(dashboard|onboarding)/);

    // The link is single-use.
    await page.context().clearCookies();
    await page.goto(`${baseURL}${url.pathname}${url.search}`);
    await page.getByRole("button", { name: /choose a new password/i }).click();
    await expect(page.getByText(/expired or was already used/i)).toBeVisible();
  });

  test("the old password no longer signs in; the new one does", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(newUser.email);
    await page.locator('input[name="password"]').fill(newUser.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();

    await page.locator('input[name="password"]').fill(newUser.nextPassword);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL(/\/(dashboard|onboarding)/);
  });
});

test.describe("password reset gate", () => {
  test("a plain signed-in session gets no reset form — Settings is the current-password path", async ({
    page,
  }) => {
    test.skip(!hasStack, "needs the seeded e2e user (local stack)");
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(process.env.SUPABASE_E2E_USER_EMAIL!);
    await page.locator('input[name="password"]').fill(process.env.SUPABASE_E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL(/\/(dashboard|onboarding)/);

    await page.goto("/reset-password");
    await expect(page.locator('input[name="password"]')).toHaveCount(0);
    await expect(page.getByText(/you're signed in/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /go to settings/i })).toBeVisible();
  });
});

test.describe("redirect guards", () => {
  test.skip(!hasStack, "Needs the local Supabase stack (.env.e2e).");

  test("signed-out visitors keep their destination", async ({ page }) => {
    await page.goto("/notifications");
    await page.waitForURL(/\/login\?redirectTo=%2Fnotifications/);
  });

  test("an off-site redirectTo is ignored after sign-in", async ({ page }) => {
    await page.goto("/login?redirectTo=%2F%2Fevil.example");
    await page
      .locator('input[name="email"]')
      .fill(process.env.SUPABASE_E2E_USER_EMAIL!);
    await page
      .locator('input[name="password"]')
      .fill(process.env.SUPABASE_E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL("**/dashboard");
  });
});
