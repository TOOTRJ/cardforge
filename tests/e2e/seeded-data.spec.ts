import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// The seed is only useful if the REAL app can render it: through RLS, as an
// anonymous visitor, with the structured planeswalker / saga content intact.
// supabase/seeds/10_dev_data.sql feeds every preview branch, the shared dev
// database and the local stack — so a seed row the app chokes on would break
// all three at once. These are read-only and need no sign-in.
//
// Only meaningful against the seeded local stack (see tests/README.md).
// ---------------------------------------------------------------------------

const hasLocalStack = existsSync(".env.e2e");

test.describe("seeded dev data renders", () => {
  test.skip(!hasLocalStack, "Needs the seeded local Supabase stack (.env.e2e).");

  test("gallery lists the seeded public cards — and never the private ones", async ({
    page,
  }) => {
    await page.goto("/gallery/browse?sort=newest");
    await expect(
      page.getByRole("link", { name: /cinderwing matriarch/i }).first(),
    ).toBeVisible();
    // A seeded DRAFT and a seeded UNLISTED card must not leak into the gallery.
    await expect(page.getByRole("link", { name: /untitled dragon idea/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /void tithe/i })).toHaveCount(0);
  });

  test("a seeded creator's public profile shows PUBLIC cards only", async ({ page }) => {
    await page.goto("/profile/dev_artist");
    await expect(
      page.getByRole("heading", { name: "Ari the Artificer", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /thornback behemoth/i }).first(),
    ).toBeVisible();
    // "Void Tithe" is seeded UNLISTED: reachable by link, never listed here —
    // and not counted in the "N public" badge (dev_artist has 14 public cards).
    await expect(page.getByRole("link", { name: /void tithe/i })).toHaveCount(0);
    await expect(page.getByText(/^14 public$/)).toBeVisible();
  });

  test("an unlisted card still opens by direct link", async ({ page }) => {
    await page.goto("/card/dev_artist/void-tithe");
    await expect(page.getByRole("heading", { name: "Void Tithe", exact: true })).toBeVisible();
  });

  test("the seeded planeswalker and saga pages open, with their comments", async ({
    page,
  }) => {
    // Not asserting the ability / chapter TEXT here: the card detail page
    // doesn't pass face_content to its live preview yet (open item in TODO.md,
    // "hand-builds the front-face <CardPreview> bag"). When that lands, add
    // `getByText(/draw a card, then discard a card/i)` — the seed has it.
    await page.goto("/card/dev_artist/veyra-stormbound");
    await expect(
      page.getByRole("heading", { name: "Veyra, Stormbound", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/legendary planeswalker — veyra/i).first()).toBeVisible();
    await expect(page.getByText(/the -2 feels right at four loyalty/i)).toBeVisible();

    await page.goto("/card/dev_artist/the-sundering-of-aldmoor");
    await expect(
      page.getByRole("heading", { name: "The Sundering of Aldmoor", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/enchantment — saga/i).first()).toBeVisible();
  });

  test("the seeded public deck and challenges are browsable", async ({ page }) => {
    await page.goto("/decks");
    await expect(
      page.getByRole("link", { name: /cinderwing dragonstorm/i }).first(),
    ).toBeVisible();

    await page.goto("/challenges");
    await expect(page.getByText(/arcane frontiers/i).first()).toBeVisible();
    await expect(page.getByText(/tiny titans/i).first()).toBeVisible();
  });

  test("the un-onboarded account has no public profile content to leak", async ({
    page,
  }) => {
    const response = await page.goto("/profile/dev_new");
    // Exists (200) but owns nothing public.
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByRole("link", { name: /cinderwing/i })).toHaveCount(0);
  });
});
