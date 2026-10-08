import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { e2eCredentials, signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// A 404 is drawn ONCE, and for a signed-in visitor it stays a 404.
//
// A notFound() thrown under a route group renders inside that group's layout.
// While the groups shared the root not-found.tsx — which wraps itself in the
// site shell, for unmatched URLs — every such 404 had two headers, two
// "what's new" ribbons and two footers. For a signed-in visitor the second
// header also mounted a second RealtimeAlerts, whose effect threw on the
// Realtime channel the first one had subscribed, and the root error boundary
// ("Something forged sideways.") replaced the 404 a moment after it appeared
// (2026-10; a private card's URL opened by anyone but its owner was one way
// in).
//
// The private-card test also pins the other half of that report: the OWNER
// of a private card opens its page by URL.
// ---------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
const hasDatabase = Boolean(url);
const hasLocalStack = Boolean(url && serviceKey) && /127\.0\.0\.1|localhost/.test(url);

const HEADING = /404 — That card isn.t in the forge/;

/** Elements in the page itself (the dev overlay's shadow DOM is not it). */
const count = (page: Page, selector: string) =>
  page.evaluate((s) => document.querySelectorAll(s).length, selector);

/** The 404 body inside one site chrome — and not the error boundary. */
async function expectOne404(page: Page) {
  await expect(page.getByRole("heading", { name: HEADING })).toBeVisible();
  for (const landmark of ["header", "main", "footer"]) {
    await expect.poll(() => count(page, landmark), { message: `<${landmark}> elements` }).toBe(1);
  }
  await expect(page.getByText("Something forged sideways.")).toHaveCount(0);
}

/** …for a signed-in visitor: their own chrome, once, and it is still the 404
 *  after everything the header loads has settled. */
async function expectSignedIn404(page: Page) {
  await expectOne404(page);
  await expect(page.getByRole("button", { name: /open account menu/i })).toHaveCount(1);
  await page.waitForLoadState("networkidle");
  await expectOne404(page);
  await expect(page.getByRole("button", { name: /open account menu/i })).toHaveCount(1);
}

test.describe("a 404 draws the site chrome once", () => {
  test("an unmatched URL (the root not-found brings the shell)", async ({ page }) => {
    const response = await page.goto("/no-such-page-anywhere");
    expect(response?.status()).toBe(404);
    await expectOne404(page);
  });

  test("a missing card (notFound() under the marketing layout)", async ({ page }) => {
    test.skip(!hasDatabase, "needs the local Supabase stack (.env.e2e)");
    const response = await page.goto("/card/nobody-here/no-such-card");
    expect(response?.status()).toBe(404);
    await expectOne404(page);
  });
});

test.describe("a signed-in visitor's 404 stays a 404", () => {
  test.skip(!e2eCredentials(), "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.");

  test("a missing card, under the marketing layout's auth island", async ({ page }) => {
    await signIn(page, { as: "free" });
    const response = await page.goto("/card/nobody-here/no-such-card");
    expect(response?.status()).toBe(404);
    await expectSignedIn404(page);
  });

  test("a card that isn't there to edit, under the signed-in layout", async ({ page }) => {
    await signIn(page, { as: "free" });
    // The page calls notFound() inside app/(app)'s loading boundary, so the
    // HTTP status is whatever the stream started with — assert what renders.
    await page.goto("/card/no-such-card-to-edit/edit");
    await expectSignedIn404(page);
  });

  test("a private card: its owner opens the page by URL, another account gets the 404", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.skip(!hasLocalStack, "Needs the local Supabase stack (.env.e2e) to seed the card.");
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: owner } = await admin.from("profiles").select("id").eq("username", "e2e_forger").single();
    const { data: system } = await admin.from("game_systems").select("id").limit(1).single();
    if (!owner || !system) throw new Error("Seed the e2e user first (node scripts/seed-e2e.mjs).");

    const slug = `private-page-probe-${Date.now()}`;
    const title = "Private Page Probe";
    const { data: card, error } = await admin
      .from("cards")
      .insert({ owner_id: owner.id, title, slug, game_system_id: system.id, visibility: "private" })
      .select("id")
      .single();
    expect(error).toBeNull();

    try {
      // The owner: RLS reads their private row through the session cookie.
      await signIn(page);
      const mine = await page.goto(`/card/e2e_forger/${slug}`);
      expect(mine?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

      // Anyone else, signed in: the row is unreadable, so it is a 404 — the
      // page, with their chrome, not the error boundary.
      const context = await browser.newContext({ baseURL });
      try {
        const visitor = await context.newPage();
        await signIn(visitor, { as: "free" });
        const theirs = await visitor.goto(`/card/e2e_forger/${slug}`);
        expect(theirs?.status()).toBe(404);
        await expectSignedIn404(visitor);
      } finally {
        await context.close();
      }
    } finally {
      await admin.from("cards").delete().eq("id", card!.id);
    }
  });
});
