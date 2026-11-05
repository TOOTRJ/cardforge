import { describe, expect, it, vi } from "vitest";
import { handleChargeRefunded, handleDispute, handleEarlyFraudWarning } from "@/lib/stripe/charge-events";

// ---------------------------------------------------------------------------
// Money going back (lib/stripe/charge-events.ts, migration 0174): a refund
// or a dispute marks the sale, a PACK's credits follow the money through
// reconcile_pack_withdrawal, and every admin is told once per key. A
// recording stand-in for the admin client; a Stripe whose charges.retrieve
// answers what the test scripts.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function makeAdmin(opts: {
  packByIntent?: Record<string, Row>;
  invoiceByIntent?: Record<string, Row>;
  admins?: string[];
  alerted?: string[];
  reconcile?: { credits_delta: number; clawed_total: number; target: number };
} = {}) {
  const updates: Array<{ table: string; values: Row; key: [string, unknown] }> = [];
  const inserts: Array<{ table: string; rows: Row[] }> = [];
  const rpcs: Array<{ fn: string; args: Row }> = [];
  const admin = {
    from(table: string) {
      return {
        select() {
          const filters: Array<[string, unknown]> = [];
          const chain = {
            eq: (col: string, value: unknown) => {
              filters.push([col, value]);
              return chain;
            },
            limit: () => chain,
            maybeSingle: async () => {
              if (table === "billing_pack_payments") {
                const pi = String(filters.find(([c]) => c === "payment_intent_id")?.[1] ?? "");
                return { data: opts.packByIntent?.[pi] ?? null, error: null };
              }
              if (table === "billing_payments") {
                const pi = String(filters.find(([c]) => c === "payment_intent_id")?.[1] ?? "");
                return { data: opts.invoiceByIntent?.[pi] ?? null, error: null };
              }
              if (table === "profiles") return { data: null, error: null };
              return { data: null, error: null };
            },
            then: (resolve: (v: unknown) => void) => {
              if (table === "profiles") {
                resolve({ data: (opts.admins ?? ["admin-1"]).map((id) => ({ id })), error: null });
              } else if (table === "notifications") {
                resolve({ data: (opts.alerted ?? []).map((id) => ({ recipient_id: id })), error: null });
              } else resolve({ data: [], error: null });
            },
          };
          return chain;
        },
        update(values: Row) {
          return {
            eq: async (col: string, value: unknown) => {
              updates.push({ table, values, key: [col, value] });
              return { error: null };
            },
          };
        },
        insert: async (rows: Row[]) => {
          inserts.push({ table, rows });
          return { error: null };
        },
      };
    },
    rpc: async (fn: string, args: Row) => {
      rpcs.push({ fn, args });
      return { data: [opts.reconcile ?? { credits_delta: 0, clawed_total: 0, target: 0 }], error: null };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, updates, inserts, rpcs };
}

/** A Stripe whose charge and dispute reads answer what the test scripts
 *  (null = the read fails and the event's copy stands). */
const stripeWith = (charge: Row | null, dispute: Row | null = null) =>
  ({
    charges: {
      retrieve: vi.fn(async () => {
        if (!charge) throw new Error("no api");
        return charge;
      }),
    },
    disputes: {
      retrieve: vi.fn(async () => {
        if (!dispute) throw new Error("no api");
        return dispute;
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const PACK = {
  checkout_session_id: "cs_pack",
  user_id: "user-1",
  amount_cents: 800,
  dispute_status: null,
  dispute_id: null,
  disputed_cents: 0,
  disputed_at: null,
};

describe("charge.refunded", () => {
  it("a refunded pack: the row is marked, the credits are reconciled to the refunded share, admins are told once", async () => {
    const { admin, updates, inserts, rpcs } = makeAdmin({
      packByIntent: { pi_1: PACK },
      reconcile: { credits_delta: -15, clawed_total: 15, target: 15 },
    });
    await handleChargeRefunded(
      { id: "ch_1", payment_intent: "pi_1", amount_refunded: 400, currency: "usd", customer: "cus_1", created: 1_790_000_000 } as never,
      { admin },
      1_790_000_100,
    );
    expect(updates).toEqual([
      {
        table: "billing_pack_payments",
        values: { refunded_cents: 400, refunded_at: new Date(1_790_000_100 * 1000).toISOString() },
        key: ["checkout_session_id", "cs_pack"],
      },
    ]);
    expect(rpcs).toEqual([{ fn: "reconcile_pack_withdrawal", args: { p_session: "cs_pack", p_withdrawn_cents: 400 } }]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("notifications");
    expect(inserts[0].rows[0]).toMatchObject({
      recipient_id: "admin-1",
      type: "billing_alert",
      payload: {
        dedupeKey: "refund:ch_1:400",
        alert: "refund",
        saleKind: "pack",
        saleId: "cs_pack",
        userId: "user-1",
        amountCents: 400,
        creditsDelta: -15,
      },
    });
  });

  it("a refunded invoice: the row is marked, no credits move, admins are told", async () => {
    const { admin, updates, inserts, rpcs } = makeAdmin({
      invoiceByIntent: { pi_2: { invoice_id: "in_1", user_id: "user-2", amount_cents: 1500, dispute_status: null, disputed_cents: 0, disputed_at: null } },
    });
    await handleChargeRefunded({ id: "ch_2", payment_intent: "pi_2", amount_refunded: 1500, currency: "usd" } as never, { admin });
    expect(updates[0]).toMatchObject({ table: "billing_payments", key: ["invoice_id", "in_1"], values: { refunded_cents: 1500 } });
    expect(rpcs).toEqual([]);
    expect(inserts[0].rows[0]).toMatchObject({ payload: { saleKind: "invoice", saleId: "in_1", userId: "user-2", creditsDelta: 0 } });
  });

  it("an unmatched charge still alerts, as unmatched; a charge refunded for $0 does nothing", async () => {
    const { admin, updates, inserts, rpcs } = makeAdmin();
    await handleChargeRefunded({ id: "ch_3", payment_intent: "pi_none", amount_refunded: 600, currency: "usd" } as never, { admin });
    expect(updates).toEqual([]);
    expect(rpcs).toEqual([]);
    expect(inserts[0].rows[0]).toMatchObject({ payload: { saleKind: null, saleId: null, userId: null, amountCents: 600 } });

    const zero = makeAdmin();
    await handleChargeRefunded({ id: "ch_4", payment_intent: "pi_1", amount_refunded: 0 } as never, { admin: zero.admin });
    expect(zero.inserts).toEqual([]);
  });

  it("a refund on a pack under a PARTIAL dispute counts the dispute's own amount, not the whole pack", async () => {
    const { admin, rpcs } = makeAdmin({
      packByIntent: { pi_1: { ...PACK, dispute_status: "needs_response", disputed_cents: 300 } },
    });
    await handleChargeRefunded({ id: "ch_1", payment_intent: "pi_1", amount_refunded: 100 } as never, { admin });
    expect(rpcs).toEqual([{ fn: "reconcile_pack_withdrawal", args: { p_session: "cs_pack", p_withdrawn_cents: 300 } }]);
  });

  it("admins already told for this (charge, amount) are not told again; a larger refund is a new key", async () => {
    const { admin, inserts } = makeAdmin({ admins: ["admin-1", "admin-2"], alerted: ["admin-1"] });
    await handleChargeRefunded({ id: "ch_5", payment_intent: "pi_x", amount_refunded: 300 } as never, { admin });
    expect(inserts[0].rows.map((r) => r.recipient_id)).toEqual(["admin-2"]);
  });
});

describe("charge.dispute.created / closed", () => {
  it("an open dispute on a pack takes the credits back; won gives them back; the status is on the row", async () => {
    const opened = makeAdmin({
      packByIntent: { pi_1: PACK },
      reconcile: { credits_delta: -30, clawed_total: 30, target: 30 },
    });
    const openDispute = { id: "dp_1", charge: "ch_1", payment_intent: "pi_1", amount: 800, currency: "usd", status: "needs_response", reason: "fraudulent", created: 1 };
    await handleDispute(
      openDispute as never,
      { admin: opened.admin, stripe: stripeWith({ id: "ch_1", amount_refunded: 0, payment_intent: "pi_1", customer: "cus_1" }, openDispute) },
      { closed: false, eventCreated: 1_790_000_000 },
    );
    expect(opened.updates[0]).toMatchObject({
      table: "billing_pack_payments",
      values: { dispute_id: "dp_1", dispute_status: "needs_response", disputed_cents: 800, disputed_at: new Date(1_790_000_000 * 1000).toISOString() },
    });
    expect(opened.rpcs).toEqual([{ fn: "reconcile_pack_withdrawal", args: { p_session: "cs_pack", p_withdrawn_cents: 800 } }]);
    expect(opened.inserts[0].rows[0]).toMatchObject({
      payload: { dedupeKey: "dispute:dp_1:needs_response", alert: "dispute", disputeStatus: "needs_response", disputeReason: "fraudulent", creditsDelta: -30 },
    });

    const won = makeAdmin({
      packByIntent: { pi_1: { ...PACK, dispute_status: "needs_response", dispute_id: "dp_1", disputed_cents: 800, disputed_at: "2026-11-01T00:00:00.000Z" } },
      reconcile: { credits_delta: 30, clawed_total: 0, target: 0 },
    });
    const wonDispute = { id: "dp_1", charge: "ch_1", payment_intent: "pi_1", amount: 800, currency: "usd", status: "won" };
    await handleDispute(
      wonDispute as never,
      { admin: won.admin, stripe: stripeWith({ id: "ch_1", amount_refunded: 0, payment_intent: "pi_1" }, wonDispute) },
      { closed: true },
    );
    // Won: nothing withdrawn → the target is 0, the credits come back; disputed_at (already set) untouched.
    expect(won.updates[0].values).toEqual({ dispute_id: "dp_1", dispute_status: "won", disputed_cents: 800 });
    expect(won.rpcs).toEqual([{ fn: "reconcile_pack_withdrawal", args: { p_session: "cs_pack", p_withdrawn_cents: 0 } }]);
    expect(won.inserts[0].rows[0]).toMatchObject({ payload: { dedupeKey: "dispute:dp_1:won", alert: "dispute_closed", creditsDelta: 30 } });
  });

  it("reads Stripe's CURRENT dispute, never the event's snapshot: a late `created` after `closed` reopens nothing", async () => {
    // The event says needs_response; Stripe says the dispute was won.
    const { admin, updates, rpcs, inserts } = makeAdmin({
      packByIntent: { pi_1: { ...PACK, dispute_status: "won", dispute_id: "dp_1", disputed_cents: 800, disputed_at: "2026-11-01T00:00:00.000Z" } },
      reconcile: { credits_delta: 0, clawed_total: 0, target: 0 },
    });
    const stale = { id: "dp_1", charge: "ch_1", payment_intent: "pi_1", amount: 800, currency: "usd", status: "needs_response" };
    await handleDispute(
      stale as never,
      { admin, stripe: stripeWith({ id: "ch_1", amount_refunded: 0, payment_intent: "pi_1" }, { ...stale, status: "won" }) },
      { closed: false },
    );
    expect(updates[0].values).toMatchObject({ dispute_status: "won" });
    expect(rpcs).toEqual([{ fn: "reconcile_pack_withdrawal", args: { p_session: "cs_pack", p_withdrawn_cents: 0 } }]);
    expect(inserts[0].rows[0]).toMatchObject({ payload: { dedupeKey: "dispute:dp_1:won", alert: "dispute_closed" } });

    // Stripe can't be read AND the row is already final: the row's status wins over the stale event.
    const unread = makeAdmin({
      packByIntent: { pi_1: { ...PACK, dispute_status: "won", dispute_id: "dp_1", disputed_cents: 800, disputed_at: "2026-11-01T00:00:00.000Z" } },
    });
    await handleDispute(stale as never, { admin: unread.admin, stripe: stripeWith(null, null) }, { closed: false });
    expect(unread.updates[0].values).toMatchObject({ dispute_status: "won" });
    expect(unread.rpcs[0].args).toMatchObject({ p_withdrawn_cents: 0 });

    // A SECOND dispute on the same charge (a new id) is judged afresh: open, clawing.
    const second = makeAdmin({
      packByIntent: { pi_1: { ...PACK, dispute_status: "won", dispute_id: "dp_1", disputed_cents: 800, disputed_at: "2026-11-01T00:00:00.000Z" } },
      reconcile: { credits_delta: -30, clawed_total: 30, target: 30 },
    });
    const fresh = { ...stale, id: "dp_2" };
    await handleDispute(fresh as never, { admin: second.admin, stripe: stripeWith({ id: "ch_1", amount_refunded: 0, payment_intent: "pi_1" }, fresh) }, { closed: false });
    expect(second.updates[0].values).toMatchObject({ dispute_id: "dp_2", dispute_status: "needs_response" });
    expect(second.updates[0].values).toHaveProperty("disputed_at");
    expect(second.rpcs[0].args).toMatchObject({ p_withdrawn_cents: 800 });
  });

  it("lost keeps the money withdrawn; a charge Stripe can't read falls back to the event alone", async () => {
    const lost = makeAdmin({ packByIntent: { pi_1: PACK }, reconcile: { credits_delta: 0, clawed_total: 30, target: 30 } });
    await handleDispute(
      { id: "dp_2", charge: "ch_1", payment_intent: "pi_1", amount: 800, currency: "usd", status: "lost" } as never,
      { admin: lost.admin, stripe: stripeWith(null, null) },
      { closed: true },
    );
    expect(lost.rpcs).toEqual([{ fn: "reconcile_pack_withdrawal", args: { p_session: "cs_pack", p_withdrawn_cents: 800 } }]);
    expect(lost.inserts[0].rows[0]).toMatchObject({ payload: { alert: "dispute_closed", disputeStatus: "lost" } });
  });

  it("a dispute on an invoice marks the row and alerts; access is Stripe's dispute setting, not ours", async () => {
    const { admin, updates, rpcs, inserts } = makeAdmin({
      invoiceByIntent: { pi_9: { invoice_id: "in_9", user_id: "user-9", amount_cents: 600, dispute_status: null, disputed_cents: 0, disputed_at: null } },
    });
    const review = { id: "dp_9", charge: "ch_9", payment_intent: null, amount: 600, currency: "usd", status: "under_review" };
    await handleDispute(
      review as never,
      { admin, stripe: stripeWith({ id: "ch_9", amount_refunded: 0, payment_intent: "pi_9" }, review) },
      { closed: false },
    );
    expect(updates[0]).toMatchObject({ table: "billing_payments", key: ["invoice_id", "in_9"], values: { dispute_status: "under_review" } });
    expect(rpcs).toEqual([]);
    expect(inserts[0].rows[0]).toMatchObject({ payload: { saleKind: "invoice", userId: "user-9" } });
  });
});

describe("radar.early_fraud_warning.created", () => {
  it("alerts once per warning with the matched sale; moves nothing", async () => {
    const { admin, updates, rpcs, inserts } = makeAdmin({ packByIntent: { pi_1: PACK } });
    await handleEarlyFraudWarning(
      { id: "issfr_1", charge: "ch_1", fraud_type: "made_with_stolen_card" } as never,
      { admin, stripe: stripeWith({ id: "ch_1", amount: 800, currency: "usd", payment_intent: "pi_1", customer: "cus_1" }) },
    );
    expect(updates).toEqual([]);
    expect(rpcs).toEqual([]);
    expect(inserts[0].rows[0]).toMatchObject({
      payload: { dedupeKey: "fraud:issfr_1", alert: "fraud_warning", saleKind: "pack", saleId: "cs_pack", amountCents: 800, disputeReason: "made_with_stolen_card" },
    });
  });
});
