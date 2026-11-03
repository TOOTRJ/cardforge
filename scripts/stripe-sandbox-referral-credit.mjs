#!/usr/bin/env node
// ---------------------------------------------------------------------------
// SCRATCH (uncommitted): the referral programme's free month for a PAYING
// referrer — a Stripe customer-balance credit — against the Stripe SANDBOX,
// on test clocks. It calls the REAL code in-process:
//   - grantOwedSides (lib/referrals/server.ts) → planReferralMonth →
//     oneMonthCents → creditCustomerBalance (customers.createBalanceTransaction);
//   - handleStripeEvent (lib/stripe/webhook-handlers.ts) with each renewal's
//     real invoice as an `invoice.paid` event, to show the monthly credit
//     refill still fires on a $0 invoice paid from the balance.
// A recording stand-in replaces the Supabase admin client. No database is
// touched.
//
//   node scripts/stripe-sandbox-referral-credit.mjs   (from the repo root; on hold with RF1)
//
// The key: STRIPE_TEST_KEY is read from the main checkout's .env.local
// IN-PROCESS, and that one line only. It must be sk_test_ / rk_test_ or
// nothing runs, and it is never printed. Every other secret-looking env var
// is dropped before the app's code loads. Each scenario's test clock (and
// with it its customer and subscription) is deleted in `finally`.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";

const ENV_FILE = process.env.SANDBOX_ENV_FILE ?? ".env.local"; // run from the repo root (or point SANDBOX_ENV_FILE at the main checkout's .env.local)
const ROOT = process.cwd(); // run from the repo root

const line = readFileSync(ENV_FILE, "utf8").split(/\r?\n/).find((l) => l.startsWith("STRIPE_TEST_KEY="));
const KEY = (line ?? "").slice("STRIPE_TEST_KEY=".length).trim().replace(/^["']|["']$/g, "");
if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(KEY)) {
  console.error("STRIPE_TEST_KEY must be a Stripe SANDBOX key (sk_test_… or rk_test_…). Nothing was run.");
  process.exit(2);
}
for (const name of Object.keys(process.env)) {
  if (/STRIPE|SUPABASE|SECRET|TOKEN|_KEY|PASSWORD|DATABASE_URL|RESEND|OPENAI|AI_GATEWAY/i.test(name)) delete process.env[name];
}
process.env.NEXT_PUBLIC_BILLING_ENABLED = "true";

const safeMessage = (error) =>
  String(error instanceof Error ? error.message : error).replace(/\b(sk|rk|pk)_(test|live)_[*A-Za-z0-9]+/g, "[key]");
for (const level of ["warn", "error", "log"]) {
  const write = console[level].bind(console);
  console[level] = (...args) => write(...args.map((a) => (typeof a === "string" || a instanceof Error ? safeMessage(a) : a)));
}
process.on("unhandledRejection", (error) => {
  console.error(`Stopped: ${safeMessage(error)}`);
  process.exit(1);
});

const require = createRequire(path.join(ROOT, "package.json"));
const { createJiti } = require("jiti");
const jiti = createJiti(path.join(ROOT, "package.json"), {
  interopDefault: true,
  alias: { "@": ROOT, "server-only": path.join(ROOT, "tests/stubs/server-only.ts") },
});
const load = (p) => jiti.import(path.join(ROOT, p));

const Stripe = require("stripe").default ?? require("stripe");
const referrals = await load("lib/referrals/server.ts");
const webhooks = await load("lib/stripe/webhook-handlers.ts");
const plans = await load("lib/billing/plans.ts");

const stripe = new Stripe(KEY, { apiVersion: "2026-05-27.dahlia", maxNetworkRetries: 2 });

const HOUR = 3600;
const DAY = 86400;
const iso = (sec) => new Date(sec * 1000).toISOString();
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
function addMonthsUtc(sec, n) {
  const d = new Date(sec * 1000);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return Math.floor(d.getTime() / 1000);
}

/** A recording stand-in for the Supabase admin client: every `profiles`
 *  read answers `profile`; every other read answers nothing; writes are
 *  no-ops; every rpc is recorded and answers null. */
function recordingAdmin(profile) {
  const rpcs = [];
  const writes = [];
  const answer = (data) => ({ data, error: null });
  const admin = {
    rpcs,
    writes,
    from(table) {
      let writing = false;
      const result = () => answer(table === "profiles" && !writing ? profile : null);
      const builder = new Proxy(
        {},
        {
          get(_, prop) {
            if (prop === "then") return (ok, ko) => Promise.resolve(result()).then(ok, ko);
            if (prop === "maybeSingle" || prop === "single") return async () => result();
            if (["update", "insert", "upsert", "delete"].includes(prop)) {
              return (payload) => {
                writing = true;
                writes.push({ table, op: prop, payload });
                return builder;
              };
            }
            return () => builder;
          },
        },
      );
      return builder;
    },
    rpc: async (name, args) => {
      rpcs.push({ name, args });
      return answer(null);
    },
  };
  return admin;
}

async function prices() {
  const list = await stripe.prices.list({ lookup_keys: ["plus_monthly", "pro_monthly"], active: true, limit: 10 });
  const by = Object.fromEntries(list.data.map((p) => [p.lookup_key, p]));
  if (!by.plus_monthly || !by.pro_monthly) throw new Error("The sandbox catalog has no plus_monthly / pro_monthly lookup key.");
  return by;
}

class Clock {
  constructor(name, log) {
    this.name = name;
    this.log = log;
  }
  async start() {
    this.t0 = Math.floor(Date.now() / 1000);
    this.clock = await stripe.testHelpers.testClocks.create({ frozen_time: this.t0, name: `pipglyph referral check: ${this.name}` });
    this.now = this.t0;
  }
  async advance(toSec, why) {
    await stripe.testHelpers.testClocks.advance(this.clock.id, { frozen_time: toSec });
    const deadline = Date.now() + 6 * 60_000;
    for (;;) {
      const c = await stripe.testHelpers.testClocks.retrieve(this.clock.id);
      if (c.status === "ready") break;
      if (c.status === "internal_failure") throw new Error(`test clock ${this.clock.id} failed to advance`);
      if (Date.now() > deadline) throw new Error(`test clock ${this.clock.id} still advancing after 6 min`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    this.now = toSec;
    this.log(`  ⏩ clock → ${iso(toSec)}${why ? ` (${why})` : ""}`);
  }
  async delete() {
    if (this.clock) await stripe.testHelpers.testClocks.del(this.clock.id);
  }
}

/** One paying referrer on `tier` monthly: the referral month granted a day
 *  into the period, then three renewals; every invoice asserted, and each
 *  renewal's invoice replayed as `invoice.paid` through the real handler. */
async function payingReferrer({ clock, price, tier, log, result }) {
  const P = price.unit_amount;
  const customer = await stripe.customers.create({
    test_clock: clock.clock.id,
    name: `PipGlyph referral check (${tier})`,
    metadata: { pipglyph_sandbox_check: "referral" },
  });
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  const sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.id }], default_payment_method: pm.id });

  const userId = `sandbox-referrer-${tier}`;
  const profile = {
    id: userId,
    is_admin: false,
    subscription_tier: tier,
    subscription_status: "active",
    stripe_customer_id: customer.id,
    stripe_subscription_id: sub.id,
    cancel_at_period_end: false,
    current_period_end: null,
    subscription_ends_at: null,
    comp_tier: null,
    comp_expires_at: null,
  };
  await clock.advance(clock.t0 + DAY, "one day into the period");

  // The referral, as the sweep / qualify path hands it to grantOwedSides:
  // rewarded, the friend's side already settled, the referrer's owed.
  const referral = {
    id: randomUUID(),
    status: "rewarded",
    referrer_id: userId,
    referee_id: "sandbox-friend",
    referrer_reward: null,
    referee_reward: "plus_month",
    grant_attempts: 0,
  };
  const deps = { stripe, billingEnabled: true, now: new Date(clock.now * 1000), profiles: { [userId]: profile } };
  const admin = recordingAdmin(profile);
  const first = await referrals.grantOwedSides(admin, referral, deps);
  log(`  referral month granted: ${JSON.stringify(first.referrer)}`);
  if (first.referrer?.kind !== "balance_credit") result.errors.push(`the referrer got ${first.referrer?.kind ?? "nothing"}, expected balance_credit`);
  if (first.referrer?.amountCents !== P) result.errors.push(`credit ${money(first.referrer?.amountCents ?? 0)}, expected one month of ${tier} = ${money(P)}`);
  const recorded = admin.writes.find((w) => w.table === "referrals");
  log(`  recorded on the referral row: ${JSON.stringify(recorded?.payload ?? null)}`);
  const notified = admin.writes.find((w) => w.table === "notifications");
  log(`  notification: ${JSON.stringify(notified?.payload ?? null)}`);

  // A retry (the sweep running again before the row write landed) must not credit twice.
  const again = await referrals.grantOwedSides(recordingAdmin(profile), referral, deps);
  log(`  retried grant: ${JSON.stringify(again.referrer)}`);
  const txns = await stripe.customers.listBalanceTransactions(customer.id, { limit: 100 });
  const credits = txns.data.filter((t) => t.metadata?.referral_id === referral.id);
  log(`  balance transactions for the referral: ${credits.map((t) => `${t.amount} ${t.currency} "${t.description}"`).join("; ")}`);
  if (credits.length !== 1) result.errors.push(`${credits.length} referral balance transactions, expected 1 (idempotency)`);
  const cust = await stripe.customers.retrieve(customer.id);
  log(`  customer balance after the grant: ${cust.balance} (${money(-cust.balance)} of credit)`);
  if (cust.balance !== -P) result.errors.push(`balance ${cust.balance}, expected ${-P}`);

  for (let k = 1; k <= 3; k++) await clock.advance(addMonthsUtc(clock.t0, k) + 2 * HOUR, `renewal ${k} + 2h`);

  const invoices = (await stripe.invoices.list({ subscription: sub.id, limit: 100 })).data.sort((a, b) => a.created - b.created);
  invoices.forEach((inv, i) => {
    const day = Math.round((inv.created - clock.t0) / DAY);
    log(
      `  invoice ${i + 1}: day ${String(day).padStart(3)}  ${(inv.billing_reason ?? "").padEnd(20)}  total ${money(inv.total).padStart(7)}  ` +
        `starting balance ${String(inv.starting_balance ?? 0).padStart(6)}  ending balance ${String(inv.ending_balance ?? 0).padStart(6)}  ` +
        `charged (amount_paid) ${money(inv.amount_paid).padStart(7)}  ${inv.status}`,
    );
  });
  const charged = invoices.map((i) => i.amount_paid);
  const expected = [P, 0, P, P];
  result.amounts = charged;
  if (charged.length !== expected.length || charged.some((v, i) => v !== expected[i])) {
    result.errors.push(`charged ${charged.map(money).join(", ")} — expected ${expected.map(money).join(", ")}`);
  }
  const unpaid = invoices.filter((i) => i.status !== "paid");
  if (unpaid.length) result.errors.push(`${unpaid.length} invoice(s) not paid`);

  // The refill: each renewal's real invoice, as Stripe's invoice.paid event,
  // through the real handler. The handler re-reads the subscription from the
  // sandbox, syncs it and grants the month's allotment (grant_credits,
  // reason subscription_refill) — whatever the invoice charged.
  const allotment = plans.MONTHLY_CREDITS[tier];
  for (const [i, inv] of invoices.entries()) {
    if (inv.billing_reason !== "subscription_cycle") continue;
    const replay = recordingAdmin(profile);
    await webhooks.handleStripeEvent(
      { id: `evt_replay_${inv.id}`, type: "invoice.paid", created: inv.status_transitions?.paid_at ?? inv.created, data: { object: inv } },
      { admin: replay, stripe },
    );
    const grants = replay.rpcs.filter((r) => r.name === "grant_credits" && r.args?.p_reason === "subscription_refill");
    const paymentRow = replay.writes.find((w) => w.table === "billing_payments");
    const paymentNote = replay.writes.find((w) => w.table === "notifications");
    log(
      `  invoice ${i + 1} (${money(inv.amount_paid)}) replayed as invoice.paid → refill grant_credits: ` +
        `${grants.length ? grants.map((g) => `${g.args.p_amount} credits`).join(", ") : "NONE"}; ` +
        `billing_payments amount ${paymentRow ? paymentRow.payload?.amount_cents ?? JSON.stringify(paymentRow.payload) : "—"}; ` +
        `"payment received" notification: ${paymentNote ? paymentNote.payload?.type ?? "yes" : "none"}`,
    );
    if (grants.length !== 1 || grants[0].args.p_amount !== allotment) {
      result.errors.push(`invoice ${i + 1}: refill ${grants.map((g) => g.args.p_amount).join(",") || "none"}, expected ${allotment}`);
    }
  }
}

const price = await prices();
console.log(`Sandbox prices: Plus monthly ${money(price.plus_monthly.unit_amount)}, Pro monthly ${money(price.pro_monthly.unit_amount)}`);

const SCENARIOS = [
  ["A. Plus monthly referrer", "plus", price.plus_monthly],
  ["B. Pro monthly referrer", "pro", price.pro_monthly],
];
const results = await Promise.all(
  SCENARIOS.map(async ([name, tier, p]) => {
    const lines = [];
    const log = (l) => lines.push(l);
    const result = { name, errors: [], amounts: null, lines };
    const clock = new Clock(name, log);
    try {
      await clock.start();
      await payingReferrer({ clock, price: p, tier, log, result });
    } catch (error) {
      result.errors.push(`crashed: ${safeMessage(error)}`);
    } finally {
      try {
        await clock.delete();
        lines.push(`  test clock deleted`);
      } catch (error) {
        result.errors.push(`cleanup failed for ${clock.clock?.id}: ${safeMessage(error)}`);
      }
    }
    return result;
  }),
);

let failures = 0;
for (const r of results) {
  console.log(`\n${r.errors.length ? "✗" : "✓"} ${r.name}`);
  for (const l of r.lines) console.log(l);
  if (r.amounts) console.log(`  charged per invoice: ${r.amounts.map(money).join(" → ")}`);
  for (const e of r.errors) console.log(`  ✗ ${e}`);
  if (r.errors.length) failures++;
}
console.log(`\n${failures ? `${failures} scenario(s) FAILED` : "All scenarios passed"}.`);
process.exit(failures ? 1 : 0);
