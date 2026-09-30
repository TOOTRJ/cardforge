import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { e2eCredentials, signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// The compare page's two admin writes through the real stack (TODO 0.18):
//
//   * the VERIFY TOGGLE — ticking publishes the combo and records what was
//     measured (layout version, override hash, the score or its absence) plus
//     a history event; unticking withdraws it and keeps the record. Runs on
//     lotr/c, which has no reference printing, so nothing calls Scryfall (the
//     tick's score is "unavailable", which must not block the publish);
//   * the REFERENCE PIN — the search (our proxy, mocked here) → a printing of
//     the wrong colour is refused, the right one is pinned and shown, and
//     Revert clears it. The pin re-reads the card from Scryfall on the server
//     (never trusting the client) and the page renders the pinned printing
//     from Scryfall, so that test skips when Scryfall is unreachable.
//
// Both change frame_reviews on the LOCAL stack only (the service client
// refuses any other URL) and restore the row exactly as they found it — a
// combo left published would change what the creator offers the other
// specs. frame_review_events is append-only (the service role may not
// delete), so the history assertions read the newest entry, never a count.
//
// Also: a non-admin gets the not-found page and a 404 from the score route,
// and the score route answers an admin with its own 400 / 404 without
// Scryfall.
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
const hasLocalStack =
  Boolean(supabaseUrl && serviceKey) && /127\.0\.0\.1|localhost/.test(supabaseUrl);

const COMPARE_C = "/admin/frame-compare?template=lotr&color=c";
const COMPARE_U = "/admin/frame-compare?template=lotr&color=u";

// lotr/u's second registry printing (blue), and lotr/w's (white).
const GANDALF = {
  id: "eae80537-f355-4aa3-8952-b08f3d1a1e41",
  name: "Gandalf, Friend of the Shire",
  set: "ltr",
  thumb_url: null,
  image_status: "lowres",
};
const SAMWISE = {
  id: "44c6a273-9307-432a-96f5-3e536da70f95",
  name: "Samwise the Stouthearted",
  set: "ltr",
  thumb_url: null,
  image_status: "lowres",
};

type ReviewRow = Record<string, unknown>;

function serviceClient(): SupabaseClient {
  if (!hasLocalStack) throw new Error("frame-verify-pin writes to the LOCAL stack only");
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

async function readRow(admin: SupabaseClient, template: string, colorKey: string): Promise<ReviewRow | null> {
  const { data, error } = await admin
    .from("frame_reviews")
    .select("*")
    .eq("template", template)
    .eq("color_key", colorKey)
    .maybeSingle();
  if (error) throw new Error(`frame_reviews read: ${error.message}`);
  return data;
}

/** Runs `body` and puts the combo's frame_reviews row back as it was. */
async function withComboRestored(
  template: string,
  colorKey: string,
  body: (admin: SupabaseClient) => Promise<void>,
) {
  const admin = serviceClient();
  const before = await readRow(admin, template, colorKey);
  try {
    await body(admin);
  } finally {
    const { error } = before
      ? await admin.from("frame_reviews").upsert(before, { onConflict: "template,color_key" })
      : await admin.from("frame_reviews").delete().eq("template", template).eq("color_key", colorKey);
    // A failed restore would leave the combo changed for every later spec.
    if (error) throw new Error(`frame_reviews restore of ${template}/${colorKey}: ${error.message}`);
  }
}

/** The newest entry of the combo's History (listed newest first). */
async function newestHistoryAction(page: Page): Promise<string | undefined> {
  const history = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^History \(\d+\)$/ }) });
  await history.locator("summary").click();
  return (await history.locator("li").first().locator("span.font-medium").textContent())?.trim();
}

async function scryfallReachable(request: APIRequestContext): Promise<boolean> {
  try {
    const response = await request.get(`https://api.scryfall.com/cards/${GANDALF.id}`, {
      headers: { Accept: "application/json", "User-Agent": "PipGlyph-e2e/1.0" },
      timeout: 10_000,
    });
    return response.ok();
  } catch {
    return false;
  }
}

test.describe("frame compare — verify toggle and reference pin", () => {
  test.skip(!e2eCredentials(), "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.");

  test("ticking publishes lotr/c with a record, unticking withdraws it", async ({ page }) => {
    test.skip(!hasLocalStack, "Needs the local stack's service key (.env.e2e).");
    test.setTimeout(120_000);

    await withComboRestored("lotr", "c", async (admin) => {
      // Start unverified, whatever this stack held.
      const { error } = await admin.from("frame_reviews").delete().eq("template", "lotr").eq("color_key", "c");
      expect(error).toBeNull();

      await signIn(page);
      await page.goto(COMPARE_C);
      const box = page.getByRole("checkbox", { name: "Mark lotr/c as verified" });
      await expect(box).not.toBeChecked();
      await expect(page.getByTestId("verification-record")).toHaveCount(0);
      // Said twice (the header and the compare controls): no printing, no Scryfall.
      await expect(page.getByText(/No real printing exists for this combination/).first()).toBeVisible();

      // Tick: no printing to score, so the record says so — and it still publishes.
      await box.check();
      await expect(
        page.getByText(/lotr\/c verified — now available to all users\. \(Alignment score unavailable/),
      ).toBeVisible({ timeout: 60_000 });

      const ticked = await readRow(admin, "lotr", "c");
      expect(ticked).toMatchObject({ verified: true, score_json: null, verified_reference_id: null });
      expect(ticked?.verified_at).toBeTruthy();
      expect(ticked?.verified_by).toBeTruthy();
      expect(ticked?.verified_layout_version).toEqual(expect.any(Number));
      expect(ticked?.verified_override_hash).toEqual(expect.any(String));
      // A tick never touches the pinned-reference columns.
      expect(ticked?.reference_scryfall_id ?? null).toBeNull();

      await page.reload();
      await expect(box).toBeChecked();
      await expect(page.getByTestId("verification-record")).toContainText(
        new RegExp(
          `Verified:\\s*layout v${ticked?.verified_layout_version} · override ${ticked?.verified_override_hash} — current layout v\\d+`,
        ),
      );
      expect(await newestHistoryAction(page)).toBe("verify");

      // Untick: withdrawn, the stamped record stays.
      await box.uncheck();
      await expect(page.getByText("lotr/c withdrawn from the picker.")).toBeVisible({ timeout: 30_000 });
      const withdrawn = await readRow(admin, "lotr", "c");
      expect(withdrawn).toMatchObject({
        verified: false,
        verified_at: null,
        verified_by: null,
        verified_layout_version: ticked?.verified_layout_version,
        verified_override_hash: ticked?.verified_override_hash,
      });

      await page.reload();
      await expect(box).not.toBeChecked();
      await expect(page.getByTestId("verification-record")).toHaveCount(0);
      expect(await newestHistoryAction(page)).toBe("withdraw");
    });
  });

  test("the score route answers an admin's bad or printing-less request without Scryfall", async ({ page }) => {
    await signIn(page);
    const invalid = await page.request.post("/api/admin/frame-align-score", {
      data: { template: "lotr", color: "a" },
    });
    expect(invalid.status()).toBe(400);
    const none = await page.request.post("/api/admin/frame-align-score", {
      data: { template: "lotr", color: "c" },
    });
    expect(none.status()).toBe(404);
    expect(await none.json()).toEqual({ ok: false, error: "No reference printing for this combination." });
  });

  test("pin: a wrong colour is refused, the right printing pinned and shown, Revert clears it", async ({
    page,
    request,
  }) => {
    test.skip(!hasLocalStack, "Needs the local stack's service key (.env.e2e).");
    test.skip(!(await scryfallReachable(request)), "Scryfall is unreachable — the pin re-reads the card server-side.");
    test.setTimeout(120_000);

    // Our search proxy, mocked: the pin itself still goes through the server.
    await page.route("**/api/scryfall/search**", async (route) => {
      const q = new URL(route.request().url()).searchParams.get("q") ?? "";
      await route.fulfill({ json: { ok: true, results: /samwise/i.test(q) ? [SAMWISE] : [GANDALF] } });
    });

    await withComboRestored("lotr", "u", async (admin) => {
      await admin
        .from("frame_reviews")
        .update({ reference_scryfall_id: null, reference_name: null, reference_set: null })
        .eq("template", "lotr")
        .eq("color_key", "u");
      const before = await readRow(admin, "lotr", "u");

      await signIn(page);
      await page.goto(COMPARE_U);
      await expect(page.getByRole("button", { name: /revert to default/i })).toHaveCount(0);

      await page.getByRole("button", { name: /change reference card/i }).click();
      const search = page.getByRole("searchbox", { name: "Search Scryfall for a reference card" });

      // A white printing on the blue row: refused, nothing pinned.
      await search.fill("samwise");
      await page.getByRole("button", { name: /Samwise the Stouthearted/ }).click();
      await expect(
        page.getByText(/Samwise the Stouthearted is a white card; this row verifies the blue/),
      ).toBeVisible({ timeout: 30_000 });
      expect((await readRow(admin, "lotr", "u"))?.reference_scryfall_id ?? null).toBeNull();

      // The blue one: pinned (with the low-res warning), shown after the refresh.
      await search.fill("gandalf");
      await page.getByRole("button", { name: /Gandalf, Friend of the Shire/ }).click();
      await expect(page.getByText(/Reference set to Gandalf, Friend of the Shire/)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: /revert to default/i })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("reference-switcher")).toContainText(
        "Pinned · Gandalf, Friend of the Shire (LTR)",
      );
      const pinned = await readRow(admin, "lotr", "u");
      expect(pinned).toMatchObject({
        reference_scryfall_id: GANDALF.id,
        reference_name: GANDALF.name,
        reference_set: "ltr",
        // Pinning never ticks or unticks.
        verified: before?.verified ?? false,
      });
      expect(await newestHistoryAction(page)).toBe("pin");

      // Revert: back to the registry default.
      await page.getByRole("button", { name: /revert to default/i }).click();
      await expect(page.getByText("Reverted to the default reference.")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: /revert to default/i })).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByTestId("reference-switcher")).not.toContainText("Pinned");
      expect(await readRow(admin, "lotr", "u")).toMatchObject({
        reference_scryfall_id: null,
        reference_name: null,
        reference_set: null,
      });
    });
  });

  test("a non-admin gets the not-found page and a 404 from the score route", async ({ page }) => {
    await signIn(page, { as: "free" });
    // The page calls notFound() inside app/(app)'s loading boundary, so the
    // HTTP status is whatever the stream started with — assert what renders.
    await page.goto(COMPARE_U);
    await expect(page.getByRole("heading", { name: /404 — That card isn.t in the forge/ })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /as verified/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /change reference card/i })).toHaveCount(0);

    const refused = await page.request.post("/api/admin/frame-align-score", {
      data: { template: "lotr", color: "u" },
    });
    expect(refused.status()).toBe(404);
  });
});
