import { describe, expect, it } from "vitest";
import {
  planEndingAdminLabel,
  planEndingOf,
  planEndingSentence,
  planEndingShort,
} from "@/lib/billing/plan-ending";
import { planStatusOf } from "@/lib/billing/plan-status";
import { billingViewerFromProfile } from "@/lib/billing/viewer";

// ---------------------------------------------------------------------------
// "Your plan has been cancelled and ends on <date>" from the PROFILE ROW —
// the one reading behind the dashboard notice, Settings, the header menu,
// the upgrade modal and the admin directory. The state table of #482's
// billing page, extended to every page that has no Stripe call to make.
// ---------------------------------------------------------------------------

const PERIOD_END = "2026-10-23T02:31:04.000Z";
const LATER = "2026-12-07T02:31:04.000Z";
const CANCELLED_ON = "2026-10-07T18:00:00.000Z";

const row = (over: Record<string, unknown> = {}) => ({
  subscription_status: "active",
  current_period_end: PERIOD_END,
  cancel_at_period_end: false,
  subscription_ends_at: null,
  subscription_canceled_at: null,
  ...over,
});

describe("planEndingOf — the state table", () => {
  const cases: Array<[string, Record<string, unknown>, ReturnType<typeof planEndingOf>]> = [
    ["a plan that renews", row(), null],
    ["no profile fields at all (a free account)", { subscription_status: null }, null],
    [
      "cancelled, synced after 0135: the stored date",
      row({ cancel_at_period_end: true, subscription_ends_at: PERIOD_END, subscription_canceled_at: CANCELLED_ON }),
      { kind: "plan", endsAt: PERIOD_END, billedBeforeAt: null, canceledAt: CANCELLED_ON },
    ],
    [
      "cancelled, synced BEFORE 0135: the flag, dated by the stored period end",
      row({ cancel_at_period_end: true }),
      { kind: "plan", endsAt: PERIOD_END, billedBeforeAt: null, canceledAt: null },
    ],
    [
      "a cancelled TRIAL: it ends, nothing is charged",
      row({ subscription_status: "trialing", cancel_at_period_end: true, subscription_ends_at: PERIOD_END }),
      { kind: "trial", endsAt: PERIOD_END, billedBeforeAt: null, canceledAt: null },
    ],
    [
      "an end date PAST the next renewal (flag false): still billed first",
      row({ subscription_ends_at: LATER }),
      { kind: "plan", endsAt: LATER, billedBeforeAt: PERIOD_END, canceledAt: null },
    ],
    [
      "a trial that ends after it converts is a plan that is billed first",
      row({ subscription_status: "trialing", subscription_ends_at: LATER }),
      { kind: "plan", endsAt: LATER, billedBeforeAt: PERIOD_END, canceledAt: null },
    ],
    // Not "ending": already over, or payment broken (perks are paused; the
    // page says so instead).
    ["ended (status canceled) — never 'ending'", row({ subscription_status: "canceled", cancel_at_period_end: true, subscription_ends_at: PERIOD_END }), null],
    ["past due", row({ subscription_status: "past_due", subscription_ends_at: PERIOD_END }), null],
    ["the flag with no period end to date it by", row({ cancel_at_period_end: true, current_period_end: null }), null],
    ["a garbage date is not a date", row({ subscription_ends_at: "soon" }), null],
  ];
  for (const [name, profile, expected] of cases) {
    it(name, () => expect(planEndingOf(profile)).toEqual(expected));
  }
  it("null / undefined profile", () => {
    expect(planEndingOf(null)).toBeNull();
    expect(planEndingOf(undefined)).toBeNull();
  });
});

describe("the copy — one wording family with the billing page", () => {
  const plan = planEndingOf(row({ cancel_at_period_end: true, subscription_ends_at: PERIOD_END }))!;
  const trial = planEndingOf(row({ subscription_status: "trialing", subscription_ends_at: PERIOD_END }))!;
  const later = planEndingOf(row({ subscription_ends_at: LATER }))!;

  it("a cancelled plan: cancelled, the date, kept until then", () => {
    expect(planEndingSentence(plan, "Pro")).toBe(
      "Your Pro plan was cancelled and ends on October 23, 2026. You keep Pro until then.",
    );
  });
  it("a cancelled trial: the trial ends and nothing is charged", () => {
    expect(planEndingSentence(trial, "Plus")).toBe(
      "You cancelled your Plus free trial. It ends on October 23, 2026 and you won't be charged. You keep Plus until then.",
    );
  });
  it("an end date after the next renewal never says 'nothing more is charged'", () => {
    const text = planEndingSentence(later, "Pro");
    expect(text).toBe(
      "Your Pro plan is set to end on December 7, 2026. It is still billed as usual until then — next on October 23, 2026.",
    );
  });
  it("short and admin labels", () => {
    expect(planEndingShort(plan)).toBe("ends Oct 23, 2026");
    expect(planEndingShort(trial)).toBe("trial ends Oct 23, 2026");
    expect(planEndingAdminLabel(plan)).toBe("cancelled, ends Oct 23, 2026");
    expect(planEndingAdminLabel(trial)).toBe("trial cancelled, ends Oct 23, 2026");
    expect(planEndingAdminLabel(later)).toBe("cancelled, ends Dec 7, 2026 (billed first)");
  });
});

describe("the same row through the other readers", () => {
  const entitlements = { isPaid: true, effectiveTier: "pro" as const };
  it("the storefront viewer is 'ending' on the stored date alone (flag false: a later-period cancellation)", () => {
    const viewer = billingViewerFromProfile(
      { subscription_status: "active", stripe_customer_id: "cus_1", cancel_at_period_end: false, current_period_end: PERIOD_END, subscription_ends_at: LATER },
      entitlements,
    );
    expect(viewer.subscriptionEnding).toBe(true);
    expect(viewer.subscriptionEndsAt).toBe(LATER);
  });
  it("…and on the flag alone, with the period end as its date", () => {
    const viewer = billingViewerFromProfile(
      { subscription_status: "active", stripe_customer_id: "cus_1", cancel_at_period_end: true, current_period_end: PERIOD_END },
      entitlements,
    );
    expect(viewer).toMatchObject({ subscriptionEnding: true, subscriptionEndsAt: PERIOD_END });
  });
  it("a renewing or ended subscription is not ending", () => {
    expect(
      billingViewerFromProfile({ subscription_status: "active", stripe_customer_id: "cus_1", current_period_end: PERIOD_END }, entitlements),
    ).toMatchObject({ subscriptionEnding: false, subscriptionEndsAt: null });
    expect(
      billingViewerFromProfile(
        { subscription_status: "canceled", stripe_customer_id: "cus_1", cancel_at_period_end: true, subscription_ends_at: PERIOD_END },
        entitlements,
      ),
    ).toMatchObject({ subscriptionEnding: false, subscriptionEndsAt: null });
  });
  it("the billing page, when Stripe can't be read, dates the ending by the stored date — a later-period one is 'billed first'", () => {
    expect(
      planStatusOf({
        live: true,
        delinquent: false,
        comped: false,
        status: "active",
        subscription: null,
        profile: { currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: false, endsAt: LATER },
      }),
    ).toEqual({ kind: "ending", endsAt: LATER, billedBeforeAt: PERIOD_END });
  });
});
