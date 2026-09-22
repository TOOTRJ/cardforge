import { expect, type Page } from "@playwright/test";

// The one sign-in every authed spec uses: the seeded e2e user from .env.e2e
// (scripts/seed-e2e.mjs), landing on the dashboard. Specs used to carry their
// own copy of these lines; keep the login form's selectors here only.
export async function signIn(page: Page): Promise<void> {
  const email = process.env.SUPABASE_E2E_USER_EMAIL;
  const password = process.env.SUPABASE_E2E_USER_PASSWORD;
  expect(email && password, "SUPABASE_E2E_USER_EMAIL / _PASSWORD (from .env.e2e)").toBeTruthy();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email!);
  await page.locator('input[type="password"]').fill(password!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard");
}
