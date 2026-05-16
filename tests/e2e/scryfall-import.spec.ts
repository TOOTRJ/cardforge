import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Scryfall import e2e (Phase 11 chunk 16 — scaffolded).
//
// Mocks the api.scryfall.com response so the test doesn't depend on
// Scryfall's availability or rate limit. Still requires auth — skips
// without test-user creds.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

test.describe("Scryfall search → import", () => {
  test.skip(
    !hasCredentials,
    "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.",
  );

  test("imports a mocked Scryfall card and seeds form fields", async ({
    page,
  }) => {
    // Intercept our server-side proxy. The dialog calls
    // /api/scryfall/search?q=... then /api/scryfall/named?id=... — both
    // are mocked here so the test never touches the real Scryfall API.
    await page.route("**/api/scryfall/search**", async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          results: [
            {
              id: "94c70f23-0ca9-425e-a53a-6c09921c0075",
              name: "Lightning Bolt",
              set: "lea",
              set_name: "Limited Edition Alpha",
              type_line: "Instant",
              mana_cost: "{R}",
              rarity: "common",
              artist: "Christopher Rush",
              thumb_url: null,
              print_url: null,
              oracle_text: "Lightning Bolt deals 3 damage to any target.",
            },
          ],
        },
      });
    });
    await page.route("**/api/scryfall/named**", async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          card: {
            id: "94c70f23-0ca9-425e-a53a-6c09921c0075",
            name: "Lightning Bolt",
            set: "lea",
            set_name: "Limited Edition Alpha",
            print_url: null,
            thumb_url: null,
            scryfall_uri: "https://scryfall.com/card/lea/162/lightning-bolt",
          },
          patch: {
            title: "Lightning Bolt",
            cost: "{R}",
            card_type: "spell",
            rarity: "common",
            color_identity: ["red"],
            rules_text: "Lightning Bolt deals 3 damage to any target.",
            artist_credit: "Christopher Rush",
            source_scryfall_id: "94c70f23-0ca9-425e-a53a-6c09921c0075",
          },
        },
      });
    });

    // Sign in + open the creator.
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(
      process.env.SUPABASE_E2E_USER_EMAIL!,
    );
    await page.locator('input[type="password"]').fill(
      process.env.SUPABASE_E2E_USER_PASSWORD!,
    );
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard");
    await page.goto("/create");

    // Open the Scryfall import dialog from the Identity-tab trigger.
    await page.getByRole("button", { name: /search a real card/i }).click();

    // Type into the search input → triggers the mocked /search.
    await page.locator('input[aria-label="Search Scryfall"]').fill(
      "Lightning Bolt",
    );

    // Pick the mocked result.
    await page.getByRole("option", { name: /lightning bolt/i }).click();

    // Confirm. The mocked /named has already seeded the patch.
    await page
      .getByRole("button", { name: /use as starting point/i })
      .click();

    // Title field on the Identity tab now reflects the imported value.
    await expect(
      page.locator('input[placeholder="Emberbound Wyrm"]'),
    ).toHaveValue("Lightning Bolt");
  });
});
