import { describe, expect, it } from "vitest";
import {
  CREDIT_PACKS,
  MONTHLY_CREDITS,
  PACK_ORDER,
  PACK_SUBSCRIBER_DISCOUNT_PCT,
  SIGNUP_CREDITS,
  TRIAL_CREDITS,
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
    expect(MONTHLY_CREDITS.free).toBeLessThan(MONTHLY_CREDITS.plus);
    expect(MONTHLY_CREDITS.plus).toBeLessThan(MONTHLY_CREDITS.pro);
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

  it("Free doesn't refill: 5 credits once at signup (the profiles.credits default), 0 a month", () => {
    expect(SIGNUP_CREDITS).toBe(5);
    expect(MONTHLY_CREDITS.free).toBe(0);
    expect(MONTHLY_CREDITS.plus).toBeGreaterThan(0);
    expect(PLANS[0].features[0]).toMatch(/5 AI credits at sign-up/);
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
    expect(TRIAL_CREDITS).toBe(25);
    expect(TRIAL_CREDITS).toBeLessThan(MONTHLY_CREDITS.plus);
    expect(TRIAL_WINBACK_DISCOUNT_PCT).toBe(20);
    expect(TRIAL_WINBACK_COUPON_ID).toBe("TRIAL_WINBACK_20");
    expect(TRIAL_WINBACK_WINDOW_DAYS).toBe(30);
  });
});

