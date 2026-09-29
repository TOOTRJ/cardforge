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

  // TODO 1.5 (with 1.18's owner decision): a printing whose frame PipGlyph
  // doesn't have — here a borderless Sheoldred, whose Scryfall art is only
  // the bordered window — asks for a frame in the dialog before the import
  // (it replaced 1.16's heads-up and treatment toast). The bordered M15 is
  // preselected; the Card step then says the frame was substituted.
  const cardStep = (page: Page) =>
    page
      .getByRole("navigation", { name: /card editor steps/i })
      .getByRole("button", { name: /^card$/i });

  const frameOption = (page: Page, label: RegExp) =>
    page
      .getByRole("radiogroup", { name: "Frame for the import" })
      .getByRole("radio", { name: label });

  async function searchAndPick(page: Page, query: string, option: RegExp) {
    await signIn(page);
    await page.goto("/create");
    await page.getByRole("button", { name: /^search a real card/i }).click();
    await page.locator('input[aria-label="Search Scryfall"]').fill(query);
    await page.getByRole("option", { name: option }).click();
  }

  test("a borderless printing asks for a frame; the bordered M15 is preselected", async ({
    page,
  }) => {
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
          // What lib/scryfall/import-mapper.ts emits for DMU #435, with the
          // match finalized by /api/scryfall/named.
          patch: {
            title: "Sheoldred, the Apocalypse",
            cost: "{2}{B}{B}",
            kind: "creature",
            frame_template: "m15",
            frame_match: {
              status: "nearest",
              template: "m15borderless",
              exactLabel: "Borderless frame",
              reason: "PipGlyph doesn't draw the legendary crown yet",
              signature: "borderless/standard+crown",
              landOn: "m15",
              blockedBy: "4.6",
            },
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

    await searchAndPick(page, "Sheoldred", /sheoldred/i);

    const chooser = page.getByTestId("import-frame-chooser");
    await expect(chooser).toContainText(/Borderless frame .*— pick one of these/);
    await expect(chooser).toContainText(
      "Scryfall's art for this printing is cropped to the bordered window.",
    );
    await expect(frameOption(page, /^M15 \(2015\) Standard/)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // 1.16's heads-up is retired: the chooser covers it.
    await expect(page.getByText(/which PipGlyph doesn't offer yet/)).toHaveCount(0);

    // Keep the run offline: no art import.
    await page.getByRole("checkbox", { name: /also import artwork/i }).uncheck();
    await page.getByRole("button", { name: /use as starting point/i }).click();

    await cardStep(page).click();
    await expect(page.getByTestId("frame-substituted")).toHaveText(
      "Frame substituted (imported Borderless frame)",
    );
  });

  // TODO 1.4 + 1.5: Bident of Thassa THS #42 prints Theros's 2003 Nyx frame,
  // whose nearest PipGlyph frame is Nyx (frame_match); Nyx isn't verified in
  // blue (supabase/seed.sql), so the chooser names what the printing is and
  // preselects the M15 standard the import falls forward to.
  test("an import asks for its signature's frame and preselects the fallback", async ({
    page,
  }) => {
    const id = "85e45d14-a501-40b9-af0a-720ecd20dad7"; // THS #42
    await page.route("**/api/scryfall/search**", async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          results: [
            {
              id,
              name: "Bident of Thassa",
              set: "ths",
              set_name: "Theros",
              type_line: "Legendary Enchantment Artifact",
              mana_cost: "{2}{U}{U}",
              rarity: "rare",
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
            name: "Bident of Thassa",
            set: "ths",
            set_name: "Theros",
            print_url: null,
            thumb_url: null,
            scryfall_uri: null,
          },
          // What lib/scryfall/import-mapper.ts emits for THS #42.
          patch: {
            title: "Bident of Thassa",
            cost: "{2}{U}{U}",
            kind: "enchantment",
            frame_template: "nyx",
            frame_match: {
              status: "nearest",
              template: "nyx",
              exactLabel: "Nyx frame (2003)",
              reason: "PipGlyph's Nyx frame is the 2015 constellation showcase",
              signature: "nyx/2003",
              blockedBy: "4.7",
            },
            card_type: "enchantment",
            supertype: "Legendary Artifact",
            rarity: "rare",
            color_identity: ["blue"],
            source_scryfall_id: id,
          },
        },
      });
    });

    await searchAndPick(page, "Bident", /bident of thassa/i);

    await expect(page.getByTestId("import-frame-chooser")).toContainText(
      "PipGlyph doesn't have the Nyx frame (2003) yet — pick one of these",
    );
    await expect(frameOption(page, /^M15 \(2015\) Standard/)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.getByRole("checkbox", { name: /also import artwork/i }).uncheck();
    await page.getByRole("button", { name: /use as starting point/i }).click();

    // The user picked it, so no after-the-fact toast; the Card step says it.
    await expect(page.getByText(/isn't available in blue yet/)).toHaveCount(0);
    await cardStep(page).click();
    await expect(page.getByTestId("frame-substituted")).toHaveText(
      "Frame substituted (imported Nyx frame (2003))",
    );
  });
});
