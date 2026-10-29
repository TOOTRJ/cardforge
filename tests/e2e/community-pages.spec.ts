import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// /creators and /frames/requested (TODO NV11 / NV12) at phone width: no
// sideways scroll. /creators scrolled to 747 px on a 390 px screen once —
// a creator's strip card with no stored render is drawn live, and its
// min-content widened the grid's implicit column (fixed with grid-cols-1 +
// min-w-0 on the row). With the local stack the seeded dev cards have no
// bakes, which is exactly that case; without it the pages show their
// "not available" state, which must fit too.
// ---------------------------------------------------------------------------

test.use({ viewport: { width: 390, height: 844 } });

for (const path of ["/creators", "/frames/requested"]) {
  test(`${path} fits a 390 px screen`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(widths.scroll, `${path} is ${widths.scroll} px wide`).toBeLessThanOrEqual(widths.viewport);
  });
}
