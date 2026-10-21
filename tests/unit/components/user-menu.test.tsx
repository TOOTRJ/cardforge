// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The avatar dropdown's admin shortcuts. Frame requests joined them on
// 2026-09-29 (TODO 1.6, owner decision D5); since the admin audit (I1) the
// menu lists EVERY admin page, from siteConfig.adminNav — the list the
// dashboard rail reads. Only admins see any of them.
// The popover renders inline here — the menu's contents are what's tested.
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/app/(auth)/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => false }));

import { UserMenu } from "@/components/layout/user-menu";
import { siteConfig } from "@/lib/site-config";

const ADMIN_SHORTCUTS = siteConfig.adminNav.map((item) => [item.label, item.href] as const);

afterEach(cleanup);

describe("UserMenu admin shortcuts", () => {
  it("lists all twelve admin pages for an admin, in the rail's order, Frame requests after Frame compare (D5)", () => {
    expect(ADMIN_SHORTCUTS).toHaveLength(12);
    render(<UserMenu username="dev_admin" displayName="Dev Admin" isAdmin />);
    const admin = screen.getByRole("navigation", { name: "Admin" });
    const links = [...admin.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual(ADMIN_SHORTCUTS.map(([label, href]) => [label, href]));
    const labels = links.map(([label]) => label);
    expect(labels.indexOf("Frame requests")).toBe(labels.indexOf("Frame compare") + 1);
  });

  it("shows no admin shortcut to anyone else", () => {
    render(<UserMenu username="dev_pro" displayName="Priya" isPaid />);
    expect(screen.queryByRole("navigation", { name: "Admin" })).toBeNull();
    for (const [, href] of ADMIN_SHORTCUTS) {
      expect(document.querySelector(`a[href="${href}"]`), href).toBeNull();
    }
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
  });
});
