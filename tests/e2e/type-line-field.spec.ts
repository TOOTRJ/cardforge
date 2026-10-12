import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// TODO 3b.16 — the type line's types are ONE field, pre-filled with the card
// type's word. A new creature: the field says "Creature"; a word typed
// before it prints before it; "Creature" removed prints the words left —
// capitalised — and the card stays a creature (its P/T inputs stay). Saved
// as a draft, the edit page opens on the line as it prints, an untouched
// field stays untouched, and a re-worded line is saved and read back.
//
// Auth-gated like create-card.spec.ts (the local Supabase stack, with
// migration 0137's `printed_types`).
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

const typesField = (page: Page) => page.getByTestId("types-field-input-front");
const titleField = (page: Page) => page.locator('input[placeholder="Emberbound Wyrm"]');
const subtypesField = (page: Page) => page.locator('input[placeholder="Dragon, Elder"]');
const rail = (page: Page) => page.getByRole("navigation", { name: /card editor steps/i });

/** The live preview's type line (the visible one of the page's previews). */
function previewTypeLine(page: Page) {
  return page.locator('[data-testid="type-line"]:visible').first();
}

test.describe("the Types field", () => {
  test.skip(!hasCredentials, "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.");

  test("a creature: pre-filled, a word before it, the word removed — and the edit page reads it back", async ({ page }) => {
    const name = `Type Line Probe ${Date.now()}`;
    await signIn(page);
    await page.goto("/create");
    await expect(page.getByRole("heading", { name: /forge a new card/i })).toBeVisible();
    await rail(page).getByRole("button", { name: /^identity$/i }).click();

    // Pre-filled with the card type's word, in plain view (no "More options").
    await expect(typesField(page)).toHaveValue("Creature");
    await expect(page.getByText(/more options — supertype, subtypes/i)).toHaveCount(0);
    await expect(page.getByTestId("types-field-reset-front")).toHaveCount(0);
    await titleField(page).fill(name);

    // A word before it; each word capitalised when the field is left.
    await typesField(page).fill("goblin Creature");
    await subtypesField(page).fill("wizard");
    await titleField(page).click();
    await expect(typesField(page)).toHaveValue("Goblin Creature");
    await expect(subtypesField(page)).toHaveValue("Wizard");
    await expect(previewTypeLine(page)).toHaveText(/^Goblin\s+Creature\s+—\s+Wizard$/);

    // "Creature" removed: the line prints what is left, and says the card is
    // still a creature.
    await typesField(page).fill("goblin");
    await titleField(page).click();
    await expect(typesField(page)).toHaveValue("Goblin");
    await expect(previewTypeLine(page)).toHaveText(/^Goblin\s+—\s+Wizard$/);
    await expect(page.getByTestId("types-field-note-front")).toContainText(/still a creature/i);
    await expect(page.getByTestId("types-field-reset-front")).toBeVisible();

    // The kind keeps deciding behaviour: the P/T inputs are still there.
    await rail(page).getByRole("button", { name: /^text & stats$/i }).click();
    await expect(page.getByRole("textbox", { name: /^power$/i })).toBeVisible();

    // Saved as a draft; the edit page reads the saved line back.
    await rail(page).getByRole("button", { name: /^publish$/i }).click();
    await page.getByTestId("save-as-draft").check();
    const saveButton = page.getByRole("button", { name: /^save$/i });
    await expect(saveButton).toBeEnabled();
    await saveButton.dispatchEvent("click");
    await page.waitForURL(/\/card\/.+\/edit/);
    await page.reload();
    await rail(page).getByRole("button", { name: /^identity$/i }).click();
    await expect(page.getByTestId("locked-summary")).toContainText(/Goblin\s+—\s+Wizard/);
    await expect(typesField(page)).toHaveValue("Goblin");
    await expect(previewTypeLine(page)).toHaveText(/^Goblin\s+—\s+Wizard$/);
    // On a saved card the type is locked; the printed line is not.
    await expect(subtypesField(page)).toHaveCount(0);

    // Re-worded on the edit, saved, read back; Reset is the built line.
    await typesField(page).fill("goblin king");
    await titleField(page).click();
    await expect(typesField(page)).toHaveValue("Goblin King");
    await expect(saveButton).toBeEnabled();
    await saveButton.dispatchEvent("click");
    await expect(page.getByText(/unsaved changes/i)).toHaveCount(0, { timeout: 30_000 });
    await page.reload();
    await rail(page).getByRole("button", { name: /^identity$/i }).click();
    await expect(typesField(page)).toHaveValue("Goblin King");
    await expect(previewTypeLine(page)).toHaveText(/^Goblin\s+King\s+—\s+Wizard$/);
    await page.getByTestId("types-field-reset-front").click();
    await expect(typesField(page)).toHaveValue("Goblin Creature");
    await expect(previewTypeLine(page)).toHaveText(/^Goblin\s+Creature\s+—\s+Wizard$/);
  });

  test("a land with “Creature” typed shows a P/T; a token's field sits after a fixed “Token”", async ({ page }) => {
    await signIn(page);
    await page.goto("/create");
    await expect(page.getByRole("heading", { name: /forge a new card/i })).toBeVisible();
    await page.getByText(/^card type$/i).first().click();
    await page.getByRole("radiogroup", { name: /^card type$/i }).getByRole("radio", { name: /^land/i }).click();
    await rail(page).getByRole("button", { name: /^identity$/i }).click();
    await typesField(page).fill("land creature");
    await subtypesField(page).fill("forest, dryad");
    await titleField(page).click();
    await expect(typesField(page)).toHaveValue("Land Creature");
    await expect(previewTypeLine(page)).toHaveText(/^Land\s+Creature\s+—\s+Forest\s+Dryad$/);
    await rail(page).getByRole("button", { name: /^text & stats$/i }).click();
    await expect(page.getByRole("textbox", { name: /^power$/i })).toBeVisible();

    // The token kind: "Token" is a fixed prefix beside the field.
    await rail(page).getByRole("button", { name: /^card$/i }).click();
    await page.getByText(/^card type$/i).first().click();
    await page.getByRole("radiogroup", { name: /^card type$/i }).getByRole("radio", { name: /^token/i }).click();
    await rail(page).getByRole("button", { name: /^identity$/i }).click();
    await expect(page.getByTestId("types-field-token-prefix")).toHaveText("Token");
    await expect(previewTypeLine(page)).toHaveText(/^Token\s/);
    await expect(typesField(page)).not.toHaveValue(/token/i);
  });
});
