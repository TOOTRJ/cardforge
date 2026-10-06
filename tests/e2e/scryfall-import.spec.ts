import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signIn } from "./helpers/sign-in";
import { everyColourOf, withFramesUnverified } from "./helpers/verified-frames";

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

  // A test that needs a combo UNpublished withdraws it for its own run
  // (helpers/verified-frames.ts) instead of leaning on supabase/seed.sql,
  // which mirrors production and only grows. (M15 is verified in every
  // colour by scripts/seed-e2e.mjs.)

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

  // TODO 1.23: Scryfall leaves tokens and emblems out of a plain search. The
  // dialog's "Tokens & emblems" scope asks the search route for scope=tokens
  // (Scryfall's include_extras), the Cards scope asks for the no-match
  // fallback (fallback=tokens — the only other place it is sent), and a
  // Cards search that the server answered from tokens and emblems says so. The routes are mocked, so the run stays offline; the token is
  // the 2014–19 Treasure TXLN #7, an exact match, so no chooser.
  test("the Tokens & emblems scope finds a Treasure token and imports it", async ({ page }) => {
    const id = "720f3e68-84c0-462e-a0d1-90236ccc494a"; // TXLN #7
    const searched: Array<{ q: string | null; scope: string | null; fallback: string | null }> = [];
    await page.route("**/api/scryfall/search**", async (route) => {
      const params = new URL(route.request().url()).searchParams;
      searched.push({ q: params.get("q"), scope: params.get("scope"), fallback: params.get("fallback") });
      const token = params.get("scope") === "tokens";
      await route.fulfill({
        json: {
          ok: true,
          // A Cards search the server answered from tokens and emblems.
          scope: "tokens",
          results: [
            token
              ? {
                  id,
                  name: "Treasure",
                  set: "txln",
                  set_name: "Ixalan Tokens",
                  type_line: "Token Artifact — Treasure",
                  mana_cost: "",
                  rarity: "common",
                  artist: "Florian de Gesincourt",
                  power: null,
                  toughness: null,
                  thumb_url: null,
                  print_url: null,
                  oracle_text: "{T}, Sacrifice this token: Add one mana of any color.",
                  image_status: "highres_scan",
                }
              : {
                  id: "3c4a0a5f-4b2a-4a0e-9d56-2a2f2f0b3f11",
                  name: "Kaito, Cunning Infiltrator Emblem",
                  set: "tfdn",
                  set_name: "Foundations Tokens",
                  type_line: "Emblem",
                  mana_cost: "",
                  rarity: "common",
                  artist: null,
                  power: null,
                  toughness: null,
                  thumb_url: null,
                  print_url: null,
                  oracle_text: null,
                  image_status: "highres_scan",
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
            name: "Treasure",
            set: "txln",
            set_name: "Ixalan Tokens",
            print_url: null,
            thumb_url: null,
            scryfall_uri: null,
            has_back_image: false,
          },
          patch: {
            title: "Treasure",
            cost: "",
            kind: "token",
            frame_template: "m15tokenartifact",
            frame_match: {
              status: "exact",
              template: "m15tokenartifact",
              exactLabel: "M15 (2015) frame",
              reason: null,
              signature: "era/2015",
            },
            card_type: "token",
            supertype: "Artifact",
            subtypes_text: "Treasure",
            rarity: "common",
            color_identity: ["colorless"],
            rules_text: "{T}, Sacrifice this token: Add one mana of any color.",
            artist_credit: "Florian de Gesincourt",
            source_scryfall_id: id,
          },
        },
      });
    });

    await signIn(page);
    await page.goto("/create");
    await page.getByRole("button", { name: /^search a real card/i }).click();
    const search = page.locator('input[aria-label="Search Scryfall"]');

    // A Cards search the server answered from tokens and emblems says so.
    await search.fill("Kaito Cunning Infiltrator Emblem");
    await expect(page.getByTestId("search-fallback-note")).toHaveText(
      "No cards matched — these are tokens and emblems.",
    );
    await expect
      .poll(() => searched.at(-1))
      .toEqual({ q: "Kaito Cunning Infiltrator Emblem", scope: null, fallback: "tokens" });

    // The Tokens & emblems scope sends scope=tokens and lists the type line.
    await page
      .getByRole("radiogroup", { name: "Search scope" })
      .getByRole("radio", { name: "Tokens & emblems" })
      .click();
    await search.fill("Treasure");
    // Switching the scope re-ran the Kaito query first; wait for Treasure's.
    await expect.poll(() => searched.at(-1)).toEqual({ q: "Treasure", scope: "tokens", fallback: null });
    const option = page.getByRole("option", { name: /Treasure/ });
    await expect(option).toContainText("Token Artifact — Treasure");
    await expect(page.getByTestId("search-fallback-note")).toHaveCount(0);

    await option.click();
    await confirmImport(page, false);
    await expect(page.getByText("Seeded form with Treasure.")).toBeVisible();
    const identityStep = page
      .getByRole("navigation", { name: /card editor steps/i })
      .getByRole("button", { name: /^identity$/i });
    if (await identityStep.count()) await identityStep.click();
    await expect(page.locator('input[placeholder="Emberbound Wyrm"]')).toHaveValue("Treasure");
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

// ---------------------------------------------------------------------------
// TODO 5.4: a transform printing lands on the double-faced bodies with both
// faces' art, walked through the ADMIN's frame preview (the seeded e2e user
// is an admin; `previewFrames` unions the bodies with the verified set and
// the save is a private frame preview). Production verified the bodies on
// 2026-10-06 and supabase/seed.sql mirrors that, so the spec withdraws the
// two it previews for its own run (helpers/verified-frames.ts, local stack
// only) — a save on a PUBLISHED combo is an ordinary save, not a preview.
// /api/scryfall/named is mocked with
// the patch the mapper emits for MID #7 Brutal Cathar // Moonrage Brute
// once both bodies are verified (tests/unit/scryfall/dfc-imports.test.ts
// pins that patch); /api/scryfall/import-art answers a same-origin image for
// each face. Local stack only (the card row is read back through the
// service client).
// ---------------------------------------------------------------------------

test.describe("Scryfall import → the double-faced bodies (TODO 5.4)", () => {
  test.skip(
    !hasCredentials || !hasLocalStack,
    "Needs the seeded e2e admin and the local Supabase stack.",
  );

  test("MID #7 lands on the transform body with both arts, the back on the sun / moon back in red", async ({ page }) => {
    const id = "0dbac7ce-a6fa-466e-b6ba-173cf2dec98e"; // MID #7
    const run = Date.now();
    const title = `Brutal Cathar ${run}`;

    // The art the mocked import-art route hands back must be SAVABLE: the
    // save keeps only the caller's own storage objects on a registered
    // origin (migration 0127; lib/validation/card.ts isSafeImageUrl takes
    // the local stack's http origin outside production). So: the e2e
    // user's id through the publishable client, the stack's origin
    // registered as the app does before its first upload (tests/e2e/
    // media-url-guards.spec.ts does the same), and the object URLs in the
    // user's folder — the objects need not exist for the row to be stored.
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const asUser = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", {
      auth: { persistSession: false },
    });
    const signedIn = await asUser.auth.signInWithPassword({
      email: process.env.SUPABASE_E2E_USER_EMAIL!,
      password: process.env.SUPABASE_E2E_USER_PASSWORD!,
    });
    expect(signedIn.error, "the seeded e2e user signs in").toBeNull();
    const userId = signedIn.data.user!.id;
    await asUser.auth.signOut();
    const registered = await admin
      .from("storage_origins")
      .upsert(
        { origin: new URL(supabaseUrl).origin, note: "e2e (as lib/media/storage-origin.ts)" },
        { onConflict: "origin", ignoreDuplicates: true },
      );
    expect(registered.error).toBeNull();
    const artUrl = (face: "front" | "back") =>
      `${supabaseUrl}/storage/v1/object/public/card-art/${userId}/dfc-${face}-${run}.webp`;

    await page.route("**/api/scryfall/search**", async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          results: [
            {
              id,
              name: "Brutal Cathar // Moonrage Brute",
              set: "mid",
              set_name: "Innistrad: Midnight Hunt",
              type_line: "Creature — Human Soldier Werewolf // Creature — Werewolf",
              mana_cost: "{2}{W}",
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
            name: "Brutal Cathar // Moonrage Brute",
            set: "mid",
            set_name: "Innistrad: Midnight Hunt",
            print_url: null,
            thumb_url: null,
            scryfall_uri: null,
            has_back_image: true,
          },
          patch: {
            title,
            cost: "{2}{W}",
            kind: "transform",
            frame_template: "m15dfcfront",
            frame_match: {
              status: "exact",
              template: "m15dfcfront",
              exactLabel: "M15 (2015) transform frame",
              reason: null,
              signature: "transform/2015",
            },
            card_type: "creature",
            subtypes_text: "Human, Soldier, Werewolf",
            rarity: "rare",
            color_identity: ["white"],
            printed_dfc_icon: "sunmoon",
            printed_collector: "2015",
            printed_stamp: "oval",
            rules_text: "When this creature enters, exile target creature an opponent controls until this creature leaves the battlefield.\nDaybound",
            power: "2",
            toughness: "2",
            source_scryfall_id: id,
            back_face: {
              title: "Moonrage Brute",
              cost: "",
              card_type: "creature",
              subtypes_text: "Werewolf",
              rules_text: "First strike\nWard—Pay 3 life.\nNightbound",
              power: "3",
              toughness: "3",
              color_identity: ["red"],
              frame_style: { template: "m15dfcbackleft" },
              imported_art_url: null,
            },
          },
        },
      });
    });
    const artModes: string[] = [];
    await page.route("**/api/scryfall/import-art", async (route) => {
      const mode = (route.request().postDataJSON() as { mode: string }).mode;
      artModes.push(mode);
      await route.fulfill({
        json: {
          ok: true,
          publicUrl: artUrl(mode === "art-back" ? "back" : "front"),
          artist: null,
          warning: null,
          source: { scryfallId: id, cardName: "Brutal Cathar // Moonrage Brute", scryfallUri: null },
        },
      });
    });

    // The admin's frame preview lights both bodies, withdrawn here so the
    // walk is the preview's (the seed has them verified, as production does).
    await withFramesUnverified(everyColourOf("m15dfcfront", "m15dfcbackleft"), async () => {
      await signIn(page);
      await page.goto("/create?previewFrames=m15dfcfront,m15dfcbackleft");
      await expect(page.getByTestId("frame-preview-banner")).toBeVisible();
      await page.getByRole("button", { name: /^search a real card/i }).click();
      await page.locator('input[aria-label="Search Scryfall"]').fill("Brutal Cathar");
      await page.getByRole("option", { name: /brutal cathar/i }).click();
      await expect(page.getByText(/Will populate/)).toBeVisible();
      await expect(page.getByRole("checkbox", { name: /also import artwork/i })).toBeChecked();
      await page.getByRole("button", { name: /use as starting point/i }).click();
      await expect(page.getByText("Imported Brutal Cathar // Moonrage Brute with artwork.")).toBeVisible();
      expect([...artModes].sort()).toEqual(["art", "art-back"]);

      // The Card step: the Transform kind, the sun / moon family.
      await page
        .getByRole("navigation", { name: /card editor steps/i })
        .getByRole("button", { name: /^card$/i })
        .click();
      await expect(page.locator("summary").filter({ hasText: /card type\s*transform/i })).toBeVisible();
      await expect(page.getByTestId("dfc-icon-family")).toContainText(/Sun/i);

      // Save (a frame preview saves private) and read the row back.
      const saveButton = page.getByRole("button", { name: /^save$/i });
      await expect(saveButton).toBeEnabled();
      await saveButton.dispatchEvent("click");
      await page.waitForURL(/\/card\/.+\/edit\?.*previewFrames=/);
    });

    const { data: row, error } = await admin
      .from("cards")
      .select("id, frame_style, back_face, art_url, color_identity, visibility")
      .eq("title", title)
      .maybeSingle();
    try {
      expect(error).toBeNull();
      expect(row, "the saved card row").not.toBeNull();
      expect(row?.frame_style).toMatchObject({ template: "m15dfcfront", dfcIcon: "sunmoon" });
      expect(row?.color_identity).toEqual(["white"]);
      expect(row?.art_url).toBe(artUrl("front"));
      expect(row?.back_face).toMatchObject({
        title: "Moonrage Brute",
        card_type: "creature",
        frame_style: { template: "m15dfcbackleft" },
        color_identity: ["red"],
        art_url: artUrl("back"),
      });
      expect((row?.back_face as { cost?: string }).cost).toBeUndefined();
      // A frame preview is always private.
      expect(row?.visibility).toBe("private");
    } finally {
      if (row?.id) await admin.from("cards").delete().eq("id", row.id);
    }
  });
});
