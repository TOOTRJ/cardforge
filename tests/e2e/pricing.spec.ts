import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Pricing page e2e — hermetic (no auth, no Stripe). Verifies the storefront
// renders the three tiers and the monthly/annual toggle reprices.
// ---------------------------------------------------------------------------

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
      page.getByRole("heading", { name: /forge more with a plan/i }),
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
