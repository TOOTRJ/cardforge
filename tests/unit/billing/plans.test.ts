import { describe, expect, it } from "vitest";
import {
  CREDIT_PACKS,
  MONTHLY_CREDITS,
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
});
