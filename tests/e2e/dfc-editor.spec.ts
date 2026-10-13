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

      // Face tabs (TODO 5.14): ONE Front face | Back face switch above every
      // step. The back's type and colour are on the Card step, where the
      // front's are, while the Back face tab is selected (collapsed
      // sections: the summaries name the values).
      const frontTab = page.getByRole("tab", { name: /^Front face/ });
      const backTab = page.getByRole("tab", { name: /^Back face/ });
      await expect(frontTab).toHaveAttribute("aria-selected", "true");
      await expect(backTab).toContainText(/needs a name and artwork/);
      await backTab.click();
      await expect(backTab).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("dfc-back-type")).toContainText(/Creature/);
      await expect(page.getByTestId("dfc-back-color")).toContainText(/follows the front/);
      await expect(page.getByTestId("dfc-front-type")).toHaveCount(0);
      // The preview shows the face being edited, and says so; the other one
      // is the small button beside it (the desktop aside is the last in the
      // DOM; the phone block is hidden at this width).
      await expect(page.getByTestId("face-preview-showing").last()).toHaveText("Showing: Back face");
      await expect(page.getByRole("button", { name: "Front face — edit this face" }).last()).toBeVisible();
      // A 1024 × 768 window: the preview is ONE sticky column beside the
      // form, and whatever stands under the large card falls off its foot
      // for good (a sticky column never scrolls). The other face stands in
      // the label's row there — whole, in the window.
      const desktop = page.viewportSize()!;
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.getByTestId("face-preview-showing").last().scrollIntoViewIfNeeded();
      await expect(page.getByTestId("face-preview-other").last()).toBeInViewport({ ratio: 1 });
      await page.setViewportSize(desktop);

      // Identity: the selected face's name — the back's, then the front's.
      const title = `Walked Transform ${Date.now()}`;
      const rail = page.getByRole("navigation", { name: /card editor steps/i });
      await rail.getByRole("button", { name: /^identity$/i }).click();
      // The tab stays through a step change; the preview with it.
      await expect(backTab).toHaveAttribute("aria-selected", "true");
      await page.getByLabel(/^Back face — Title/).fill(`${title} (back)`);
      await expect(page.locator('input[placeholder="Emberbound Wyrm"]')).toHaveCount(0);
      await expect(backTab).toContainText(/needs artwork/);
      // No mana cost on a transform back: the Text step says so in its place.
      await rail.getByRole("button", { name: /^text/i }).click();
      await expect(page.getByTestId("back-no-cost-note")).toBeVisible();
      await expect(page.getByLabel("Back face rules text")).toBeVisible();
      // The small front face switches the tab back.
      await page.getByRole("button", { name: "Front face — edit this face" }).last().click();
      await expect(frontTab).toHaveAttribute("aria-selected", "true");
      await expect(page.getByTestId("face-preview-showing").last()).toHaveText("Showing: Front face");
      await rail.getByRole("button", { name: /^identity$/i }).click();
      await page.locator('input[placeholder="Emberbound Wyrm"]').fill(title);

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
