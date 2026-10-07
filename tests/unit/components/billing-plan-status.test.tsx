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

  // -------------------------------------------------------------------------
  // The state table: every Stripe shape → the sentence the card prints.
  // -------------------------------------------------------------------------
  const LATER = PERIOD_END + 40 * 86400; // Dec 2, 2026
  const MID = PERIOD_END - 10 * 86400; // Oct 13, 2026
  const phase = (end: number) => ({ start_date: end - 30 * 86400, end_date: end, items: [] });
  const table: Array<[string, Record<string, unknown>, string, RegExp, RegExp | null, string | null]> = [
    ["active, renewing", {}, "active", /^Renews on October 23, 2026\./, null, "Cancel plan"],
    ["cancel_at_period_end", { cancel_at_period_end: true }, "active", /ends on October 23, 2026 and won't renew — nothing more is charged/, /Renews/, "Resume Plus"],
    ["cancel_at only, at period end", { cancel_at: PERIOD_END }, "active", /ends on October 23, 2026 and won't renew/, /Renews/, "Resume Plus"],
    ["cancel_at mid-period", { cancel_at: MID }, "active", /ends on October 13, 2026 and won't renew — nothing more is charged/, /Renews/, "Resume Plus"],
    ["cancel_at in a LATER period", { cancel_at: LATER }, "active", /set to end on December 2, 2026\. Until then it is still billed as usual — next on October 23, 2026/, /nothing more is charged|Renews on/, "Resume Plus"],
    ["trialing", { status: "trialing", trial_end: PERIOD_END }, "trialing", /^Your free trial ends on October 23, 2026, then \$6\.00 \/ month on the card below\./, null, "Cancel plan"],
    ["trialing + cancelled (flag)", { status: "trialing", trial_end: PERIOD_END, cancel_at_period_end: true }, "trialing", /cancelled your free trial\. It ends on October 23, 2026 and you won't be charged/, /on the card below/, "Resume Plus"],
    ["trialing + cancelled (portal cancel_at)", { status: "trialing", trial_end: PERIOD_END, cancel_at: PERIOD_END }, "trialing", /cancelled your free trial\. It ends on October 23, 2026 and you won't be charged/, /on the card below/, "Resume Plus"],
    ["trialing + cancel date after the trial", { status: "trialing", trial_end: PERIOD_END, cancel_at: LATER }, "trialing", /set to end on December 2, 2026\. Until then it is still billed as usual — next on October 23, 2026/, /won't be charged/, "Resume Plus"],
    ["schedule that ends in a cancellation at period end", { schedule: { end_behavior: "cancel", phases: [phase(PERIOD_END)] } }, "active", /ends on October 23, 2026 and won't renew/, /Renews/, "Resume Plus"],
    ["schedule that ends in a cancellation after another phase", { schedule: { end_behavior: "cancel", phases: [phase(PERIOD_END), phase(LATER)] } }, "active", /set to end on December 2, 2026\. Until then it is still billed as usual/, /nothing more is charged/, "Resume Plus"],
    ["scheduled downgrade + cancelled", { cancel_at: PERIOD_END, schedule: { end_behavior: "release", current_phase: phase(PERIOD_END), phases: [phase(PERIOD_END), { start_date: PERIOD_END, end_date: LATER, items: [{ price: null }] }] } }, "active", /ends on October 23, 2026 and won't renew/, /Changes to/, "Resume Plus"],
    ["Stripe says canceled, profile still live", { status: "canceled", cancel_at_period_end: true }, "active", /Stripe reports that this subscription has ended/, /Renews|Resume/, null],
  ];
  it.each(table)("%s", (_name, patch, profileStatus, says, neverSays, button) => {
    const status = statusFor({ ...stripeSub, ...patch } as typeof stripeSub, profileStatus);
    renderCard(status);
    const line = screen.getByTestId("line").textContent ?? "";
    expect(line).toMatch(says);
    if (neverSays) expect(line).not.toMatch(neverSays);
    for (const name of ["Cancel plan", "Resume Plus"]) {
      const found = screen.queryByRole("button", { name });
      if (name === button) expect(found).toBeTruthy();
      else expect(found).toBeNull();
    }
  });

  it("accounts with no live subscription: past due (cancelled or not), comped, ended, free", () => {
    const text = (status: PlanStatus) => {
      cleanup();
      renderCard(status);
      return screen.getByTestId("line").textContent ?? "";
    };
    expect(text({ kind: "delinquent" })).toMatch(/payment didn't go through, so paid perks are paused/);
    expect(text({ kind: "comped" })).toMatch(/Courtesy of the PipGlyph team — no renewal, no card needed\./);
    expect(text({ kind: "ended" })).toMatch(/^Your previous plan has ended\. You're on the free plan/);
    expect(text({ kind: "free" })).toMatch(/^Every tool is yours for free/);
  });
});
