import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// "Use art from a real card" (TODO 1.15): the Art block's lookup puts a real
// printing's art on the card WITHOUT the full import — the name, type, frame
// and colour stay; only the art and its artist credit change. The three
// /api/scryfall/* routes the dialog calls are mocked, so the run never
// touches Scryfall or the storage bucket. Needs the seeded e2e users.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL && !!process.env.SUPABASE_E2E_USER_PASSWORD;

const ORACLE_ID = "68954295-54e3-4303-a6bc-fc4547a4e3a3";
const DOM_168 = "a1b2c3d4-0000-4000-8000-000000000168";
// Any image the dev server serves: art_url is only checked at save.
const PUBLIC_URL = "/defaults/banners/banner-01.webp?real-card-art";

function printing(id: string, set: string, number: string, artist: string) {
  return {
    id,
    set,
    set_name: set.toUpperCase(),
    released_at: "2018-04-27",
    collector_number: number,
    frame: "2015",
    border_color: "black",
    full_art: false,
    textless: false,
    snow: false,
    devoid: false,
    treatment: null,
    artist,
    has_back_image: false,
    thumb_url: null,
    image_status: "highres_scan",
    match: null,
  };
}

async function mockScryfall(page: Page) {
  const importArtBodies: unknown[] = [];
  await page.route("**/api/scryfall/search**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        results: [
          {
            id: "llanowar-search-hit",
            name: "Llanowar Elves",
            oracle_id: ORACLE_ID,
            set: "fdn",
            set_name: "Foundations",
            type_line: "Creature — Elf Druid",
            mana_cost: "{G}",
            rarity: "common",
            artist: null,
            thumb_url: null,
            print_url: null,
            oracle_text: null,
            image_status: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/scryfall/printings**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        printings: [
          printing("a1b2c3d4-0000-4000-8000-000000000314", "m19", "314", "Artist of M19"),
          printing(DOM_168, "dom", "168", "Artist of DOM"),
        ],
        has_more: false,
        total_cards: 2,
      },
    }),
  );
  await page.route("**/api/scryfall/import-art**", async (route) => {
    importArtBodies.push(route.request().postDataJSON());
    await route.fulfill({
      json: { ok: true, publicUrl: PUBLIC_URL, artist: "Artist of DOM", warning: null },
    });
  });
  return importArtBodies;
}

const stepButton = (page: Page, name: RegExp) =>
  page.getByRole("navigation", { name: /card editor steps/i }).getByRole("button", { name });

test.describe("Use art from a real card (TODO 1.15)", () => {
  test.skip(!hasCredentials, "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.");

  test("puts one printing's art and artist on the card; the name, type and frame stay", async ({
    page,
  }) => {
    const importArtBodies = await mockScryfall(page);
    await signIn(page, { as: "free" });
    await page.goto("/create");
    const identity = stepButton(page, /^identity$/i);
    if (await identity.count()) await identity.click();

    const title = page.locator('input[placeholder="Emberbound Wyrm"]');
    await title.fill("My Forest Scout");

    await page.getByRole("button", { name: /^use art from a real card$/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Search a card by name").fill("Llanowar Elves");
    await dialog.getByRole("option", { name: /Llanowar Elves/ }).click();
    const grid = dialog.getByTestId("printings-grid");
    // No frame-status badges in the art picker.
    await expect(grid.locator("[data-status]")).toHaveCount(0);
    await grid.getByRole("button").filter({ hasText: /^DOM · 2018 · #168/ }).click();
    await expect(dialog.getByTestId("real-art-chosen")).toContainText("Artist of DOM");
    await dialog.getByRole("button", { name: /use this art/i }).click();
    await expect(dialog).toBeHidden();

    expect(importArtBodies).toEqual([{ scryfallId: DOM_168, mode: "art" }]);
    await expect(title).toHaveValue("My Forest Scout");
    await page.getByText(/More options — artist credit/).click();
    await expect(page.locator('input[placeholder="Anya Vale"]').first()).toHaveValue(
      "Artist of DOM",
    );
    // The art block now shows the imported crop.
    await expect(page.getByRole("img", { name: "Card artwork preview" })).toHaveAttribute(
      "src",
      PUBLIC_URL,
    );
  });

  test("a guest sees the button disabled", async ({ page }) => {
    await page.goto("/create");
    const identity = stepButton(page, /^identity$/i);
    if (await identity.count()) await identity.click();
    const button = page.getByRole("button", { name: /^use art from a real card$/i });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("title", "Sign in to use art from real cards.");
  });
});
