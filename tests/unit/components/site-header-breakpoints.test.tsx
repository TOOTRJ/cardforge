// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Which header items show from which breakpoint (TODO 3b.27, 3b.38). The row
// is measured in a browser (the PR's table); here the classes that decide it
// are held per account. Below `md` a signed-in FREE account's row (credits
// chip, Upgrade, New card, Dashboard, bell, avatar, hamburger) needed ~722 px
// and ran 58 px past the edge at 640: its Dashboard button waits for `md`,
// and the drawer — open at those widths — carries Dashboard first.
// ---------------------------------------------------------------------------

let billingOn = true;
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => billingOn }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/gallery" }));

const mobileMenuProps = vi.fn();
vi.mock("@/components/layout/mobile-menu", () => ({
  MobileMenu: (props: Record<string, unknown>) => {
    mobileMenuProps(props);
    return null;
  },
}));
vi.mock("@/components/layout/nav-links", () => ({
  NavLinks: ({ className }: { className?: string }) => <nav data-testid="inline-nav" className={className} />,
}));
vi.mock("@/components/layout/logo", () => ({ Logo: () => null }));
vi.mock("@/components/layout/user-menu", () => ({ UserMenu: () => null }));
vi.mock("@/components/layout/header-credits-chip", () => ({ HeaderCreditsChip: () => null }));
vi.mock("@/components/notifications/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/notifications/realtime-alerts", () => ({ RealtimeAlerts: () => null }));

import { SiteHeader, type HeaderUser } from "@/components/layout/site-header";

const FREE: HeaderUser = { id: "u-free", username: "dev_free", displayName: "Free", isPaid: false, tier: "free" };
const PRO: HeaderUser = { id: "u-pro", username: "dev_pro", displayName: "Pro", isPaid: true, tier: "pro" };

function classesOf(name: string): string[] {
  return (screen.getByRole("link", { name }).getAttribute("class") ?? "").split(/\s+/);
}

afterEach(() => {
  cleanup();
  billingOn = true;
  mobileMenuProps.mockClear();
});

describe("SiteHeader breakpoints", () => {
  it("a free account (billing on): Dashboard from md, Upgrade and New card from sm, the nav from xl", () => {
    render(<SiteHeader user={FREE} />);
    expect(classesOf("Dashboard")).toEqual(expect.arrayContaining(["hidden", "md:inline-flex"]));
    expect(classesOf("Dashboard")).not.toContain("sm:inline-flex");
    expect(classesOf("Upgrade")).toEqual(expect.arrayContaining(["hidden", "sm:inline-flex"]));
    expect(classesOf("New card")).toEqual(expect.arrayContaining(["hidden", "sm:inline-flex"]));
    expect(screen.getByTestId("inline-nav").className).toContain("xl:flex");
    expect(mobileMenuProps).toHaveBeenLastCalledWith(expect.objectContaining({ desktopNavFrom: "xl", isAuthed: true }));
  });

  it("a paid account keeps Dashboard from sm (its row fits) and the nav from lg", () => {
    render(<SiteHeader user={PRO} />);
    expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull();
    expect(classesOf("Dashboard")).toEqual(expect.arrayContaining(["hidden", "sm:inline-flex"]));
    expect(classesOf("Dashboard")).not.toContain("md:inline-flex");
    expect(screen.getByTestId("inline-nav").className).toContain("lg:flex");
  });

  it("billing off: no Upgrade, so Dashboard shows from sm", () => {
    billingOn = false;
    render(<SiteHeader user={FREE} />);
    expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull();
    expect(classesOf("Dashboard")).toEqual(expect.arrayContaining(["hidden", "sm:inline-flex"]));
  });

  it("signed out: Sign in and Start creating from sm, no Dashboard", () => {
    render(<SiteHeader user={null} />);
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(classesOf("Sign in")).toEqual(expect.arrayContaining(["hidden", "sm:inline-flex"]));
    expect(classesOf("Start creating")).toEqual(expect.arrayContaining(["hidden", "sm:inline-flex"]));
  });
});

describe("the drawer carries Dashboard where the row drops it", () => {
  it("a signed-in drawer opens with Dashboard as its first link", async () => {
    const { MobileMenu } = await vi.importActual<typeof import("@/components/layout/mobile-menu")>(
      "@/components/layout/mobile-menu",
    );
    render(<MobileMenu desktopNavFrom="xl" isAuthed username="dev_free" credits={5} />);
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    expect(trigger.className).toContain("xl:hidden");
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    const first = dialog.querySelector("a");
    expect(first?.getAttribute("href")).toBe("/dashboard");
    expect(first?.textContent).toContain("Dashboard");
  });
});
