import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// TODO 3b.15 — the token kind's type picker. An artifact token (a Treasure:
// Creature off, Artifact on) and an enchantment creature token (a Glimmer:
// Enchantment on beside the default Creature), each built on the Card step,
// named by its subtypes, previewed with "Token" first on its type line and
// saved as a draft — the edit page's pinned summary reads the saved type
// line and frame back.
//
// Auth-gated like create-card.spec.ts; needs the m15token and
// m15tokenartifact combos verified (supabase/seed.sql on a reset stack,
// scripts/seed-e2e.mjs on a long-lived one).
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

/** /create on the Token kind, with the Token type section open. */
async function openTokenCreator(page: Page) {
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: /forge a new card/i })).toBeVisible();
  // The editor opens on the Card step.
  await page.getByText(/^card type$/i).first().click();
  await page
    .getByRole("radiogroup", { name: /^card type$/i })
    .getByRole("radio", { name: /^token/i })
    .click();
  await expect(page.locator("summary").filter({ hasText: /card type\s*token/i })).toBeVisible();
  // A new token is a Creature token.
  const section = page.locator("summary").filter({ hasText: /^token type/i });
  await expect(section).toContainText(/token\s+creature/i);
  await section.click();
  const types = page.getByRole("group", { name: /^token types$/i });
  await expect(types.getByRole("button", { name: /^creature/i })).toHaveAttribute("aria-pressed", "true");
  return types;
}

/** Types the subtypes on the Identity step; the name follows them. */
async function nameBySubtypes(page: Page, subtypes: string) {
  const rail = page.getByRole("navigation", { name: /card editor steps/i });
  await rail.getByRole("button", { name: /^identity$/i }).click();
  await page.getByText(/more options — supertype, subtypes/i).click();
  await page.locator('input[placeholder="Dragon, Elder"]').fill(subtypes);
  await expect(page.locator('input[placeholder="Emberbound Wyrm"]')).toHaveValue(subtypes);
  return rail;
}

/** The live preview's type line (the visible one of the page's previews). */
function previewTypeLine(page: Page) {
  return page.locator('[data-testid="type-line"]:visible').first();
}

/** Saves as a draft and opens the edit page's pinned summary. */
async function saveDraftAndReadSummary(page: Page) {
  const rail = page.getByRole("navigation", { name: /card editor steps/i });
  await rail.getByRole("button", { name: /^publish$/i }).click();
  await page.getByTestId("save-as-draft").check();
  const saveButton = page.getByRole("button", { name: /^save$/i });
  await expect(saveButton).toBeEnabled();
  await saveButton.dispatchEvent("click");
  await page.waitForURL(/\/card\/.+\/edit/);
  await rail.getByRole("button", { name: /^identity$/i }).click();
  return page.getByTestId("locked-summary");
}

test.describe("token type picker", () => {
  test.skip(!hasCredentials, "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.");

  test("an artifact token: Artifact on, no P/T, the artifact token frame", async ({ page }) => {
    await signIn(page);
    const types = await openTokenCreator(page);

    await types.getByRole("button", { name: /^creature/i }).click();
    await types.getByRole("button", { name: /^artifact/i }).click();
    await expect(types.getByRole("button", { name: /^creature/i })).toHaveAttribute("aria-pressed", "false");
    await expect(types.getByRole("button", { name: /^artifact/i })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("summary").filter({ hasText: /^token type/i })).toContainText(/token\s+artifact/i);

    const rail = await nameBySubtypes(page, "Treasure");
    await expect(previewTypeLine(page)).toHaveText(/^Token\s+Artifact\s+—\s+Treasure$/);

    // A Treasure has no P/T input, and tokens show no rarity chips.
    await rail.getByRole("button", { name: /^text & stats$/i }).click();
    await expect(page.getByRole("textbox", { name: /^power$/i })).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: /^rarity$/i })).toHaveCount(0);

    const summary = await saveDraftAndReadSummary(page);
    await expect(summary).toContainText(/token\s+artifact\s+—\s+treasure/i);
    // The frame followed the type.
    await expect(summary).toContainText(/artifact token/i);
  });

  test("an enchantment creature token: Enchantment beside Creature, with a P/T", async ({ page }) => {
    await signIn(page);
    const types = await openTokenCreator(page);

    await types.getByRole("button", { name: /^enchantment/i }).click();
    await expect(types.getByRole("button", { name: /^enchantment/i })).toHaveAttribute("aria-pressed", "true");
    await expect(types.getByRole("button", { name: /^creature/i })).toHaveAttribute("aria-pressed", "true");

    const rail = await nameBySubtypes(page, "Glimmer");
    await expect(previewTypeLine(page)).toHaveText(/^Token\s+Enchantment\s+Creature\s+—\s+Glimmer$/);

    // A creature token keeps its P/T inputs.
    await rail.getByRole("button", { name: /^text & stats$/i }).click();
    await expect(page.getByRole("textbox", { name: /^power$/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^toughness$/i })).toBeVisible();

    const summary = await saveDraftAndReadSummary(page);
    await expect(summary).toContainText(/token\s+enchantment\s+creature\s+—\s+glimmer/i);
    // Enchantment stays on the plain token frame until 4.51's Nyx dress.
    await expect(summary).not.toContainText(/artifact token/i);
  });
});
