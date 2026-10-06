import { test, expect } from "@playwright/test";
import { e2eCredentials, signIn } from "./helpers/sign-in";
import { DOUBLE_FACED_BODIES, hasLocalStack, withFramesUnverified } from "./helpers/verified-frames";

// ---------------------------------------------------------------------------
// The double-faced editor (TODO 5.2) on the LOCAL stack: the Transform chip
// → both faces → save → the card page flips.
//
// supabase/seed.sql mirrors production's frame_reviews. Production verified
// the nine double-faced bodies on 2026-10-06, so on a fresh stack the
// Transform and Modal chips are lit for everyone (the last test). The first
// two tests are about the state BEFORE a body is verified — the admin's
// frame preview, and the dark chips everyone else sees — so they withdraw
// the bodies for their own run (helpers/verified-frames.ts, local stack
// only). The seeded e2e user is an ADMIN, and an admin's frame preview
// unions the combos the URL names with the verified set (TODO 2.1): the chip
// lights for them, the save is a private frame preview (both gates skipped
// on the server, as for any preview), and the owner can open their private
// card's page, where the live hero flips to the back face. Everything else
// — the forced back face, the derived back body, the family, the colour —
// is the ordinary path.
// ---------------------------------------------------------------------------

const CREATE = "/create?previewFrames=m15dfcfront,m15dfcback&kind=transform";

test.describe("double-faced editor", () => {
  test.skip(!e2eCredentials(), "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.");

  test("Transform chip → both faces → save → the card page flips", async ({ page }) => {
    test.skip(!hasLocalStack, "Needs the local Supabase stack (.env.e2e) to set the verified frames.");
    await withFramesUnverified(DOUBLE_FACED_BODIES, async () => {
      await signIn(page);
      await page.goto(CREATE);
      await expect(page.getByTestId("frame-preview-banner")).toBeVisible();

      // The Card step's sections start collapsed: open the kind chips. The
      // Transform chip, lit by the preview; the Modal chip stays dark (its
      // bodies, 5.1b's, aren't in this preview and aren't verified).
      await page.locator("summary").filter({ hasText: /^card type/i }).first().click();
      const kinds = page.getByRole("radiogroup", { name: "Card type" });
      const modal = kinds.getByRole("radio", { name: /Modal double-faced/ });
      await expect(modal).toBeDisabled();
      const transform = kinds.getByRole("radio", { name: /^Transform/ });
      await expect(transform).toBeEnabled();
      await transform.click();
      await expect(page.locator("summary").filter({ hasText: /card type\s*transform/i })).toBeVisible();
      // The front's face type and the icon family rows under the kind chips
      // (collapsed sections; the family's summary reads the default).
      await expect(page.getByTestId("dfc-front-type")).toBeVisible();
      await expect(page.getByTestId("dfc-icon-family")).toContainText(/Arrows/);
      // A new card is colourless, and a double-faced creature can't be (design
      // D2): the colour moved to the first one the front is previewed in.
      await expect(page.locator("summary").filter({ hasText: /^colou?r/i })).not.toContainText(/colorless/i);
      // Pick blue by hand all the same, as a maker would.
      await page.locator("summary").filter({ hasText: /^colou?r/i }).first().click();
      await page.getByRole("radiogroup", { name: "Color identity" }).getByRole("radio", { name: /^blue/i }).click();
      await expect(page.locator("summary").filter({ hasText: /^colou?r/i })).toContainText(/blue/i);

      // Identity: the front's name, then the back face panel.
      const title = `Walked Transform ${Date.now()}`;
      const rail = page.getByRole("navigation", { name: /card editor steps/i });
      await rail.getByRole("button", { name: /^identity$/i }).click();
      await page.locator('input[placeholder="Emberbound Wyrm"]').fill(title);
      const panel = page.getByTestId("dfc-face-panel");
      await expect(panel).toBeVisible();
      // No mana cost on a transform back; a type and a colour of its own
      // (the colour section is collapsed: its summary names the colour).
      await expect(panel.getByRole("radiogroup", { name: "Back face type" })).toBeVisible();
      await expect(panel.getByTestId("dfc-back-color")).toContainText(/follows the front/);
      await expect(panel.getByText(/^Cost$/)).toHaveCount(0);
      const backTitle = panel.locator('input[placeholder="Insectile Aberration"]');
      await backTitle.fill(`${title} (back)`);
      // Focusing the panel flips the live preview to the back (the desktop
      // aside is the last preview in the DOM; the mobile one is hidden here).
      await expect(page.getByRole("button", { name: /show the front face/i }).last()).toBeVisible();

      // A preview saves like a draft (no art needed).
      const saveButton = page.getByRole("button", { name: /^save$/i });
      await expect(saveButton).toBeEnabled();
      await saveButton.dispatchEvent("click");
      await page.waitForURL(/\/card\/.+\/edit\?.*previewFrames=/);

      // The card page flips: the live hero's corner button turns it over.
      await page.getByRole("link", { name: /view public page/i }).click();
      await page.waitForURL(/\/card\/[^/]+\/[^/]+$/);
      const flip = page.getByRole("button", { name: /flip to back face/i });
      await expect(flip).toBeVisible();
      await flip.click();
      await expect(page.getByRole("button", { name: /flip to front face/i })).toBeVisible();
    });
  });

  test("the hint and the kind chips are dark without a verified transform combo", async ({ page }) => {
    test.skip(!hasLocalStack, "Needs the local Supabase stack (.env.e2e) to set the verified frames.");
    await withFramesUnverified(DOUBLE_FACED_BODIES, async () => {
      await signIn(page, { as: "free" });
      await page.goto("/create");
      await page.locator("summary").filter({ hasText: /^card type/i }).first().click();
      const kinds = page.getByRole("radiogroup", { name: "Card type" });
      const transform = kinds.getByRole("radio", { name: /^Transform/ });
      await expect(transform).toBeDisabled();
      await expect(transform).toContainText(/Frames awaiting verification/);
      await expect(kinds.getByRole("radio", { name: /Modal double-faced/ })).toBeDisabled();
    });
  });

  test("both double-faced kinds are offered to everyone once their bodies are verified (the seed mirrors production)", async ({ page }) => {
    // No preview, no admin: a free account on the seeded frame_reviews.
    await signIn(page, { as: "free" });
    await page.goto("/create");
    await page.locator("summary").filter({ hasText: /^card type/i }).first().click();
    const kinds = page.getByRole("radiogroup", { name: "Card type" });
    const transform = kinds.getByRole("radio", { name: /^Transform/ });
    await expect(transform).toBeEnabled();
    await expect(transform).not.toContainText(/Frames awaiting verification/);
    const modal = kinds.getByRole("radio", { name: /Modal double-faced/ });
    await expect(modal).toBeEnabled();
    await expect(modal).not.toContainText(/Frames awaiting verification/);
  });
});
