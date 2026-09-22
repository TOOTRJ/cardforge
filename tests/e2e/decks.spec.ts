import { test, expect } from "@playwright/test";
import { signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// Decks e2e (decks series PR 7).
//
// Public browse renders without auth; deck CRUD + decklist import drive the
// full owner flow and skip without the Supabase test-user creds (see
// tests/README.md — the full suite needs the local stack). The import spec
// keeps its paste OFFLINE-parseable ambiguity low but does hit the real
// Scryfall API via the app's server action, same posture as
// scryfall-import.spec.ts.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

test.describe("public decks browse", () => {
  test("renders the browse page with format filters", async ({ page }) => {
    await page.goto("/decks");
    await expect(
      page.getByRole("heading", { name: /community decks/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: /filter by format/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^commander$/i }),
    ).toBeVisible();
  });
});

test.describe("deck CRUD + import", () => {
  test.skip(
    !hasCredentials,
    "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.",
  );

  test("creates a deck, imports a small list, and deletes it", async ({
    page,
  }) => {
    await signIn(page);

    // Create.
    const title = `E2E Deck ${Date.now()}`;
    await page.goto("/dashboard/decks/new");
    // The wizard: Basics → Build → Cover → Review. Pick "Import a decklist"
    // explicitly — the default build mode is AI whenever a gateway is
    // configured, and that path spends credits.
    await page.getByRole("textbox", { name: /deck name/i }).fill(title);
    await page.getByRole("button", { name: /^next$/i }).click();
    await page.getByRole("radio", { name: /import a decklist/i }).click();
    await page.getByRole("button", { name: /^next$/i }).click(); // Cover (optional)
    await page.getByRole("button", { name: /^next$/i }).click(); // Review
    await page.getByRole("button", { name: /^create deck$/i }).click();

    // Import mode lands on the deck page with the import dialog already open
    // (?import=1) — decks are edited inline now, there is no /edit hop.
    await page.waitForURL(/\/deck\/[^/?]+\?import=1/);

    // Import a tiny list (basics only — a single Scryfall collection call).
    await page
      .locator('textarea[aria-label="Decklist text"]')
      .fill("4 Mountain\n2 Island");
    await page.getByRole("button", { name: /preview import/i }).click();
    await expect(
      page.getByRole("button", { name: /add 6 cards/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /add 6 cards/i }).click();

    // Dialog gone: it's our deck, and it shows the imported lands (the page
    // behind an open dialog is aria-hidden, so the heading is asserted here,
    // not on arrival). Tiles are image-first — the
    // card name lives in the button's accessible name).
    await expect(page.getByRole("heading", { name: title })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: /^open mountain$/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /^open island$/i }),
    ).toBeVisible();

    // Delete (cleanup — also exercises the destructive path). Owner tools
    // sit on the deck page itself.
    await page.getByRole("button", { name: /delete deck/i }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /delete deck/i })
      .click();
    await page.waitForURL("**/dashboard/decks");
  });
});
