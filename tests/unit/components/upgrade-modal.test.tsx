// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// The out-of-credits modal after the 2026-09-24 pricing decisions: packs are
// sold right where the need is felt, the copy tells a free account it started
// with 5 credits and doesn't refill, and a subscriber sees packs first at the
// subscriber price (an ACTIVE plan; a trial pays full price).
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  me: null as null | Record<string, unknown>,
  checkout: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/stripe/actions", () => ({
  createCheckoutSessionAction: s.checkout,
  createPortalSessionAction: vi.fn(),
}));
vi.mock("@/lib/routing/navigate", () => ({ navigateTo: vi.fn() }));
vi.mock("@/lib/supabase/session-cookie", () => ({ hasSupabaseSessionCookie: () => true }));

import { UpgradeModal } from "@/components/billing/upgrade-modal";

const freeUser = { id: "u1", username: "dev_free", isPaid: false, tier: "free", hasSubscribed: false };
const proSubscriber = {
  id: "u2",
  username: "dev_pro",
  isPaid: true,
  tier: "pro",
  hasSubscribed: true,
  hasBillingAccount: true,
  hasLiveSubscription: true,
  subscriptionStatus: "active",
};

beforeEach(() => {
  s.me = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ user: s.me }), { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function orderOf(...labels: RegExp[]): number[] {
  const html = document.body.innerHTML;
  return labels.map((re) => html.search(re));
}

describe("UpgradeModal — out of credits", () => {
  it("free account: says the 5 starter credits don't refill, lists plans first, then all three packs", async () => {
    s.me = freeUser;
    render(<UpgradeModal open reason="credits" onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /try pro free/i })).toBeTruthy());
    expect(screen.getByText(/Free accounts get 5 credits to start and don't refill/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /buy 10 credits/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /buy 30 credits/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /buy 100 credits/i })).toBeTruthy();
    expect(screen.queryByText(/for subscribers/)).toBeNull();
    const [plans, packs] = orderOf(/Try Pro free/, /Buy 10 credits/);
    expect(plans).toBeLessThan(packs);
  });

  it("active subscriber: packs first at the subscriber price, and the copy talks about topping up", async () => {
    s.me = proSubscriber;
    render(<UpgradeModal open reason="credits" onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("Your current plan")).toBeTruthy());
    expect(screen.getByText(/Your plan refills every month — top up any time with a pack, 20% off for subscribers/)).toBeTruthy();
    // The three pack price lines carry the subscriber price.
    expect(screen.getAllByText(/\$\d+(\.\d\d)? for subscribers/)).toHaveLength(3);
    expect(screen.getByText(/\$6\.40/)).toBeTruthy();
    const [packs, plans] = orderOf(/Buy 10 credits/, /Your current plan/);
    expect(packs).toBeLessThan(plans);
  });

  it("a trialing subscriber sees packs at full price (the coupon needs an ACTIVE plan)", async () => {
    s.me = { ...proSubscriber, subscriptionStatus: "trialing" };
    render(<UpgradeModal open reason="credits" onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("Your current plan")).toBeTruthy());
    expect(screen.queryByText(/\$\d+(\.\d\d)? for subscribers/)).toBeNull();
    expect(screen.getByText(/subscriber discount starts once your trial converts/)).toBeTruthy();
    expect(screen.getByText(/\$8 one-time/)).toBeTruthy();
  });

  it("other reasons show no packs", async () => {
    s.me = freeUser;
    render(<UpgradeModal open reason="hi_res_export" onOpenChange={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /try pro free/i })).toBeTruthy());
    expect(screen.queryByRole("button", { name: /buy 10 credits/i })).toBeNull();
  });
});
