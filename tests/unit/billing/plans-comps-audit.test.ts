import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { effectiveTierForProfile, type BillingProfileSlice } from "@/lib/billing/entitlements";
import { refillTierFor, type RefillProfileRow } from "@/lib/billing/credit-refill";
import {
  CHECKOUT_MIN_TRIAL_SECONDS,
  COMP_CREDIT_GRANT_KEY,
  MAX_TRIAL_SECONDS,
  TRIAL_END_BEFORE_COMP_KEY,
  compCreditChangeFor,
  compCreditLedgerKey,
  compCreditNote,
  compEndDateError,
  compHoldsCheckoutUntil,
  liveCompChargeLine,
  compNeedsEndDate,
  compOverLiveSubscription,
  compStripeNote,
  compTrialChangeFor,
} from "@/lib/billing/comp-stripe";
import {
  oneMonthCents,
  periodCreditCents,
  periodMonthsAndDays,
  unspentCreditCents,
  yearlyCentsOf,
} from "@/lib/billing/balance-credit";
import { isUnconvertedTrial } from "@/lib/stripe/subscription-sync";
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
// audit, a hold on a card-backed TRIAL's first charge (compTrialChangeFor)
// and, on an ACTIVE plan, the comp period's price on the Stripe customer
// balance (compCreditChangeFor; owner answers 2026-10-30).
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
  it("no end date: Stripe can't hold a trial open-ended — left alone (the admin action refuses it first: owner answer 2)", () => {
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

describe("a comp on a LIVE (active) subscription — owner answer 1: the payer pays nothing for it", () => {
  const activeSub = (over: Record<string, unknown> = {}) => ({
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: {} as Record<string, string>,
    ...over,
  });

  it("the comp period goes on the Stripe balance (a new grant from NOW); the higher tier's perks apply", () => {
    const change = compCreditChangeFor({ sub: activeSub(), subscribedTier: "plus", comp: { tier: "pro", expiresAt: COMP_30 }, now: NOW });
    expect(change).toEqual({
      kind: "settle",
      grant: { startSec: sec(NOW), endSec: sec(COMP_30) },
      coverUntilSec: sec(COMP_30),
      grantMeta: `${sec(NOW)}:${sec(COMP_30)}`,
      opensGrant: true,
      reason: "comp_credits_period",
    });
    // The trial path leaves an active plan alone: its dates never move.
    expect(compTrialChangeFor({ sub: activeSub(), subscribedTier: "plus", comp: { tier: "pro", expiresAt: COMP_30 }, now: NOW })).toEqual({
      kind: "none",
      reason: "not_trialing",
    });
    expect(effectiveTierForProfile(profile({ subscription_tier: "plus", subscription_status: "active", comp_tier: "pro", comp_expires_at: COMP_30 }))).toBe("pro");
  });
  it("re-saved, extended or shortened: the SAME grant (its start never moves) — the writer posts only the difference", () => {
    const meta = { [COMP_CREDIT_GRANT_KEY]: `${sec(NOW)}:${sec(COMP_30)}` };
    const later = new Date(NOW.getTime() + days(5) * 1000);
    const longer = iso(sec(NOW) + days(90));
    expect(compCreditChangeFor({ sub: activeSub({ metadata: meta }), subscribedTier: "plus", comp: { tier: "plus", expiresAt: longer }, now: later })).toMatchObject({
      kind: "settle",
      grant: { startSec: sec(NOW) },
      coverUntilSec: sec(longer),
      grantMeta: `${sec(NOW)}:${sec(longer)}`,
      opensGrant: false,
      reason: "comp_credits_period",
    });
    expect(compCreditLedgerKey("sub_1", { startSec: sec(NOW), endSec: sec(longer) })).toBe(`comp:sub_1:${sec(NOW)}`);
  });
  it("cleared (or dropped below the plan): released — covers only the time lived through, metadata cleared", () => {
    const meta = { [COMP_CREDIT_GRANT_KEY]: `${sec(NOW)}:${sec(COMP_30)}` };
    const later = new Date(NOW.getTime() + days(10) * 1000);
    for (const comp of [{ tier: null, expiresAt: null }, { tier: "plus" as const, expiresAt: COMP_30 }]) {
      const tier = comp.tier == null ? "plus" : "pro"; // a Plus comp on a Pro plan is below it
      expect(compCreditChangeFor({ sub: activeSub({ metadata: meta }), subscribedTier: tier, comp, now: later })).toEqual({
        kind: "settle",
        grant: { startSec: sec(NOW), endSec: sec(COMP_30) },
        coverUntilSec: sec(later),
        grantMeta: "",
        opensGrant: false,
        reason: "comp_released",
      });
    }
  });
  it("a FINISHED grant is not reopened: the comp ran its course, the next comp opens a new grant", () => {
    const meta = { [COMP_CREDIT_GRANT_KEY]: `${sec(NOW) - days(60)}:${sec(NOW) - days(30)}` };
    expect(compCreditChangeFor({ sub: activeSub({ metadata: meta }), subscribedTier: "plus", comp: { tier: null, expiresAt: null }, now: NOW })).toEqual({
      kind: "none",
      reason: "no_comp",
    });
    expect(compCreditChangeFor({ sub: activeSub({ metadata: meta }), subscribedTier: "plus", comp: { tier: "plus", expiresAt: COMP_30 }, now: NOW })).toMatchObject({
      opensGrant: true,
      grant: { startSec: sec(NOW) },
    });
  });
  it("a comp never demotes a payer; one below the plan moves no money", () => {
    expect(effectiveTierForProfile(profile({ subscription_tier: "pro", subscription_status: "active", comp_tier: "plus", comp_expires_at: COMP_30 }))).toBe("pro");
    const change = compCreditChangeFor({ sub: activeSub(), subscribedTier: "pro", comp: { tier: "plus", expiresAt: COMP_30 }, now: NOW });
    expect(change).toEqual({ kind: "none", reason: "comp_lower_tier" });
  });
  it("a plan set to END gets no credit (no invoice would take it)", () => {
    for (const ending of [{ cancel_at_period_end: true }, { cancel_at: sec(NOW) + days(10) }]) {
      expect(compCreditChangeFor({ sub: activeSub(ending), subscribedTier: "plus", comp: { tier: "plus", expiresAt: COMP_30 }, now: NOW })).toEqual({
        kind: "none",
        reason: "ending",
      });
    }
  });
  it("with a SCHEDULED DOWNGRADE (Pro → Plus at period end): the dates and the schedule are untouched (money only, on the balance); perks are the higher of comp and plan", () => {
    const change = compCreditChangeFor({ sub: activeSub(), subscribedTier: "pro", comp: { tier: "pro", expiresAt: COMP_30 }, now: NOW });
    expect(change.kind).toBe("settle");
    // After the phase change the profile says Plus; a Pro comp still gives Pro.
    expect(effectiveTierForProfile(profile({ subscription_tier: "plus", subscription_status: "active", comp_tier: "pro", comp_expires_at: COMP_30 }))).toBe("pro");
  });
  it("a trialing plan is never credited (the trial is HELD instead)", () => {
    expect(compCreditChangeFor({ sub: trialSub(), subscribedTier: "plus", comp: { tier: "plus", expiresAt: COMP_30 }, now: NOW })).toEqual({
      kind: "none",
      reason: "not_active",
    });
  });
});

describe("the balance credit's maths (lib/billing/balance-credit.ts — docs/BILLING.md)", () => {
  const MONTHLY_PLUS = { unit_amount: 600, currency: "usd", recurring: { interval: "month", interval_count: 1 } };
  const ANNUAL_PLUS = { unit_amount: 6000, currency: "usd", recurring: { interval: "year", interval_count: 1 } };
  const at = (s: string) => sec(s);
  const credit = (price: typeof MONTHLY_PLUS | null, start: string, end: string) =>
    periodCreditCents({ price, tier: "plus", startSec: at(start), endSec: at(end) });

  it("a whole-month comp on a monthly plan is exactly price × months", () => {
    expect(credit(MONTHLY_PLUS, "2026-11-01T12:00:00Z", "2026-12-01T12:00:00Z")).toBe(600);
    expect(credit(MONTHLY_PLUS, "2026-11-01T12:00:00Z", "2027-02-01T12:00:00Z")).toBe(1800);
    // The picker's midnight, a few hours short of the save's time: still one month.
    expect(credit(MONTHLY_PLUS, "2026-11-01T15:30:00Z", "2026-12-01T00:00:00Z")).toBe(600);
    // Jan 31 + 1 month = Feb 28.
    expect(periodMonthsAndDays(at("2027-01-31T12:00:00Z"), at("2027-02-28T12:00:00Z"))).toEqual({ months: 1, days: 0 });
  });
  it("a non-whole-month comp is prorated per day on the year's price (÷ 365)", () => {
    // 30 days from Oct 29 ends Nov 28 — a day short of a calendar month.
    expect(credit(MONTHLY_PLUS, "2026-10-29T12:00:00Z", "2026-11-28T12:00:00Z")).toBe(592); // 7200 × 30/365
    expect(credit(MONTHLY_PLUS, "2026-11-01T12:00:00Z", "2026-11-11T12:00:00Z")).toBe(197); // 7200 × 10/365
  });
  it("an ANNUAL plan: the comp period's share of the year — ÷ 12 per whole month, ÷ 365 per day", () => {
    expect(credit(ANNUAL_PLUS, "2026-11-01T12:00:00Z", "2026-12-01T12:00:00Z")).toBe(500);
    expect(credit(ANNUAL_PLUS, "2026-11-01T12:00:00Z", "2026-12-16T12:00:00Z")).toBe(747); // 6000 × (1/12 + 15/365)
    expect(yearlyCentsOf(ANNUAL_PLUS, "plus")).toBe(6000);
    expect(oneMonthCents(ANNUAL_PLUS, "plus")).toBe(500);
  });
  it("Stripe's price unreadable: the plan's monthly list price × 12", () => {
    expect(yearlyCentsOf(null, "plus")).toBe(7200);
    expect(oneMonthCents(null, "pro")).toBe(1500);
  });
  it("an empty or backwards period is worth nothing", () => {
    expect(credit(MONTHLY_PLUS, "2026-11-01T12:00:00Z", "2026-11-01T12:00:00Z")).toBe(0);
    expect(credit(MONTHLY_PLUS, "2026-11-02T12:00:00Z", "2026-11-01T12:00:00Z")).toBe(0);
  });
  it("the claw-back cap: only the credit still unspent on the balance", () => {
    expect(unspentCreditCents({ balance: -403 })).toBe(403);
    expect(unspentCreditCents({ balance: 250 })).toBe(0); // the customer owes; nothing left to take back
    expect(unspentCreditCents(null)).toBe(0);
  });
  it("the admin's line names what moved", () => {
    const money = (c: number) => `$${(c / 100).toFixed(2)}`;
    const settle = compCreditChangeFor({ sub: { status: "active", metadata: {} }, subscribedTier: "plus", comp: { tier: "plus", expiresAt: COMP_30 }, now: NOW });
    expect(compCreditNote(settle, { postedCents: 600, keptCents: 0, money })).toMatch(/^Credited \$6\.00 to their Stripe balance/);
    expect(compCreditNote(settle, { postedCents: -403, keptCents: 50, money })).toBe(
      "Took back $4.03 of unused comp credit from their Stripe balance. $0.50 had already paid an invoice and stays with them.",
    );
  });
});

describe("owner answer 2: a comp on a trialing or paying user needs an END DATE", () => {
  it("refused with no expiry on trialing, active and past-due; allowed for free users", () => {
    for (const status of ["trialing", "active", "past_due"]) {
      expect(compNeedsEndDate(status)).toBe(true);
      expect(compEndDateError({ subscriptionStatus: status, tier: "plus", expiresAt: null, now: NOW })).toMatch(/set an expiry date/);
      expect(compEndDateError({ subscriptionStatus: status, tier: "plus", expiresAt: COMP_30, now: NOW })).toBeNull();
      // Clearing is always allowed.
      expect(compEndDateError({ subscriptionStatus: status, tier: null, expiresAt: null, now: NOW })).toBeNull();
    }
    for (const status of [null, "canceled", "incomplete_expired"]) {
      expect(compNeedsEndDate(status)).toBe(false);
      expect(compEndDateError({ subscriptionStatus: status, tier: "pro", expiresAt: null, now: NOW })).toBeNull();
    }
  });
  it("and no further out than 730 days (Stripe's trial limit; one bound for a credit too)", () => {
    const far = iso(sec(NOW) + MAX_TRIAL_SECONDS + days(1));
    expect(compEndDateError({ subscriptionStatus: "active", tier: "plus", expiresAt: far, now: NOW })).toMatch(/at most 730 days/);
    expect(compEndDateError({ subscriptionStatus: null, tier: "plus", expiresAt: far, now: NOW })).toBeNull();
  });
});

describe("owner answer 3: clearing a comp after the trial's own end has passed charges now — and says only that", () => {
  it("the trial ends now; the user's notification names no trial date", () => {
    const held = trialSub({ trial_end: sec(COMP_30), metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(TRIAL_END) } });
    const later = new Date((TRIAL_END + days(3)) * 1000);
    const change = compTrialChangeFor({ sub: held, subscribedTier: "plus", comp: { tier: null, expiresAt: null }, now: later });
    expect(change).toMatchObject({ kind: "set_trial_end", trialEnd: "now", reason: "comp_released_trial" });
    expect(compStripeNote(change, { live: true })).toBe("Their trial had already passed its own end, so it ends now and is charged.");
    // adminSetCompTierAction sends trialEnd only for comp_holds_trial
    // (tests/unit/admin/user-actions.test.ts), so the bell reads:
    expect(
      describeNotification({ type: "comp_plan", actor: null, card: null, threadId: null, payload: { tier: null, expiresAt: null } }, { isAdmin: false }).body,
    ).toBe("ended your complimentary plan access.");
  });
});

describe("a comp-held trial cancelled during the hold is not a LAPSED trial (no trial_lapsed, no win-back)", () => {
  const base = { id: "sub_1", status: "canceled", items: { data: [] } };
  it("a comp hold that was never a free trial (a comped former subscriber's checkout)", () => {
    const checkoutSec = sec(NOW);
    const sub = { ...base, trial_end: sec(COMP_30), ended_at: checkoutSec + days(5), metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(checkoutSec) } };
    expect(isUnconvertedTrial(sub)).toBe(false);
    // Without the key the same object reads as a lapsed trial — what the key prevents.
    expect(isUnconvertedTrial({ ...sub, metadata: {} })).toBe(true);
  });
  it("a real 7-day trial held by a comp: lapsed only when cancelled inside the 7 days", () => {
    const meta = { [TRIAL_END_BEFORE_COMP_KEY]: String(TRIAL_END) };
    expect(isUnconvertedTrial({ ...base, trial_end: sec(COMP_30), ended_at: TRIAL_END - days(1), metadata: meta })).toBe(true);
    expect(isUnconvertedTrial({ ...base, trial_end: sec(COMP_30), ended_at: TRIAL_END + days(3), metadata: meta })).toBe(false);
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
  it("billing page: 'nothing is charged before then' only when Stripe's trial really reaches the comp's end (finding 2)", () => {
    const line = (status: string, stripeTrialEnd: string | null, ending = false) =>
      liveCompChargeLine({ status, ending, compExpiresAt: COMP_30, stripeTrialEnd });
    expect(line("trialing", COMP_30)).toBe("trial_held");
    expect(line("trialing", iso(sec(COMP_30) + 60))).toBe("trial_held");
    // The hold failed, or Stripe still has the 7-day end: no promise.
    expect(line("trialing", iso(TRIAL_END))).toBe("own_dates");
    expect(line("trialing", null)).toBe("own_dates");
    expect(line("active", null)).toBe("balance_credit");
    expect(line("active", null, true)).toBe("own_dates");
    expect(liveCompChargeLine({ status: "trialing", ending: false, compExpiresAt: null, stripeTrialEnd: COMP_30 })).toBe("own_dates");
  });
  it("the comp notification names a paying user's balance credit", () => {
    const body = describeNotification(
      { type: "comp_plan", actor: null, card: null, threadId: null, payload: { tier: "plus", expiresAt: COMP_30, creditCents: 600, currency: "usd" } },
      { isAdmin: false },
    ).body;
    expect(body).toMatch(/We've put \$6 on your billing balance, so the comp period costs you nothing\./);
    expect(body).not.toContain("trial");
  });
  it("the comp notification says when the first charge lands when it moved the trial", () => {
    const describe_ = (payload: Record<string, unknown>) =>
      describeNotification({ type: "comp_plan", actor: null, card: null, threadId: null, payload }, { isAdmin: false }).body;
    expect(describe_({ tier: "plus", expiresAt: COMP_30 })).not.toContain("trial");
    expect(describe_({ tier: "plus", expiresAt: COMP_30, trialEnd: COMP_30 })).toMatch(/Your free trial now runs until .*; nothing is charged before then\./);
  });
});
