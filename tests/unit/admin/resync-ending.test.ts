import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /admin/users → "Resync from Stripe" on a subscriber who has CANCELLED but
// is still active — through the REAL sync (lib/stripe/subscription-sync.ts),
// with a subscription shaped exactly like the one the Customer Portal left
// in the sandbox on 2026-10-07 (flexible billing mode):
//
//   status "active", cancel_at_period_end false,
//   cancel_at 1794097332 === items.data[0].current_period_end,
//   canceled_at 1791418974, schedule null
//
// What it pins: the stored row is right after a resync (flag true + the end
// date + when it was cancelled), the admin panel SHOWS it (label + detail
// rows — the page used to have no display for a pending cancellation), and a
// resync can no longer answer "Synced" after writing nothing.
// ---------------------------------------------------------------------------

const TARGET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PERIOD_END = 1794097332;

const s = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  listed: [] as unknown[] | null,
  stored: null as unknown,
  schedule: null as unknown,
  missingColumns: false,
  writes: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", is_admin: true }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...s.row }, error: null }) }) }),
      update: (values: Record<string, unknown>) => ({
        eq: async () => {
          if (s.missingColumns && "subscription_ends_at" in values) {
            return {
              error: {
                code: "PGRST204",
                message: "Could not find the 'subscription_ends_at' column of 'profiles' in the schema cache",
              },
            };
          }
          s.writes.push(values);
          Object.assign(s.row, values);
          return { error: null };
        },
      }),
    }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/billing/credit-refill", () => ({
  grantMonthlyCreditsForPeriod: async () => ({ ok: true }),
  grantTrialCreditsForPeriod: async () => ({ ok: true }),
}));
vi.mock("@/lib/stripe/config", () => ({
  tierForPrice: (price: { id?: string } | null) =>
    price?.id?.includes("pro") ? "pro" : price?.id?.includes("plus") ? "plus" : null,
  tierForProduct: () => null,
}));
vi.mock("@/lib/stripe/client", () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    subscriptions: {
      list: async () => {
        if (s.listed === null) throw new Error("list failed");
        return { data: s.listed };
      },
      retrieve: async () => {
        if (!s.stored) throw new Error("No such subscription");
        return s.stored;
      },
    },
    subscriptionSchedules: {
      retrieve: async () => {
        if (!s.schedule) throw new Error("No such schedule");
        return s.schedule;
      },
    },
    products: { retrieve: async () => ({}) },
  }),
}));

import { adminResyncSubscriptionAction } from "@/lib/admin/user-actions";
import { planEndingAdminLabel, planEndingOf } from "@/lib/billing/plan-ending";
import { cancellationStats } from "@/lib/admin/user-cancellation";
import { resyncToast } from "@/components/admin/user-billing-controls";

/** The sandbox subscription after "Cancel subscription" in the portal. */
const portalCancelled = (over: Record<string, unknown> = {}) => ({
  id: "sub_live",
  status: "active",
  customer: "cus_1",
  created: 1791418932,
  cancel_at: PERIOD_END,
  cancel_at_period_end: false,
  canceled_at: 1791418974,
  schedule: null,
  trial_end: null,
  items: { data: [{ id: "si_1", current_period_end: PERIOD_END, price: { id: "price_pro_monthly" } }] },
  ...over,
});

beforeEach(() => {
  s.row = {
    id: TARGET,
    subscription_tier: "pro",
    subscription_status: "active",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_live",
    current_period_end: new Date(PERIOD_END * 1000).toISOString(),
    cancel_at_period_end: false,
    subscription_ends_at: null,
    subscription_canceled_at: null,
  };
  s.listed = [portalCancelled()];
  s.stored = portalCancelled();
  s.schedule = null;
  s.missingColumns = false;
  s.writes = [];
});

describe("admin Resync on a portal-cancelled (cancel_at only) subscription", () => {
  it("stores the pending cancellation — and the admin panel shows it", async () => {
    const result = await adminResyncSubscriptionAction({ userId: TARGET });
    expect(result).toMatchObject({
      ok: true,
      tier: "pro",
      status: "active",
      endsAt: new Date(PERIOD_END * 1000).toISOString(),
      nothingFound: false,
    });
    // The stored data (the question "is the row right after a resync?").
    expect(s.row).toMatchObject({
      subscription_status: "active",
      cancel_at_period_end: true,
      subscription_ends_at: new Date(PERIOD_END * 1000).toISOString(),
      subscription_canceled_at: new Date(1791418974 * 1000).toISOString(),
    });
    // What the admin page draws from that row.
    const ending = planEndingOf(s.row);
    expect(ending).not.toBeNull();
    expect(planEndingAdminLabel(ending!)).toBe("cancelled, ends Nov 8, 2026");
    expect(cancellationStats(ending, "active")).toEqual({
      state: "cancelled — still active until it ends",
      endsAt: "November 8, 2026",
      canceledAt: "October 8, 2026",
      billedFirst: "no — ends with the paid period",
    });
    // …and the toast says so too.
    expect(result.ok && resyncToast(result)).toBe("Synced: pro · active · cancelled, ends Nov 8, 2026");
  });

  it("the customer's subscription list comes back EMPTY (a drifted customer link): the stored subscription is synced instead of nothing", async () => {
    s.listed = [];
    const result = await adminResyncSubscriptionAction({ userId: TARGET });
    expect(result).toMatchObject({ ok: true, nothingFound: false });
    expect(s.row).toMatchObject({ cancel_at_period_end: true, subscription_ends_at: new Date(PERIOD_END * 1000).toISOString() });
  });

  it("the list call FAILS: same — the stored subscription is the source", async () => {
    s.listed = null;
    await adminResyncSubscriptionAction({ userId: TARGET });
    expect(s.row.subscription_ends_at).toBe(new Date(PERIOD_END * 1000).toISOString());
  });

  it("nothing in Stripe and nothing stored: says so instead of 'Synced', and writes nothing", async () => {
    s.listed = [];
    s.stored = null;
    s.row.stripe_subscription_id = null;
    const result = await adminResyncSubscriptionAction({ userId: TARGET });
    expect(result).toMatchObject({ ok: true, nothingFound: true });
    expect(s.writes).toEqual([]);
  });

  it("a cancellation dated in a LATER period: the flag stays false (it renews first) but the date is stored, and the panel says 'billed first'", async () => {
    const later = PERIOD_END + 30 * 86400;
    s.listed = [portalCancelled({ cancel_at: later })];
    s.stored = portalCancelled({ cancel_at: later });
    await adminResyncSubscriptionAction({ userId: TARGET });
    expect(s.row).toMatchObject({ cancel_at_period_end: false, subscription_ends_at: new Date(later * 1000).toISOString() });
    const ending = planEndingOf(s.row);
    expect(planEndingAdminLabel(ending!)).toBe("cancelled, ends Dec 8, 2026 (billed first)");
    expect(cancellationStats(ending, "active").billedFirst).toBe("yes — renews November 8, 2026, then ends later");
  });

  it("a schedule that ends in a cancellation (no cancel fields on the subscription) is read and stored", async () => {
    const scheduled = portalCancelled({ cancel_at: null, canceled_at: null, schedule: "sub_sched_1" });
    s.listed = [scheduled];
    s.stored = null; // the list alone carries the schedule as an id
    s.schedule = { id: "sub_sched_1", end_behavior: "cancel", phases: [{ end_date: PERIOD_END }] };
    await adminResyncSubscriptionAction({ userId: TARGET });
    expect(s.row).toMatchObject({ cancel_at_period_end: true, subscription_ends_at: new Date(PERIOD_END * 1000).toISOString() });
  });

  it("a pending DOWNGRADE (schedule that releases) is not a cancellation", async () => {
    const scheduled = portalCancelled({ cancel_at: null, canceled_at: null, schedule: "sub_sched_1" });
    s.listed = [scheduled];
    s.stored = scheduled;
    s.schedule = { id: "sub_sched_1", end_behavior: "release", phases: [{ end_date: PERIOD_END }] };
    await adminResyncSubscriptionAction({ userId: TARGET });
    expect(s.row).toMatchObject({ cancel_at_period_end: false, subscription_ends_at: null, subscription_canceled_at: null });
    expect(planEndingOf(s.row)).toBeNull();
  });

  it("resumed in Stripe: a resync clears the stored cancellation", async () => {
    s.row.cancel_at_period_end = true;
    s.row.subscription_ends_at = new Date(PERIOD_END * 1000).toISOString();
    s.row.subscription_canceled_at = new Date(1791418974 * 1000).toISOString();
    const resumed = portalCancelled({ cancel_at: null, canceled_at: null });
    s.listed = [resumed];
    s.stored = resumed;
    const result = await adminResyncSubscriptionAction({ userId: TARGET });
    expect(s.row).toMatchObject({ cancel_at_period_end: false, subscription_ends_at: null, subscription_canceled_at: null });
    expect(result.ok && resyncToast(result)).toBe("Synced: pro · active");
  });

  it("an ENDED subscription resyncs like the webhook's deleted event: free, canceled, no pending cancellation", async () => {
    const ended = portalCancelled({ status: "canceled", cancel_at: null, ended_at: PERIOD_END });
    s.listed = [ended];
    s.stored = ended;
    await adminResyncSubscriptionAction({ userId: TARGET });
    expect(s.row).toMatchObject({
      subscription_tier: "free",
      subscription_status: "canceled",
      stripe_subscription_id: null,
      cancel_at_period_end: false,
      subscription_ends_at: null,
    });
    expect(cancellationStats(planEndingOf(s.row), "canceled").state).toBe("ended (no live subscription)");
  });

  it("the code is live before migration 0135: the sync still writes the old columns instead of failing", async () => {
    s.missingColumns = true;
    const result = await adminResyncSubscriptionAction({ userId: TARGET });
    expect(result.ok).toBe(true);
    expect(s.writes).toHaveLength(1);
    expect(s.writes[0]).not.toHaveProperty("subscription_ends_at");
    expect(s.row).toMatchObject({ cancel_at_period_end: true });
    // The fallback reading still dates it by the period end.
    expect(planEndingAdminLabel(planEndingOf(s.row)!)).toBe("cancelled, ends Nov 8, 2026");
  });
});
