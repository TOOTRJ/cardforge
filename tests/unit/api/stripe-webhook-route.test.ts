import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The webhook ROUTE's idempotency (migration 0099): the only thing between a
// Stripe retry and a double grant_credits. Claim the event id; a retry that
// meets an existing claim sees processed → 200, fresh → 409, stale → takes
// over (exactly one winner); a handler throw releases the claim so the next
// retry reprocesses immediately.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  event: { id: "evt_1", type: "customer.subscription.updated", data: { object: {} } },
  constructThrows: false,
  insertError: null as { code?: string; message: string } | null,
  existing: null as { processed_at: string | null; claimed_at: string } | null,
  taken: [] as Array<{ id: string }>,
  handlerThrows: false,
  handled: 0,
}));

vi.mock("@/lib/stripe/client", () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    webhooks: {
      constructEvent: () => {
        if (s.constructThrows) throw new Error("bad signature");
        return s.event;
      },
    },
  }),
}));
vi.mock("@/lib/stripe/webhook-handlers", () => ({
  handleStripeEvent: async () => {
    s.handled += 1;
    if (s.handlerThrows) throw new Error("handler exploded");
  },
}));

const stub = chainClient((table, calls: ChainCall[]) => {
  expect(table).toBe("stripe_events");
  const first = calls[0]?.method;
  const methods = calls.map((c) => c.method);
  if (first === "insert") return { error: s.insertError };
  if (first === "select") return { data: s.existing };
  if (first === "update" && methods.includes("select")) return { data: s.taken };
  return { error: null };
});
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => true,
  createAdminClient: () => stub.client,
}));

import { POST } from "@/app/api/stripe/webhook/route";

const post = () =>
  POST(
    new Request("http://x/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "{}",
    }),
  );
const ops = () => stub.log.map((entry) => entry.calls.map((c) => c.method).join("."));

beforeEach(() => {
  s.constructThrows = false;
  s.insertError = null;
  s.existing = null;
  s.taken = [];
  s.handlerThrows = false;
  s.handled = 0;
  stub.log.length = 0;
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/stripe/webhook", () => {
  it("claims, handles, and stamps a fresh event", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(s.handled).toBe(1);
    expect(ops()).toEqual(["insert", "update.eq"]);
    const stamp = stub.log[1].calls[0].args[0] as { processed_at: string };
    expect(stamp.processed_at).toMatch(/^\d{4}-/);
  });

  it("answers 200 without re-handling an already processed event", async () => {
    s.insertError = { code: "23505", message: "duplicate" };
    s.existing = { processed_at: "2026-09-22T00:00:00Z", claimed_at: "2026-09-22T00:00:00Z" };
    const res = await post();
    expect(res.status).toBe(200);
    expect(s.handled).toBe(0);
  });

  it("answers 409 while another delivery's fresh claim is in flight", async () => {
    s.insertError = { code: "23505", message: "duplicate" };
    s.existing = { processed_at: null, claimed_at: new Date().toISOString() };
    const res = await post();
    expect(res.status).toBe(409);
    expect(s.handled).toBe(0);
  });

  it("takes over a stale claim — but only the one retry that wins the conditional update", async () => {
    s.insertError = { code: "23505", message: "duplicate" };
    s.existing = { processed_at: null, claimed_at: new Date(Date.now() - 11 * 60_000).toISOString() };
    s.taken = [{ id: "evt_1" }];
    expect((await post()).status).toBe(200);
    expect(s.handled).toBe(1);
    // The takeover is `update … is(processed_at, null) … lt(claimed_at, stale) … select`.
    expect(ops()[2]).toBe("update.eq.is.lt.select");

    s.handled = 0;
    s.taken = [];
    expect((await post()).status).toBe(409);
    expect(s.handled).toBe(0);
  });

  it("releases the claim and answers 500 when the handler throws, so the next retry reprocesses", async () => {
    s.handlerThrows = true;
    const res = await post();
    expect(res.status).toBe(500);
    expect(ops()).toEqual(["insert", "delete.eq"]);
  });

  it("lets Stripe retry on a storage error and refuses a bad or missing signature", async () => {
    s.insertError = { code: "08006", message: "connection lost" };
    expect((await post()).status).toBe(500);
    expect(s.handled).toBe(0);

    s.insertError = null;
    s.constructThrows = true;
    expect((await post()).status).toBe(400);
    const noSig = await POST(new Request("http://x/api/stripe/webhook", { method: "POST", body: "{}" }));
    expect(noSig.status).toBe(400);
    expect(s.handled).toBe(0);
  });
});
