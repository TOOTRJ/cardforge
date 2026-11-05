// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO HM5: a phone's first screen shows the first hero card, small, beside
// the pip strip and the CTAs. From sm up it is gone (display:none and never
// fetched: lazy, no preload) and the wrappers are `contents`, so the desktop
// layout is the one it was.
// ---------------------------------------------------------------------------

vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));

import { MarketingHero, type HeroFeaturedCard } from "@/components/marketing/marketing-hero";

afterEach(cleanup);

const card = (slug: string, title: string): HeroFeaturedCard => ({
  slug,
  title,
  imageUrl: `https://example.supabase.co/storage/v1/object/public/card-renders/u/${slug}.thumb.webp`,
  owner: { username: "maker", displayName: "Maker" },
});

const phoneCards = (root: HTMLElement) =>
  [...root.querySelectorAll("a.sm\\:hidden")] as HTMLAnchorElement[];

describe("MarketingHero on a phone", () => {
  it("draws the first hero card once more, small, hidden from sm up, with sizes for its width", () => {
    const { container } = render(
      <MarketingHero featured={[card("first", "First Card"), card("second", "Second Card")]} />,
    );
    const [phone, ...rest] = phoneCards(container);
    expect(rest).toHaveLength(0);
    expect(phone.getAttribute("href")).toBe("/card/maker/first");
    expect(phone.className).toContain("max-w-24");
    const img = phone.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("First Card");
    expect(img.getAttribute("sizes")).toBe("(max-width: 400px) 24vw, 96px");
    // Never preloaded: a desktop would fetch a picture it never shows.
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("fetchpriority")).not.toBe("high");
  });

  it("sits beside the pip strip and the CTAs, in wrappers that vanish from sm up", () => {
    const { container } = render(<MarketingHero featured={[card("first", "First Card")]} />);
    const phone = phoneCards(container)[0];
    const row = phone.parentElement!;
    expect(row.className).toContain("sm:contents");
    const column = row.firstElementChild!;
    expect(column.className).toContain("sm:contents");
    expect(column.querySelector('[aria-label="Supports all five Magic colors"]')).not.toBeNull();
    expect(column.textContent).toContain("Explore the gallery");
  });

  it("draws no phone card with no featured cards (the placeholder pair)", () => {
    const { container } = render(<MarketingHero featured={[]} />);
    expect(phoneCards(container)).toHaveLength(0);
  });
});
