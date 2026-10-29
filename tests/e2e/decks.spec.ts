import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// Decks e2e (decks series PR 7; the create flow is the New deck dialog of
// TODO DK4, the deck page the one-screen builder of DK5).
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
      page.getByRole("radiogroup", { name: /filter by format/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /^commander$/i }),
    ).toBeVisible();
  });
});

test.describe("deck CRUD + import", () => {
  test.skip(
    !hasCredentials,
    "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.",
  );

  /** The imported lands, by their tiles' names — image-first tiles carry the
   *  card's name, quantity and status (TODO DK5.12). The page behind an open
   *  dialog is aria-hidden, so the heading is asserted once it has closed. */
  async function expectImportedLands(page: Page, title: string) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /^mountain, 4 copies, imported$/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /^island, 2 copies, imported$/i }),
    ).toBeVisible();
  }

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

  test("creates a deck with a pasted list, shows it in the page's views and statuses, and deletes it", async ({
    page,
  }) => {
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

    // The deck is made, the list goes through the deck page's import commit
    // (exact matches only), and the deck opens with its cards.
    await page.waitForURL(/\/deck\/[^/?]+$/, { timeout: 60_000 });
    await expectImportedLands(page, title);

    // The page's views (TODO DK5.3): every view names its entries the same
    // way; the Table view is a table.
    const views = page.getByRole("radiogroup", { name: "View" });
    await views.getByRole("radio", { name: "Table" }).click();
    await expect(page.getByRole("table", { name: "The deck's cards" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^mountain, 4 copies, imported$/i }),
    ).toBeVisible();
    // The status filter counts cards (quantities summed).
    await expect(
      page.getByRole("radiogroup", { name: "Filter by card status" }).getByRole("radio", { name: /^imported/i }),
    ).toContainText("6");
    // Back to the default view: the choice is remembered in a cookie.
    await views.getByRole("radio", { name: "Stacks" }).click();

    await deleteDeck(page);
  });

  test("creates an empty deck from My Decks, lands on its first door, imports through the deck page, and deletes it", async ({
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

    // An empty deck opens on its first way to add cards — the empty deck's
    // "Paste a decklist" door (TODO DK4.4) — and the ?new=1 that asked for
    // it leaves the address bar.
    await page.waitForURL(/\/deck\/[^/?]+$/, { timeout: 30_000 });
    const pasteDoor = page.getByRole("button", { name: /^paste a decklist/i });
    await expect(pasteDoor).toBeFocused();

    // The deck page's own import: paste → preview → review → add.
    await pasteDoor.press("Enter");
    await page.locator('textarea[aria-label="Decklist text"]').fill("4 Mountain\n2 Island");
    await page.getByRole("button", { name: /preview import/i }).click();
    await expect(page.getByRole("button", { name: /add 6 cards/i })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /add 6 cards/i }).click();

    await expectImportedLands(page, title);
    await deleteDeck(page);
  });
});
