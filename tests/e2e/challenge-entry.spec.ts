import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Challenge entry toggle — the Publish panel's "Enter the challenge"
// checkbox manages the submission tag, and a public save lands the card on
// the challenge page. Runs against the seeded "Arcane Frontiers" challenge
// (active for 14 days after the local migrations apply).
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

test.describe("challenge entry from the editor", () => {
  test.skip(
    !hasCredentials,
    "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.",
  );

  test("toggle adds the tag; public save appears on the challenge page", async ({
    page,
  }) => {
    await page.goto("/login");
    await page
      .locator('input[type="email"]')
      .fill(process.env.SUPABASE_E2E_USER_EMAIL!);
    await page
      .locator('input[type="password"]')
      .fill(process.env.SUPABASE_E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/create");
    const title = `Frontier Probe ${Date.now()}`;
    // The editor opens on Frame; the title input lives on Identity — jump there
    // first via the step rail.
    const rail = page.getByRole("navigation", { name: /card editor steps/i });
    await rail.getByRole("button", { name: /^identity$/i }).click();
    await page.locator('input[placeholder="Emberbound Wyrm"]').fill(title);

    // Publish panel: the challenge toggle manages the tag.
    await rail.getByRole("button", { name: /^publish$/i }).click();
    const toggle = page.getByRole("checkbox", {
      name: /enter the .* challenge/i,
    });
    await expect(toggle).toBeVisible();
    await toggle.check();

    // The tag landed in the Advanced tags field.
    await page.locator("summary", { hasText: /advanced/i }).click();
    await expect(page.locator('input[name="tags_text"]')).toHaveValue(
      /arcane-frontiers/,
    );

    // Unchecking removes it; re-check for the real save.
    await toggle.uncheck();
    await expect(page.locator('input[name="tags_text"]')).not.toHaveValue(
      /arcane-frontiers/,
    );
    await toggle.check();

    // Entries must be public (the default — assert and ensure regardless).
    const publicChip = page.getByRole("radio", { name: /public/i });
    await publicChip.check();
    await expect(publicChip).toBeChecked();

    const saveButton = page.getByRole("button", { name: /save card/i });
    await expect(saveButton).toBeVisible();
    // The save button arms ~300ms after the Publish panel appears (the
    // Next→Save misclick guard). dispatchEvent bypasses Playwright's
    // enabled-wait, so wait explicitly or the click lands on a disabled
    // button and silently does nothing.
    await expect(saveButton).toBeEnabled();
    await saveButton.dispatchEvent("click");
    await page.waitForURL(/\/card\/.+\/edit/);

    // The card shows up among the challenge entries. Tiles are image-first
    // (the title lives in the link's accessible name / thumbnail alt), so
    // assert by role rather than visible text.
    await page.goto("/challenges/arcane-frontiers");
    await expect(
      page.getByRole("link", { name: new RegExp(title) }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
