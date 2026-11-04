// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// The home page's ONE create button (owner 2026-11-04): the same words on
// every home-page button that starts a card, each click a create_cta_click
// with its surface (never cta_click: that is the Storefront chain's), and a
// visitor's remembered for the signup that may follow.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({ track: vi.fn(), remember: vi.fn() }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: s.track }));
vi.mock("@/lib/analytics/attribution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/attribution")>()),
  rememberSignupSurface: s.remember,
}));

import { CreateCtaLink } from "@/components/marketing/create-cta-link";
import { CREATE_CTA_LABEL, ctaSurfaceLabel, CTA_SURFACES } from "@/lib/marketing/create-cta";

afterEach(() => {
  cleanup();
  s.track.mockReset();
  s.remember.mockReset();
});

const code = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("CreateCtaLink", () => {
  it("says the one label, goes to /create, and records the click with its surface", () => {
    render(<CreateCtaLink surface="home_pulse" className="btn" />);
    const link = screen.getByRole("link", { name: CREATE_CTA_LABEL });
    expect(link.getAttribute("href")).toBe("/create");
    expect(link.className).toBe("btn");
    fireEvent.click(link);
    expect(s.track).toHaveBeenCalledWith("create_cta_click", { surface: "home_pulse", signedIn: false });
    expect(s.remember).toHaveBeenCalledWith("home_pulse");
  });

  it("remembers nothing for a signed-in member (no signup can follow), as the header", () => {
    document.cookie = "sb-dev-auth-token=1; path=/";
    try {
      render(<CreateCtaLink surface="home_hero" />);
      fireEvent.click(screen.getByRole("link", { name: CREATE_CTA_LABEL }));
      expect(s.track).toHaveBeenCalledWith("create_cta_click", { surface: "home_hero", signedIn: true });
      expect(s.remember).not.toHaveBeenCalled();
    } finally {
      document.cookie = "sb-dev-auth-token=; path=/; max-age=0";
    }
  });

  it("is the home page's only way to start a card: no other words, no bare /create link", () => {
    expect(CREATE_CTA_LABEL).toBe("Make a card — free");
    for (const file of ["app/(marketing)/page.tsx", "components/marketing/marketing-hero.tsx"]) {
      const source = code(file);
      expect(source).not.toMatch(/href="\/create"/);
      expect(source).not.toMatch(/Start creating|Start your journey|Forge your own/);
    }
    const surfaces = [
      ...code("app/(marketing)/page.tsx").matchAll(/<CreateCtaLink surface="(\w+)"/g),
      ...code("components/marketing/marketing-hero.tsx").matchAll(/<CreateCtaLink surface="(\w+)"/g),
    ].map((m) => m[1]);
    expect(surfaces.sort()).toEqual(["home_final", "home_hero", "home_pulse"]);
  });

  it("names every surface for the admin panel", () => {
    for (const surface of [...CTA_SURFACES, "none"]) expect(ctaSurfaceLabel(surface)).not.toBe(surface);
    expect(ctaSurfaceLabel("something_new")).toBe("something_new");
  });
});
