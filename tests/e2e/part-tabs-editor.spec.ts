import { test, expect } from "@playwright/test";
import { e2eCredentials, signIn } from "./helpers/sign-in";

// ---------------------------------------------------------------------------
// Face tabs, part 2 (TODO 5.14): the four two-part kinds that are ONE
// picture — Split, Aftermath, Adventure, Flip. One happy path per kind, with
// only the tabs: the kind chip → the switch in the kind's own words → the
// second part's fields on its own tab of the Identity and Text steps (out of
// the "More options" fold they were in) → the ring on the single preview →
// save as a private draft → reopen: both parts are as typed.
//
// The seeded e2e user is an ADMIN: `?previewFrames=all` lights every kind
// chip whatever the seed's verified combos are (a split frame is not
// verified in supabase/seed.sql; its save is then a private frame preview).
// ---------------------------------------------------------------------------

const KINDS = [
  { kind: "split", chip: /^Split/, first: "Left half", second: "Right half", ownArt: true },
  { kind: "aftermath", chip: /^Aftermath/, first: "Top half", second: "Aftermath half", ownArt: true },
  { kind: "adventure", chip: /^Adventure/, first: "Creature", second: "Adventure spell", ownArt: false },
  { kind: "flip", chip: /^Flip/, first: "Top side", second: "Flipped side", ownArt: false },
] as const;

test.describe("two-part kinds: the part tabs", () => {
  test.skip(!e2eCredentials(), "Set SUPABASE_E2E_USER_EMAIL + SUPABASE_E2E_USER_PASSWORD to run.");

  for (const { kind, chip, first, second, ownArt } of KINDS) {
    test(`${kind}: both parts through the tabs → draft → reopen`, async ({ page }) => {
      await signIn(page);
      await page.goto("/create?previewFrames=all");
      await page.locator("summary").filter({ hasText: /^card type/i }).first().click();
      await page.getByRole("radiogroup", { name: "Card type" }).getByRole("radio", { name: chip }).click();

      const firstTab = page.getByRole("tab", { name: new RegExp(`^${first}`) });
      const secondTab = page.getByRole("tab", { name: new RegExp(`^${second}`) });
      await expect(firstTab).toHaveAttribute("aria-selected", "true");
      // A part with no picture of its own is not asked for artwork.
      await expect(secondTab).toContainText(ownArt ? /needs a name and artwork/ : /needs a name$/);
      // The Card step is the card's: the switch stays usable and says so.
      await secondTab.click();
      await expect(page.getByTestId("face-switch-note")).toContainText(/Everything on this step is shared by both/);
      // (The Card type section folds shut once a kind is picked: its bar.)
      await expect(page.locator("summary").filter({ hasText: /^card type/i }).first()).toBeVisible();
      // ONE picture: no two-face preview; the part being edited is ringed.
      await expect(page.getByTestId("face-preview")).toHaveCount(0);
      const ring = page.getByTestId("part-outline").filter({ visible: true }).first();
      await expect(ring).toHaveAttribute("data-face", "back");
      await expect(page.getByTestId("part-editing-label").filter({ visible: true }).first()).toContainText(
        `Editing: ${second}`,
      );

      // Identity — the second part's tab stays through the step change.
      const title = `Walked ${kind} ${Date.now()}`;
      const rail = page.getByRole("navigation", { name: /card editor steps/i });
      await rail.getByRole("button", { name: /^identity$/i }).click();
      await expect(secondTab).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText(/More options — artist credit &/)).toHaveCount(0);
      await page.getByLabel(new RegExp(`^${second} — Title`)).fill(`${title} (second)`);
      await page
        .getByRole("radiogroup", { name: `${second} card type` })
        .getByRole("radio", { name: /^Sorcery/ })
        .click();
      await page.locator("[name='back_face.subtypes_text']").fill("Arcane");
      // The first part's own fields are on ITS tab.
      await expect(page.locator("[name='title']")).toHaveCount(0);
      await firstTab.click();
      await expect(ring).toHaveAttribute("data-face", "front");
      await page.getByLabel(new RegExp(`^${first} — Title`)).fill(title);
      await expect(page.locator("[name='back_face.title']")).toHaveCount(0);

      // Text & stats — the second part's rules where the first part's are.
      await rail.getByRole("button", { name: /^text/i }).click();
      await secondTab.click();
      await page.getByLabel(`${second} rules text`, { exact: true }).click();
      await page.keyboard.type("Tap target permanent.");
      await expect(page.locator("[name='back_face.flavor_text']")).toHaveCount(kind === "adventure" ? 0 : 1);

      // A private draft needs no artwork.
      await rail.getByRole("button", { name: /^publish$/i }).click();
      const draft = page.getByTestId("save-as-draft");
      if (!(await draft.isChecked())) await draft.check();
      const saveButton = page.getByRole("button", { name: /^save$/i });
      await expect(saveButton).toBeEnabled();
      await saveButton.dispatchEvent("click");
      await page.waitForURL(/\/card\/.+\/edit/);

      // Reopen: the stored card, on its first part; the second on its tab.
      await page.reload();
      await expect(firstTab).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("[name='title']")).toHaveValue(title);
      await secondTab.click();
      await expect(page.locator("[name='back_face.title']")).toHaveValue(`${title} (second)`);
      await expect(page.locator("[name='back_face.subtypes_text']")).toHaveValue("Arcane");
      await expect(
        page.getByRole("radiogroup", { name: `${second} card type` }).getByRole("radio", { checked: true }),
      ).toContainText("Sorcery");
      await rail.getByRole("button", { name: /^text/i }).click();
      await expect(page.getByLabel(`${second} rules text`, { exact: true })).toContainText("Tap target permanent.");
    });
  }
});
