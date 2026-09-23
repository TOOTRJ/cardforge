import { expect, type Page } from "@playwright/test";

// The one sign-in every authed spec uses: the seeded e2e users from .env.e2e
// (scripts/seed-e2e.mjs), landing on the dashboard. Specs used to carry their
// own copy of these lines; keep the login form's selectors here only.
//
//   signIn(page)                 → e2e_forger, the ADMIN (fully unlocked)
//   signIn(page, { as: "free" }) → e2e_free, a plain never-subscribed account
//                                  (what a customer sees on /pricing)

export type E2eAccount = "admin" | "free";

/** The seeded account's credentials, or null when .env.e2e isn't set up. */
export function e2eCredentials(as: E2eAccount = "admin"): { email: string; password: string } | null {
  const main = process.env.SUPABASE_E2E_USER_EMAIL;
  const password = process.env.SUPABASE_E2E_USER_PASSWORD;
  if (!main || !password) return null;
  const email =
    as === "free"
      ? process.env.SUPABASE_E2E_FREE_USER_EMAIL || main.replace(/@/, "+free@")
      : main;
  return { email, password };
}

export async function signIn(page: Page, options: { as?: E2eAccount } = {}): Promise<void> {
  const creds = e2eCredentials(options.as);
  expect(creds, "SUPABASE_E2E_USER_EMAIL / _PASSWORD (from .env.e2e)").toBeTruthy();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(creds!.email);
  await page.locator('input[type="password"]').fill(creds!.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard");
}
