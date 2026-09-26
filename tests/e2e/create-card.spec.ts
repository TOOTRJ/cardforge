import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers/sign-in";

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

    // Art-less cards save as DRAFTS: Save needs a title AND artwork unless
    // "Save as a draft" is ticked on the Publish step (drafts need a title).
    const saveButton = page.getByRole("button", { name: /^save$/i });
    await expect(saveButton).toBeDisabled();

    const rail = page.getByRole("navigation", { name: /card editor steps/i });
    await rail.getByRole("button", { name: /^publish$/i }).click();
    await page.getByTestId("save-as-draft").check();
    await expect(saveButton).toBeEnabled();
    await saveButton.dispatchEvent("click");

    // After save, the editor redirects to the slug-edit URL.
    await page.waitForURL(/\/card\/.+\/edit/);
  });

  test("a free account saves a Foil card and the finish sticks", async ({
    page,
  }) => {
    // TODO 6.5 (owner decision 2026-09-26): Foil and Etched ship, free on
    // every plan — so the FREE account picks one. Showcase stays "Soon".
    await signIn(page, { as: "free" });
    const rail = await openCreatorWithTitle(page, `Foil Card ${Date.now()}`);

    // The finish picker lives under the Publish step's Advanced section.
    await rail.getByRole("button", { name: /^publish$/i }).click();
    await page.getByText(/^advanced$/i).click();
    const finish = page.getByRole("radiogroup", { name: /^finish$/i });
    await expect(finish.getByRole("radio", { name: /showcase/i })).toBeDisabled();
    const foil = finish.getByRole("radio", { name: /^foil/i });
    await expect(foil).toBeEnabled();
    await foil.click();
    await expect(foil).toHaveAttribute("aria-checked", "true");

    // Art-less → save as a draft (see the first test).
    await page.getByTestId("save-as-draft").check();
    const saveButton = page.getByRole("button", { name: /^save$/i });
    await expect(saveButton).toBeEnabled();
    await saveButton.dispatchEvent("click");
    // A draft save stays in the editor, on the same (Publish) step.
    await page.waitForURL(/\/card\/.+\/edit/);

    // The edit page pins the saved structure — finish included — on
    // Identity, and no longer offers the picker (the finish is locked).
    await expect(finish).toHaveCount(0);
    await rail.getByRole("button", { name: /^identity$/i }).click();
    await expect(page.getByTestId("locked-summary")).toContainText(
      /finish\s*foil/i,
    );
  });

  test("mana pips auto-sort into canonical printed order", async ({
    page,
  }) => {
    await signIn(page);
    const rail = await openCreatorWithTitle(page, `Pip Order ${Date.now()}`);

    // The cost picker lives on the Text & stats step (cost + rarity moved
    // there from their own Pips step). No save — asserting on the preview
    // alone keeps the test outside the free-tier card capacity.
    await rail.getByRole("button", { name: /^text & stats$/i }).click();
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
    const saveButton = page.getByRole("button", { name: /^save$/i });
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
    // A successful kind change collapses the section, so read the result off
    // the two collapsible summaries instead of the (now unmounted) chips.
    await expect(
      page.locator("summary").filter({ hasText: /card type\s*planeswalker/i }),
    ).toBeVisible();
    await expect(
      page
        .locator("summary")
        .filter({ hasText: /frame\s*m15 \(2015\) — planeswalker/i }),
    ).toBeVisible();
  });
});
