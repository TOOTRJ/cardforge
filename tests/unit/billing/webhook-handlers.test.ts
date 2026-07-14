import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleStripeEvent } from "@/lib/stripe/webhook-handlers";
import { MONTHLY_CREDITS } from "@/lib/billing/plans";

// Minimal admin-client stand-in that records the writes the handlers make, so
// we can assert dispatch behavior without a real Supabase client.
// `customerLookupHit: false` simulates a profile whose stripe_customer_id was
// never persisted (the 2026-07-11 first-live-trial bug) so the metadata
// fallback path can be exercised.
function makeAdmin(opts: { customerLookupHit?: boolean } = {}) {
  const { customerLookupHit = true } = opts;
  const updates: Array<{
    table: string;
    values: Record<string, unknown>;
    key: unknown[];
  }> = [];
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const admin = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: customerLookupHit ? { id: "user-1" } : null,
                  error: null,
                }),
              };
            },
          };
        },
        update(values: Record<string, unknown>) {
          return {
            eq: async (...key: unknown[]) => {
              updates.push({ table, values, key });
              return { error: null };
            },
          };
        },
      };
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return { data: 0, error: null };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, updates, rpcs };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stripe = {} as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (event: any, admin: any) =>
  handleStripeEvent(event, { admin, stripe });

beforeEach(() => {
  process.env.STRIPE_PRICE_PLUS_MONTHLY = "price_plus";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro";
});
afterEach(() => {
  delete process.env.STRIPE_PRICE_PLUS_MONTHLY;
  delete process.env.STRIPE_PRICE_PRO_MONTHLY;
});

describe("handleStripeEvent", () => {
  it("on subscription.created: writes tier/status and grants the first month", async () => {
    const { admin, updates, rpcs } = makeAdmin();
    await run(
      {
        id: "evt_sub_1",
        type: "customer.subscription.created",
        data: {
          object: {
            id: "sub_1",
            customer: "cus_1",
            status: "active",
            cancel_at_period_end: false,
            items: {
              data: [
                { price: { id: "price_plus" }, current_period_end: 1893456000 },
              ],
            },
          },
        },
      },
      admin,
    );

    expect(updates[0].values).toMatchObject({
      subscription_tier: "plus",
      subscription_status: "active",
      stripe_subscription_id: "sub_1",
      cancel_at_period_end: false,
    });
    expect(typeof updates[0].values.current_period_end).toBe("string");

    const grant = rpcs.find((r) => r.fn === "grant_credits");
    expect(grant?.args).toMatchObject({
      p_user_id: "user-1",
      p_amount: MONTHLY_CREDITS.plus,
      p_reason: "subscription_refill",
    });
    expect(String(grant?.args.p_idempotency_key)).toMatch(/^refill:user-1:\d{4}-\d{2}$/);
  });

  it("falls back to subscription metadata when the customer id was never persisted, and backfills it", async () => {
    // Regression: the first live trial had stripe_customer_id NULL on the
    // profile (the checkout wrote it through a trigger-pinned column), so the
    // customer lookup matched nothing and the webhook silently no-opped.
    const { admin, updates, rpcs } = makeAdmin({ customerLookupHit: false });
    await run(
      {
        id: "evt_sub_meta",
        type: "customer.subscription.created",
        data: {
          object: {
            id: "sub_2",
            customer: "cus_2",
            status: "trialing",
            cancel_at_period_end: false,
            metadata: { supabase_user_id: "user-meta" },
            items: {
              data: [
                { price: { id: "price_plus" }, current_period_end: 1893456000 },
              ],
            },
          },
        },
      },
      admin,
    );

    // Backfill of the missing customer id, keyed by the metadata user id.
    const backfill = updates.find(
      (u) => u.values.stripe_customer_id === "cus_2",
    );
    expect(backfill?.key).toEqual(["id", "user-meta"]);

    // Subscription state written by profile id, not by customer id.
    const state = updates.find((u) => u.values.subscription_tier === "plus");
    expect(state?.key).toEqual(["id", "user-meta"]);
    expect(state?.values).toMatchObject({
      subscription_status: "trialing",
      stripe_subscription_id: "sub_2",
    });

    // Trial still gets the first month's credits.
    const grant = rpcs.find((r) => r.fn === "grant_credits");
    expect(grant?.args).toMatchObject({
      p_user_id: "user-meta",
      p_amount: MONTHLY_CREDITS.plus,
    });
  });

  it("on subscription.deleted: downgrades to free and clears the sub", async () => {
    const { admin, updates, rpcs } = makeAdmin();
    await run(
      {
        id: "evt_del",
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_1",
            customer: "cus_1",
            status: "canceled",
            cancel_at_period_end: false,
            items: { data: [{ price: { id: "price_plus" }, current_period_end: 1 }] },
          },
        },
      },
      admin,
    );
    expect(updates[0].values).toMatchObject({
      subscription_tier: "free",
      subscription_status: "canceled",
      stripe_subscription_id: null,
      current_period_end: null,
    });
    // No credit grant on cancellation.
    expect(rpcs.some((r) => r.fn === "grant_credits")).toBe(false);
  });

  it("on checkout.session.completed (pack): grants pack credits keyed by event id", async () => {
    const { admin, rpcs } = makeAdmin();
    await run(
      {
        id: "evt_pack_1",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "payment",
            payment_status: "paid",
            client_reference_id: "user-1",
            metadata: {
              purchase_kind: "pack",
              supabase_user_id: "user-1",
              pack_credits: "100",
            },
          },
        },
      },
      admin,
    );
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]).toMatchObject({
      fn: "grant_credits",
      args: {
        p_user_id: "user-1",
        p_amount: 100,
        p_reason: "pack_purchase",
        p_idempotency_key: "evt_pack_1",
      },
    });
  });

  it("on checkout.session.completed (pack, unpaid): no grant until funds settle", async () => {
    const { admin, rpcs } = makeAdmin();
    await run(
      {
        id: "evt_pack_unpaid",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "payment",
            payment_status: "unpaid",
            client_reference_id: "user-1",
            metadata: {
              purchase_kind: "pack",
              supabase_user_id: "user-1",
              pack_credits: "100",
            },
          },
        },
      },
      admin,
    );
    expect(rpcs).toHaveLength(0);
  });

  it("on checkout.session.completed (subscription mode): no pack grant", async () => {
    const { admin, rpcs } = makeAdmin();
    await run(
      {
        id: "evt_sub_checkout",
        type: "checkout.session.completed",
        data: { object: { mode: "subscription", metadata: {} } },
      },
      admin,
    );
    expect(rpcs).toHaveLength(0);
  });

  it("on invoice.payment_failed: marks the subscription past_due", async () => {
    const { admin, updates } = makeAdmin();
    await run(
      {
        id: "evt_fail",
        type: "invoice.payment_failed",
        data: { object: { customer: "cus_1" } },
      },
      admin,
    );
    expect(updates[0].values).toMatchObject({ subscription_status: "past_due" });
  });
});
