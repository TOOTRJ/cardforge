import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// Decks e2e (decks series PR 7; the create flow is the New deck dialog of
// TODO DK4).
//
// Public browse renders without auth; deck CRUD + decklist import drive the
// full owner flow and skip without the Supabase test-user creds (see
// tests/README.md — the full suite needs the local stack). The import specs
// keep their paste OFFLINE-parseable ambiguity low but do hit the real
// Scryfall API via the app's server actions, same posture as
// scryfall-import.spec.ts.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

test.describe("public decks browse", () => {
  test("the landing offers search + browse-all; /decks/browse carries the format filters", async ({
    page,
  }) => {
    // /decks is a static landing: search box + browse-all link (+ format hub
    // chips when there are public decks). The filter chips live on the
    // dynamic /decks/browse route, where a click actually re-queries.
    await page.goto("/decks");
    await expect(
      page.getByRole("heading", { name: /community decks/i }),
    ).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search decks" })).toBeVisible();
    await page.getByRole("link", { name: /browse all decks/i }).click();
    await expect(page).toHaveURL(/\/decks\/browse$/);
    await expect(page.getByRole("heading", { name: /browse decks/i })).toBeVisible();
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

  /** Delete the open deck from its owner tools (cleanup — also the
   *  destructive path). */
  async function deleteDeck(page: Page) {
    await page.getByRole("button", { name: /delete deck/i }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /delete deck/i })
      .click();
    await page.waitForURL("**/dashboard/decks");
  }

  test("creates a deck with a pasted list, then deletes it", async ({ page }) => {
    await signIn(page);

    // /dashboard/decks/new opens the New deck dialog over My Decks: a name,
    // a format (Commander unless another is picked) and an optional paste.
    // AI deck building is a line there, not a control, while it is paused.
    const title = `E2E Deck ${Date.now()}`;
    await page.goto("/dashboard/decks/new");
    const dialog = page.getByRole("dialog", { name: "New deck" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Deck name" }).fill(title);
    await expect(dialog.getByRole("radio", { name: "Commander" })).toHaveAttribute("aria-checked", "true");
    await dialog.getByRole("radio", { name: "Modern" }).click();
    await expect(dialog.getByRole("radio", { name: "Modern" })).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByRole("button", { name: /\bai\b/i })).toHaveCount(0);
    // A tiny list — basics only, a single Scryfall collection call.
    await dialog.getByRole("textbox", { name: /paste a decklist/i }).fill("4 Mountain\n2 Island");
    await dialog.getByRole("button", { name: /^create deck$/i }).click();

    // The deck is made, the list goes through the deck page's import commit,
    // and the deck opens with its cards.
    await page.waitForURL(/\/deck\/[^/?]+$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^open mountain$/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^open island$/i })).toBeVisible();

    await deleteDeck(page);
  });

  test("creates an empty deck from My Decks, lands on the import, imports a list, and deletes it", async ({
    page,
  }) => {
    await signIn(page);

    const title = `E2E Empty ${Date.now()}`;
    await page.goto("/dashboard/decks");
    await page.getByRole("button", { name: /^new deck$/i }).click();
    const dialog = page.getByRole("dialog", { name: "New deck" });
    await dialog.getByRole("textbox", { name: "Deck name" }).fill(title);
    // Enter in the name creates it.
    await dialog.getByRole("textbox", { name: "Deck name" }).press("Enter");

    // An empty deck opens with its way to add cards focused; the ?new=1 that
    // asked for it leaves the address bar.
    await page.waitForURL(/\/deck\/[^/?]+$/, { timeout: 30_000 });
    const importButton = page.getByRole("button", { name: /^import decklist$/i });
    await expect(importButton).toBeFocused();

    // The deck page's own import: paste → preview → review → add.
    await importButton.press("Enter");
    await page.locator('textarea[aria-label="Decklist text"]').fill("4 Mountain\n2 Island");
    await page.getByRole("button", { name: /preview import/i }).click();
    await expect(page.getByRole("button", { name: /add 6 cards/i })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /add 6 cards/i }).click();

    // Dialog gone: it's our deck, and it shows the imported lands (the page
    // behind an open dialog is aria-hidden, so the heading is asserted here).
    // Tiles are image-first — the card name lives in the button's name.
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^open mountain$/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^open island$/i })).toBeVisible();

    await deleteDeck(page);
  });
});
