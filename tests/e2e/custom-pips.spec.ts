import { test, expect } from "@playwright/test";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// Custom pips e2e — the full override lifecycle against the local stack:
// upload a custom red pip → it replaces the icon on the picker button, in
// the cost row, and on the live card preview (cost AND inline rules text) →
// remove → everything reverts to the standard mana-font glyph.
//
// Auth-gated like the other editor specs; see tests/README.md.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

test.describe("custom pips", () => {
  test.skip(
    !hasCredentials,
    "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.",
  );

  test("upload → renders everywhere → remove → reverts", async ({ page }) => {
    // A real 64×64 PNG (solid dark red) generated on the fly.
    const pipPng = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 122, g: 27, b: 27, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    // Sign in.
    await page.goto("/login");
    await page
      .locator('input[type="email"]')
      .fill(process.env.SUPABASE_E2E_USER_EMAIL!);
    await page
      .locator('input[type="password"]')
      .fill(process.env.SUPABASE_E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard");

    // Open the creator on the Pips panel (cost picker + pip dialog).
    await page.goto("/create");
    const rail = page.getByRole("navigation", { name: /card editor steps/i });
    await rail.getByRole("button", { name: /^pips$/i }).click();

    // Upload a custom red pip through the dialog.
    await page.getByRole("button", { name: /customize pips/i }).click();
    await page
      .locator('input[aria-label="Upload custom red mana pip"]')
      .setInputFiles({ name: "custom-red.png", mimeType: "image/png", buffer: pipPng });
    await expect(page.getByText("Custom red pip saved.")).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape"); // close the dialog

    // The picker's red button swaps to the uploaded icon (router.refresh
    // delivers the new override map).
    const redButton = page.getByRole("button", { name: "Add Red", exact: true });
    await expect(redButton.locator("img")).toBeVisible({ timeout: 15_000 });

    // Add {R} to the cost — the picker preview row renders the custom icon.
    await redButton.click();
    const customPipImgs = page.locator('img[src*="custom-pips"]');
    await expect
      .poll(async () => customPipImgs.count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(2); // picker button + cost row

    // Inline rules-text pips wear the override too: type a {R} into rules
    // and check the live card preview.
    await rail.getByRole("button", { name: /^text & stats$/i }).click();
    await page
      .locator('textarea[name="rules_text"]')
      .fill("{T}: Add {R} to your mana pool.");
    await expect
      .poll(async () => customPipImgs.count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(2); // cost (title band) + rules-text pip on the preview

    // Remove → revert to standard.
    await rail.getByRole("button", { name: /^pips$/i }).click();
    await page.getByRole("button", { name: /customize pips/i }).click();
    await page
      .getByRole("button", { name: /remove custom red mana pip/i })
      .click();
    await expect(page.getByText("Red pip reset to standard.")).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => customPipImgs.count(), { timeout: 15_000 })
      .toBe(0);
  });
});
