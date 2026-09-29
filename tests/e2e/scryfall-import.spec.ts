import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
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

// The local stack's service client sets the verified frames a test depends
// on (withFramesUnverified) — never a remote database.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
const hasLocalStack =
  Boolean(supabaseUrl && serviceKey) && /127\.0\.0\.1|localhost/.test(supabaseUrl);

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

  // Mocks /search + /named for one printing — `patch` is what
  // lib/scryfall/import-mapper.ts emits for it (finalized by
  // /api/scryfall/named), `card` the route's payload. No `oracle_id`, so the
  // dialog lists no other printings and the run stays offline.
  async function mockPrinting(
    page: Page,
    printing: {
      id: string;
      name: string;
      set: string;
      set_name: string;
      type_line: string;
      has_back_image: boolean;
      patch: Record<string, unknown>;
    },
  ) {
    await page.route("**/api/scryfall/search**", async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          results: [
            {
              id: printing.id,
              name: printing.name,
              set: printing.set,
              set_name: printing.set_name,
              type_line: printing.type_line,
              mana_cost: null,
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
            id: printing.id,
            name: printing.name,
            set: printing.set,
            set_name: printing.set_name,
            print_url: null,
            thumb_url: null,
            scryfall_uri: null,
            has_back_image: printing.has_back_image,
          },
          patch: printing.patch,
        },
      });
    });
  }

  // Sign in, open the import dialog and pick the mocked search result.
  async function searchAndPick(
    page: Page,
    query: string,
    option: RegExp = new RegExp(query, "i"),
  ) {
    await signIn(page);
    await page.goto("/create");
    await page.getByRole("button", { name: /^search a real card/i }).click();
    await page.locator('input[aria-label="Search Scryfall"]').fill(query);
    await page.getByRole("option", { name: option }).click();
  }

  // Commit the import from the loaded detail pane, with or without the art.
  async function confirmImport(page: Page, withArt: boolean) {
    await expect(page.getByText(/Will populate/)).toBeVisible();
    const artwork = page.getByRole("checkbox", { name: /also import artwork/i });
    if (withArt) await expect(artwork).toBeChecked();
    else await artwork.uncheck();
    await page.getByRole("button", { name: /use as starting point/i }).click();
  }

  async function pickAndImport(page: Page, search: string, withArt: boolean) {
    await searchAndPick(page, search);
    await confirmImport(page, withArt);
  }

  const cardStep = (page: Page) =>
    page
      .getByRole("navigation", { name: /card editor steps/i })
      .getByRole("button", { name: /^card$/i });

  const frameOption = (page: Page, label: RegExp) =>
    page
      .getByRole("radiogroup", { name: "Frame for the import" })
      .getByRole("radio", { name: label });

  // The chooser reads the verified frame combos (frame_reviews), so a test
  // that needs a combo UNpublished withdraws it for its own run instead of
  // leaning on supabase/seed.sql, which mirrors production and only grows.
  // (M15 is verified in every colour by scripts/seed-e2e.mjs.) Local stack
  // only — the caller skips without it; the combos are restored after.
  async function withFramesUnverified(
    combos: ReadonlyArray<{ template: string; color_key: string }>,
    run: () => Promise<void>,
  ) {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const withdrawn: Array<{ template: string; color_key: string }> = [];
    for (const combo of combos) {
      const { data, error } = await admin
        .from("frame_reviews")
        .update({ verified: false })
        .eq("template", combo.template)
        .eq("color_key", combo.color_key)
        .eq("verified", true)
        .select("template, color_key");
      if (error) throw new Error(`frame_reviews: ${error.message}`);
      withdrawn.push(...(data ?? []));
    }
    try {
      await run();
    } finally {
      for (const combo of withdrawn) {
        await admin
          .from("frame_reviews")
          .update({ verified: true })
          .eq("template", combo.template)
          .eq("color_key", combo.color_key);
      }
    }
  }

  // TODO 1.5 (with 1.18's owner decision): a printing whose frame PipGlyph
  // doesn't have — here a borderless Sheoldred, whose Scryfall art is only
  // the bordered window — asks for a frame in the dialog before the import
  // (it replaced 1.16's heads-up and treatment toast). The bordered M15 is
  // preselected; the Card step then says the frame was substituted. Holds
  // whether or not the Borderless frame is verified in black: the heading
  // names it either way, and the landing is the bordered M15.
  test("a borderless printing asks for a frame; the bordered M15 is preselected", async ({
    page,
  }) => {
    const id = "8df6603a-38c1-4d18-8b84-6211e9a7cc09"; // DMU #435
    await mockPrinting(page, {
      id,
      name: "Sheoldred, the Apocalypse",
      set: "dmu",
      set_name: "Dominaria United",
      type_line: "Legendary Creature — Phyrexian Praetor",
      has_back_image: false,
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
    });

    await searchAndPick(page, "Sheoldred");

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
    await confirmImport(page, false);

    await cardStep(page).click();
    await expect(page.getByTestId("frame-substituted")).toHaveText(
      "Frame substituted (imported Borderless frame)",
    );
  });

  // TODO 1.8: an adventure (like a split, flip or aftermath card) is ONE
  // image — "Also import artwork" asks for the front art only, never the
  // back face's (which used to 404 and toast "back-face art couldn't be
  // fetched").
  test("an adventure imports its one image, with no back-face request", async ({
    page,
  }) => {
    const id = "09fd2d9c-1793-4beb-a3fb-7a869f660cd4"; // ELD #115
    await mockPrinting(page, {
      id,
      name: "Bonecrusher Giant // Stomp",
      set: "eld",
      set_name: "Throne of Eldraine",
      type_line: "Creature — Giant // Instant — Adventure",
      has_back_image: false,
      patch: {
        title: "Bonecrusher Giant",
        cost: "{2}{R}",
        kind: "adventure",
        card_type: "creature",
        subtypes_text: "Giant",
        rarity: "rare",
        color_identity: ["red"],
        power: "4",
        toughness: "3",
        artist_credit: "Victor Adame Minguez",
        source_scryfall_id: id,
        back_face: {
          title: "Stomp",
          cost: "{1}{R}",
          card_type: "instant",
          subtypes_text: "Adventure",
          artist_credit: "Victor Adame Minguez",
          imported_art_url: null,
        },
      },
    });
    const artModes: string[] = [];
    await page.route("**/api/scryfall/import-art", async (route) => {
      artModes.push((route.request().postDataJSON() as { mode: string }).mode);
      await route.fulfill({
        json: {
          ok: true,
          // A same-origin image, so the run stays offline.
          publicUrl: "/defaults/banners/banner-05.webp",
          artist: "Victor Adame Minguez",
          warning: null,
          source: { scryfallId: id, cardName: "Bonecrusher Giant // Stomp", scryfallUri: null },
        },
      });
    });

    await pickAndImport(page, "Bonecrusher Giant", true);
    await expect(
      page.getByText("Imported Bonecrusher Giant // Stomp with artwork."),
    ).toBeVisible();
    expect(artModes).toEqual(["art"]);
    await expect(page.getByText(/back-face art couldn't be fetched/)).toHaveCount(0);
  });

  // TODO 1.21: a layout kind keeps the printed card type. Commit // Memory's
  // front is an Instant; the aftermath kind used to write its own Sorcery
  // over it. (Aftermath isn't verified in supabase/seed.sql, so the card
  // keeps the M15 frame here — the type line is the point.)
  test("an aftermath card keeps its printed Instant", async ({ page }) => {
    const id = "06c9e2e8-2b4c-4087-9141-6aa25a506626"; // AKH #211
    await mockPrinting(page, {
      id,
      name: "Commit // Memory",
      set: "akh",
      set_name: "Amonkhet",
      type_line: "Instant // Sorcery",
      has_back_image: false,
      patch: {
        title: "Commit",
        cost: "{3}{U}",
        kind: "aftermath",
        card_type: "instant",
        rarity: "rare",
        color_identity: ["blue"],
        rules_text: "Put target spell or nonland permanent into its owner's library second from the top.",
        artist_credit: "Ryan Alexander Lee",
        source_scryfall_id: id,
        back_face: {
          title: "Memory",
          cost: "{4}{U}{U}",
          card_type: "sorcery",
          rules_text: "Aftermath",
          artist_credit: "Ryan Alexander Lee",
          imported_art_url: null,
        },
      },
    });

    await pickAndImport(page, "Commit", false);
    await expect(page.getByText("Seeded form with Commit // Memory.")).toBeVisible();
    // The live preview draws the front face first, then the second half
    // (Memory, a Sorcery) for its flip; a hidden mobile twin may share the
    // DOM. The front's type line used to read "Sorcery".
    const typeLines = page
      .getByText(/^(Instant|Sorcery)$/)
      .filter({ visible: true });
    await expect(typeLines.first()).toHaveText("Instant");
  });

  // TODO 1.4 + 1.5: Bident of Thassa THS #42 prints Theros's 2003 Nyx frame,
  // whose nearest PipGlyph frame is Nyx (frame_match). With Nyx not verified
  // in blue (withdrawn for this run, whatever the seed lists), the chooser
  // names what the printing is and preselects the M15 standard the import
  // falls forward to; the pick lands without an after-the-fact toast. (Before
  // the chooser, this import toasted "This printing's Nyx Constellation frame
  // isn't available in blue yet — using M15 (2015) Standard.")
  test("an import asks for its signature's frame and preselects the fallback", async ({
    page,
  }) => {
    test.skip(!hasLocalStack, "Needs the local Supabase stack (.env.e2e) to set the verified frames.");
    const id = "85e45d14-a501-40b9-af0a-720ecd20dad7"; // THS #42
    await mockPrinting(page, {
      id,
      name: "Bident of Thassa",
      set: "ths",
      set_name: "Theros",
      type_line: "Legendary Enchantment Artifact",
      has_back_image: false,
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
    });

    await withFramesUnverified([{ template: "nyx", color_key: "u" }], async () => {
      await searchAndPick(page, "Bident", /bident of thassa/i);

      await expect(page.getByTestId("import-frame-chooser")).toContainText(
        "PipGlyph doesn't have the Nyx frame (2003) yet — pick one of these",
      );
      await expect(frameOption(page, /^M15 \(2015\) Standard/)).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await confirmImport(page, false);

      // The user picked it, so no after-the-fact toast; the Card step says it.
      await expect(page.getByText(/isn't available in blue yet/)).toHaveCount(0);
      await cardStep(page).click();
      await expect(page.getByTestId("frame-substituted")).toHaveText(
        "Frame substituted (imported Nyx frame (2003))",
      );
    });
  });
});
