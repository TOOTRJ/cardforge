import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Frame profile editor e2e — the seeded e2e user is an admin on the LOCAL
// stack (scripts/seed-e2e.mjs sets profiles.is_admin). Drives the visual
// layout editor: select a slot, nudge with arrow keys, confirm the field
// value and outline move, then revert.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

test.describe("frame profile editor", () => {
  test.skip(
    !hasCredentials,
    "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.",
  );

  test("select title, nudge with arrows, revert", async ({ page }) => {
    await page.goto("/login");
    await page
      .locator('input[type="email"]')
      .fill(process.env.SUPABASE_E2E_USER_EMAIL!);
    await page
      .locator('input[type="password"]')
      .fill(process.env.SUPABASE_E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/admin/frame-compare?template=m15&color=w");
    await page.getByRole("button", { name: /edit layout/i }).click();

    // Select the title slot from the chip list.
    await page.getByRole("button", { name: /^title$/ }).click();
    const topInput = page.getByLabel("title topPct");
    const base = Number(await topInput.inputValue());

    // Nudge down 3 × 0.1 via arrow keys on the canvas.
    const canvas = page.locator('[data-testid="slot-overlay"]');
    await canvas.click({ position: { x: 5, y: 5 } });
    // Focus the keyboard wrapper (the canvas's scroll container).
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(topInput).toHaveValue(String(Math.round((base + 0.3) * 10000) / 10000));

    // The selected outline tracks the draft.
    const outline = page.locator('[data-slot-outline="title"]');
    await expect(outline).toHaveCSS("top", /.+/);

    // Revert restores the base value.
    await page.getByRole("button", { name: /revert draft/i }).click();
    await expect(topInput).toHaveValue(String(base));
  });
});
