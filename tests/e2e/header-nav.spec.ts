import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// ---------------------------------------------------------------------------
// The grouped header (TODO NV1 / WD2) in a real browser, signed out — runs
// without Supabase, like the marketing smoke. Community, Learn and Account
// are WAI-ARIA disclosures: keyboard-operable, one open at a time, Escape
// hands focus back. Below 1024 px the menu button opens a dialog drawer.
// The visible nav is there from 1024 px and the row never overflows.
// ---------------------------------------------------------------------------

test.describe("header disclosures (desktop)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("keyboard: Enter / Space open, Tab walks in, Escape closes and returns focus", async ({ page }) => {
    await page.goto("/about");
    const header = page.getByRole("banner");
    const community = header.getByRole("button", { name: "Community", exact: true });
    await community.focus();
    await page.keyboard.press("Enter");
    await expect(community).toHaveAttribute("aria-expanded", "true");
    const panel = page.locator(`#${await community.getAttribute("aria-controls")}`);
    await expect(panel).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("link", { name: /card gallery/i })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(community).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await expect(community).toBeFocused();
    await page.keyboard.press("Space");
    await expect(community).toHaveAttribute("aria-expanded", "true");
  });

  test("one panel at a time; a click outside closes it; no menu roles", async ({ page }) => {
    await page.goto("/about");
    const header = page.getByRole("banner");
    const community = header.getByRole("button", { name: "Community", exact: true });
    const learn = header.getByRole("button", { name: "Learn", exact: true });
    const account = header.getByRole("button", { name: "Account", exact: true });
    await community.click();
    await learn.click();
    await expect(community).toHaveAttribute("aria-expanded", "false");
    await expect(learn).toHaveAttribute("aria-expanded", "true");
    await account.click();
    await expect(learn).toHaveAttribute("aria-expanded", "false");
    await expect(header.getByRole("link", { name: /sign in/i })).toBeVisible();
    await page.locator("main h1").first().click();
    await expect(account).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('header [role="menu"], header [role="menuitem"]')).toHaveCount(0);
  });

  test("axe: no serious or critical violations with each panel open", async ({ page }) => {
    await page.goto("/about");
    const header = page.getByRole("banner");
    for (const name of ["Community", "Learn", "Account"]) {
      await header.getByRole("button", { name, exact: true }).click();
      // Past the panel's 140 ms fade-in: axe reads colours as they are drawn.
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).include("header").analyze();
      const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(blocking.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) })), name).toEqual([]);
    }
  });
});

test.describe("header row widths", () => {
  for (const width of [1024, 1280, 1366, 1920]) {
    test(`${width} px: the nav is visible and nothing overflows`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/about");
      const header = page.getByRole("banner");
      await expect(header.getByRole("navigation", { name: "Main" })).toBeVisible();
      await expect(header.getByRole("button", { name: "Open navigation menu" })).toBeHidden();
      const overflow = await page.evaluate(() => {
        const row = document.querySelector("header > div")!;
        return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          row: row.scrollWidth - row.clientWidth,
          // The header and footer share the wide frame: the logo never moves.
          logos: [...document.querySelectorAll('a[aria-label="PipGlyph home"]')].map((a) =>
            Math.round(a.getBoundingClientRect().left),
          ),
        };
      });
      expect(overflow.page).toBeLessThanOrEqual(0);
      expect(overflow.row).toBeLessThanOrEqual(0);
      expect(new Set(overflow.logos).size).toBe(1);
    });
  }
});

test.describe("the drawer (phone)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Create stays in the bar; the menu is a dialog with accordions; Escape returns focus", async ({ page }) => {
    await page.goto("/about");
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Create a card" })).toBeVisible();
    await expect(header.getByRole("navigation", { name: "Main" })).toBeHidden();
    const trigger = header.getByRole("button", { name: "Open navigation menu" });
    await trigger.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: /create a card/i })).toBeVisible();
    const learn = drawer.getByRole("button", { name: "Learn", exact: true });
    await expect(learn).toHaveAttribute("aria-expanded", "false");
    await learn.click();
    await expect(learn).toHaveAttribute("aria-expanded", "true");
    await expect(drawer.getByRole("link", { name: /what's new/i })).toBeVisible();
    await expect(drawer.getByRole("link", { name: /sign in/i })).toBeVisible();
    await page.waitForTimeout(300);
    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
