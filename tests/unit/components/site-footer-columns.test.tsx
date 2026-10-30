// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The footer (TODO NV2 / WD2 / NV10): four EVEN columns — Create · Community
// · Learn · Company — one grid track each (the old grid had four tracks for
// five columns, and "Legal" wrapped onto a row of its own); the wide frame,
// as the header; the WotC disclaimer kept; every link reports nav_click with
// surface "footer".
// ---------------------------------------------------------------------------

let billingOn = true;
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => billingOn }));
const tracked = vi.fn();
vi.mock("@/lib/analytics/funnel-client", () => ({
  trackFunnelEvent: (...args: unknown[]) => tracked(...args),
}));

import { SiteFooter } from "@/components/layout/site-footer";
import { pageContainerClass } from "@/components/layout/page-container";
import { siteConfig } from "@/lib/site-config";

afterEach(() => {
  cleanup();
  billingOn = true;
  tracked.mockClear();
  document.cookie = "sb-test-auth-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

describe("the footer", () => {
  it("lays its four columns on four equal tracks", () => {
    render(<SiteFooter />);
    const nav = screen.getByRole("navigation", { name: "Footer" });
    expect(nav.className).toContain("md:grid-cols-4");
    expect(nav.children).toHaveLength(4);
    expect([...nav.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Create", "Community", "Learn", "Company"]);
  });

  it("uses the wide frame, like the header (the logo never moves)", () => {
    render(<SiteFooter />);
    const frame = screen.getByRole("contentinfo").firstElementChild!;
    for (const cls of pageContainerClass("wide").split(" ")) expect(frame.className).toContain(cls);
    expect(pageContainerClass("wide")).toContain("max-w-[1920px]");
  });

  it("keeps the WotC disclaimer", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("contentinfo").textContent).toContain(siteConfig.disclaimer);
  });

  it("drops Pricing with billing off", () => {
    billingOn = false;
    render(<SiteFooter />);
    expect(within(screen.getByRole("contentinfo")).queryByRole("link", { name: "Pricing" })).toBeNull();
  });

  it("a link reports nav_click from the footer; signed in = the session cookie's hint", () => {
    render(<SiteFooter />);
    fireEvent.click(screen.getByRole("link", { name: "Card gallery" }));
    document.cookie = "sb-test-auth-token=x";
    fireEvent.click(screen.getByRole("link", { name: "What's new" }));
    expect(tracked.mock.calls).toEqual([
      ["nav_click", { item: "community.gallery", surface: "footer", signedIn: false }],
      ["nav_click", { item: "learn.whats-new", surface: "footer", signedIn: true }],
    ]);
  });
});
