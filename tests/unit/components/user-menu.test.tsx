// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The Account menu (the avatar's disclosure panel, TODO NV1). Its admin
// shortcuts: Frame requests joined them on 2026-09-29 (TODO 1.6, owner
// decision D5); since the admin audit (I1) the menu lists EVERY admin page,
// from siteConfig.adminNav — the list the dashboard rail reads. Only admins
// see any of them. The menu also carries My decks and New deck, and ONE
// billing destination.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/decks/new" }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));
vi.mock("@/app/(auth)/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => false }));

import { UserMenu } from "@/components/layout/user-menu";
import { siteConfig } from "@/lib/site-config";

const ADMIN_SHORTCUTS = siteConfig.adminNav.map((item) => [item.label, item.href] as const);

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
}

afterEach(cleanup);

describe("UserMenu admin shortcuts", () => {
  it("lists all twelve admin pages for an admin, in the rail's order, Frame requests after Frame compare (D5)", () => {
    expect(ADMIN_SHORTCUTS).toHaveLength(12);
    render(<UserMenu username="dev_admin" displayName="Dev Admin" isAdmin />);
    openMenu();
    const admin = screen.getByRole("navigation", { name: "Admin" });
    const links = [...admin.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual(ADMIN_SHORTCUTS.map(([label, href]) => [label, href]));
    const labels = links.map(([label]) => label);
    expect(labels.indexOf("Frame requests")).toBe(labels.indexOf("Frame compare") + 1);
  });

  it("shows no admin shortcut to anyone else", () => {
    render(<UserMenu username="dev_pro" displayName="Priya" />);
    openMenu();
    expect(screen.queryByRole("navigation", { name: "Admin" })).toBeNull();
    for (const [, href] of ADMIN_SHORTCUTS) {
      expect(document.querySelector(`a[href="${href}"]`), href).toBeNull();
    }
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
  });
});

describe("UserMenu links", () => {
  it("My decks and New deck, the profile, and ONE current page — the longest match", () => {
    render(<UserMenu username="dev_pro" displayName="Priya" hasMessages unreadMessages={12} />);
    openMenu();
    expect(screen.getByRole("link", { name: "My decks" }).getAttribute("href")).toBe("/dashboard/decks");
    expect(screen.getByRole("link", { name: "New deck" }).getAttribute("href")).toBe("/dashboard/decks/new");
    expect(screen.getByRole("link", { name: "View profile" }).getAttribute("href")).toBe("/profile/dev_pro");
    expect(screen.getByRole("link", { name: "Messages (9+)" }).getAttribute("href")).toBe("/messages");
    const current = [...document.querySelectorAll('[aria-current="page"]')].map((a) => a.textContent);
    expect(current).toEqual(["New deck"]);
  });

  it("no Messages without a support thread; no billing row with billing off", () => {
    render(<UserMenu username="dev_free" displayName="Finn" />);
    openMenu();
    expect(screen.queryByRole("link", { name: /messages/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /billing/i })).toBeNull();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
  });
});
