import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { effectiveTierForProfile, type BillingProfileSlice } from "@/lib/billing/entitlements";
import { refillTierFor, type RefillProfileRow } from "@/lib/billing/credit-refill";
import {
  CHECKOUT_MIN_TRIAL_SECONDS,
  MAX_TRIAL_SECONDS,
  TRIAL_END_BEFORE_COMP_KEY,
  compHoldsCheckoutUntil,
  compOverLiveSubscription,
  compStripeNote,
  compTrialChangeFor,
} from "@/lib/billing/comp-stripe";
import { accountPlanLine } from "@/lib/billing/account-plan-line";
import { billingViewerFromProfile } from "@/lib/billing/viewer";
import { planStatusOf } from "@/lib/billing/plan-status";
import { CARD_CAPACITY, MONTHLY_CREDITS } from "@/lib/billing/plans";
import { describeNotification } from "@/lib/notifications/describe";

// ---------------------------------------------------------------------------
// The plans × comps audit (2026-10-30). One scenario per question; each
// asserts the code path that answers it. The owner's rule: a comp month is
// FREE, and the month after it is CHARGED NORMALLY (the subscription's own
// price, on its card, with no action from the user).
//
// A comp is a profile overlay — perks (effectiveTierForProfile), credits
// (refillTierFor), capacity (card_capacity_for, 0104) — and, since this
// audit, a hold on a card-backed TRIAL's first charge (compTrialChangeFor).
// ---------------------------------------------------------------------------

const NOW = new Date("2026-11-01T12:00:00Z");
// effectiveTierForProfile reads the clock itself.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});
const sec = (d: Date | string) => Math.floor(new Date(d).getTime() / 1000);
const days = (n: number) => n * 86_400;
const iso = (s: number) => new Date(s * 1000).toISOString();

const TRIAL_END = sec(NOW) + days(6); // a 7-day trial, one day in
const COMP_30 = iso(sec(NOW) + days(30)); // "a free month"

function profile(over: Partial<BillingProfileSlice> = {}): BillingProfileSlice {
  return {
    subscription_tier: null,
    subscription_status: null,
    is_admin: false,
    comp_tier: null,
    comp_expires_at: null,
    ...over,
  };
}
const refillRow = (over: Partial<RefillProfileRow> = {}): RefillProfileRow => ({
  id: "u1",
  subscription_tier: null,
  subscription_status: null,
  comp_tier: null,
  comp_expires_at: null,
  is_admin: false,
  created_at: null,
  ...over,
});
const trialSub = (over: Record<string, unknown> = {}) => ({
  status: "trialing",
  trial_end: TRIAL_END,
  cancel_at_period_end: false,
  cancel_at: null,
  metadata: {} as Record<string, string>,
  ...over,
});

describe("a TRIALING user is comped a free month (the owner's case)", () => {
  const comp = { tier: "plus" as const, expiresAt: COMP_30 };

  it("during it: Plus perks, the trial is held until the comp ends — no charge inside the month", () => {
    expect(
      effectiveTierForProfile(profile({ subscription_tier: "plus", subscription_status: "trialing", comp_tier: "plus", comp_expires_at: COMP_30 })),
    ).toBe("plus");
    const change = compTrialChangeFor({ sub: trialSub(), subscribedTier: "plus", comp, now: NOW });
    expect(change).toEqual({
      kind: "set_trial_end",
      trialEnd: sec(COMP_30),
      beforeComp: String(TRIAL_END),
      reason: "comp_holds_trial",
    });
    // Before this audit nothing moved: Stripe charged at TRIAL_END (day 7),
    // inside the free month.
    expect(sec(COMP_30)).toBeGreaterThan(TRIAL_END);
  });

  it("during it: the comp is owed its month's credits (a trial alone gets its 25 at creation only)", () => {
    expect(refillTierFor(refillRow({ subscription_tier: "plus", subscription_status: "trialing" }), "2026-11", NOW)).toBeNull();
    expect(
      refillTierFor(refillRow({ subscription_tier: "plus", subscription_status: "trialing", comp_tier: "plus", comp_expires_at: COMP_30 }), "2026-11", NOW),
    ).toBe("plus");
  });

  it("when it ends: Stripe's trial ends at the same second and the plan is charged normally", () => {
    // Stripe now holds trial_end = comp end; the conversion is Stripe's own
    // (the card from Checkout, the subscription's price). Once it has run the
    // subscription is active and the comp is over: nothing more to move.
    const after = new Date(Date.parse(COMP_30) + 1000);
    const converted = { ...trialSub({ status: "active", trial_end: sec(COMP_30) }) };
    expect(compTrialChangeFor({ sub: converted, subscribedTier: "plus", comp, now: after })).toEqual({
      kind: "none",
      reason: "not_trialing",
    });
    expect(effectiveTierForProfile(profile({ subscription_tier: "plus", subscription_status: "active", comp_tier: "plus", comp_expires_at: COMP_30 }))).toBe("plus");
    // The paid month is a normal refill (the active plan), not the comp.
    expect(refillTierFor(refillRow({ subscription_tier: "plus", subscription_status: "active", comp_tier: "plus", comp_expires_at: COMP_30 }), "2026-12", after)).toBe("plus");
  });

  it("saving the same comp again changes nothing (idempotent)", () => {
    const held = trialSub({ trial_end: sec(COMP_30), metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(TRIAL_END) } });
    expect(compTrialChangeFor({ sub: held, subscribedTier: "plus", comp, now: NOW })).toEqual({ kind: "none", reason: "unchanged" });
  });

  it("a comp of a HIGHER tier holds the trial too; the plan bought is charged after it", () => {
    const pro = { tier: "pro" as const, expiresAt: COMP_30 };
    expect(effectiveTierForProfile(profile({ subscription_tier: "plus", subscription_status: "trialing", comp_tier: "pro", comp_expires_at: COMP_30 }))).toBe("pro");
    expect(compTrialChangeFor({ sub: trialSub(), subscribedTier: "plus", comp: pro, now: NOW })).toMatchObject({ kind: "set_trial_end", trialEnd: sec(COMP_30) });
  });

  it("a comp BELOW the trial's plan changes nothing (the higher of the two applies)", () => {
    expect(compTrialChangeFor({ sub: trialSub(), subscribedTier: "pro", comp, now: NOW })).toEqual({ kind: "none", reason: "comp_lower_tier" });
    expect(effectiveTierForProfile(profile({ subscription_tier: "pro", subscription_status: "trialing", comp_tier: "plus", comp_expires_at: COMP_30 }))).toBe("pro");
  });
});

describe("a comp LONGER than the trial, an undated one, and one past Stripe's limit", () => {
  it("longer: the trial runs to the comp's end (90 days)", () => {
    const end = iso(sec(NOW) + days(90));
    expect(compTrialChangeFor({ sub: trialSub(), subscribedTier: "plus", comp: { tier: "plus", expiresAt: end }, now: NOW })).toMatchObject({
      kind: "set_trial_end",
      trialEnd: sec(end),
    });
  });
  it("shorter than the trial: nothing moves (the trial already covers it)", () => {
    const end = iso(sec(NOW) + days(2));
    expect(compTrialChangeFor({ sub: trialSub(), subscribedTier: "plus", comp: { tier: "plus", expiresAt: end }, now: NOW })).toEqual({ kind: "none", reason: "unchanged" });
  });
  it("no end date: Stripe can't hold a trial open-ended — left alone, and the admin is told", () => {
    const change = compTrialChangeFor({ sub: trialSub(), subscribedTier: "plus", comp: { tier: "plus", expiresAt: null }, now: NOW });
    expect(change).toEqual({ kind: "none", reason: "comp_no_expiry" });
    expect(compStripeNote(change, { live: true })).toMatch(/still converts and charges/);
  });
  it("past 730 days: left alone", () => {
    const end = iso(sec(NOW) + MAX_TRIAL_SECONDS + days(1));
    expect(compTrialChangeFor({ sub: trialSub(), subscribedTier: "plus", comp: { tier: "plus", expiresAt: end }, now: NOW })).toEqual({ kind: "none", reason: "comp_too_long" });
  });
});

describe("a comp that is CLEARED, SHORTENED or EXPIRES", () => {
  const held = trialSub({ trial_end: sec(COMP_30), metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(TRIAL_END) } });

  it("cleared while the trial's own end is still ahead: the trial goes back to it", () => {
    expect(compTrialChangeFor({ sub: held, subscribedTier: "plus", comp: { tier: null, expiresAt: null }, now: NOW })).toEqual({
      kind: "set_trial_end",
      trialEnd: TRIAL_END,
      beforeComp: "",
      reason: "comp_released_trial",
    });
  });
  it("cleared after the trial's own end: it ends now and is charged (as it would have been)", () => {
    const later = new Date((TRIAL_END + days(3)) * 1000);
    expect(compTrialChangeFor({ sub: held, subscribedTier: "plus", comp: { tier: null, expiresAt: null }, now: later })).toMatchObject({
      kind: "set_trial_end",
      trialEnd: "now",
    });
  });
  it("shortened: the trial follows the new end, never earlier than its own", () => {
    const end = iso(sec(NOW) + days(14));
    expect(compTrialChangeFor({ sub: held, subscribedTier: "plus", comp: { tier: "plus", expiresAt: end }, now: NOW })).toMatchObject({
      kind: "set_trial_end",
      trialEnd: sec(end),
      beforeComp: String(TRIAL_END),
    });
    const tooShort = iso(sec(NOW) + days(2));
    expect(compTrialChangeFor({ sub: held, subscribedTier: "plus", comp: { tier: "plus", expiresAt: tooShort }, now: NOW })).toMatchObject({
      trialEnd: TRIAL_END,
    });
  });
  it("expired: the perks fall back by themselves (no job) and no credits are owed", () => {
    const past = iso(sec(NOW) - 1);
    expect(effectiveTierForProfile(profile({ comp_tier: "pro", comp_expires_at: past }))).toBe("free");
    expect(refillTierFor(refillRow({ comp_tier: "pro", comp_expires_at: past }), "2026-11", NOW)).toBeNull();
  });
});

describe("a comp on a LIVE (active) subscription", () => {
  it("keeps billing as usual (owner question 1); the higher tier's perks apply", () => {
    const change = compTrialChangeFor({ sub: { status: "active" }, subscribedTier: "plus", comp: { tier: "pro", expiresAt: COMP_30 }, now: NOW });
    expect(change).toEqual({ kind: "none", reason: "not_trialing" });
    expect(compStripeNote(change, { live: true })).toBe("Their Stripe subscription keeps billing as usual during the comp.");
    expect(effectiveTierForProfile(profile({ subscription_tier: "plus", subscription_status: "active", comp_tier: "pro", comp_expires_at: COMP_30 }))).toBe("pro");
  });
  it("a comp never demotes a payer", () => {
    expect(effectiveTierForProfile(profile({ subscription_tier: "pro", subscription_status: "active", comp_tier: "plus", comp_expires_at: COMP_30 }))).toBe("pro");
  });
  it("with a SCHEDULED DOWNGRADE (Pro → Plus at period end): untouched, the downgrade still lands; perks are the higher of comp and plan", () => {
    // A schedule exists only on an ACTIVE plan (createCheckoutSessionAction),
    // and the comp never writes to an active subscription.
    expect(compTrialChangeFor({ sub: { status: "active" }, subscribedTier: "pro", comp: { tier: "pro", expiresAt: COMP_30 }, now: NOW }).kind).toBe("none");
    // After the phase change the profile says Plus; a Pro comp still gives Pro.
    expect(effectiveTierForProfile(profile({ subscription_tier: "plus", subscription_status: "active", comp_tier: "pro", comp_expires_at: COMP_30 }))).toBe("pro");
  });
});

describe("a comp on a CANCELLED-but-not-ended subscription", () => {
  it("the subscription is left to end on its date; the comp carries the perks after it; nothing is charged later", () => {
    for (const ending of [{ cancel_at_period_end: true }, { cancel_at: TRIAL_END }]) {
      expect(compTrialChangeFor({ sub: trialSub(ending), subscribedTier: "plus", comp: { tier: "plus", expiresAt: COMP_30 }, now: NOW })).toEqual({
        kind: "none",
        reason: "ending",
      });
    }
    // Once Stripe has deleted it the profile is free + canceled; the comp still applies.
    expect(effectiveTierForProfile(profile({ subscription_tier: "free", subscription_status: "canceled", comp_tier: "plus", comp_expires_at: COMP_30 }))).toBe("plus");
  });
});

describe("credits and capacity during a comp", () => {
  it("credits: a comp is owed its tier's monthly allotment, the higher of comp and plan", () => {
    expect(refillTierFor(refillRow({ comp_tier: "plus", comp_expires_at: COMP_30 }), "2026-11", NOW)).toBe("plus");
    expect(refillTierFor(refillRow({ subscription_tier: "plus", subscription_status: "active", comp_tier: "pro", comp_expires_at: COMP_30 }), "2026-11", NOW)).toBe("pro");
    expect(MONTHLY_CREDITS.plus).toBeGreaterThan(0);
    // Admins are unlimited — never refilled.
    expect(refillTierFor(refillRow({ is_admin: true, comp_tier: "pro" }), "2026-11", NOW)).toBeNull();
  });
  it("capacity: the database trigger counts an unexpired comp exactly as the app does", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0104_card_capacity_enforcement.sql"), "utf8");
    expect(sql).toContain("when comp_tier in ('plus', 'pro')");
    expect(sql).toContain("and (comp_expires_at is null or comp_expires_at > now()) then comp_tier");
    expect(CARD_CAPACITY.plus).toBeGreaterThan(CARD_CAPACITY.free);
  });
});

describe("subscribing WHILE comped", () => {
  it("Checkout starts the plan with trial_end at the comp's end when the comp covers the plan bought", () => {
    expect(compHoldsCheckoutUntil({ tier: "pro", expiresAt: COMP_30 }, "plus", NOW)).toBe(sec(COMP_30));
    expect(compHoldsCheckoutUntil({ tier: "plus", expiresAt: COMP_30 }, "plus", NOW)).toBe(sec(COMP_30));
  });
  it("not when the plan bought is above the comp, the comp is undated, or ends within Checkout's 48 h", () => {
    expect(compHoldsCheckoutUntil({ tier: "plus", expiresAt: COMP_30 }, "pro", NOW)).toBeNull();
    expect(compHoldsCheckoutUntil({ tier: "plus", expiresAt: null }, "plus", NOW)).toBeNull();
    expect(compHoldsCheckoutUntil({ tier: "plus", expiresAt: iso(sec(NOW) + CHECKOUT_MIN_TRIAL_SECONDS - 60) }, "plus", NOW)).toBeNull();
  });
});

describe("what the user sees (every surface that names a plan)", () => {
  it("account menu: a comp with no subscription is 'complimentary'; over a live plan it names the effective tier", () => {
    expect(accountPlanLine({ isPaid: true, tier: "plus", subscriptionStatus: null })).toEqual(["Plus · complimentary"]);
    expect(accountPlanLine({ isPaid: true, tier: "pro", subscriptionStatus: "trialing", hasLiveSubscription: true })).toEqual(["Pro plan"]);
  });
  it("storefront viewer: a comp is paid (so /pricing sends them to billing) with the effective tier", () => {
    const viewer = billingViewerFromProfile({ subscription_status: null, stripe_customer_id: null }, { isPaid: true, effectiveTier: "plus" });
    expect(viewer).toMatchObject({ isPaid: true, currentTier: "plus", hasLiveSubscription: false, hasBillingAccount: false });
  });
  it("billing page plan card: 'comped' with no subscription; over a live trial, its own line names the comp", () => {
    expect(planStatusOf({ live: false, delinquent: false, comped: true, status: null, subscription: null, profile: { currentPeriodEnd: null, cancelAtPeriodEnd: false } })).toEqual({ kind: "comped" });
    // The trial line reads Stripe, which now holds the comp's end.
    expect(
      planStatusOf({
        live: true,
        delinquent: false,
        comped: false,
        status: "trialing",
        subscription: { trialEnd: COMP_30, currentPeriodEnd: COMP_30, cancelAtPeriodEnd: false, endsAt: null, pendingChange: null },
        profile: { currentPeriodEnd: null, cancelAtPeriodEnd: false },
      }),
    ).toEqual({ kind: "trial", trialEnd: COMP_30 });
    expect(compOverLiveSubscription({ comp_tier: "plus", comp_expires_at: COMP_30, subscription_tier: "plus" }, NOW)).toEqual({ tier: "plus", expiresAt: COMP_30 });
    expect(compOverLiveSubscription({ comp_tier: "plus", comp_expires_at: COMP_30, subscription_tier: "pro" }, NOW)).toBeNull();
  });
  it("the comp notification says when the first charge lands when it moved the trial", () => {
    const describe_ = (payload: Record<string, unknown>) =>
      describeNotification({ type: "comp_plan", actor: null, card: null, threadId: null, payload }, { isAdmin: false }).body;
    expect(describe_({ tier: "plus", expiresAt: COMP_30 })).not.toContain("trial");
    expect(describe_({ tier: "plus", expiresAt: COMP_30, trialEnd: COMP_30 })).toMatch(/Your free trial now runs until .*; nothing is charged before then\./);
  });
});
