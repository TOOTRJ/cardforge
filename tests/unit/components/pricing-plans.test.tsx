// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// /pricing storefront, rendered. The server actions, the navigation seam and
// the toast are stubbed; /api/me is answered by a fetch stub. What's under
// test is the wiring the 2026-09-22 report exposed: which button each viewer
// gets, and that a click reaches the right action and then either redirects
// or surfaces the action's error.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  signedIn: false,
  me: null as null | Record<string, unknown>,
  checkout: vi.fn(),
  portal: vi.fn(),
  navigateTo: vi.fn(),
  toastError: vi.fn(),
  track: vi.fn(),
}));

// The funnel beacon posts to /api/events; in a test DOM that would try to
// reach a server that isn't there, so the tracker is a spy here (and its
// calls are what the wiring tests assert).
vi.mock("@/lib/analytics/funnel-client", () => ({ trackFunnelEvent: s.track }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: s.toastError, success: vi.fn() } }));
vi.mock("@/lib/stripe/actions", () => ({
  createCheckoutSessionAction: s.checkout,
  createPortalSessionAction: s.portal,
}));
vi.mock("@/lib/routing/navigate", () => ({ navigateTo: s.navigateTo }));
vi.mock("@/lib/supabase/session-cookie", () => ({
  hasSupabaseSessionCookie: () => s.signedIn,
}));

import { PricingPlans } from "@/components/billing/pricing-plans";

const freeUser = { id: "u1", username: "dev_free", isPaid: false, tier: "free", hasSubscribed: false };

beforeEach(() => {
  s.signedIn = false;
  s.me = null;
  s.checkout.mockReset().mockResolvedValue({ ok: true, url: "https://checkout.test/s" });
  s.portal.mockReset().mockResolvedValue({ ok: true, url: "https://portal.test/s" });
  s.navigateTo.mockReset();
  s.toastError.mockReset();
  s.track.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ user: s.me }), { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const button = (name: RegExp) => screen.getByRole("button", { name });

describe("PricingPlans", () => {
  it("renders the anonymous storefront without touching the network", async () => {
    render(<PricingPlans />);
    expect(screen.getByRole("link", { name: /get started free/i })).toHaveProperty("href", expect.stringContaining("/signup"));
    expect(screen.getAllByRole("link", { name: /start free — 7-day trial/i })).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
    // Funnel: one pricing_view per mount, tagged with the surface.
    expect(s.track).toHaveBeenCalledTimes(1);
    expect(s.track).toHaveBeenCalledWith("pricing_view", { surface: "pricing" });
  });

  it("funnel: a signup link click and a checkout click both record cta_click with the surface", async () => {
    render(<PricingPlans surface="billing" />);
    fireEvent.click(screen.getAllByRole("link", { name: /start free — 7-day trial/i })[0]);
    expect(s.track).toHaveBeenCalledWith("cta_click", { surface: "billing", kind: "signup", tier: "plus" });

    cleanup();
    s.track.mockReset();
    s.signedIn = true;
    s.me = freeUser;
    render(<PricingPlans />);
    await waitFor(() => expect(button(/try pro free for 7 days/i)).toBeTruthy());
    fireEvent.click(button(/try pro free for 7 days/i));
    expect(s.track).toHaveBeenCalledWith("cta_click", { surface: "pricing", kind: "subscription", tier: "pro", period: "monthly" });
  });

  it("a server-provided viewer renders the signed-in buttons on the FIRST render, with no fetch and no anonymous flash", () => {
    s.signedIn = true;
    render(
      <PricingPlans
        initialViewer={{
          loaded: true,
          isSignedIn: true,
          isPaid: true,
          currentTier: "pro",
          hasSubscribed: false,
          hasBillingAccount: false,
          hasLiveSubscription: false,
          subscriptionStatus: null,
        }}
      />,
    );
    // Synchronous assertions: what the server HTML carries is what shows.
    expect(screen.getByText("Your current plan")).toBeTruthy();
    expect(button(/try plus free for 7 days/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /start free — 7-day trial/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /manage plan/i })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("free account: 'Your current plan' on Free, trial checkouts on Plus and Pro, no portal button", async () => {
    s.signedIn = true;
    s.me = freeUser;
    render(<PricingPlans />);
    await screen.findByText("Your current plan");
    expect(button(/try plus free for 7 days/i)).toBeTruthy();
    expect(button(/try pro free for 7 days/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /manage plan/i })).toBeNull();
  });

  it("a checkout click carries the tier AND the toggled billing period, then redirects", async () => {
    s.signedIn = true;
    s.me = freeUser;
    render(<PricingPlans />);
    await screen.findByText("Your current plan");
    fireEvent.click(screen.getByRole("tab", { name: /annual/i }));
    fireEvent.click(button(/try pro free for 7 days/i));
    await waitFor(() =>
      expect(s.checkout).toHaveBeenCalledWith({ kind: "subscription", tier: "pro", period: "annual" }),
    );
    await waitFor(() => expect(s.navigateTo).toHaveBeenCalledWith("https://checkout.test/s"));
    expect(s.toastError).not.toHaveBeenCalled();
  });

  it("an action error surfaces as a toast instead of a silent click", async () => {
    s.signedIn = true;
    s.me = freeUser;
    s.checkout.mockResolvedValue({ ok: false, error: "Billing isn't available right now." });
    render(<PricingPlans />);
    await screen.findByText("Your current plan");
    fireEvent.click(button(/try plus free for 7 days/i));
    await waitFor(() => expect(s.toastError).toHaveBeenCalledWith("Billing isn't available right now."));
    expect(s.navigateTo).not.toHaveBeenCalled();
  });

  it("live Plus subscriber: Manage plan opens the portal, Pro offers an in-place switch", async () => {
    s.signedIn = true;
    s.me = {
      ...freeUser,
      isPaid: true,
      tier: "plus",
      hasSubscribed: true,
      hasBillingAccount: true,
      hasLiveSubscription: true,
      subscriptionStatus: "active",
    };
    render(<PricingPlans />);
    await screen.findByText("Your current plan");
    fireEvent.click(button(/manage plan/i));
    await waitFor(() => expect(s.portal).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(s.navigateTo).toHaveBeenCalledWith("https://portal.test/s"));
    expect(button(/switch to pro/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /switch to plus/i })).toBeNull();
  });

  it("comped Pro without a billing account: no 'Manage plan' that could only fail (the owner's report)", async () => {
    s.signedIn = true;
    s.me = { ...freeUser, isPaid: true, tier: "pro", hasBillingAccount: false, hasLiveSubscription: false };
    render(<PricingPlans />);
    await screen.findByText("Your current plan");
    expect(screen.queryByRole("button", { name: /manage plan/i })).toBeNull();
    expect(button(/try plus free for 7 days/i)).toBeTruthy();
    expect(s.portal).not.toHaveBeenCalled();
  });

  it("broken payment: both paid cards say 'Update payment to continue' and open the portal", async () => {
    s.signedIn = true;
    s.me = { ...freeUser, hasSubscribed: true, hasBillingAccount: true, subscriptionStatus: "past_due" };
    render(<PricingPlans />);
    const fixes = await screen.findAllByRole("button", { name: /update payment to continue/i });
    expect(fixes).toHaveLength(2);
    fireEvent.click(fixes[0]!);
    await waitFor(() => expect(s.portal).toHaveBeenCalledTimes(1));
  });
});
