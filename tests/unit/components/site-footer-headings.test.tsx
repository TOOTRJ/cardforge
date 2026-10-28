// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SiteFooter } from "@/components/layout/site-footer";
import { siteConfig } from "@/lib/site-config";

// ---------------------------------------------------------------------------
// TODO 3b.34: the footer is on every page, the creator's included, and its
// column headings were h4s — after a page's h1 (the creator) or h2 (a
// gallery row) that skipped a level (axe "heading-order", one node per
// creator screen). They are h2s: top-level sections of the page outline.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const levelOf = (el: Element) => Number(el.tagName.slice(1));

describe("the footer's headings (3b.34)", () => {
  it("names each column with an h2", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    const headings = within(footer).getAllByRole("heading");
    expect(headings.map((h) => h.textContent?.trim())).toEqual(siteConfig.footerNav.map((c) => c.title));
    for (const heading of headings) expect(heading.tagName).toBe("H2");
  });

  it("never skips a level after a page's own h1 (the creator's outline)", () => {
    const { container } = render(
      <>
        <main>
          <h1>Create a card</h1>
        </main>
        <SiteFooter />
      </>,
    );
    const levels = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map(levelOf);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1], `heading ${i} after level ${levels[i - 1]}`).toBeLessThanOrEqual(1);
    }
  });
});
