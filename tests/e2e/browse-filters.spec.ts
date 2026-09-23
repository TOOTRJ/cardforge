import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// /gallery and /decks are static landings; every search, filter, sort and
// page change is a navigation within the dynamic /browse sibling. These
// click the REAL controls and assert the grid changed, not just the URL —
// the regression this guards against was a URL that updated while the
// results stayed frozen on the cached landing (2026-09-22).
//
// Needs the seeded local stack: the assertions name seeded cards/decks.
// ---------------------------------------------------------------------------

const hasLocalStack = existsSync(".env.e2e");

test.describe("browse search and filters", () => {
  test.skip(!hasLocalStack, "Needs the seeded local Supabase stack (.env.e2e).");

  test("the gallery landing shows browse-by chips on top and searches into /gallery/browse", async ({
    page,
  }) => {
    await page.goto("/gallery");
    const hubs = page.getByRole("navigation", { name: /browse the gallery by type and tag/i });
    await expect(hubs).toBeVisible();
    // The chips sit above the trending hero, not under the grid.
    const hubsBox = await hubs.boundingBox();
    const heroBox = await page.getByRole("heading", { name: /hot this week/i }).boundingBox();
    expect(hubsBox && heroBox && hubsBox.y < heroBox.y).toBe(true);
    await expect(hubs.getByRole("link", { name: /^creature/i })).toHaveAttribute(
      "href",
      "/gallery/type/creature",
    );

    const search = page.getByRole("searchbox", { name: "Search cards" });
    await search.fill("thornback");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/gallery\/browse\?q=thornback$/);
    await expect(page.getByRole("link", { name: /thornback behemoth/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /cinderwing matriarch/i })).toHaveCount(0);
  });

  test("type chips and the search box on /gallery/browse change the grid", async ({ page }) => {
    await page.goto("/gallery/browse");
    await expect(page.getByRole("link", { name: /cinderwing matriarch/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /emberlash/i }).first()).toBeVisible();

    await page.getByRole("button", { name: /^filters/i }).click();
    const typeGroup = page.getByRole("radiogroup", { name: "Card type" });
    await typeGroup.getByRole("radio", { name: "Instant" }).click();
    await expect(page).toHaveURL(/\/gallery\/browse\?type=instant$/);
    await expect(page.getByRole("link", { name: /emberlash/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /cinderwing matriarch/i })).toHaveCount(0);

    // Search is layered on top of the type filter (and starts on page 1).
    const search = page.getByRole("searchbox", { name: "Search gallery" });
    await search.fill("cinderwing");
    await search.press("Enter");
    await expect(page).toHaveURL(/type=instant/);
    await expect(page).toHaveURL(/q=cinderwing/);
    await expect(page.getByText(/no cards match/i)).toBeVisible();

    await typeGroup.getByRole("radio", { name: "All" }).click();
    await expect(page).not.toHaveURL(/type=/);
    await expect(page.getByRole("link", { name: /cinderwing matriarch/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /emberlash/i })).toHaveCount(0);
  });

  test("format chips on /decks/browse filter the decks; the landing searches into it", async ({
    page,
  }) => {
    await page.goto("/decks");
    await expect(page.getByRole("navigation", { name: /browse decks by format/i })).toBeVisible();
    const search = page.getByRole("searchbox", { name: "Search decks" });
    await search.fill("dragonstorm");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/decks\/browse\?q=dragonstorm$/);
    await expect(page.getByRole("link", { name: /cinderwing dragonstorm/i }).first()).toBeVisible();

    await page.goto("/decks/browse");
    await expect(page.getByRole("link", { name: /cinderwing dragonstorm/i }).first()).toBeVisible();
    await page.getByRole("button", { name: "Standard", exact: true }).click();
    await expect(page).toHaveURL(/\/decks\/browse\?format=standard$/);
    await expect(page.getByText(/no decks match/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /cinderwing dragonstorm/i })).toHaveCount(0);

    await page.getByRole("button", { name: "Commander", exact: true }).click();
    await expect(page).toHaveURL(/\/decks\/browse\?format=commander$/);
    await expect(page.getByRole("link", { name: /cinderwing dragonstorm/i }).first()).toBeVisible();
  });
});
