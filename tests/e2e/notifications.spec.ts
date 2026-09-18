import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Notification acknowledgement: opening the bell marks everything seen — the
// header badge and the dashboard "Notifications" count clear, while the items
// that were new keep their highlight for that open. Visiting /notifications
// does the same. Seeds an unread notification for the e2e user through the
// local stack's service role.
// ---------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
const email = process.env.SUPABASE_E2E_USER_EMAIL ?? "";
const password = process.env.SUPABASE_E2E_USER_PASSWORD ?? "";
const hasStack = Boolean(url && serviceKey && email && password) && /127\.0\.0\.1|localhost/.test(url);

async function seedUnread(count: number) {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: me } = await admin.from("profiles").select("id").eq("username", "e2e_forger").single();
  const { data: other } = await admin
    .from("profiles")
    .select("id")
    .neq("username", "e2e_forger")
    .limit(1)
    .single();
  if (!me || !other) throw new Error("Seed the e2e user and at least one other profile first.");
  await admin.from("notifications").delete().eq("recipient_id", me.id);
  await admin.from("notifications").insert(
    Array.from({ length: count }, () => ({ recipient_id: me.id, actor_id: other.id, type: "follow" })),
  );
  return admin;
}

test.describe("notifications are seen on open", () => {
  test.skip(!hasStack, "Needs the local Supabase stack (.env.e2e).");

  test("opening the bell clears the badge and the dashboard count", async ({ page }) => {
    const admin = await seedUnread(2);

    await page.goto("/login");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL("**/dashboard");

    const bell = page.getByRole("button", { name: /notifications \(2 unread\)/i });
    await expect(bell).toBeVisible();
    const railBadge = page.getByRole("link", { name: /^notifications 2 unread$/i }); // dashboard rail
    await expect(railBadge).toBeVisible();

    await bell.click();
    // The two new items stay highlighted for this open…
    await expect(page.getByRole("img", { name: "New" })).toHaveCount(2);
    // …but the badge is gone and the DB agrees.
    await expect(page.getByRole("button", { name: /^notifications$/i })).toBeVisible();
    await expect
      .poll(async () => {
        const { count } = await admin
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .is("read_at", null);
        return count;
      })
      .toBe(0);

    // Dashboard count refreshes to zero; the next open shows items plain.
    await page.keyboard.press("Escape");
    await expect(railBadge).toHaveCount(0);
    await page.getByRole("button", { name: /^notifications$/i }).click();
    await expect(page.getByRole("img", { name: "New" })).toHaveCount(0);
    await expect(page.getByText(/clear all/i)).toHaveCount(0);
  });

  test("visiting /notifications marks everything seen", async ({ page }) => {
    const admin = await seedUnread(1);

    await page.goto("/login");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/notifications");
    await expect(page.getByRole("img", { name: "New" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^notifications$/i })).toBeVisible();
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    expect(count).toBe(0);
    await page.reload();
    await expect(page.getByRole("img", { name: "New" })).toHaveCount(0);
  });
});
