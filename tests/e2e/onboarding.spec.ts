import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// First-run onboarding against the LOCAL Supabase stack: a fresh signup is
// sent to /onboarding, claims a handle, keeps the dealt built-in art, opts
// into the newsletter, and lands on the dashboard; the wizard never shows
// again; settings reflect the choices; the public profile renders the
// built-in banner.
// ---------------------------------------------------------------------------

const hasStack =
  !!process.env.SUPABASE_E2E_USER_EMAIL && !!process.env.SUPABASE_E2E_USER_PASSWORD;

const runId = Date.now().toString(36);
const user = {
  email: `onboard-${runId}@example.com`,
  username: `onboard_${runId}`,
  handle: `claimed_${runId}`,
  password: `onboard-pass-${runId}`,
};

test.describe("onboarding", () => {
  test.skip(!hasStack, "Needs the local Supabase stack (.env.e2e).");
  test.describe.configure({ mode: "serial" });

  test("a new account is walked through the wizard once", async ({ page }) => {
    await page.goto("/signup");
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="username"]').fill(user.username);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole("button", { name: /create account/i }).click();
    await page.waitForURL("**/onboarding");

    // Step 1 — the signup handle is prefilled; claim a different one.
    const username = page.locator('input[name="username"]');
    await expect(username).toHaveValue(user.username);
    await username.fill(user.handle);
    await expect(page.getByText(/^available\.$/i)).toBeVisible();
    await page.locator('input[name="display_name"]').fill("Claimed Forger");
    await page.getByRole("button", { name: /save and continue/i }).click();

    // Step 2 — built-in art was dealt at signup; shuffle keeps it built-in.
    await expect(page.getByRole("heading", { name: /choose your look/i })).toBeVisible();
    await expect(page.getByText("built-in").first()).toBeVisible();
    await page.getByRole("button", { name: /shuffle/i }).first().click();
    await expect(page.getByText("Saving…")).toHaveCount(0);
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 3 — newsletter is opt-in (unchecked) until the user says so.
    const newsletter = page.locator("#email-pref-newsletter");
    await expect(newsletter).not.toBeChecked();
    await newsletter.check();
    await page.getByRole("button", { name: /^finish$/i }).click();
    await page.waitForURL("**/dashboard");

    // Never again.
    await page.goto("/onboarding");
    await page.waitForURL("**/dashboard");
  });

  test("settings and the public profile reflect the choices", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/settings");
    await expect(page.locator('input[name="username"]')).toHaveValue(user.handle);
    await expect(page.locator("#email-pref-newsletter")).toBeChecked();
    await expect(page.locator("#email-pref-activity")).toBeChecked();

    await page.goto(`/profile/${user.handle}`);
    await expect(page.getByText("Claimed Forger").first()).toBeVisible();
    const banner = page.locator('img[src^="/defaults/banners/"]').first();
    await expect(banner).toBeVisible();
  });

  test("the unsubscribe page refuses an incomplete link", async ({ page }) => {
    await page.goto("/unsubscribe?token=nope&list=newsletter");
    await expect(page.getByText(/link isn't complete/i)).toBeVisible();
  });
});
