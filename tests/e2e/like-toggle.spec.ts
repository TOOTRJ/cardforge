import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Liking from an anonymous-rendered listing page (the gallery is ISR'd, so the
// tile's props never change after a like) — the heart must STAY filled once
// the server confirms, and toggling must not spam the owner with duplicate
// notifications (migration 0101). Needs the local stack (tests/README.md).
// ---------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
const email = process.env.SUPABASE_E2E_USER_EMAIL ?? "";
const password = process.env.SUPABASE_E2E_USER_PASSWORD ?? "";
const hasStack =
  Boolean(url && serviceKey && email && password) && /127\.0\.0\.1|localhost/.test(url);

// Seeded public card owned by dev_artist (supabase/seeds/10_dev_data.sql).
const CARD_ID = "c0000000-0000-4000-a000-000000000005"; // Thornback Behemoth
const OWNER_ID = "d0000000-0000-4000-a000-000000000004";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("like toggle", () => {
  test.skip(!hasStack, "Needs the local Supabase stack (.env.e2e).");

  test("the heart stays filled after the action settles, and toggling never duplicates the owner's notification", async ({
    page,
  }) => {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: me } = await admin
      .from("profiles")
      .select("id")
      .eq("username", "e2e_forger")
      .single();
    if (!me) throw new Error("Seed the e2e user first.");
    // Clean slate for this actor/card pair.
    await admin.from("card_likes").delete().eq("user_id", me.id).eq("card_id", CARD_ID);
    await admin
      .from("notifications")
      .delete()
      .eq("actor_id", me.id)
      .eq("type", "like")
      .eq("card_id", CARD_ID);
    const likeNotifications = async () => {
      const { count } = await admin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", OWNER_ID)
        .eq("actor_id", me.id)
        .eq("type", "like")
        .eq("card_id", CARD_ID);
      return count ?? 0;
    };

    await signIn(page);
    // The GALLERY is the anonymous-rendered (ISR) surface where the tile's
    // props never change after a like — the case that used to snap back.
    await page.goto("/gallery?sort=newest");
    const tile = page
      .locator("div")
      .filter({ has: page.locator('a[href="/card/dev_artist/thornback-behemoth"]') })
      .filter({ has: page.getByRole("button", { name: /^(un)?like \(\d+\)$/i }) })
      .last();
    const heart = () => tile.getByRole("button", { name: /^(un)?like \(\d+\)$/i });
    await expect(heart()).toBeVisible();
    await expect(heart()).toHaveAttribute("aria-pressed", "false");

    await heart().click();
    await expect(heart()).toHaveAttribute("aria-pressed", "true");
    // Let the server action settle — the heart used to flip back right here.
    await page.waitForTimeout(1500);
    await expect(heart()).toHaveAttribute("aria-pressed", "true");
    await expect.poll(likeNotifications).toBe(1);

    // Toggle off and on again: the unread row is retracted, then exactly one
    // notification exists again — never two.
    await heart().click();
    await expect(heart()).toHaveAttribute("aria-pressed", "false");
    await expect.poll(likeNotifications).toBe(0);
    await heart().click();
    await expect(heart()).toHaveAttribute("aria-pressed", "true");
    await expect.poll(likeNotifications).toBe(1);
  });
});
