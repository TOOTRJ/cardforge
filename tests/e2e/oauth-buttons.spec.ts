import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// TODO HM6: /login and /signup offer every configured sign-in provider, one
// named button each, above the email form. Only the buttons — no provider is
// enabled on the local stack, so nothing here leaves the app. The buttons
// render only with Supabase configured (the e2e stack); Discord only where
// NEXT_PUBLIC_AUTH_DISCORD=1 (CI's .env.e2e sets it).
// ---------------------------------------------------------------------------

const hasStack = !!process.env.SUPABASE_E2E_USER_EMAIL;
const discord = process.env.NEXT_PUBLIC_AUTH_DISCORD === "1";

test.describe("OAuth sign-in buttons", () => {
  test.skip(!hasStack, "Needs the local Supabase stack (.env.e2e).");

  for (const path of ["/login", "/signup"]) {
    test(`${path} shows a named button per provider`, async ({ page }) => {
      await page.goto(path);
      const google = page.getByRole("button", { name: "Continue with Google" });
      await expect(google).toBeVisible();
      await expect(google).toBeEnabled();

      const discordButton = page.getByRole("button", { name: "Continue with Discord" });
      if (discord) {
        await expect(discordButton).toBeVisible();
        // The same size as Google's.
        const [g, d] = await Promise.all([google.boundingBox(), discordButton.boundingBox()]);
        expect(d?.width).toBe(g?.width);
        expect(d?.height).toBe(g?.height);
      } else {
        await expect(discordButton).toHaveCount(0);
      }
    });
  }

  test("a cancelled provider sign-in lands on a calm login message", async ({ page }) => {
    await page.goto(
      "/auth/callback?redirectTo=%2Fdecks&error=access_denied&error_description=The+resource+owner+or+authorization+server+denied+the+request",
    );
    await expect(page).toHaveURL(/\/login\?error=oauth-cancelled&redirectTo=%2Fdecks$/);
    await expect(page.getByRole("status").filter({ hasText: "Sign-in was cancelled" })).toBeVisible();
    await expect(page.getByText("That sign-in link didn")).toHaveCount(0);
  });
});
