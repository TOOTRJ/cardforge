import { test, expect } from "@playwright/test";
import { e2eCredentials, signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// /admin/frame-requests (TODO 1.6) through the real stack: migration 0123's
// admin_frame_request_counts() read by the seeded ADMIN e2e user, over the
// rows supabase/seeds/21_frame_requests.sql plants on every seeded database
// — both groups (D1), users-first order (D4), the "not in registry" flag
// (D6). Read-only. Needs the seeded local stack (.env.e2e); CI runs it.
// ---------------------------------------------------------------------------

test.describe("admin frame requests", () => {
  test.skip(!e2eCredentials(), "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.");

  test("lists the seeded frames in two groups, with the for-good families collapsed", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/frame-requests?window=all");

    await expect(
      page.getByRole("heading", { name: "Most-requested missing frames" }),
    ).toBeVisible();

    const missing = page.getByRole("table", { name: "Missing frames" });
    const sheoldred = missing.locator('tr[data-signature="borderless/standard+crown"]');
    await expect(sheoldred).toContainText("Borderless frame");
    await expect(sheoldred).toContainText("window-cropped");
    await expect(sheoldred.getByRole("link", { name: /DMU #435/ })).toHaveAttribute(
      "href",
      "https://scryfall.com/card/dmu/435",
    );
    // Distinct users first (D4): the Japan showcase (2 users, 2 requests)
    // outranks Sheoldred (no users, 4 requests).
    await expect(missing.locator("tbody tr").first()).toHaveAttribute("data-signature", "japan-showcase");
    // A key no registry rule has is flagged (D6).
    await expect(
      missing.locator('tr[data-signature="retired/seed-example"]').getByText("not in registry"),
    ).toBeVisible();
    // The Future Sight row is 120 days old: all time shows it, 30 days doesn't.
    await expect(missing.locator('tr[data-signature="future"]')).toBeVisible();

    // Exact frames waiting for verification sit in their own group (D1).
    const unverified = page.getByRole("table", { name: "Not yet verified" });
    await expect(unverified.locator('tr[data-signature="showcase/thb/constellation"]')).toBeVisible();
    await expect(unverified.locator('tr[data-signature="fullart/basic/2022"]')).toBeVisible();
    await expect(missing.locator('tr[data-signature="showcase/thb/constellation"]')).toHaveCount(0);

    // The poster family sits in the collapsed "Unsupported for good" group.
    await expect(page.getByText("Artist-lettered borderless poster")).toBeHidden();
    await page.getByText(/Unsupported for good/).click();
    await expect(page.getByText("Artist-lettered borderless poster")).toBeVisible();

    await page.getByRole("link", { name: "30 days" }).click();
    await expect(page).toHaveURL(/\/admin\/frame-requests$/);
    await expect(
      page.getByRole("table", { name: "Missing frames" }).locator('tr[data-signature="future"]'),
    ).toHaveCount(0);
  });
});
