// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The header for a subscriber who has cancelled: the Account menu's plan line
// says the plan and when it ends ("Pro · ends Oct 23, 2026") — from
// planEndingOf's facts, through the header — and "Billing & plan" keeps its
// one destination.

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: vi.fn() }));
vi.mock("@/app/(auth)/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => true }));
vi.mock("@/components/notifications/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/notifications/realtime-alerts", () => ({ RealtimeAlerts: () => null }));

import { SiteHeader } from "@/components/layout/site-header";

afterEach(cleanup);

const PRO = {
  id: "u",
  username: "dev_pro",
  displayName: "Priya",
  isPaid: true,
  tier: "pro" as const,
  subscribedTier: "pro" as const,
  subscriptionStatus: "active",
  hasLiveSubscription: true,
  credits: 80,
  creditsUsed: 3,
};

function accountPanel() {
  const button = screen.getByRole("button", { name: "Open account menu" });
  fireEvent.click(button);
  return document.getElementById(button.getAttribute("aria-controls")!)!;
}

describe("the Account menu — a cancelled plan", () => {
  it("the plan line names the plan and its end date; billing still links to /dashboard/billing", () => {
    render(
      <SiteHeader
        user={{ ...PRO, subscriptionEnding: true, subscriptionEndsAt: "2026-10-23T02:31:04.000Z", subscriptionEndingKind: "plan" }}
      />,
    );
    const panel = accountPanel();
    expect(panel.textContent).toContain("Pro · ends Oct 23, 2026");
    expect(panel.textContent).toContain("80 credits · 3 used this month");
    expect(screen.getByRole("link", { name: "Billing & plan" }).getAttribute("href")).toBe("/dashboard/billing");
  });

  it("a cancelled trial says so", () => {
    render(
      <SiteHeader
        user={{ ...PRO, subscriptionEnding: true, subscriptionEndsAt: "2026-10-23T02:31:04.000Z", subscriptionEndingKind: "trial" }}
      />,
    );
    expect(accountPanel().textContent).toContain("Pro · trial ends Oct 23, 2026");
  });

  it("a plan that renews keeps the plain line", () => {
    render(<SiteHeader user={PRO} />);
    const panel = accountPanel();
    expect(panel.textContent).toContain("Pro plan");
    expect(panel.textContent).not.toContain("ends");
  });

  it("a free account reads Free plan", () => {
    render(<SiteHeader user={{ ...PRO, isPaid: false, tier: "free" }} />);
    expect(accountPanel().textContent).toContain("Free plan");
  });
});

describe("the Account menu — other plan states", () => {
  it("an admin reads Admin and unlimited credits, never Pro plan · ∞", () => {
    render(<SiteHeader user={{ ...PRO, isAdmin: true, credits: Number.MAX_SAFE_INTEGER, creditsUsed: 0 }} />);
    const text = accountPanel().textContent ?? "";
    expect(text).toContain("Admin");
    expect(text).toContain("Unlimited credits · 0 used this month");
    expect(text).not.toContain("Pro plan");
    expect(text).not.toContain("∞");
  });

  it("a past_due subscriber reads their plan with payment due — not Free plan", () => {
    render(
      <SiteHeader
        user={{ ...PRO, isPaid: false, tier: "free", subscribedTier: "pro", subscriptionStatus: "past_due", hasLiveSubscription: false }}
      />,
    );
    const text = accountPanel().textContent ?? "";
    expect(text).toContain("Pro · payment due");
    expect(text).not.toContain("Free plan");
  });

  it("a comped account reads complimentary", () => {
    render(<SiteHeader user={{ ...PRO, subscriptionStatus: null, hasLiveSubscription: false }} />);
    expect(accountPanel().textContent).toContain("Pro · complimentary");
  });
});
