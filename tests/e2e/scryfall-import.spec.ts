import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers/sign-in";

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

    // The Scryfall import opens from the quick-start tiles at the top of the
    // creator (the old identity-panel trigger is gone). The tile's accessible
    // name is its title + description, hence the prefix match.
    await page
      .getByRole("button", { name: /^search a real card/i })
      .click();

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

    // Title field on the Identity step now reflects the imported value. Hop
    // there if the import left us on another step (the ACTIVE step renders
    // as plain text, not a button).
    const identityStep = page
      .getByRole("navigation", { name: /card editor steps/i })
      .getByRole("button", { name: /^identity$/i });
    if (await identityStep.count()) await identityStep.click();
    await expect(
      page.locator('input[placeholder="Emberbound Wyrm"]'),
    ).toHaveValue("Lightning Bolt");
  });

  // TODO 1.16 stopgap: a borderless printing lands on the bordered frame —
  // the dialog says so before the import and the creator toasts the frame
  // the card actually got, instead of a silent "exact". The notice is the
  // FRONT toast (it follows the dialog's own "Seeded form with …").
  async function importBorderlessSheoldred(
    page: Page,
    frameTemplate: string,
  ) {
    const id = "8df6603a-38c1-4d18-8b84-6211e9a7cc09"; // DMU #435
    await page.route("**/api/scryfall/search**", async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          results: [
            {
              id,
              name: "Sheoldred, the Apocalypse",
              set: "dmu",
              set_name: "Dominaria United",
              type_line: "Legendary Creature — Phyrexian Praetor",
              mana_cost: "{2}{B}{B}",
              rarity: "mythic",
              artist: null,
              thumb_url: null,
              print_url: null,
              oracle_text: null,
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
            id,
            name: "Sheoldred, the Apocalypse",
            set: "dmu",
            set_name: "Dominaria United",
            print_url: null,
            thumb_url: null,
            scryfall_uri: null,
          },
          // What lib/scryfall/import-mapper.ts emits for DMU #435 (with the
          // frame the test asks for).
          patch: {
            title: "Sheoldred, the Apocalypse",
            cost: "{2}{B}{B}",
            kind: "creature",
            frame_template: frameTemplate,
            printing_treatment: "borderless",
            card_type: "creature",
            supertype: "Legendary",
            subtypes_text: "Phyrexian, Praetor",
            rarity: "mythic",
            color_identity: ["black"],
            power: "4",
            toughness: "5",
            source_scryfall_id: id,
          },
        },
      });
    });

    await signIn(page);
    await page.goto("/create");
    await page.getByRole("button", { name: /^search a real card/i }).click();
    await page.locator('input[aria-label="Search Scryfall"]').fill("Sheoldred");
    await page.getByRole("option", { name: /sheoldred/i }).click();

    await expect(
      page.getByText(/This printing is borderless, which PipGlyph doesn't offer yet/),
    ).toBeVisible();
    // Keep the run offline: no art import.
    await page.getByRole("checkbox", { name: /also import artwork/i }).uncheck();
    await page.getByRole("button", { name: /use as starting point/i }).click();
  }

  const frontToast = (page: Page) =>
    page.locator('[data-sonner-toast][data-front="true"]');

  test("names a borderless printing's substituted frame", async ({ page }) => {
    await importBorderlessSheoldred(page, "m15");
    await expect(frontToast(page)).toHaveText(
      "This printing is borderless — PipGlyph used the bordered M15 (2015) Standard frame.",
    );
  });

  test("names the frame the card landed on, not the one the printing wanted", async ({
    page,
  }) => {
    // modern is verified in white only (supabase/seed.sql), so a black card
    // asking for it lands on M15 Standard; the notice names M15.
    await importBorderlessSheoldred(page, "modern");
    await expect(frontToast(page)).toHaveText(
      "This printing is borderless — PipGlyph used the bordered M15 (2015) Standard frame.",
    );
  });
});
