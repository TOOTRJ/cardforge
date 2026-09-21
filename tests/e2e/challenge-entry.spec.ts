import { test, expect } from "@playwright/test";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// Challenge entry toggle — the Publish panel's "Enter the challenge"
// switch manages the submission tag, and a public save lands the card on
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

    // A PUBLIC save needs artwork (only drafts save without it), and a
    // challenge entry must be public — so give the card some art. The
    // uploader sits beside the title on Identity; with no OPENAI_API_KEY in
    // the e2e env the moderation scan is a pass-through.
    const art = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 38, g: 52, b: 92 },
      },
    })
      .png()
      .toBuffer();
    await page
      .locator('input[aria-label="Upload card art"]')
      .setInputFiles({ name: "frontier.png", mimeType: "image/png", buffer: art });
    await expect(page.getByText("Artwork uploaded.")).toBeVisible({
      timeout: 20_000,
    });

    // Publish panel: the challenge toggle (a switch) manages the tag.
    await rail.getByRole("button", { name: /^publish$/i }).click();
    const toggle = page.getByRole("switch", {
      name: /enter the .* challenge/i,
    });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toBeChecked();

    // The tag landed in the Advanced tags field.
    await page.locator("summary", { hasText: /advanced/i }).click();
    await expect(page.locator('input[name="tags_text"]')).toHaveValue(
      /arcane-frontiers/,
    );

    // Switching it off removes it; switch back on for the real save.
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('input[name="tags_text"]')).not.toHaveValue(
      /arcane-frontiers/,
    );
    await toggle.click();
    await expect(toggle).toBeChecked();

    // Entries must be public (the default — assert and ensure regardless).
    const publicChip = page.getByRole("radio", { name: /public/i });
    await publicChip.check();
    await expect(publicChip).toBeChecked();

    const saveButton = page.getByRole("button", { name: /^save$/i });
    await expect(saveButton).toBeVisible();
    // The save button arms ~300ms after the Publish panel appears (the
    // Next→Save misclick guard). dispatchEvent bypasses Playwright's
    // enabled-wait, so wait explicitly or the click lands on a disabled
    // button and silently does nothing.
    await expect(saveButton).toBeEnabled();
    await saveButton.dispatchEvent("click");
    // A first PUBLIC save doesn't redirect — it raises the share prompt.
    await expect(
      page.getByRole("dialog", { name: /your card is live/i }),
    ).toBeVisible({ timeout: 30_000 });

    // The card shows up among the challenge entries. Tiles are image-first
    // (the title lives in the link's accessible name / thumbnail alt), so
    // assert by role rather than visible text.
    await page.goto("/challenges/arcane-frontiers");
    await expect(
      page.getByRole("link", { name: new RegExp(title) }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
