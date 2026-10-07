// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// /dashboard/billing's plan card: a cancelled plan says when it ENDS, what is
// kept until then, and offers Resume — never "Renews on" or "Cancel plan".
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/stripe/actions", () => ({
  createPortalSessionAction: vi.fn(),
  cancelScheduledPlanChangeAction: vi.fn(),
}));
vi.mock("@/lib/routing/navigate", () => ({ navigateTo: vi.fn() }));

import { PlanActions, PlanStatusLine, endingBadgeLabel } from "@/components/billing/plan-status";
import { planStatusOf, type PlanStatus } from "@/lib/billing/plan-status";
import { summarizeBillingDetails } from "@/lib/billing/subscription-details";

afterEach(cleanup);

const PERIOD_END = 1792722400; // Oct 23, 2026 (UTC)
const stripeSub = {
  status: "active",
  cancel_at_period_end: false,
  cancel_at: null as number | null,
  trial_end: null as number | null,
  default_payment_method: { card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2034 } },
  items: {
    data: [{ current_period_end: PERIOD_END, price: { unit_amount: 600, currency: "usd", recurring: { interval: "month" } } }],
  },
};

/** Stripe object → the page's status, the way the page computes it. */
function statusFor(subscription: typeof stripeSub, profileStatus = "active"): PlanStatus {
  const details = summarizeBillingDetails({ customer: null, subscription, invoices: [] });
  return planStatusOf({
    live: true,
    delinquent: false,
    comped: false,
    status: profileStatus,
    subscription: details.subscription,
    // The webhook has not (or could not) set the flag — the live read decides.
    profile: { currentPeriodEnd: new Date(PERIOD_END * 1000).toISOString(), cancelAtPeriodEnd: false },
  });
}

function renderCard(status: PlanStatus) {
  return render(
    <div>
      <p data-testid="line">
        <PlanStatusLine status={status} planName="Plus" priceLine="$6.00 / month" hasPaymentMethod />
      </p>
      <PlanActions status={status} live planName="Plus" />
    </div>,
  );
}

describe("billing plan card", () => {
  it("an active plan renews and can be cancelled", () => {
    renderCard(statusFor(stripeSub));
    expect(screen.getByTestId("line").textContent).toMatch(/Renews on\s*October 23, 2026/);
    expect(screen.getByRole("button", { name: /cancel plan/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();
  });

  it.each([
    ["cancel_at_period_end", { ...stripeSub, cancel_at_period_end: true, cancel_at: PERIOD_END }],
    ["cancel_at only (Customer Portal / newer API versions)", { ...stripeSub, cancel_at_period_end: false, cancel_at: PERIOD_END }],
  ])("cancelled via %s: ends on the date, keeps perks, offers Resume — never 'Renews'", (_name, sub) => {
    const status = statusFor(sub);
    renderCard(status);
    const line = screen.getByTestId("line").textContent ?? "";
    expect(line).toMatch(/ends on\s*October 23, 2026/);
    expect(line).toMatch(/won.t\s+renew/);
    expect(line).toMatch(/keep every Plus perk until then/);
    expect(line).not.toMatch(/Renews on/);
    expect(screen.getByRole("button", { name: "Resume Plus" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /cancel plan/i })).toBeNull();
    expect(endingBadgeLabel(status)).toBe("Ending");
  });

  it("a cancelled trial: the trial ends and nothing is charged — not 'then $6.00 / month on the card below'", () => {
    const status = statusFor(
      { ...stripeSub, status: "trialing", trial_end: PERIOD_END, cancel_at_period_end: true },
      "trialing",
    );
    renderCard(status);
    const line = screen.getByTestId("line").textContent ?? "";
    expect(line).toMatch(/cancelled your free trial/);
    expect(line).toMatch(/ends on\s*October 23, 2026/);
    expect(line).toMatch(/won.t be charged/);
    expect(line).not.toMatch(/on the card below/);
    expect(screen.getByRole("button", { name: "Resume Plus" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /cancel plan/i })).toBeNull();
    expect(endingBadgeLabel(status)).toBe("Trial ending");
  });

  it("a scheduled downgrade keeps its own copy and 'Keep Plus' — it is not a cancellation", () => {
    const status: PlanStatus = {
      kind: "pending_change",
      pending: { startsAt: new Date(PERIOD_END * 1000).toISOString(), tier: "plus", interval: "month", amountCents: 600, currency: "usd" },
    };
    render(
      <div>
        <p data-testid="line">
          <PlanStatusLine status={status} planName="Pro" priceLine="$15.00 / month" hasPaymentMethod />
        </p>
        <PlanActions status={status} live planName="Pro" />
      </div>,
    );
    expect(screen.getByTestId("line").textContent).toMatch(/Changes to\s*Plus/);
    expect(screen.getByRole("button", { name: "Keep Pro" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();
    expect(endingBadgeLabel(status)).toBeNull();
  });
});
