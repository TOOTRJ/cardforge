import { test, expect } from "@playwright/test";
import { e2eCredentials, signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// /admin/frame-requests (TODO 1.6) through the real stack: migration 0120's
// admin_frame_request_counts() read by the seeded ADMIN e2e user, over the
// rows supabase/seeds/20_frame_requests.sql plants on every seeded database.
// Read-only. Needs the seeded local stack (.env.e2e); CI runs it.
// ---------------------------------------------------------------------------

test.describe("admin frame requests", () => {
  test.skip(!e2eCredentials(), "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.");

  test("lists the seeded missing frames, with the for-good families collapsed", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/frame-requests?window=all");

    await expect(
      page.getByRole("heading", { name: "Most-requested missing frames" }),
    ).toBeVisible();

    const table = page.getByRole("table", { name: "Most-requested missing frames" });
    const sheoldred = table.locator('tr[data-signature="borderless/standard+crown"]');
    await expect(sheoldred).toContainText("Borderless frame");
    await expect(sheoldred).toContainText("window-cropped");
    await expect(sheoldred.getByRole("link", { name: /DMU #435/ })).toHaveAttribute(
      "href",
      "https://scryfall.com/card/dmu/435",
    );
    // The Future Sight row is 120 days old: all time shows it, 30 days doesn't.
    await expect(table.locator('tr[data-signature="future"]')).toBeVisible();

    // The poster family sits in the collapsed "Unsupported for good" group.
    await expect(page.getByText("Artist-lettered borderless poster")).toBeHidden();
    await page.getByText(/Unsupported for good/).click();
    await expect(page.getByText("Artist-lettered borderless poster")).toBeVisible();

    await page.getByRole("link", { name: "30 days" }).click();
    await expect(page).toHaveURL(/\/admin\/frame-requests$/);
    await expect(
      page.getByRole("table", { name: "Most-requested missing frames" }).locator('tr[data-signature="future"]'),
    ).toHaveCount(0);
  });
});
