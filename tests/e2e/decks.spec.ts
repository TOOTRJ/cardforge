import { test, expect, type Page } from "@playwright/test";

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
    await page.locator('input[placeholder="Atraxa Superfriends"]').fill(title);
    await page.getByRole("button", { name: /create deck/i }).click();
    await page.waitForURL("**/deck/*/edit");
    await expect(page.getByRole("heading", { name: title })).toBeVisible();

    // Import a tiny list (basics only — a single Scryfall collection call).
    await page.getByRole("button", { name: /import decklist/i }).click();
    await page
      .locator('textarea[aria-label="Decklist text"]')
      .fill("4 Mountain\n2 Island");
    await page.getByRole("button", { name: /preview import/i }).click();
    await expect(
      page.getByRole("button", { name: /add 6 cards/i }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /add 6 cards/i }).click();

    // The deck page shows the imported lands.
    await page.getByRole("link", { name: /view deck/i }).click();
    await page.waitForURL("**/deck/*");
    await expect(page.getByText(/6 cards/i).first()).toBeVisible();
    await expect(page.getByText("Mountain").first()).toBeVisible();

    // Delete (cleanup — also exercises the destructive path).
    await page.getByRole("link", { name: /edit deck/i }).click();
    await page.waitForURL("**/deck/*/edit");
    await page.getByRole("button", { name: /delete deck/i }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /delete deck/i })
      .click();
    await page.waitForURL("**/dashboard/decks");
  });
});
