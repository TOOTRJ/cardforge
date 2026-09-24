import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The trial-ending reminder's email side: configured or not, and who the
// "account" list resolves the user to.
const email = vi.hoisted(() => ({
  configured: true,
  recipient: { email: "trial@example.test", unsubscribeToken: "tok" } as null | {
    email: string;
    unsubscribeToken: string;
  },
  send: vi.fn(),
}));
vi.mock("@/lib/email/send", () => ({
  isEmailConfigured: () => email.configured,
  sendEmail: (...args: unknown[]) => email.send(...args),
}));
vi.mock("@/lib/email/preferences", () => ({
  getRecipientFor: async () => email.recipient,
}));

import { handleStripeEvent } from "@/lib/stripe/webhook-handlers";
import { MONTHLY_CREDITS, TRIAL_CREDITS, creditRefillKey, currentCreditPeriod } from "@/lib/billing/plans";

// Minimal admin-client stand-in that records the writes the handlers make, so
// we can assert dispatch behavior without a real Supabase client.
// `customerLookupHit: false` simulates a profile whose stripe_customer_id was
// never persisted (the 2026-07-11 first-live-trial bug) so the metadata
// fallback path can be exercised.
function makeAdmin(
  opts: {
    customerLookupHit?: boolean;
    /** The credit_ledger row under this month's base refill key — null (the
     *  default) means the month hasn't granted yet (base-grant path). */
    ledgerRow?: { delta: number } | null;
  } = {},
) {
  const { customerLookupHit = true, ledgerRow = null } = opts;
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
            // The month's refill rows (credit-refill.ts reads them with one
            // LIKE on the base key prefix).
            like: async () => ({
              data: ledgerRow
                ? [{ ...ledgerRow, idempotency_key: creditRefillKey("user-1", currentCreditPeriod()) }]
                : [],
              error: null,
            }),
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
  email.configured = true;
  email.recipient = { email: "trial@example.test", unsubscribeToken: "tok" };
  email.send.mockReset().mockResolvedValue({ ok: true });
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

    // A trial gets its tranche (not the full month) under the month's base key.
    const grant = rpcs.find((r) => r.fn === "grant_credits");
    expect(grant?.args).toMatchObject({
      p_user_id: "user-meta",
      p_amount: TRIAL_CREDITS,
      p_reason: "trial_grant",
    });
    expect(String(grant?.args.p_idempotency_key)).toMatch(/^refill:user-meta:\d{4}-\d{2}$/);
  });

  it("on subscription.updated while trialing: NO grant (one trial grant, at creation)", async () => {
    // Regression: a no-card 7-day trial spanning a month boundary banked a
    // second month's allotment from any updated event (or the cron) firing
    // in the new month — without a single payment. State writes still land.
    const { admin, updates, rpcs } = makeAdmin();
    await run(
      {
        id: "evt_trial_update",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_1",
            customer: "cus_1",
            status: "trialing",
            cancel_at_period_end: true,
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
      subscription_status: "trialing",
      cancel_at_period_end: true,
    });
    expect(rpcs.some((r) => r.fn === "grant_credits")).toBe(false);
  });

  it("on subscription.updated when a trial converts to active: grants the month", async () => {
    // The first PAID month's allotment lands at conversion (trial grant was
    // last month's key, so the base grant fires fresh here).
    const { admin, rpcs } = makeAdmin();
    await run(
      {
        id: "evt_trial_convert",
        type: "customer.subscription.updated",
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
    const grant = rpcs.find((r) => r.fn === "grant_credits");
    expect(grant?.args).toMatchObject({
      p_user_id: "user-1",
      p_amount: MONTHLY_CREDITS.plus,
    });
    expect(String(grant?.args.p_idempotency_key)).toMatch(
      /^refill:user-1:\d{4}-\d{2}$/,
    );
  });

  it("a trial converting in the SAME month it started tops the tranche up to the full allotment", async () => {
    // The tranche (25) sits under the base key; the first payment's grant
    // sees it and adds the shortfall under the tier's upgrade key.
    const { admin, rpcs } = makeAdmin({ ledgerRow: { delta: TRIAL_CREDITS } });
    await run(
      {
        id: "evt_trial_convert_same_month",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_1",
            customer: "cus_1",
            status: "active",
            cancel_at_period_end: false,
            items: { data: [{ price: { id: "price_pro" }, current_period_end: 1893456000 }] },
          },
        },
      },
      admin,
    );
    const grant = rpcs.find((r) => r.fn === "grant_credits");
    expect(grant?.args).toMatchObject({ p_amount: MONTHLY_CREDITS.pro - TRIAL_CREDITS });
    expect(String(grant?.args.p_idempotency_key)).toMatch(/:upgrade:pro$/);
  });

  it("on subscription.updated (mid-month upgrade): tops up the tier delta", async () => {
    // Regression: the month's refill key was already consumed by the Plus
    // grant, so upgrading to Pro used to grant NOTHING until the next month.
    const { admin, rpcs } = makeAdmin({
      ledgerRow: { delta: MONTHLY_CREDITS.plus },
    });
    await run(
      {
        id: "evt_upgrade",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_1",
            customer: "cus_1",
            status: "active",
            cancel_at_period_end: false,
            items: {
              data: [
                { price: { id: "price_pro" }, current_period_end: 1893456000 },
              ],
            },
          },
        },
      },
      admin,
    );

    const grant = rpcs.find((r) => r.fn === "grant_credits");
    expect(grant?.args).toMatchObject({
      p_user_id: "user-1",
      p_amount: MONTHLY_CREDITS.pro - MONTHLY_CREDITS.plus,
      p_reason: "subscription_refill",
    });
    expect(String(grant?.args.p_idempotency_key)).toMatch(
      /^refill:user-1:\d{4}-\d{2}:upgrade:pro$/,
    );
  });

  it("on subscription.updated (same tier, month already granted): no extra grant", async () => {
    const { admin, rpcs } = makeAdmin({
      ledgerRow: { delta: MONTHLY_CREDITS.plus },
    });
    await run(
      {
        id: "evt_same_tier",
        type: "customer.subscription.updated",
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
    expect(rpcs.some((r) => r.fn === "grant_credits")).toBe(false);
  });

  it("cancel at period end: the update keeps the plan (flag set), the later deleted event ends it", async () => {
    // The portal's cancel writes cancel_at_period_end=true on an ACTIVE
    // subscription: perks stay until the period ends; only the deleted
    // event that Stripe sends at period end demotes the profile.
    const { admin, updates, rpcs } = makeAdmin({ ledgerRow: { delta: MONTHLY_CREDITS.pro } });
    const sub = {
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: true,
      items: { data: [{ price: { id: "price_pro" }, current_period_end: 1893456000 }] },
    };
    await run({ id: "evt_cancel_scheduled", type: "customer.subscription.updated", data: { object: sub } }, admin);
    expect(updates.at(-1)?.values).toMatchObject({
      subscription_tier: "pro",
      subscription_status: "active",
      cancel_at_period_end: true,
      stripe_subscription_id: "sub_1",
    });
    expect(rpcs.some((r) => r.fn === "grant_credits")).toBe(false);

    await run(
      { id: "evt_cancel_done", type: "customer.subscription.deleted", data: { object: { ...sub, status: "canceled" } } },
      admin,
    );
    expect(updates.at(-1)?.values).toMatchObject({
      subscription_tier: "free",
      subscription_status: "canceled",
      cancel_at_period_end: false,
      stripe_subscription_id: null,
    });
    expect(rpcs.some((r) => r.fn === "grant_credits")).toBe(false);
  });

  it("a pack paid on `completed` AND echoed by `async_payment_succeeded` asks for the SAME session key twice", async () => {
    // grant_credits dedupes on the idempotency key inside the database; the
    // handler's job is to never mint a different key for the same purchase.
    const { admin, rpcs } = makeAdmin();
    const session = {
      id: "cs_pack_twice",
      mode: "payment",
      payment_status: "paid",
      client_reference_id: "user-1",
      metadata: { purchase_kind: "pack", supabase_user_id: "user-1", pack_credits: "30" },
    };
    await run({ id: "evt_a", type: "checkout.session.completed", data: { object: session } }, admin);
    await run({ id: "evt_b", type: "checkout.session.async_payment_succeeded", data: { object: session } }, admin);
    expect(rpcs).toHaveLength(2);
    expect(new Set(rpcs.map((r) => r.args.p_idempotency_key))).toEqual(new Set(["pack:cs_pack_twice"]));
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

  it("on checkout.session.completed (pack): grants pack credits keyed by SESSION id", async () => {
    const { admin, rpcs } = makeAdmin();
    await run(
      {
        id: "evt_pack_1",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_pack_1",
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
        // Session-scoped (not event-scoped) so completed +
        // async_payment_succeeded for one purchase can never grant twice.
        p_idempotency_key: "pack:cs_pack_1",
      },
    });
  });

  it("on checkout.session.async_payment_succeeded (pack): grants when the funds settle", async () => {
    // Regression: async/delayed payment methods fire `completed` UNPAID (no
    // grant, correctly) — but the later settlement event was unhandled, so
    // the customer paid and never received the credits.
    const { admin, rpcs } = makeAdmin();
    const session = {
      id: "cs_pack_async",
      mode: "payment",
      client_reference_id: "user-1",
      metadata: {
        purchase_kind: "pack",
        supabase_user_id: "user-1",
        pack_credits: "30",
      },
    };
    await run(
      {
        id: "evt_pack_completed_unpaid",
        type: "checkout.session.completed",
        data: { object: { ...session, payment_status: "unpaid" } },
      },
      admin,
    );
    expect(rpcs).toHaveLength(0);

    await run(
      {
        id: "evt_pack_settled",
        type: "checkout.session.async_payment_succeeded",
        data: { object: { ...session, payment_status: "paid" } },
      },
      admin,
    );
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]).toMatchObject({
      fn: "grant_credits",
      args: {
        p_user_id: "user-1",
        p_amount: 30,
        p_idempotency_key: "pack:cs_pack_async",
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

// ---------------------------------------------------------------------------
// Sync-layer regressions surfaced through the webhook entry point.
// ---------------------------------------------------------------------------

function makeStripeWithSubs(subs: unknown[]) {
  const canceled: string[] = [];
  const stripe = {
    subscriptions: {
      list: async () => ({ data: subs }),
      retrieve: async (id: string) => subs.find((s) => (s as { id: string }).id === id),
      cancel: async (id: string) => {
        canceled.push(id);
        return { id, status: "canceled" };
      },
    },
    products: { retrieve: async () => { throw new Error("none"); } },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { stripe: stripe as any, canceled };
}

describe("handleStripeEvent — price/tier resolution + multi-subscription safety", () => {
  it("REGRESSION 2026-09-14: portal upgrade to an unlisted Pro price does NOT write tier=free", async () => {
    const { admin, updates, rpcs } = makeAdmin({
      ledgerRow: { delta: MONTHLY_CREDITS.plus },
    });
    // The subscription now carries a $15/mo price that isn't in the env.
    const object = {
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      created: 10,
      items: {
        data: [
          {
            id: "si_1",
            price: { id: "price_portal_pro", unit_amount: 1500, recurring: { interval: "month" } },
            current_period_end: 1893456000,
          },
        ],
      },
    };
    await handleStripeEvent(
      { id: "evt_portal", type: "customer.subscription.updated", data: { object } } as never,
      { admin, stripe: makeStripeWithSubs([object]).stripe },
    );
    const state = updates.find((u) => "subscription_tier" in u.values);
    expect(state?.values).toMatchObject({ subscription_tier: "pro", subscription_status: "active" });
    // …and the mid-month Pro top-up lands.
    const grant = rpcs.find((r) => r.fn === "grant_credits");
    expect(grant?.args).toMatchObject({ p_amount: MONTHLY_CREDITS.pro - MONTHLY_CREDITS.plus });
  });

  it("a lingering trial's deletion resyncs to the live Pro subscription instead of demoting", async () => {
    const { admin, updates, rpcs } = makeAdmin();
    const trial = {
      id: "sub_trial",
      customer: "cus_1",
      status: "trialing",
      created: 1,
      items: { data: [{ id: "si_t", price: { id: "price_plus" }, current_period_end: 1 }] },
    };
    const pro = {
      id: "sub_pro",
      customer: "cus_1",
      status: "active",
      created: 2,
      cancel_at_period_end: false,
      items: { data: [{ id: "si_p", price: { id: "price_pro" }, current_period_end: 1893456000 }] },
    };
    await handleStripeEvent(
      { id: "evt_del_trial", type: "customer.subscription.deleted", data: { object: { ...trial, status: "canceled" } } } as never,
      { admin, stripe: makeStripeWithSubs([trial, pro]).stripe },
    );
    const state = updates.find((u) => "subscription_tier" in u.values);
    expect(state?.values).toMatchObject({
      subscription_tier: "pro",
      subscription_status: "active",
      stripe_subscription_id: "sub_pro",
    });
    expect(rpcs.some((r) => r.fn === "grant_credits")).toBe(false);
  });

  it("invoice.payment_failed on a secondary subscription resyncs to the live Pro plan instead of demoting", async () => {
    const { admin, updates } = makeAdmin();
    const failing = {
      id: "sub_trial",
      customer: "cus_1",
      status: "past_due",
      created: 1,
      items: { data: [{ id: "si_t", price: { id: "price_plus" }, current_period_end: 1 }] },
    };
    const pro = {
      id: "sub_pro",
      customer: "cus_1",
      status: "active",
      created: 2,
      cancel_at_period_end: false,
      items: { data: [{ id: "si_p", price: { id: "price_pro" }, current_period_end: 1893456000 }] },
    };
    await handleStripeEvent(
      {
        id: "evt_fail_secondary",
        type: "invoice.payment_failed",
        data: {
          object: {
            customer: "cus_1",
            parent: { subscription_details: { subscription: "sub_trial" } },
          },
        },
      } as never,
      { admin, stripe: makeStripeWithSubs([failing, pro]).stripe },
    );
    const state = updates.find((u) => "subscription_tier" in u.values);
    expect(state?.values).toMatchObject({ subscription_tier: "pro", subscription_status: "active" });
    expect(updates.some((u) => u.values.subscription_status === "past_due")).toBe(false);
  });

  it("invoice.payment_failed on the ONLY subscription still marks it past_due through the sync layer", async () => {
    const { admin, updates } = makeAdmin();
    const only = {
      id: "sub_only",
      customer: "cus_1",
      status: "past_due",
      created: 1,
      cancel_at_period_end: false,
      items: { data: [{ id: "si_o", price: { id: "price_pro" }, current_period_end: 1893456000 }] },
    };
    await handleStripeEvent(
      {
        id: "evt_fail_only",
        type: "invoice.payment_failed",
        data: { object: { customer: "cus_1", parent: { subscription_details: { subscription: "sub_only" } } } },
      } as never,
      { admin, stripe: makeStripeWithSubs([only]).stripe },
    );
    const state = updates.find((u) => "subscription_status" in u.values);
    expect(state?.values).toMatchObject({ subscription_status: "past_due" });
  });

  it("checkout.session.completed cancels the superseded trial once the new plan is paid", async () => {
    const { admin } = makeAdmin();
    const trial = { id: "sub_trial", status: "trialing" };
    const { stripe, canceled } = makeStripeWithSubs([trial]);
    await handleStripeEvent(
      {
        id: "evt_supersede",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_1",
            mode: "subscription",
            subscription: "sub_new",
            metadata: { supersedes_subscription_id: "sub_trial" },
          },
        },
      } as never,
      { admin, stripe },
    );
    expect(canceled).toEqual(["sub_trial"]);
  });

  it("checkout.session.completed leaves an already-lapsed superseded subscription alone", async () => {
    const { admin } = makeAdmin();
    const { stripe, canceled } = makeStripeWithSubs([{ id: "sub_old", status: "canceled" }]);
    await handleStripeEvent(
      {
        id: "evt_supersede_2",
        type: "checkout.session.completed",
        data: {
          object: { id: "cs_2", mode: "subscription", subscription: "sub_new", metadata: { supersedes_subscription_id: "sub_old" } },
        },
      } as never,
      { admin, stripe },
    );
    expect(canceled).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// customer.subscription.trial_will_end → ONE notification + ONE email per
// subscription, honest about whether the plan converts.
// ---------------------------------------------------------------------------
describe("handleStripeEvent — trial_will_end", () => {
  function makeTrialAdmin(opts: { alreadyNotified?: boolean; insertError?: string } = {}) {
    const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
    const admin = {
      from(table: string) {
        return {
          select() {
            const chain = {
              eq: () => chain,
              limit: () => chain,
              maybeSingle: async () =>
                table === "profiles"
                  ? { data: { id: "user-1" }, error: null }
                  : { data: opts.alreadyNotified ? { id: "n_1" } : null, error: null },
            };
            return chain;
          },
          insert: async (row: Record<string, unknown>) => {
            inserts.push({ table, row });
            return { error: opts.insertError ? { message: opts.insertError } : null };
          },
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { admin: admin as any, inserts };
  }
  const customers = { retrieve: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trialStripe = { customers } as any;
  const trialSub = (extra: Record<string, unknown> = {}) => ({
    id: "sub_trial",
    customer: "cus_1",
    status: "trialing",
    trial_end: 1_790_735_200,
    default_payment_method: null,
    default_source: null,
    items: { data: [{ price: { id: "price_pro", unit_amount: 1500, currency: "usd", recurring: { interval: "month" } } }] },
    ...extra,
  });
  const event = (object: unknown) =>
    ({ id: "evt_twe", type: "customer.subscription.trial_will_end", data: { object } }) as never;

  beforeEach(() => {
    customers.retrieve.mockReset().mockResolvedValue({ id: "cus_1", invoice_settings: { default_payment_method: null } });
  });

  it("no card anywhere: notification says so, email says the plan simply ends", async () => {
    const { admin, inserts } = makeTrialAdmin();
    await handleStripeEvent(event(trialSub()), { admin, stripe: trialStripe });
    expect(inserts).toEqual([
      {
        table: "notifications",
        row: {
          recipient_id: "user-1",
          actor_id: null,
          type: "trial_ending",
          payload: {
            subscriptionId: "sub_trial",
            tier: "pro",
            trialEnd: "2026-09-30T02:26:40.000Z",
            hasPaymentMethod: false,
            amountCents: 1500,
            currency: "usd",
            interval: "month",
          },
        },
      },
    ]);
    expect(email.send).toHaveBeenCalledTimes(1);
    const [message, options] = email.send.mock.calls[0];
    expect(message.to).toBe("trial@example.test");
    expect(message.subject).toContain("add a card to keep it");
    expect(message.html).toContain("$15 / month");
    expect(options).toEqual({ idempotencyKey: "trial-ending:sub_trial" });
  });

  it("a card on the CUSTOMER (Checkout stores it there) counts, like Stripe's own conversion check", async () => {
    customers.retrieve.mockResolvedValue({ id: "cus_1", invoice_settings: { default_payment_method: "pm_1" } });
    const { admin, inserts } = makeTrialAdmin();
    await handleStripeEvent(event(trialSub()), { admin, stripe: trialStripe });
    expect(inserts[0].row.payload).toMatchObject({ hasPaymentMethod: true });
    expect(email.send.mock.calls[0][0].subject).not.toContain("add a card");
    // A card on the subscription itself needs no customer read at all.
    customers.retrieve.mockClear();
    const second = makeTrialAdmin();
    await handleStripeEvent(event(trialSub({ default_payment_method: "pm_2" })), { admin: second.admin, stripe: trialStripe });
    expect(second.inserts[0].row.payload).toMatchObject({ hasPaymentMethod: true });
    expect(customers.retrieve).not.toHaveBeenCalled();
  });

  it("once per subscription: a redelivered event neither notifies nor emails again", async () => {
    const { admin, inserts } = makeTrialAdmin({ alreadyNotified: true });
    await handleStripeEvent(event(trialSub()), { admin, stripe: trialStripe });
    expect(inserts).toEqual([]);
    expect(email.send).not.toHaveBeenCalled();
  });

  it("the notification is the durable part: an insert failure throws (Stripe retries); a missing email setup or recipient is fine", async () => {
    await expect(
      handleStripeEvent(event(trialSub()), { admin: makeTrialAdmin({ insertError: "boom" }).admin, stripe: trialStripe }),
    ).rejects.toThrow(/trial_ending notification failed/);

    email.configured = false;
    const { admin, inserts } = makeTrialAdmin();
    await handleStripeEvent(event(trialSub()), { admin, stripe: trialStripe });
    expect(inserts).toHaveLength(1);
    expect(email.send).not.toHaveBeenCalled();

    email.configured = true;
    email.recipient = null;
    await handleStripeEvent(event(trialSub()), { admin: makeTrialAdmin().admin, stripe: trialStripe });
    expect(email.send).not.toHaveBeenCalled();
  });

  it("a send failure never fails the webhook, and a non-trialing subscription is ignored", async () => {
    email.send.mockRejectedValue(new Error("resend down"));
    const { admin, inserts } = makeTrialAdmin();
    await expect(handleStripeEvent(event(trialSub()), { admin, stripe: trialStripe })).resolves.toBeUndefined();
    expect(inserts).toHaveLength(1);

    const active = makeTrialAdmin();
    await handleStripeEvent(event(trialSub({ status: "active" })), { admin: active.admin, stripe: trialStripe });
    expect(active.inserts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// invoice.paid (revenue row + resync + ONE "payment received") and
// checkout.session.expired (ONE reminder per user per 30 days, only while
// still relevant). A small chainable admin stub: every query builder call
// returns the chain; awaiting it (or maybeSingle) answers per table.
// ---------------------------------------------------------------------------
type Rows = Record<string, Array<Record<string, unknown>>>;
function makeChainAdmin(rows: Rows, opts: { insertError?: string; upsertError?: string } = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const upserts: Array<{ table: string; row: Record<string, unknown>; opts: unknown }> = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  function chain(table: string, result: () => { data: unknown; error: unknown }) {
    const c: Record<string, unknown> = {};
    const self = () => c;
    for (const m of ["eq", "neq", "like", "gte", "lte", "lt", "gt", "is", "in", "order", "limit", "select"]) c[m] = self;
    c.maybeSingle = async () => {
      const r = result();
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
    };
    c.single = async () => {
      const r = result();
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : (r.data ?? { id: "fe_1" }), error: r.error };
    };
    c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return c;
  }
  const admin = {
    from(table: string) {
      return {
        select: () => chain(table, () => ({ data: rows[table] ?? [], error: null })),
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return chain(table, () => ({
            data: table === "funnel_events" ? { id: "fe_1" } : null,
            error: opts.insertError && table !== "funnel_events" ? { message: opts.insertError } : null,
          }));
        },
        upsert: (row: Record<string, unknown>, o: unknown) => {
          upserts.push({ table, row, opts: o });
          return chain(table, () => ({ data: null, error: opts.upsertError ? { message: opts.upsertError } : null }));
        },
        update: (values: Record<string, unknown>) => {
          updates.push({ table, values });
          return chain(table, () => ({ data: null, error: null }));
        },
      };
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return { data: 0, error: null };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, inserts, upserts, updates, rpcs };
}

/** Notification rows only — funnel_events rows are asserted separately. */
const notes = (inserts: Array<{ table: string; row: Record<string, unknown> }>) =>
  inserts.filter((i) => i.table === "notifications");
const funnel = (inserts: Array<{ table: string; row: Record<string, unknown> }>) =>
  inserts.filter((i) => i.table === "funnel_events").map((i) => i.row);

describe("handleStripeEvent — invoice.paid", () => {
  const profile = { id: "user-1", subscription_tier: "pro", subscription_status: "active", stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" };
  const sub = {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_pro", recurring: { interval: "month" } }, current_period_end: 1792722400 }] },
  };
  const retrieve = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoiceStripe = { subscriptions: { retrieve, list: async () => { throw new Error("no api"); } } } as any;
  const invoice = (extra: Record<string, unknown> = {}) => ({
    id: "in_1",
    customer: "cus_1",
    amount_paid: 1500,
    currency: "usd",
    billing_reason: "subscription_cycle",
    number: "ABC-0002",
    hosted_invoice_url: "https://invoice.stripe.com/i/x",
    created: 1790130400,
    status_transitions: { paid_at: 1790130450 },
    period_start: 1790130000,
    period_end: 1792722000,
    lines: { data: [{ period: { start: 1790130400, end: 1792722400 } }] },
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: { supabase_user_id: "user-1" } } },
    ...extra,
  });
  const event = (object: unknown) => ({ id: "evt_inv", type: "invoice.paid", data: { object } }) as never;

  beforeEach(() => {
    retrieve.mockReset().mockResolvedValue(sub);
  });

  it("writes the revenue row (upsert by invoice id), resyncs + grants, and notifies ONCE with money taken", async () => {
    const { admin, inserts, upserts, updates, rpcs } = makeChainAdmin({ profiles: [profile], notifications: [], credit_ledger: [] });
    await handleStripeEvent(event(invoice()), { admin, stripe: invoiceStripe });
    expect(upserts).toEqual([
      {
        table: "billing_payments",
        row: {
          invoice_id: "in_1",
          user_id: "user-1",
          stripe_customer_id: "cus_1",
          stripe_subscription_id: "sub_1",
          amount_cents: 1500,
          currency: "usd",
          billing_reason: "subscription_cycle",
          tier: "pro",
          billing_interval: "month",
          period_start: "2026-09-23T02:26:40.000Z",
          period_end: "2026-10-23T02:26:40.000Z",
          paid_at: "2026-09-23T02:27:30.000Z",
          invoice_number: "ABC-0002",
          hosted_invoice_url: "https://invoice.stripe.com/i/x",
        },
        opts: { onConflict: "invoice_id" },
      },
    ]);
    expect(retrieve).toHaveBeenCalledWith("sub_1");
    expect(updates.find((u) => u.table === "profiles")?.values).toMatchObject({ subscription_tier: "pro", subscription_status: "active" });
    expect(rpcs.find((r) => r.fn === "grant_credits")?.args).toMatchObject({ p_user_id: "user-1", p_amount: MONTHLY_CREDITS.pro });
    expect(funnel(inserts)).toEqual([
      { event: "payment_received", user_id: "user-1", props: { amountCents: 1500, tier: "pro", interval: "month", billingReason: "subscription_cycle" }, source: "server" },
    ]);
    expect(notes(inserts)).toEqual([
      {
        table: "notifications",
        row: {
          recipient_id: "user-1",
          actor_id: null,
          type: "payment_received",
          payload: {
            invoiceId: "in_1",
            amountCents: 1500,
            currency: "usd",
            tier: "pro",
            interval: "month",
            billingReason: "subscription_cycle",
            hostedInvoiceUrl: "https://invoice.stripe.com/i/x",
          },
        },
      },
    ]);
  });

  it("a $0 invoice (trial start, full coupon) is logged but never announced; an already-announced invoice isn't repeated", async () => {
    const zero = makeChainAdmin({ profiles: [profile], notifications: [], credit_ledger: [] });
    await handleStripeEvent(event(invoice({ amount_paid: 0, billing_reason: "subscription_create" })), { admin: zero.admin, stripe: invoiceStripe });
    expect(zero.upserts[0].row).toMatchObject({ amount_cents: 0 });
    expect(zero.inserts).toEqual([]); // no notification AND no payment_received funnel row for $0

    const again = makeChainAdmin({ profiles: [profile], notifications: [{ id: "n_1" }], credit_ledger: [] });
    await handleStripeEvent(event(invoice()), { admin: again.admin, stripe: invoiceStripe });
    expect(again.upserts).toHaveLength(1);
    expect(notes(again.inserts)).toEqual([]);
  });

  it("falls back to the invoice's subscription metadata when the customer isn't linked, and backfills the link", async () => {
    const { admin, upserts, updates } = makeChainAdmin({ profiles: [], notifications: [], credit_ledger: [] });
    await handleStripeEvent(event(invoice()), { admin, stripe: invoiceStripe });
    expect(updates[0]).toEqual({ table: "profiles", values: { stripe_customer_id: "cus_1" } });
    expect(upserts[0].row).toMatchObject({ user_id: "user-1" });
  });

  it("a one-off invoice with no subscription is logged without a resync; a failed row write throws so Stripe retries", async () => {
    const { admin, upserts } = makeChainAdmin({ profiles: [profile], notifications: [], credit_ledger: [] });
    await handleStripeEvent(event(invoice({ parent: null, billing_reason: "manual" })), { admin, stripe: invoiceStripe });
    expect(retrieve).not.toHaveBeenCalled();
    expect(upserts[0].row).toMatchObject({ stripe_subscription_id: null, tier: null, billing_interval: null, billing_reason: "manual" });

    const failing = makeChainAdmin({ profiles: [profile], notifications: [], credit_ledger: [] }, { upsertError: "disk full" });
    await expect(handleStripeEvent(event(invoice()), { admin: failing.admin, stripe: invoiceStripe })).rejects.toThrow(/billing_payments write failed/);
  });

  it("a Stripe read failure skips the resync but still records the payment", async () => {
    retrieve.mockRejectedValue(new Error("stripe down"));
    const { admin, upserts, updates } = makeChainAdmin({ profiles: [profile], notifications: [], credit_ledger: [] });
    await handleStripeEvent(event(invoice()), { admin, stripe: invoiceStripe });
    expect(updates.filter((u) => u.table === "profiles")).toEqual([]);
    expect(upserts[0].row).toMatchObject({ invoice_id: "in_1", tier: null });
  });
});

describe("handleStripeEvent — checkout.session.expired", () => {
  const dayAgo = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const session = (extra: Record<string, unknown> = {}) => ({
    id: "cs_exp",
    mode: "subscription",
    status: "expired",
    created: dayAgo,
    customer: "cus_1",
    client_reference_id: "user-1",
    metadata: { supabase_user_id: "user-1", purchase_kind: "subscription", tier: "pro", period: "monthly" },
    ...extra,
  });
  const packSession = (extra: Record<string, unknown> = {}) =>
    session({ mode: "payment", metadata: { supabase_user_id: "user-1", purchase_kind: "pack", pack_credits: "30" }, ...extra });
  const event = (object: unknown) => ({ id: "evt_exp", type: "checkout.session.expired", data: { object } }) as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noStripe = {} as any;
  const free = { id: "user-1", subscription_status: null };

  it("a never-subscribed user gets ONE reminder that still offers the trial, plus the email", async () => {
    const { admin, inserts } = makeChainAdmin({ profiles: [free], notifications: [], credit_ledger: [] });
    await handleStripeEvent(event(session()), { admin, stripe: noStripe });
    expect(funnel(inserts)).toEqual([
      { event: "checkout_expired", user_id: "user-1", props: { kind: "subscription", tier: "pro", period: "monthly", sessionId: "cs_exp" }, source: "server" },
    ]);
    expect(notes(inserts)).toEqual([
      {
        table: "notifications",
        row: {
          recipient_id: "user-1",
          actor_id: null,
          type: "checkout_reminder",
          payload: { sessionId: "cs_exp", kind: "subscription", tier: "pro", period: "monthly", packCredits: null, trialEligible: true },
        },
      },
    ]);
    expect(email.send).toHaveBeenCalledTimes(1);
    const [message, options] = email.send.mock.calls[0];
    expect(message.subject).toBe("Your PipGlyph Pro trial is still waiting");
    expect(message.html).toContain("$15 / month");
    expect(options).toEqual({ idempotencyKey: "checkout-reminder:cs_exp" });
  });

  it("a lapsed subscriber is nudged without trial copy; an annual session quotes the annual price", async () => {
    const { admin, inserts } = makeChainAdmin({ profiles: [{ id: "user-1", subscription_status: "canceled" }], notifications: [], credit_ledger: [] });
    await handleStripeEvent(event(session({ metadata: { supabase_user_id: "user-1", purchase_kind: "subscription", tier: "plus", period: "annual" } })), { admin, stripe: noStripe });
    expect(notes(inserts)[0].row.payload).toMatchObject({ tier: "plus", period: "annual", trialEligible: false });
    const [message] = email.send.mock.calls[0];
    expect(message.subject).toBe("Finish upgrading to PipGlyph Plus");
    expect(message.html).toContain("$60 / year");
  });

  it("stays quiet when the plan was bought after all, when a reminder went out in the last 30 days, or when there's no user", async () => {
    const live = makeChainAdmin({ profiles: [{ id: "user-1", subscription_status: "trialing" }], notifications: [], credit_ledger: [] });
    await handleStripeEvent(event(session()), { admin: live.admin, stripe: noStripe });
    expect(notes(live.inserts)).toEqual([]);

    const recent = makeChainAdmin({ profiles: [free], notifications: [{ id: "n_recent" }], credit_ledger: [] });
    await handleStripeEvent(event(session()), { admin: recent.admin, stripe: noStripe });
    expect(notes(recent.inserts)).toEqual([]);

    const anon = makeChainAdmin({ profiles: [free], notifications: [], credit_ledger: [] });
    await handleStripeEvent(event(session({ client_reference_id: null, metadata: {} })), { admin: anon.admin, stripe: noStripe });
    expect(notes(anon.inserts)).toEqual([]);
    expect(email.send).not.toHaveBeenCalled();
  });

  it("packs: reminded with the credit count and price, unless a pack was bought after the session opened", async () => {
    const { admin, inserts } = makeChainAdmin({ profiles: [free], notifications: [], credit_ledger: [] });
    await handleStripeEvent(event(packSession()), { admin, stripe: noStripe });
    expect(notes(inserts)[0].row.payload).toMatchObject({ kind: "pack", packCredits: 30, trialEligible: false });
    const [message] = email.send.mock.calls[0];
    expect(message.subject).toBe("Your 30 PipGlyph credits are waiting");
    expect(message.html).toContain("($8)");

    email.send.mockClear();
    const bought = makeChainAdmin({ profiles: [free], notifications: [], credit_ledger: [{ id: "l_1" }] });
    await handleStripeEvent(event(packSession()), { admin: bought.admin, stripe: noStripe });
    expect(notes(bought.inserts)).toEqual([]);
    expect(email.send).not.toHaveBeenCalled();
  });

  it("the notification is the durable part (insert failure throws); a send failure or no email setup never fails the event", async () => {
    await expect(
      handleStripeEvent(event(session()), { admin: makeChainAdmin({ profiles: [free], notifications: [], credit_ledger: [] }, { insertError: "boom" }).admin, stripe: noStripe }),
    ).rejects.toThrow(/checkout_reminder notification failed/);

    email.send.mockRejectedValue(new Error("resend down"));
    const { admin, inserts } = makeChainAdmin({ profiles: [free], notifications: [], credit_ledger: [] });
    await expect(handleStripeEvent(event(session()), { admin, stripe: noStripe })).resolves.toBeUndefined();
    expect(notes(inserts)).toHaveLength(1);

    email.configured = false;
    email.send.mockReset();
    await handleStripeEvent(event(session()), { admin: makeChainAdmin({ profiles: [free], notifications: [], credit_ledger: [] }).admin, stripe: noStripe });
    expect(email.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// customer.subscription.deleted for a trial that never converted → ONE
// trial_lapsed notification + ONE win-back email (20% off the first month),
// and only when the customer has no other live plan.
// ---------------------------------------------------------------------------
describe("handleStripeEvent — trial win-back", () => {
  const profile = { id: "user-1", subscription_tier: "pro", subscription_status: "trialing", stripe_subscription_id: "sub_trial", stripe_customer_id: "cus_1" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noApiStripe = { subscriptions: { list: async () => { throw new Error("no api"); } } } as any;
  const deleted = (extra: Record<string, unknown> = {}) => ({
    id: "sub_trial",
    customer: "cus_1",
    status: "canceled",
    cancel_at_period_end: false,
    trial_end: 1_790_735_200,
    ended_at: 1_790_735_200,
    items: { data: [{ price: { id: "price_pro", unit_amount: 1500, currency: "usd", recurring: { interval: "month" } } }] },
    ...extra,
  });
  const event = (object: unknown) => ({ id: "evt_del", type: "customer.subscription.deleted", data: { object } }) as never;

  it("an unconverted trial: profile → free, ONE trial_lapsed notification with the offer window, ONE win-back email", async () => {
    const { admin, inserts, updates } = makeChainAdmin({ profiles: [profile], notifications: [] });
    await handleStripeEvent(event(deleted()), { admin, stripe: noApiStripe });
    expect(updates.find((u) => u.table === "profiles")?.values).toMatchObject({ subscription_tier: "free", subscription_status: "canceled" });
    expect(funnel(inserts)).toEqual([
      { event: "trial_lapsed", user_id: "user-1", props: { tier: "pro", interval: "month", subscriptionId: "sub_trial" }, source: "server" },
    ]);
    expect(notes(inserts)).toHaveLength(1);
    expect(notes(inserts)[0].row).toMatchObject({
      recipient_id: "user-1",
      actor_id: null,
      type: "trial_lapsed",
      payload: { subscriptionId: "sub_trial", tier: "pro", discountPct: 20 },
    });
    expect(typeof (notes(inserts)[0].row.payload as { expiresAt: unknown }).expiresAt).toBe("string");
    expect(email.send).toHaveBeenCalledTimes(1);
    const [message, options] = email.send.mock.calls[0];
    expect(message.subject).toBe("20% off your first month of PipGlyph Pro");
    expect(message.html).toContain("$12 for the first month");
    expect(message.html).toContain("instead of $15 / month");
    expect(options).toEqual({ idempotencyKey: "trial-winback:sub_trial" });
  });

  it("a paid subscription that ends (or a trial that converted first) gets no offer; a repeat delivery adds nothing", async () => {
    const paid = makeChainAdmin({ profiles: [profile], notifications: [] });
    await handleStripeEvent(event(deleted({ trial_end: 1_790_735_200, ended_at: 1_793_400_000, cancellation_details: { reason: "cancellation_requested", feedback: "too_expensive" } })), { admin: paid.admin, stripe: noApiStripe });
    expect(notes(paid.inserts)).toEqual([]);
    // …but a paid cancellation IS a funnel row, with Stripe's reason + feedback.
    expect(funnel(paid.inserts)).toEqual([
      { event: "subscription_cancelled", user_id: "user-1", props: { tier: "pro", interval: "month", subscriptionId: "sub_trial", cancelReason: "cancellation_requested", cancelFeedback: "too_expensive" }, source: "server" },
    ]);
    const never = makeChainAdmin({ profiles: [profile], notifications: [] });
    await handleStripeEvent(event(deleted({ trial_end: null })), { admin: never.admin, stripe: noApiStripe });
    expect(notes(never.inserts)).toEqual([]);
    expect(email.send).not.toHaveBeenCalled();

    const again = makeChainAdmin({ profiles: [profile], notifications: [{ id: "n_1" }] });
    await handleStripeEvent(event(deleted()), { admin: again.admin, stripe: noApiStripe });
    expect(notes(again.inserts)).toEqual([]);
  });
});

describe("handleStripeEvent — funnel rows for subscription lifecycle", () => {
  const profile = { id: "user-1", subscription_tier: "free", subscription_status: null, stripe_subscription_id: null, stripe_customer_id: "cus_1" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noApiStripe = { subscriptions: { list: async () => { throw new Error("no api"); } } } as any;
  const sub = (extra: Record<string, unknown> = {}) => ({
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_pro", recurring: { interval: "month" } }, current_period_end: 1893456000 }] },
    ...extra,
  });

  it("created: trial_started for a trial, subscription_started for a paid plan", async () => {
    const trial = makeChainAdmin({ profiles: [profile], credit_ledger: [] });
    await handleStripeEvent({ id: "e1", type: "customer.subscription.created", data: { object: sub({ status: "trialing" }) } } as never, { admin: trial.admin, stripe: noApiStripe });
    expect(funnel(trial.inserts)).toEqual([{ event: "trial_started", user_id: "user-1", props: { tier: "pro", interval: "month", subscriptionId: "sub_1" }, source: "server" }]);

    const paid = makeChainAdmin({ profiles: [profile], credit_ledger: [] });
    await handleStripeEvent({ id: "e2", type: "customer.subscription.created", data: { object: sub() } } as never, { admin: paid.admin, stripe: noApiStripe });
    expect(funnel(paid.inserts).map((r) => r.event)).toEqual(["subscription_started"]);
  });

  it("updated: trial_converted when previous_attributes.status was trialing; subscription_changed when the price changed; nothing otherwise", async () => {
    const converted = makeChainAdmin({ profiles: [profile], credit_ledger: [] });
    await handleStripeEvent({ id: "e3", type: "customer.subscription.updated", data: { object: sub(), previous_attributes: { status: "trialing" } } } as never, { admin: converted.admin, stripe: noApiStripe });
    expect(funnel(converted.inserts).map((r) => r.event)).toEqual(["trial_converted"]);

    const changed = makeChainAdmin({ profiles: [profile], credit_ledger: [] });
    await handleStripeEvent({ id: "e4", type: "customer.subscription.updated", data: { object: sub(), previous_attributes: { items: { data: [{ price: { id: "price_plus" } }] } } } } as never, { admin: changed.admin, stripe: noApiStripe });
    expect(funnel(changed.inserts)).toEqual([{ event: "subscription_changed", user_id: "user-1", props: { fromTier: "plus", toTier: "pro", interval: "month", subscriptionId: "sub_1" }, source: "server" }]);

    const quiet = makeChainAdmin({ profiles: [profile], credit_ledger: [] });
    await handleStripeEvent({ id: "e5", type: "customer.subscription.updated", data: { object: sub(), previous_attributes: { cancel_at_period_end: true } } } as never, { admin: quiet.admin, stripe: noApiStripe });
    expect(funnel(quiet.inserts)).toEqual([]);
  });

  it("checkout.session.completed records checkout_completed (and pack_purchased for a paid pack)", async () => {
    const { admin, inserts } = makeChainAdmin({ profiles: [profile] });
    await handleStripeEvent(
      { id: "e6", type: "checkout.session.completed", data: { object: { id: "cs_1", mode: "payment", payment_status: "paid", amount_total: 320, client_reference_id: "user-1", metadata: { supabase_user_id: "user-1", purchase_kind: "pack", pack: "mini", pack_credits: "10", discount: "subscriber" } } } } as never,
      { admin, stripe: noApiStripe },
    );
    expect(funnel(inserts).map((r) => [r.event, r.props])).toEqual([
      ["pack_purchased", { pack: "mini", credits: 10, discount: "subscriber", amountCents: 320, sessionId: "cs_1" }],
      ["checkout_completed", { kind: "pack", pack: "mini", discount: "subscriber", sessionId: "cs_1" }],
    ]);
  });
});

