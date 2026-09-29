// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The avatar dropdown's admin shortcuts. Frame requests joined them on
// 2026-09-29 (TODO 1.6, owner decision D5); only admins see any of them.
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

const ADMIN_SHORTCUTS = [
  ["Conversations", "/admin/messages"],
  ["Moderation", "/admin/moderation"],
  ["Challenges", "/admin/challenges"],
  ["Scryfall usage", "/admin/scryfall"],
  ["Frame compare", "/admin/frame-compare"],
  ["Frame requests", "/admin/frame-requests"],
] as const;

afterEach(cleanup);

describe("UserMenu admin shortcuts", () => {
  it("lists Frame requests after Frame compare for an admin (D5)", () => {
    render(<UserMenu username="dev_admin" displayName="Dev Admin" isAdmin />);
    for (const [label, href] of ADMIN_SHORTCUTS) {
      expect(screen.getByRole("link", { name: label }).getAttribute("href"), label).toBe(href);
    }
    const labels = screen.getAllByRole("link").map((link) => link.textContent);
    expect(labels.slice(-2)).toEqual(["Frame compare", "Frame requests"]);
  });

  it("shows no admin shortcut to anyone else", () => {
    render(<UserMenu username="dev_pro" displayName="Priya" isPaid />);
    for (const [label] of ADMIN_SHORTCUTS) {
      expect(screen.queryByRole("link", { name: label }), label).toBeNull();
    }
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
  });
});
