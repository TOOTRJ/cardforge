// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// ---------------------------------------------------------------------------
// The grouped header (TODO NV1 / WD2 / NV10). From `lg` everyone gets the
// visible nav — Community ▾ · Learn ▾ · Pricing — beside the credits chip,
// "＋ Create a card", the bell and the Account menu (TODO 3b.27 had held a
// free account's nav back to `xl`; the Upgrade and Dashboard buttons that
// made the row that wide are gone). Below `lg` the row is the logo, Create,
// the bell, the avatar and the menu button; the drawer carries the rest.
// Pricing only where a plan can be bought. Every nav link reports nav_click.
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
let pathname = "/gallery";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const tracked = vi.fn();
vi.mock("@/lib/analytics/funnel-client", () => ({
  trackFunnelEvent: (...args: unknown[]) => tracked(...args),
}));
vi.mock("@/app/(auth)/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/components/layout/logo", () => ({ Logo: () => null }));
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => <button type="button">Notifications</button>,
}));
vi.mock("@/components/notifications/realtime-alerts", () => ({ RealtimeAlerts: () => null }));

import { SiteHeader, type HeaderUser } from "@/components/layout/site-header";

const FREE: HeaderUser = { id: "u-free", username: "dev_free", displayName: "Finn", isPaid: false, tier: "free", credits: 1234, creditsUsed: 56 };
const PRO: HeaderUser = { id: "u-pro", username: "dev_pro", displayName: "Priya", isPaid: true, tier: "pro", credits: 80 };

const header = () => screen.getByRole("banner");
const bar = () => within(header());
const mainNav = () => header().querySelector('nav[aria-label="Main"]') as HTMLElement;
const classesOf = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

afterEach(() => {
  cleanup();
  billingOn = true;
  pathname = "/gallery";
  tracked.mockClear();
});

describe("the header row", () => {
  it.each([
    ["signed out", null],
    ["a free account", FREE],
    ["a paid account", PRO],
  ] as const)("%s: the nav shows from lg (1024 px), the menu button hides there", (_, user) => {
    render(<SiteHeader user={user} />);
    expect(classesOf(mainNav())).toEqual(expect.arrayContaining(["hidden", "lg:block"]));
    expect(classesOf(screen.getByRole("button", { name: "Open navigation menu" }))).toContain("lg:hidden");
  });

  it("Community and Learn are disclosure buttons; Pricing a link — for a free account and signed out", () => {
    for (const user of [null, FREE]) {
      render(<SiteHeader user={user} />);
      const nav = within(mainNav());
      for (const name of ["Community", "Learn"]) {
        const button = nav.getByRole("button", { name });
        expect(button.getAttribute("aria-expanded")).toBe("false");
        expect(document.getElementById(button.getAttribute("aria-controls")!)).toBeTruthy();
      }
      expect(nav.getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("/pricing");
      cleanup();
    }
  });

  it("no Pricing for a paid account or with billing off", () => {
    render(<SiteHeader user={PRO} />);
    expect(bar().queryByRole("link", { name: "Pricing" })).toBeNull();
    cleanup();
    billingOn = false;
    render(<SiteHeader user={FREE} />);
    expect(bar().queryByRole("link", { name: "Pricing" })).toBeNull();
  });

  it("one start button, Create a card → /create, at every width — the old buttons are gone", () => {
    for (const user of [null, FREE, PRO]) {
      render(<SiteHeader user={user} />);
      const create = bar().getByRole("link", { name: "Create a card" });
      expect(create.getAttribute("href")).toBe("/create");
      // Never hidden below a breakpoint (a signed-in phone couldn't create).
      expect(classesOf(create)).not.toContain("hidden");
      for (const gone of ["Start creating", "New card", "Dashboard", "Upgrade", "Create", "Guides", "News"]) {
        expect(bar().queryByRole("link", { name: gone }), gone).toBeNull();
      }
      cleanup();
    }
  });

  it("signed in, the credits chip opens Billing & plan (/dashboard/billing)", () => {
    render(<SiteHeader user={FREE} />);
    const chip = bar().getByRole("link", { name: /1234\s*AI credits/ });
    expect(chip.getAttribute("href")).toBe("/dashboard/billing");
  });

  it("signed out: the Account button (from lg) offers Sign in and Create account", () => {
    render(<SiteHeader user={null} />);
    const account = bar().getByRole("button", { name: "Account" });
    expect(classesOf(account.parentElement)).toEqual(expect.arrayContaining(["hidden", "lg:block"]));
    fireEvent.click(account);
    const panel = document.getElementById(account.getAttribute("aria-controls")!)!;
    expect([...panel.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["/login", "/signup"]);
    expect(bar().queryByRole("button", { name: "Open account menu" })).toBeNull();
  });

  it("one panel at a time across the nav and the Account menu", () => {
    render(<SiteHeader user={FREE} />);
    fireEvent.click(screen.getByRole("button", { name: "Community" }));
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    expect(screen.getByRole("button", { name: "Community" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Open account menu" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("the Community panel lights the page you're on and shows the feed only signed in", () => {
    render(<SiteHeader user={null} />);
    const panel = () =>
      document.getElementById(screen.getByRole("button", { name: "Community" }).getAttribute("aria-controls")!)!;
    expect(within(panel()).queryByRole("link", { name: /your feed/i, hidden: true })).toBeNull();
    expect(within(panel()).getByRole("link", { name: /card gallery/i, hidden: true }).getAttribute("aria-current")).toBe("page");
    cleanup();
    render(<SiteHeader user={FREE} />);
    expect(within(panel()).getByRole("link", { name: /your feed/i, hidden: true }).getAttribute("href")).toBe("/feed");
  });

  it("the challenge pill rides on Design challenges", () => {
    render(<SiteHeader user={null} challengeBadge={<span>Ends in 3 days</span>} />);
    const panel = document.getElementById(
      screen.getByRole("button", { name: "Community" }).getAttribute("aria-controls")!,
    )!;
    const link = within(panel).getByRole("link", { name: /design challenges/i, hidden: true });
    expect(link.textContent).toContain("Ends in 3 days");
  });
});

describe("nav_click (NV10)", () => {
  it("a panel link reports its id, the header and whether the viewer is signed in", () => {
    render(<SiteHeader user={FREE} />);
    fireEvent.click(screen.getByRole("button", { name: "Community" }));
    fireEvent.click(screen.getByRole("link", { name: /card gallery/i }));
    expect(tracked).toHaveBeenCalledWith("nav_click", { item: "community.gallery", surface: "header", signedIn: true });
  });

  it("Create a card and Pricing too, signed out", () => {
    render(<SiteHeader user={null} />);
    fireEvent.click(bar().getByRole("link", { name: "Create a card" }));
    fireEvent.click(bar().getByRole("link", { name: "Pricing" }));
    expect(tracked.mock.calls).toEqual([
      ["nav_click", { item: "create", surface: "header", signedIn: false }],
      ["nav_click", { item: "pricing", surface: "header", signedIn: false }],
    ]);
  });
});

describe("the drawer (below lg)", () => {
  function openDrawer(user: HeaderUser | null) {
    render(<SiteHeader user={user} />);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    return within(screen.getByRole("dialog"));
  }

  it("opens on Create a card, then Community and Learn as accordions, then Pricing and the Account part", () => {
    const drawer = openDrawer(FREE);
    const first = screen.getByRole("dialog").querySelector("a");
    expect(first?.getAttribute("href")).toBe("/create");
    expect(first?.textContent).toContain("Create a card");
    // The group holding the current page (/gallery) starts open; the other closed.
    const community = drawer.getByRole("button", { name: "Community" });
    const learn = drawer.getByRole("button", { name: "Learn" });
    expect(community.getAttribute("aria-expanded")).toBe("true");
    expect(learn.getAttribute("aria-expanded")).toBe("false");
    const learnPanel = document.getElementById(learn.getAttribute("aria-controls")!)!;
    expect(learnPanel.hidden).toBe(true);
    fireEvent.click(learn);
    expect(learn.getAttribute("aria-expanded")).toBe("true");
    expect(learnPanel.hidden).toBe(false);
    // Each accordion's lists hold six or fewer.
    for (const list of learnPanel.querySelectorAll("ul")) expect(list.children.length).toBeLessThanOrEqual(6);
    expect(drawer.getByRole("link", { name: "Pricing" }).getAttribute("href")).toBe("/pricing");
    for (const name of ["Dashboard", "My cards", "My decks", "New deck", "View profile", "Notifications", "Settings", "Billing & plan", "Feedback"]) {
      expect(drawer.getByRole("link", { name }), name).toBeTruthy();
    }
    expect(drawer.getByRole("link", { name: "Billing & plan" }).getAttribute("href")).toBe("/dashboard/billing");
    expect(screen.getByRole("dialog").querySelector('a[href*="#billing"]')).toBeNull();
    expect(drawer.getByRole("button", { name: /sign out/i })).toBeTruthy();
  });

  it("signed out: Sign in and Create account; a link closes the drawer and reports surface drawer", () => {
    const drawer = openDrawer(null);
    expect(drawer.getByRole("link", { name: /sign in/i }).getAttribute("href")).toBe("/login");
    expect(drawer.getByRole("link", { name: /create account/i }).getAttribute("href")).toBe("/signup");
    expect(drawer.queryByRole("button", { name: /sign out/i })).toBeNull();
    fireEvent.click(drawer.getByRole("link", { name: /card gallery/i }));
    expect(tracked).toHaveBeenCalledWith("nav_click", { item: "community.gallery", surface: "drawer", signedIn: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("an admin's drawer has an Admin link; nobody else's", () => {
    let drawer = openDrawer({ ...PRO, isAdmin: true });
    expect(drawer.getByRole("link", { name: "Admin" }).getAttribute("href")).toBe("/admin/users");
    cleanup();
    drawer = openDrawer(PRO);
    expect(drawer.queryByRole("link", { name: "Admin" })).toBeNull();
  });
});
