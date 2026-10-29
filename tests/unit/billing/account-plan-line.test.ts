import { describe, expect, it } from "vitest";
import { accountPlanLine } from "@/lib/billing/account-plan-line";
import { dateTextToString } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// The Account menu's plan line (TODO NV1): the billing page's decisions, in
// its order — a broken payment, a cancelled plan, a complimentary one — from
// the facts /api/me and the (app) layout carry. An admin is unlocked: no
// plan to name. Parts, so a date is the viewer's own (printed in UTC here).
// ---------------------------------------------------------------------------

const line = (facts: Parameters<typeof accountPlanLine>[0]) => {
  const parts = accountPlanLine(facts);
  return parts ? dateTextToString(parts, "UTC") : null;
};

const PRO_LIVE = { isPaid: true, tier: "pro" as const, subscribedTier: "pro" as const, subscriptionStatus: "active", hasLiveSubscription: true };

describe("accountPlanLine", () => {
  it("an admin reads Admin — never the unlocked tier", () => {
    expect(line({ isAdmin: true, isPaid: true, tier: "pro" })).toBe("Admin");
    expect(line({ isAdmin: true, isPaid: true, tier: "pro", subscriptionStatus: "past_due" })).toBe("Admin");
  });

  it("a broken payment names the plan it is for, though its perks are paused (effective tier Free)", () => {
    for (const status of ["past_due", "unpaid", "incomplete"]) {
      expect(
        line({ isPaid: false, tier: "free", subscribedTier: "pro", subscriptionStatus: status, hasLiveSubscription: false }),
        status,
      ).toBe("Pro · payment due");
    }
    expect(line({ isPaid: false, tier: "free", subscribedTier: "plus", subscriptionStatus: "past_due" })).toBe("Plus · payment due");
  });

  it("a cancelled plan says when it ends; a cancelled trial says the trial ends", () => {
    const ending = { ...PRO_LIVE, subscriptionEnding: true, subscriptionEndsAt: "2026-10-23T02:31:04.000Z" };
    expect(line({ ...ending, subscriptionEndingKind: "plan" })).toBe("Pro · ends Oct 23, 2026");
    expect(line({ ...ending, subscriptionStatus: "trialing", subscriptionEndingKind: "trial" })).toBe("Pro · trial ends Oct 23, 2026");
  });

  it("a comped account (paid perks, no subscription Stripe bills) reads complimentary", () => {
    expect(line({ isPaid: true, tier: "pro", subscribedTier: "free", subscriptionStatus: null, hasLiveSubscription: false })).toBe(
      "Pro · complimentary",
    );
    // A comp over a lapsed subscription is a comp all the same.
    expect(line({ isPaid: true, tier: "plus", subscribedTier: "plus", subscriptionStatus: "canceled", hasLiveSubscription: false })).toBe(
      "Plus · complimentary",
    );
  });

  it("otherwise the plan's name", () => {
    expect(line(PRO_LIVE)).toBe("Pro plan");
    expect(line({ ...PRO_LIVE, subscriptionStatus: "trialing" })).toBe("Pro plan");
    expect(line({ isPaid: false, tier: "free", subscriptionStatus: null })).toBe("Free plan");
    // A lapsed subscriber is on Free.
    expect(line({ isPaid: false, tier: "free", subscribedTier: "pro", subscriptionStatus: "canceled" })).toBe("Free plan");
  });

  it("nothing to say for a paid account with no tier", () => {
    expect(line({ isPaid: true, tier: null })).toBeNull();
  });
});
