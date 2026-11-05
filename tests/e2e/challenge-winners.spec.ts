import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// A closed challenge's winners (TODO NV12, migration 0172), read as an
// anonymous visitor from the seeded stack (supabase/seeds/44_challenge_winners.sql:
// Tiny Titans — 1st Archivist of Lost Hours, 2nd Hedge Witch's Familiar,
// 3rd Tidecaller Adept, Sunlit Vanguard an unplaced entry). Read-only.
// ---------------------------------------------------------------------------

const hasLocalStack = existsSync(".env.e2e");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

test.describe("challenge winners", () => {
  test.skip(!hasLocalStack, "Needs the seeded local Supabase stack (.env.e2e).");

  test("the closed challenge's page names its three winners in order", async ({ page }) => {
    await page.goto("/challenges/tiny-titans");
    const winners = page.getByRole("region", { name: "Winners" });
    await expect(winners.getByRole("heading", { name: "Winners" })).toBeVisible();
    const items = winners.getByRole("listitem");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText("1st place");
    await expect(items.nth(0).getByRole("link", { name: /archivist of lost hours/i }).first()).toBeVisible();
    await expect(items.nth(1)).toContainText("2nd place");
    await expect(items.nth(1).getByRole("link", { name: /hedge witch/i }).first()).toBeVisible();
    await expect(items.nth(2)).toContainText("3rd place");
    await expect(items.nth(2).getByRole("link", { name: /tidecaller adept/i }).first()).toBeVisible();
    await expect(winners.getByRole("link", { name: /sunlit vanguard/i })).toHaveCount(0);
  });

  test("/challenges' list names no winners (owner 2026-11-05)", async ({ page }) => {
    await page.goto("/challenges");
    await expect(page.getByText(/tiny titans/i).first()).toBeVisible();
    await expect(page.getByText(/\b(1st|2nd|3rd) place\b/)).toHaveCount(0);
  });

  test("a winning card's page says so, and its JSON-LD carries the award", async ({ page }) => {
    await page.goto("/card/dev_free/hedge-witchs-familiar");
    const wins = page.getByRole("list", { name: "Challenge wins" });
    await expect(wins.getByRole("link", { name: /2nd place · tiny titans/i })).toHaveAttribute(
      "href",
      "/challenges/tiny-titans",
    );
    const awards = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((nodes) => nodes.map((n) => JSON.parse(n.textContent ?? "{}").award).filter(Boolean));
    expect(awards).toContain("2nd place, Tiny Titans design challenge");
  });

  test("an entry that placed nowhere carries no badge", async ({ page }) => {
    await page.goto("/card/dev_artist/sunlit-vanguard");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("list", { name: "Challenge wins" })).toHaveCount(0);
  });

  test("the API hands a visitor the wins but never who named them", async ({ request }) => {
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    const ok = await request.get(`${url}/rest/v1/challenge_winners?select=place,card_id`, { headers });
    expect(ok.ok()).toBe(true);
    expect((await ok.json()).length).toBeGreaterThanOrEqual(3);
    const named = await request.get(`${url}/rest/v1/challenge_winners?select=named_by`, { headers });
    expect(named.ok()).toBe(false);
  });
});
