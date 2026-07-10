import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Create-card e2e (Phase 11 chunk 16 — scaffolded).
//
// Drives the form's text-only happy path (no upload) plus the action-bar
// race regression. Auth-gated, so it skips when the Supabase test-user
// creds aren't set. See tests/README.md.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

async function signIn(page: Page) {
  await page.goto("/login");
  await page
    .locator('input[type="email"]')
    .fill(process.env.SUPABASE_E2E_USER_EMAIL!);
  await page
    .locator('input[type="password"]')
    .fill(process.env.SUPABASE_E2E_USER_PASSWORD!);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard");
}

// Opens /create and fills a unique title (so reruns don't collide on the
// slug). The editor opens on the Card panel; the title input lives on
// Identity, so jump there first via the vertical step rail (xl+ — the default
// Desktop Chrome viewport is 1280px wide). Free step jumping is enabled
// (isStepEnabled: () => true). Returns the rail locator. (The rail renders the
// ACTIVE panel as a non-button, so Identity is only a button while standing
// elsewhere — which we are, on Card.)
async function openCreatorWithTitle(page: Page, title: string) {
  await page.goto("/create");
  await expect(
    page.getByRole("heading", { name: /forge a new card/i }),
  ).toBeVisible();

  const rail = page.getByRole("navigation", { name: /card editor steps/i });
  await rail.getByRole("button", { name: /^identity$/i }).click();
  await page.locator('input[placeholder="Emberbound Wyrm"]').fill(title);
  return rail;
}

test.describe("create a card (text fields only)", () => {
  test.skip(
    !hasCredentials,
    "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.",
  );

  test("fills the form and saves to dashboard", async ({ page }) => {
    await signIn(page);
    await openCreatorWithTitle(page, `Test Card ${Date.now()}`);

    // Art-less cards save via Save draft (the persistent Save button
    // requires a title AND artwork; this form has no art).
    const saveButton = page.getByRole("button", { name: /save card/i });
    await expect(saveButton).toBeDisabled();

    const draftButton = page.getByRole("button", { name: /save draft/i });
    await expect(draftButton).toBeEnabled();
    await draftButton.dispatchEvent("click");

    // After save, the editor redirects to the slug-edit URL.
    await page.waitForURL(/\/card\/.+\/edit/);
  });

  test("mana pips auto-sort into canonical printed order", async ({
    page,
  }) => {
    await signIn(page);
    const rail = await openCreatorWithTitle(page, `Pip Order ${Date.now()}`);

    // The cost picker lives on the Pips step. No save — asserting on the
    // preview alone keeps the test outside the free-tier card capacity.
    await rail.getByRole("button", { name: /^pips$/i }).click();
    await page.getByRole("button", { name: /^add white$/i }).click();
    await page.getByRole("button", { name: /^add red$/i }).click();

    // Click order was W then R, but the canonical Boros pair prints {R}{W}.
    // ManaCostGlyphs exposes the whole cost as one aria-label.
    await expect(
      page.getByRole("img", { name: "Cost {R}{W}" }).first(),
    ).toBeVisible();
  });

  test("Save is available on every step but gated on title + artwork", async ({
    page,
  }) => {
    await signIn(page);

    // Fresh creator, no title yet: Save renders on the FIRST step (no more
    // end-of-stepper gate) but stays disabled while the card is incomplete.
    await page.goto("/create");
    await expect(
      page.getByRole("heading", { name: /forge a new card/i }),
    ).toBeVisible();
    const saveButton = page.getByRole("button", { name: /save card/i });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeDisabled();

    // A title alone doesn't unlock it — artwork is still missing.
    const rail = page.getByRole("navigation", { name: /card editor steps/i });
    await rail.getByRole("button", { name: /^identity$/i }).click();
    await page
      .locator('input[placeholder="Emberbound Wyrm"]')
      .fill(`Gated Card ${Date.now()}`);
    await expect(saveButton).toBeDisabled();

    // Double-clicking Next never submits — Save is a separate button now,
    // not a swap into Next's slot.
    await page.getByRole("button", { name: /^next$/i }).dblclick();
    expect(page.url()).toContain("/create");
  });

  test("changing kind never silently overrides the chosen frame era", async ({
    page,
  }) => {
    await signIn(page);
    const rail = await openCreatorWithTitle(page, `Kind Card ${Date.now()}`);

    // Everything lives on the Card step now: open the Frame collapsible and
    // pick the Classic (1993) standard frame from the gallery.
    await rail.getByRole("button", { name: /^card$/i }).click();
    await page.getByText(/^frame$/i).first().click();
    await page
      .getByRole("radiogroup", { name: /classic \(1993\) frames/i })
      .getByRole("radio")
      .first()
      .click();

    // Ask for a Planeswalker — Classic has no planeswalker frame, so the
    // era-switch dialog must appear instead of the old silent M15 fallback.
    await page.getByText(/^card type$/i).first().click();
    const kindGroup = page.getByRole("radiogroup", { name: /^card type$/i });
    await kindGroup.getByRole("radio", { name: /planeswalker/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/classic .*no planeswalker/i)).toBeVisible();

    // Cancel → nothing changed: still a Creature (the kind derives from the
    // untouched form state, so the chip snaps back on its own).
    await dialog
      .getByRole("button", { name: /keep things as they are/i })
      .click();
    await expect(
      kindGroup.getByRole("radio", { name: /^creature$/i }),
    ).toHaveAttribute("aria-checked", "true");

    // Accept → the M15 planeswalker frame takes over.
    await kindGroup.getByRole("radio", { name: /planeswalker/i }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /switch to m15/i })
      .click();
    await expect(
      kindGroup.getByRole("radio", { name: /planeswalker/i }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
