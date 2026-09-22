import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// My Cards (/dashboard/cards) + the slimmed-down dashboard Overview.
//
// Needs the local Supabase stack + the seeded e2e user (tests/README.md).
// ONE saved draft drives the whole library flow — every save counts against
// the free-tier card limit, so the spec doesn't create more than it needs.
// ---------------------------------------------------------------------------

const hasCredentials =
  !!process.env.SUPABASE_E2E_USER_EMAIL &&
  !!process.env.SUPABASE_E2E_USER_PASSWORD;

async function saveDraft(page: Page, title: string) {
  await page.goto("/create");
  await expect(
    page.getByRole("heading", { name: /forge a new card/i }),
  ).toBeVisible();
  const rail = page.getByRole("navigation", { name: /card editor steps/i });
  await rail.getByRole("button", { name: /^identity$/i }).click();
  await page.locator('input[placeholder="Emberbound Wyrm"]').fill(title);
  await rail.getByRole("button", { name: /^publish$/i }).click();
  await page.getByTestId("save-as-draft").check();
  await page.getByRole("button", { name: /^save$/i }).dispatchEvent("click");
  await page.waitForURL(/\/card\/.+\/edit/);
  // The editor follows its redirect with a router.refresh(); navigating away
  // mid-refresh aborts the next goto (net::ERR_ABORTED).
  await page.waitForLoadState("networkidle");
}

test.describe("dashboard overview + My Cards", () => {
  test.skip(
    !hasCredentials,
    "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.",
  );

  test("overview drops the card sections and links to the public profile", async ({
    page,
  }) => {
    await signIn(page);

    for (const gone of [
      /^recent cards$/i,
      /^drafts$/i,
      /^public cards$/i,
      /^your remixes$/i,
      /^liked cards$/i,
    ]) {
      await expect(page.getByRole("heading", { name: gone })).toHaveCount(0);
    }

    await expect(
      page.getByRole("link", { name: /view public profile/i }),
    ).toHaveAttribute("href", "/profile/e2e_forger");

    // Rail order: the user's own library first, Feed right below My Decks.
    const rail = page.getByRole("navigation", { name: /dashboard navigation/i });
    const labels = (await rail.getByRole("link").allInnerTexts()).map((t) =>
      t.trim(),
    );
    expect(labels.slice(0, 2)).toEqual(["Overview", "My Cards"]);
    expect(labels.indexOf("Feed")).toBe(labels.indexOf("My Decks") + 1);

    // The Drafts stat deep-links to the matching My Cards tab.
    // (Anchored: the Cards stat's helper text also mentions "drafts".)
    await page.getByRole("link", { name: /^drafts/i }).click();
    await page.waitForURL("**/dashboard/cards?show=drafts");
    await expect(page.getByRole("radio", { name: /^drafts/i })).toBeChecked();
  });

  test("lists a saved card, filters, sorts and remembers the chosen view", async ({
    page,
  }) => {
    const title = `Library Card ${Date.now()}`;
    await signIn(page);
    await saveDraft(page, title);

    await page.goto("/dashboard/cards");
    await expect(page.getByRole("heading", { name: /^my cards$/i })).toBeVisible();

    // Default: large grid, newest edit first.
    const views = page.getByRole("radiogroup", { name: /card view/i });
    await expect(views.getByRole("radio", { name: /large grid/i })).toBeChecked();
    await expect(page.getByRole("combobox", { name: /sort cards/i })).toHaveValue(
      "updated",
    );
    await expect(page.getByRole("button", { name: `View ${title}` })).toBeVisible();

    // Filter tabs: a draft is under Drafts, not Public. The tab lands in the URL.
    // (Other specs may have published cards on this account, so assert the
    // draft is absent rather than that Public is empty.)
    await page.getByRole("radio", { name: /^public/i }).click();
    await expect(page).toHaveURL(/show=public/);
    await expect(page.getByRole("button", { name: `View ${title}` })).toHaveCount(0);
    await page.getByRole("radio", { name: /^drafts/i }).click();
    await expect(page.getByRole("button", { name: `View ${title}` })).toBeVisible();

    // Sort is reflected in the URL too (and survives the reload below).
    await page
      .getByRole("combobox", { name: /sort cards/i })
      .selectOption("title");
    await expect(page).toHaveURL(/sort=title/);

    // Search narrows by name.
    const search = page.getByRole("searchbox", { name: /search your cards/i });
    await search.fill("zzz-no-such-card");
    await expect(page.getByText(/no matches/i)).toBeVisible();
    await search.fill("");

    // Switch to the list view → rows, with explicit Edit / View actions.
    await views.getByRole("radio", { name: /^list$/i }).click();
    const row = page.getByRole("listitem").filter({ hasText: title });
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: `Edit ${title}` })).toBeVisible();

    // The view is remembered: a fresh load renders the list straight away.
    await page.reload();
    await expect(
      page
        .getByRole("radiogroup", { name: /card view/i })
        .getByRole("radio", { name: /^list$/i }),
    ).toBeChecked();
    await expect(
      page.getByRole("listitem").filter({ hasText: title }),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: /^drafts/i })).toBeChecked();
    await expect(page.getByRole("combobox", { name: /sort cards/i })).toHaveValue(
      "title",
    );

    // …and it still is after leaving and coming back with no params at all.
    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: /dashboard navigation/i })
      .getByRole("link", { name: /my cards/i })
      .click();
    await page.waitForURL("**/dashboard/cards");
    await expect(
      page
        .getByRole("radiogroup", { name: /card view/i })
        .getByRole("radio", { name: /^list$/i }),
    ).toBeChecked();

    // Select mode → the bulk bar appears for the picked card.
    await page.getByRole("button", { name: /^select$/i }).click();
    await page
      .getByRole("listitem")
      .filter({ hasText: title })
      .getByRole("button", { name: `Select ${title}` })
      .click();
    await expect(page.getByText(/1\s*selected/i).first()).toBeVisible();
  });
});
