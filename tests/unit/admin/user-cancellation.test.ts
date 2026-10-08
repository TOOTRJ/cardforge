import { describe, expect, it } from "vitest";
import { cancellationStats } from "@/lib/admin/user-cancellation";
import { planEndingOf } from "@/lib/billing/plan-ending";
import { FLAG_LABELS, USER_FLAG_FILTERS, parseUserListParams } from "@/lib/admin/users-params";

// /admin/users — a subscriber who has cancelled but is still on the plan is
// shown as cancelled, with the date, BEFORE the plan ends. (Until now the
// only cancellation the page could show was status `canceled`, after it.)

const PERIOD_END = "2026-10-23T02:31:04.000Z";

describe("cancellationStats — the detail panel's rows", () => {
  it("a plan that renews", () => {
    expect(cancellationStats(null, "active")).toEqual({
      state: "none — the plan renews",
      endsAt: "—",
      canceledAt: "—",
      billedFirst: "—",
    });
  });
  it("an ended subscription is 'ended', not a pending cancellation", () => {
    expect(cancellationStats(null, "canceled").state).toBe("ended (no live subscription)");
  });
  it("cancelled, still active: the end date, when it was cancelled, ends with the paid period", () => {
    const ending = planEndingOf({
      subscription_status: "active",
      current_period_end: PERIOD_END,
      cancel_at_period_end: true,
      subscription_ends_at: PERIOD_END,
      subscription_canceled_at: "2026-10-07T18:00:00.000Z",
    });
    expect(cancellationStats(ending, "active")).toEqual({
      state: "cancelled — still active until it ends",
      endsAt: "October 23, 2026",
      canceledAt: "October 7, 2026",
      billedFirst: "no — ends with the paid period",
    });
  });
  it("ends LATER than the paid period: still billed first", () => {
    const ending = planEndingOf({
      subscription_status: "active",
      current_period_end: PERIOD_END,
      subscription_ends_at: "2026-12-07T02:31:04.000Z",
    });
    expect(cancellationStats(ending, "active")).toMatchObject({
      endsAt: "December 7, 2026",
      billedFirst: "yes — renews October 23, 2026, then ends later",
      canceledAt: "not recorded (resync fills it)",
    });
  });
  it("a cancelled trial", () => {
    const ending = planEndingOf({ subscription_status: "trialing", current_period_end: PERIOD_END, cancel_at_period_end: true });
    expect(cancellationStats(ending, "trialing")).toMatchObject({
      state: "trial cancelled — still active until it ends, never charged",
      billedFirst: "no — ends with the trial",
    });
  });
});

describe("the directory's 'ending' segment", () => {
  it("is a filter the URL accepts, with a label", () => {
    expect(USER_FLAG_FILTERS).toContain("ending");
    expect(FLAG_LABELS.ending).toBe("Cancelled, still active");
    expect(parseUserListParams({ flag: "ending" }).flag).toBe("ending");
  });
});
