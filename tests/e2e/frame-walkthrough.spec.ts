import { test, expect } from "@playwright/test";
import { e2eCredentials, signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// Admin walk through the stepper (TODO Phase 2) on the LOCAL stack, where
// the seeded e2e user is an admin and migration 0121 is applied:
//   * /create?previewFrames=all&…&seed=sample opens the creator on an
//     UNVERIFIED frame (battle — supabase/seed.sql never verifies it) with
//     the admin banner, prefilled with the compare view's sample content (no
//     Scryfall call);
//   * the save is a private frame preview and keeps preview mode on the
//     edit page;
//   * My Cards badges it "Frame preview", and a bulk "Make public" of only
//     previews publishes nothing and says why;
//   * the preview is listed under its template in the checklist and in the
//     template's sign-off view, and deleting it there removes it;
//   * the sign-off view shows every colour side by side and offers the
//     one-job "Score all colours" (TODO 4.12);
//   * a non-admin with the same URL gets the ordinary creator, and the
//     scoring job's route answers them 404.
// ---------------------------------------------------------------------------

const WALK = "/create?previewFrames=all&kind=battle&template=battle&color=r&seed=sample";

test.describe("admin frame walk-through", () => {
  test.skip(!e2eCredentials(), "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.");

  test("walk an unverified frame, save a private preview, find it and delete it", async ({ page }) => {
    await signIn(page);
    await page.goto(WALK);

    const banner = page.getByTestId("frame-preview-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Admin frame preview/);
    await expect(page.getByTestId("frame-walkthrough-note")).toContainText(/battle\/r/);
    // The walk starts on the Card step, already on the frame and colour under
    // test (the Card step's sections are collapsed summaries once a kind is
    // set — the chips themselves are not rendered), and its save is a preview.
    const rail = page.getByRole("navigation", { name: /card editor steps/i });
    await expect(rail.locator('[aria-current="step"]')).toHaveText(/^\s*card\s*$/i);
    await expect(page.locator("summary").filter({ hasText: /card type\s*battle/i })).toBeVisible();
    await expect(
      page.locator("summary").filter({ hasText: /frame\s*m15 \(2015\) — battle/i }),
    ).toBeVisible();
    await expect(page.locator("summary").filter({ hasText: /colou?r\s*red/i })).toBeVisible();
    await expect(page.getByTestId("frame-preview-save")).toBeVisible();

    // Rename the sample so this run's card is findable.
    const title = `Walked Battle ${Date.now()}`;
    await rail.getByRole("button", { name: /^identity$/i }).click();
    await page.locator('input[placeholder="Emberbound Wyrm"]').fill(title);

    // No artwork and no draft tick: a preview saves like a draft.
    const saveButton = page.getByRole("button", { name: /^save$/i });
    await expect(saveButton).toBeEnabled();
    await saveButton.dispatchEvent("click");
    await page.waitForURL(/\/card\/.+\/edit\?.*previewFrames=all/);
    await expect(page.getByTestId("frame-preview-banner")).toContainText(/frame preview/);
    await expect(page.getByText("Private", { exact: true }).first()).toBeVisible();

    // My Cards badges it "Frame preview", and a bulk "Make public" of only
    // previews publishes nothing and says why (owner, 2026-09-28).
    await page.goto("/dashboard/cards");
    await page.getByRole("searchbox", { name: /search your cards/i }).fill(title);
    await expect(page.getByTestId("frame-preview-card-badge")).toHaveCount(1);
    await expect(page.getByTestId("frame-preview-card-badge")).toHaveText("Frame preview");
    await page.getByRole("button", { name: /^select$/i }).click();
    await page.getByRole("button", { name: /^select all$/i }).click();
    await page.getByRole("button", { name: /^make public$/i }).click();
    await expect(
      page.getByText(/Nothing was published: the selected card is a frame preview/),
    ).toBeVisible();

    // The template's sign-off view lists it under its colour.
    await page.goto("/admin/frame-compare?template=battle");
    await expect(page.getByTestId("frame-template-signoff")).toBeVisible();
    await expect(page.getByTestId("signoff-colour-r")).toContainText(title);
    await expect(page.getByTestId("signoff-publish")).toBeDisabled();
    // Every colour side by side (TODO 4.12) — our render next to its
    // printing, or the sample when the lookup fails — and the one-job scorer.
    await expect(page.getByTestId("signoff-side-by-side")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(/^side-by-side-[wubrgcm]$/)).toHaveCount(7);
    await expect(page.getByTestId("score-all-colours")).toBeEnabled();

    // The checklist lists it under the template; delete it from there.
    await page.goto("/admin/frame-compare");
    await page.locator("summary").filter({ hasText: "M15 (2015)" }).click();
    const item = page.getByTestId("frame-preview-item").filter({ hasText: title });
    await expect(item).toBeVisible();
    await expect(item.getByRole("link", { name: "Re-verify" })).toHaveAttribute(
      "href",
      /\/edit\?previewFrames=battle$/,
    );
    await item.getByRole("button", { name: /^Delete the preview/ }).click();
    await item.getByRole("button", { name: /^Confirm deleting/ }).click();
    await expect(page.getByTestId("frame-preview-item").filter({ hasText: title })).toHaveCount(0, {
      timeout: 20_000,
    });
  });

  test("a non-admin's previewFrames is ignored", async ({ page }) => {
    await signIn(page, { as: "free" });
    await page.goto(WALK);
    await expect(page.getByRole("heading", { name: /forge a new card/i })).toBeVisible();
    await expect(page.getByTestId("frame-preview-banner")).toHaveCount(0);
    await expect(page.getByTestId("frame-preview-save")).toHaveCount(0);

    // The scoring job is admin-only, checked on the server (TODO 4.12).
    const refused = await page.request.post("/api/admin/frame-score-batch", {
      data: { combos: [{ template: "battle", colorKey: "r" }] },
      headers: { origin: new URL(page.url()).origin },
    });
    expect(refused.status()).toBe(404);
  });
});
