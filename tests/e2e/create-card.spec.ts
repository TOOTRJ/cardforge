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
    const rail = await openCreatorWithTitle(page, `Test Card ${Date.now()}`);

    // Jump to the Publish step and save. Save arms (enables) ~300ms after
    // the step appears — the guard against clicks racing the Next → Save
    // swap — and dispatchEvent skips actionability waits, so wait for it
    // explicitly.
    await rail.getByRole("button", { name: /^publish$/i }).click();
    const saveButton = page.getByRole("button", { name: /save card/i });
    await expect(saveButton).toBeEnabled();

    // dispatchEvent fires the click exactly once: the label swaps to
    // "Saving…" on submit, which detaches the accessible name and would send
    // a regular click() into its retry loop hunting a button that no longer
    // exists.
    await saveButton.dispatchEvent("click");

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

  test("a click racing the Next → Save swap doesn't submit early", async ({
    page,
  }) => {
    await signIn(page);
    // A valid (titled) form, so a premature submit would observably save and
    // redirect — an invalid one would just bounce to the errored step.
    const rail = await openCreatorWithTitle(page, `Race Card ${Date.now()}`);

    // Land on the second-to-last step: jump to Publish, then one Back.
    await rail.getByRole("button", { name: /^publish$/i }).click();
    await page.getByRole("button", { name: /^back$/i }).click();

    // The race: "Save card" replaces Next in the same action-bar slot, so the
    // second click of a fast double-click lands on Save. It must hit the
    // still-disarmed button and do nothing.
    await page.getByRole("button", { name: /^next$/i }).dblclick();

    // Had the trailing click submitted, the label would now read "Saving…"
    // (failing this name lookup) or the page would already be redirecting.
    const saveButton = page.getByRole("button", { name: /save card/i });
    await expect(saveButton).toBeEnabled();
    expect(page.url()).toContain("/create");

    // Once armed, Save still works (dispatchEvent for the same reason as the
    // happy path above).
    await saveButton.dispatchEvent("click");
    await page.waitForURL(/\/card\/.+\/edit/);
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
