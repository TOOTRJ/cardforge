import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// ---------------------------------------------------------------------------
// Accessibility smoke (PipGlyph reskin) — axe-core scans of the public
// surfaces, failing on serious/critical violations. Like the marketing
// smoke, these run without Supabase env vars.
//
// Scope notes:
//   * Color-contrast is checked on the REAL rendered palette, so this guards
//     the OKLCH token values as much as the markup.
//   * Card *faces* (CardPreview) intentionally reproduce printed-card
//     contrast and aren't expected to meet web AA — axe only sees the
//     placeholder cards here, which render fine, but if a future violation
//     points inside a card face, exclude `.card-corners` rather than
//     changing trade-dress colors.
// ---------------------------------------------------------------------------

const PAGES = ["/", "/login", "/gallery", "/challenges", "/faq"];

for (const path of PAGES) {
  test(`axe scan: ${path} has no serious/critical violations`, async ({
    page,
  }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );

    expect(
      blocking.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
      })),
    ).toEqual([]);
  });
}
