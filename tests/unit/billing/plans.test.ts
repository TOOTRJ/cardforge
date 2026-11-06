import { describe, expect, it } from "vitest";
import {
  CREDIT_PACKS,
  PLAN_CREDITS_ONCE,
  FREE_PERIOD_CREDITS,
  PACK_ORDER,
  PACK_SUBSCRIBER_DISCOUNT_PCT,
  SIGNUP_CREDITS,
  TRIAL_WINBACK_COUPON_ID,
  TRIAL_WINBACK_DISCOUNT_PCT,
  TRIAL_WINBACK_WINDOW_DAYS,
  discountedPackPriceUsd,
  formatUsd,
  PLANS,
  creditRefillKey,
  currentCreditPeriod,
  planForTier,
} from "@/lib/billing/plans";

describe("billing plan catalog", () => {
  it("grants more monthly credits at higher tiers", () => {
    expect(PLAN_CREDITS_ONCE.plus).toBeLessThan(PLAN_CREDITS_ONCE.pro);
  });

  it("lists free → plus → pro in ascending price", () => {
    expect(PLANS.map((plan) => plan.tier)).toEqual(["free", "plus", "pro"]);
    expect(PLANS[0].priceUsd).toBe(0);
    expect(PLANS[1].priceUsd).toBeLessThan(PLANS[2].priceUsd);
  });

  it("emphasizes exactly one tier as 'most popular'", () => {
    expect(PLANS.filter((plan) => plan.featured)).toHaveLength(1);
  });

  it("resolves a plan for each tier", () => {
    expect(planForTier("pro").tier).toBe("pro");
    expect(planForTier("plus").tier).toBe("plus");
    expect(planForTier("free").tier).toBe("free");
  });

  it("offers credit packs with positive, increasing value", () => {
    expect(CREDIT_PACKS.small.credits).toBeGreaterThan(0);
    expect(CREDIT_PACKS.small.priceUsd).toBeGreaterThan(0);
    expect(CREDIT_PACKS.large.credits).toBeGreaterThan(CREDIT_PACKS.small.credits);
  });

  it("prices annual plans at 2 months free (monthly × 10)", () => {
    for (const plan of PLANS) {
      if (plan.priceUsd === 0) continue;
      expect(plan.annualUsd).toBe(plan.priceUsd * 10);
    }
  });
});

describe("credit refill keys", () => {
  it("formats the calendar-month period as YYYY-MM (UTC)", () => {
    expect(currentCreditPeriod(new Date("2026-06-07T12:00:00Z"))).toBe("2026-06");
    expect(currentCreditPeriod(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
    expect(currentCreditPeriod(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01");
  });

  it("derives a stable per-user-per-month idempotency key", () => {
    expect(creditRefillKey("user-123", "2026-06")).toBe("refill:user-123:2026-06");
  });

  it("Free gets 5 credits once at signup (the profiles.credits default); plan credits are one-time", () => {
    expect(SIGNUP_CREDITS).toBe(5);
    // One-time plan credits (owner 2026-11-06): 60 on Plus, 120 on Pro, nothing recurring.
    expect(PLAN_CREDITS_ONCE).toEqual({ plus: 60, pro: 120 });
    expect(PLANS[0].features[0]).toMatch(/5 AI credits to start/);
    expect(PLANS[1].features[0]).toBe("60 AI credits with your first payment");
    expect(PLANS[2].features[0]).toBe("120 AI credits with your first payment");
    for (const plan of PLANS) expect(plan.features.join(" ")).not.toMatch(/every month|a month|monthly/);
  });

  it("three packs, impulse → value, with the subscriber price cents-exact", () => {
    expect(PACK_ORDER).toEqual(["mini", "small", "large"]);
    expect(CREDIT_PACKS.mini).toEqual({ credits: 10, priceUsd: 4, label: "10 credits" });
    expect(PACK_SUBSCRIBER_DISCOUNT_PCT).toBe(20);
    expect(discountedPackPriceUsd("mini")).toBe(3.2);
    expect(discountedPackPriceUsd("small")).toBe(6.4);
    expect(discountedPackPriceUsd("large")).toBe(19.2);
    expect(formatUsd(4)).toBe("$4");
    expect(formatUsd(6.4)).toBe("$6.40");
    expect(formatUsd(19.2)).toBe("$19.20");
  });

  it("the trial tranche is a taste below every paid allotment, and the win-back offer is defined", () => {
    expect(FREE_PERIOD_CREDITS).toBe(10);
    expect(FREE_PERIOD_CREDITS).toBeLessThan(PLAN_CREDITS_ONCE.plus);
    expect(TRIAL_WINBACK_DISCOUNT_PCT).toBe(20);
    expect(TRIAL_WINBACK_COUPON_ID).toBe("TRIAL_WINBACK_20");
    expect(TRIAL_WINBACK_WINDOW_DAYS).toBe(30);
  });
});

