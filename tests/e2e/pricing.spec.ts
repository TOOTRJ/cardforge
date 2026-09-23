import { test, expect } from "@playwright/test";
import { signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// Pricing page e2e. The anonymous half is hermetic (no auth, no Stripe). The
// signed-in half uses the seeded e2e user (free, never subscribed, no Stripe
// customer) on the local stack, where Stripe is NOT configured: a click on a
// checkout button must reach the server action and surface its "Billing
// isn't available" answer — proof the button is wired end to end, which is
// what the 2026-09-22 "buttons don't work" report was missing.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL && !!process.env.SUPABASE_E2E_USER_PASSWORD;

test.describe("pricing page", () => {
  // The whole paid layer is hidden behind NEXT_PUBLIC_BILLING_ENABLED; when it's
  // off (the default) /pricing 404s, so only run these when billing is on.
  test.skip(
    process.env.NEXT_PUBLIC_BILLING_ENABLED !== "true",
    "Billing is disabled — pricing page is hidden.",
  );

  test("shows the three tiers and toggles monthly ↔ annual", async ({ page }) => {
    await page.goto("/pricing");

    await expect(
      page.getByRole("heading", { name: /legendary tools/i }),
    ).toBeVisible();

    for (const name of ["Free", "Plus", "Pro"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }

    // Monthly is the default.
    await expect(page.getByText("/ month").first()).toBeVisible();

    // Anonymous visitors get the signup CTA, not a checkout button.
    await expect(
      page.getByRole("link", { name: /get started free/i }),
    ).toBeVisible();

    // Toggle to annual → prices reprice to /year with the "2 months free" note.
    await page.getByRole("tab", { name: /annual/i }).click();
    await expect(page.getByText("/ year").first()).toBeVisible();
    await expect(page.getByText(/2 months free/i).first()).toBeVisible();
  });

  test("credit packs are available to everyone", async ({ page }) => {
    await page.goto("/pricing");
    await expect(
      page.getByRole("heading", { name: /need a top-up/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /buy 100 credits/i }),
    ).toBeVisible();
  });
});

test.describe("pricing page — signed in", () => {
  test.skip(
    process.env.NEXT_PUBLIC_BILLING_ENABLED !== "true" || !hasCredentials,
    "Needs billing enabled and the seeded e2e users (.env.e2e).",
  );

  test("a free account sees its plan badge and trial checkouts, and a click reaches the checkout action", async ({
    page,
  }) => {
    await signIn(page, { as: "free" });
    await page.goto("/pricing");
    await expect(page.getByText("Your current plan")).toBeVisible();
    await expect(page.getByRole("button", { name: /try plus free for 7 days/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /try pro free for 7 days/i })).toBeVisible();
    // No Stripe customer → nothing to manage: the portal button must not
    // appear (it could only fail).
    await expect(page.getByRole("button", { name: /manage plan/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /get started free/i })).toHaveCount(0);

    await page.getByRole("button", { name: /try plus free for 7 days/i }).click();
    await expect(page.getByText(/billing isn't available right now/i).first()).toBeVisible();

    await page.getByRole("button", { name: /buy 30 credits/i }).click();
    await expect(page.getByText(/billing isn't available right now/i).first()).toBeVisible();
  });

  test("settings, the dashboard credits card and the header all lead a free account to /pricing", async ({
    page,
  }) => {
    await signIn(page, { as: "free" });
    await expect(page.getByRole("link", { name: /^upgrade$/i })).toHaveAttribute("href", "/pricing");
    await expect(
      page.getByRole("link", { name: /upgrade or buy a credit pack for more/i }),
    ).toHaveAttribute("href", "/pricing");

    await page.goto("/settings");
    const billing = page.locator("#billing");
    await expect(billing.getByText("Free plan", { exact: true })).toBeVisible();
    await expect(billing.getByRole("link", { name: /upgrade your plan/i })).toHaveAttribute("href", "/pricing");
    await expect(billing.getByRole("link", { name: /buy credits/i })).toHaveAttribute("href", "/pricing");
    await expect(
      billing.getByRole("button", { name: /manage subscription|billing history|fix payment/i }),
    ).toHaveCount(0);
  });

  test("an admin (unlocked, no Stripe customer) is never offered 'Manage plan' — the owner's broken button", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/pricing");
    // Unlocked = effectively Pro, so Pro is the current plan …
    await expect(page.getByText("Your current plan")).toBeVisible();
    // … and the Free card used to offer a portal this account doesn't have.
    await expect(page.getByRole("button", { name: /manage plan/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /try plus free for 7 days/i })).toBeVisible();
  });
});
