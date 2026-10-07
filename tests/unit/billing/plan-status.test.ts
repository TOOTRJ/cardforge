import { describe, expect, it } from "vitest";
import { isEndingStatus, planStatusOf, type PlanStatusInput } from "@/lib/billing/plan-status";
import { endsByPeriodEnd, subscriptionEndsAt } from "@/lib/billing/subscription-ending";
import { billingViewerFromProfile } from "@/lib/billing/viewer";

// ---------------------------------------------------------------------------
// "Is this plan ending, and when?" — the one reading of Stripe's cancellation
// fields, and the order the billing page decides its copy in. The owner's
// report (2026-10): a subscriber who cancelled in the Customer Portal was
// still told the plan renews.
// ---------------------------------------------------------------------------

const PERIOD_END = 1792722400; // 2026-10-23T02:26:40Z
const item = { items: { data: [{ current_period_end: PERIOD_END }] } };

describe("subscriptionEndsAt", () => {
  it("null for a subscription that renews", () => {
    expect(subscriptionEndsAt({ status: "active", cancel_at_period_end: false, cancel_at: null, ...item })).toBeNull();
    expect(subscriptionEndsAt(null)).toBeNull();
  });

  it("cancel_at_period_end → the period end", () => {
    expect(subscriptionEndsAt({ status: "active", cancel_at_period_end: true, ...item })).toBe(PERIOD_END);
  });

  it("cancel_at alone (the portal's shape) → that date", () => {
    expect(subscriptionEndsAt({ status: "active", cancel_at_period_end: false, cancel_at: PERIOD_END, ...item })).toBe(PERIOD_END);
  });

  it("a cancelled trial → the trial end", () => {
    expect(
      subscriptionEndsAt({ status: "trialing", cancel_at_period_end: true, trial_end: PERIOD_END - 100, ...item }),
    ).toBe(PERIOD_END - 100);
  });

  it("a schedule ending in a cancellation → its last phase; a releasing schedule or a bare id → null", () => {
    const phases = [{ end_date: PERIOD_END }, { end_date: PERIOD_END + 500 }];
    expect(subscriptionEndsAt({ status: "active", schedule: { end_behavior: "cancel", phases }, ...item })).toBe(PERIOD_END + 500);
    expect(subscriptionEndsAt({ status: "active", schedule: { end_behavior: "release", phases }, ...item })).toBeNull();
    expect(subscriptionEndsAt({ status: "active", schedule: "sub_sched_1", ...item })).toBeNull();
  });

  it("an already-canceled subscription is over, not 'ending'", () => {
    expect(subscriptionEndsAt({ status: "canceled", cancel_at_period_end: true, cancel_at: PERIOD_END, ...item })).toBeNull();
  });
});

describe("endsByPeriodEnd (the profile flag)", () => {
  it("true for the flag and for a cancel_at at the period end", () => {
    expect(endsByPeriodEnd({ status: "active", cancel_at_period_end: true, ...item })).toBe(true);
    expect(endsByPeriodEnd({ status: "active", cancel_at: PERIOD_END, ...item })).toBe(true);
    expect(endsByPeriodEnd({ status: "active", cancel_at: PERIOD_END - 86400, ...item })).toBe(true);
  });
  it("false when it renews, or stops only in a later period", () => {
    expect(endsByPeriodEnd({ status: "active", ...item })).toBe(false);
    expect(endsByPeriodEnd({ status: "active", cancel_at: PERIOD_END + 40 * 86400, ...item })).toBe(false);
  });
});

const END_ISO = new Date(PERIOD_END * 1000).toISOString();
const liveSub = {
  trialEnd: null,
  currentPeriodEnd: END_ISO,
  cancelAtPeriodEnd: false,
  endsAt: null,
  pendingChange: null,
};
const base: PlanStatusInput = {
  live: true,
  delinquent: false,
  comped: false,
  status: "active",
  subscription: liveSub,
  profile: { currentPeriodEnd: END_ISO, cancelAtPeriodEnd: false },
};
const pending = { startsAt: END_ISO, tier: "plus" as const, interval: "month" as const, amountCents: 600, currency: "usd" };

describe("planStatusOf", () => {
  it("an active plan renews", () => {
    expect(planStatusOf(base)).toEqual({ kind: "renews", renewsAt: END_ISO });
  });

  it("a cancelled plan ENDS on Stripe's date — never 'renews'", () => {
    const status = planStatusOf({ ...base, subscription: { ...liveSub, cancelAtPeriodEnd: true, endsAt: END_ISO } });
    expect(status).toEqual({ kind: "ending", endsAt: END_ISO });
    expect(isEndingStatus(status)).toBe(true);
  });

  it("a cancelled TRIAL is 'trial_ending' — the old order said 'then $6 on the card below'", () => {
    const status = planStatusOf({
      ...base,
      status: "trialing",
      subscription: { ...liveSub, trialEnd: END_ISO, cancelAtPeriodEnd: true, endsAt: END_ISO },
    });
    expect(status).toEqual({ kind: "trial_ending", endsAt: END_ISO });
  });

  it("a running trial stays a trial", () => {
    expect(planStatusOf({ ...base, status: "trialing", subscription: { ...liveSub, trialEnd: END_ISO } })).toEqual({
      kind: "trial",
      trialEnd: END_ISO,
    });
  });

  it("a scheduled downgrade is a pending change, not a cancellation", () => {
    const status = planStatusOf({ ...base, subscription: { ...liveSub, pendingChange: pending } });
    expect(status.kind).toBe("pending_change");
    expect(isEndingStatus(status)).toBe(false);
  });

  it("Stripe unreachable: the profile's flag + period end still say it ends", () => {
    expect(
      planStatusOf({ ...base, subscription: null, profile: { currentPeriodEnd: END_ISO, cancelAtPeriodEnd: true } }),
    ).toEqual({ kind: "ending", endsAt: END_ISO });
  });

  it("the live read wins over a stale profile flag (resumed in the portal, webhook not landed yet)", () => {
    expect(planStatusOf({ ...base, profile: { currentPeriodEnd: END_ISO, cancelAtPeriodEnd: true } }).kind).toBe("renews");
  });

  it("an end date PAST the next renewal says the plan is billed first — never 'nothing more is charged'", () => {
    const later = new Date((PERIOD_END + 40 * 86400) * 1000).toISOString();
    expect(planStatusOf({ ...base, subscription: { ...liveSub, cancelAtPeriodEnd: true, endsAt: later } })).toEqual({
      kind: "ending",
      endsAt: later,
      billedBeforeAt: END_ISO,
    });
    // A trial with a later cancel date converts at the trial end first.
    expect(
      planStatusOf({
        ...base,
        status: "trialing",
        subscription: { ...liveSub, trialEnd: END_ISO, cancelAtPeriodEnd: true, endsAt: later },
      }),
    ).toEqual({ kind: "ending", endsAt: later, billedBeforeAt: END_ISO });
  });

  it("Stripe says the subscription is OVER while the profile still says live (a missed webhook): stale, never 'renews'", () => {
    const status = planStatusOf({ ...base, subscription: { ...liveSub, status: "canceled" } });
    expect(status).toEqual({ kind: "stale" });
    expect(isEndingStatus(status)).toBe(false);
  });

  it("the flag with no derivable date falls back to the profile's period end", () => {
    expect(
      planStatusOf({ ...base, subscription: { ...liveSub, currentPeriodEnd: null, cancelAtPeriodEnd: true, endsAt: null } }),
    ).toEqual({ kind: "ending", endsAt: END_ISO });
  });

  it("delinquent, comped, ended and free accounts", () => {
    expect(planStatusOf({ ...base, live: false, delinquent: true, status: "past_due" }).kind).toBe("delinquent");
    expect(planStatusOf({ ...base, live: false, comped: true, status: null, subscription: null }).kind).toBe("comped");
    expect(planStatusOf({ ...base, live: false, status: "canceled", subscription: null }).kind).toBe("ended");
    expect(planStatusOf({ ...base, live: false, status: null, subscription: null }).kind).toBe("free");
  });
});

describe("billingViewerFromProfile — subscriptionEnding", () => {
  const ent = { isPaid: true, effectiveTier: "plus" as const };
  it("true only for a LIVE subscription flagged to end", () => {
    const row = { stripe_customer_id: "cus_1", cancel_at_period_end: true };
    expect(billingViewerFromProfile({ ...row, subscription_status: "active" }, ent).subscriptionEnding).toBe(true);
    expect(billingViewerFromProfile({ ...row, subscription_status: "canceled" }, ent).subscriptionEnding).toBe(false);
    expect(
      billingViewerFromProfile({ ...row, cancel_at_period_end: false, subscription_status: "active" }, ent).subscriptionEnding,
    ).toBe(false);
  });
});
