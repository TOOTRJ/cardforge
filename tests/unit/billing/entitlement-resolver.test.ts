import { describe, expect, it } from "vitest";
import {
  effectiveTierForProfile,
  type BillingProfileSlice,
} from "@/lib/billing/entitlements";

// ---------------------------------------------------------------------------
// effectiveTierForProfile — which perks actually apply: a paid tier only
// while its subscription is active/trialing, and an unexpired admin comp
// takes the HIGHER of the two (a comp never demotes a paying user).
// ---------------------------------------------------------------------------

function profile(overrides: Partial<BillingProfileSlice> = {}): BillingProfileSlice {
  return {
    subscription_tier: null,
    subscription_status: null,
    is_admin: false,
    comp_tier: null,
    comp_expires_at: null,
    ...overrides,
  };
}

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

describe("effectiveTierForProfile", () => {
  it("is free with no subscription", () => {
    expect(effectiveTierForProfile(profile())).toBe("free");
  });

  it("grants a paid tier only while the subscription is active or trialing", () => {
    expect(effectiveTierForProfile(profile({ subscription_tier: "pro", subscription_status: "active" }))).toBe("pro");
    expect(effectiveTierForProfile(profile({ subscription_tier: "plus", subscription_status: "trialing" }))).toBe("plus");
    for (const status of ["canceled", "past_due", "unpaid", "incomplete", null]) {
      expect(effectiveTierForProfile(profile({ subscription_tier: "pro", subscription_status: status })), String(status)).toBe("free");
    }
  });

  it("applies an unexpired comp, ignores an expired one", () => {
    expect(effectiveTierForProfile(profile({ comp_tier: "pro", comp_expires_at: future }))).toBe("pro");
    expect(effectiveTierForProfile(profile({ comp_tier: "pro", comp_expires_at: null }))).toBe("pro");
    expect(effectiveTierForProfile(profile({ comp_tier: "plus", comp_expires_at: past }))).toBe("free");
  });

  it("takes the higher of comp and subscription — a comp never demotes", () => {
    expect(
      effectiveTierForProfile(profile({ subscription_tier: "pro", subscription_status: "active", comp_tier: "plus", comp_expires_at: future })),
    ).toBe("pro");
    expect(
      effectiveTierForProfile(profile({ subscription_tier: "plus", subscription_status: "active", comp_tier: "pro", comp_expires_at: future })),
    ).toBe("pro");
    // A lapsed subscription still gets the comp.
    expect(
      effectiveTierForProfile(profile({ subscription_tier: "pro", subscription_status: "canceled", comp_tier: "plus", comp_expires_at: future })),
    ).toBe("plus");
  });
});
