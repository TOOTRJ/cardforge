#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Free 30 days (migration 0176) against the Stripe SANDBOX, on test clocks:
// the SAME writer the admin's action calls (`grantFreeDays` / `revokeFreeDays`
// in lib/billing/free-days-apply.ts), loaded from lib/ in-process, and every
// invoice's amount and date asserted. docs/BILLING.md "Free 30 days".
//
//   node --env-file=.env.local scripts/stripe-sandbox-free-days-check.mjs
//   (npm run stripe:sandbox-free-days-check)
//
// Reads ONE variable, STRIPE_TEST_KEY — a sandbox key (sk_test_… / rk_test_…),
// checked BEFORE anything else and never printed. Every other STRIPE_*,
// Supabase or secret-looking variable is dropped from this process before
// the app's code is loaded, so nothing here can reach a live key or a
// database. Each scenario's test clock (and with it its customer and
// subscription) is deleted in `finally`. Exit 1 on any wrong amount or date.
//
// Scenarios (the owner's example first):
//   1. a MONTHLY Pro plan paid on day 0, 30 free days given on day 5: no
//      invoice on day 30; the full price on day 60 (= day 30 + 30 d), then
//      monthly from there;
//   2. a card-backed 7-day TRIAL given 30 free days on day 2: no charge on
//      day 7; the full price on day 37;
//   3. an ANNUAL plan held 30 days: the renewal moves by 30 days (asserted on
//      the subscription, not advanced — a year is too long for one clock);
//   4. scenario 1 REVOKED on day 10: the next charge is back on day 30.
// ---------------------------------------------------------------------------

import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const KEY = process.env.STRIPE_TEST_KEY ?? "";
if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(KEY)) {
  console.error("STRIPE_TEST_KEY must be a Stripe SANDBOX key (sk_test_… or rk_test_…). Nothing was run.");
  process.exit(2);
}
for (const name of Object.keys(process.env)) {
  if (/STRIPE|SUPABASE|SECRET|TOKEN|_KEY|PASSWORD|DATABASE_URL|RESEND|OPENAI|AI_GATEWAY/i.test(name)) {
    delete process.env[name];
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": root, "server-only": path.join(root, "tests/stubs/server-only.ts") },
});
const load = (p) => jiti.import(path.join(root, p));

const { default: Stripe } = await import("stripe");
const apply = await load("lib/billing/free-days-apply.ts");
const freeDays = await load("lib/billing/free-days.ts");
const compStripe = await load("lib/billing/comp-stripe.ts");

const stripe = new Stripe(KEY, { apiVersion: "2026-05-27.dahlia", maxNetworkRetries: 2 });

const safeMessage = (error) =>
  String(error instanceof Error ? error.message : error).replace(/\b(sk|rk|pk)_(test|live)_[*A-Za-z0-9]+/g, "[key]");
for (const level of ["warn", "error"]) {
  const write = console[level].bind(console);
  console[level] = (...args) => write(...args.map((a) => (typeof a === "string" || a instanceof Error ? safeMessage(a) : a)));
}
process.on("unhandledRejection", (error) => {
  console.error(`Stopped: ${safeMessage(error)}`);
  process.exit(1);
});

const DAY = 86400;
const iso = (sec) => new Date(sec * 1000).toISOString();
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const USER = "00000000-0000-4000-8000-00000000f1ee";

/** The admin client the writer reads the profile through and writes the
 *  grant row, the overlay and the resync to: an in-memory stand-in. The
 *  profile points at the clock's customer + subscription; every write is
 *  recorded and answered; nothing reaches a database. */
function fakeAdmin(profile) {
  const rows = { plan_grants: [] };
  const answer = (data) => ({ data, error: null });
  return {
    rows,
    profile,
    from(table) {
      const calls = [];
      const b = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") {
              return (ok, ko) => Promise.resolve().then(() => resolve()).then(ok, ko);
            }
            return (...args) => {
              calls.push({ method: String(prop), args });
              return b;
            };
          },
        },
      );
      const has = (m) => calls.some((c) => c.method === m);
      const arg = (m) => calls.find((c) => c.method === m)?.args;
      function resolve() {
        if (table === "profiles") {
          if (has("update")) {
            Object.assign(profile, arg("update")[0]);
            return answer(null);
          }
          return answer(has("maybeSingle") || has("single") ? profile : [profile]);
        }
        if (table === "plan_grants") {
          if (has("insert")) {
            // A real uuid: the Stripe idempotency key is `plan-grant:<id>`.
            const row = { id: randomUUID(), created_at: new Date().toISOString(), ...arg("insert")[0] };
            rows.plan_grants.push(row);
            return answer(has("single") ? { id: row.id } : [{ id: row.id }]);
          }
          if (has("update")) {
            const id = calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1];
            for (const row of rows.plan_grants) if (row.id === id) Object.assign(row, arg("update")[0]);
            return answer(null);
          }
          const byId = calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1];
          if (byId) return answer(rows.plan_grants.find((r) => r.id === byId) ?? null);
          const list = rows.plan_grants
            .filter((r) => !calls.some((c) => c.method === "eq" && c.args[0] === "status") || r.status === "applied")
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
          return answer(list);
        }
        return answer(has("maybeSingle") ? null : []);
      }
      return b;
    },
    rpc: async () => answer(null),
  };
}

async function prices() {
  const list = await stripe.prices.list({ lookup_keys: ["plus_monthly", "pro_monthly", "plus_annual"], active: true, limit: 10 });
  const by = Object.fromEntries(list.data.map((p) => [p.lookup_key, p]));
  if (!by.plus_monthly || !by.pro_monthly) {
    throw new Error("The sandbox catalog has no plus_monthly / pro_monthly lookup key (docs/BILLING.md §2).");
  }
  return by;
}

class Clock {
  constructor(name, log) {
    this.name = name;
    this.log = log;
  }
  async start() {
    this.t0 = Math.floor(Date.now() / 1000);
    this.clock = await stripe.testHelpers.testClocks.create({ frozen_time: this.t0, name: `pipglyph free-days check: ${this.name}` });
    this.now = this.t0;
    return this;
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
  async customer() {
    const customer = await stripe.customers.create({
      test_clock: this.clock.id,
      email: `free-days-${this.name}@sandbox.pipglyph.test`,
      payment_method: "pm_card_visa",
      invoice_settings: { default_payment_method: "pm_card_visa" },
    });
    return customer;
  }
  async subscribe(customerId, priceId, extra = {}) {
    return stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      metadata: { supabase_user_id: USER },
      ...extra,
    });
  }
  async invoices(customerId) {
    const list = await stripe.invoices.list({ customer: customerId, limit: 20 });
    return list.data.sort((a, b) => a.created - b.created);
  }
  async stop() {
    if (this.clock) await stripe.testHelpers.testClocks.del(this.clock.id).catch(() => {});
  }
}

let failures = 0;
function check(ok, what) {
  console.log(`  ${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures += 1;
}
const near = (a, b, slack = 90) => Math.abs(a - b) <= slack;
const periodEnd = (sub) => sub.items.data[0].current_period_end;

function profileFor(customer, sub, status, tier, interval) {
  return {
    id: USER,
    is_admin: false,
    subscription_status: status,
    subscription_tier: tier,
    stripe_customer_id: customer.id,
    stripe_subscription_id: sub.id,
    comp_tier: null,
    comp_expires_at: null,
    billing_interval: interval,
  };
}

const by = await prices();
const PRO = by.pro_monthly;
const PLUS = by.plus_monthly;
const PLUS_YEAR = by.plus_annual;
console.log(`sandbox catalog: pro_monthly ${money(PRO.unit_amount)}, plus_monthly ${money(PLUS.unit_amount)}${PLUS_YEAR ? `, plus_annual ${money(PLUS_YEAR.unit_amount)}` : ""}`);

// --- 1. the owner's example ---------------------------------------------------
{
  const clock = await new Clock("monthly-hold", console.log).start();
  try {
    console.log("\n1. Monthly Pro paid on day 0; 30 free days on day 5 → charged on day 60, not day 30");
    const customer = await clock.customer();
    let sub = await clock.subscribe(customer.id, PRO.id);
    const firstEnd = periodEnd(sub);
    check(sub.status === "active" && near(firstEnd, clock.t0 + 30 * DAY, 2 * DAY), `active, period ends ${iso(firstEnd)}`);
    const admin = fakeAdmin(profileFor(customer, sub, "active", "pro", "month"));
    await clock.advance(clock.t0 + 5 * DAY, "day 5");
    const stripeAt = new Stripe(KEY, { apiVersion: "2026-05-27.dahlia", maxNetworkRetries: 2 });
    const result = await apply.grantFreeDays(admin, { userId: USER, tier: "pro", units: 1, source: "comp", grantedBy: null, note: "sandbox" }, { stripe: stripeAt, now: new Date(clock.now * 1000) });
    check(result.ok === true, `grantFreeDays: ${result.ok ? result.note : result.error}`);
    sub = await stripe.subscriptions.retrieve(sub.id);
    check(sub.status === "trialing" && sub.trial_end === firstEnd + 30 * DAY, `Stripe: trialing until ${iso(sub.trial_end)} = period end + 30 d`);
    check(sub.metadata[compStripe.TRIAL_END_BEFORE_COMP_KEY] === String(firstEnd), "metadata keeps the pre-hold end");
    check(admin.profile.comp_tier === "pro" && admin.profile.comp_expires_at === iso(sub.trial_end), "overlay written to the same instant");
    check(admin.rows.plan_grants[0]?.status === "applied" && admin.rows.plan_grants[0]?.applied_as === "subscription_hold", "grant row applied as subscription_hold");

    // Stripe issues a $0 invoice the moment a trial is added to a running
    // subscription (the cycle resets to the trial): expected, no money.
    let inv = await clock.invoices(customer.id);
    const zero = inv.filter((i) => i.amount_paid === 0 && i.amount_due === 0);
    check(zero.length === 1 && inv.filter((i) => i.amount_paid > 0).length === 1, `one $0 invoice for the hold itself, still one paid (${inv.map((i) => money(i.amount_paid)).join(", ")})`);

    await clock.advance(firstEnd + DAY, "day 31: the old billing day has passed");
    inv = await clock.invoices(customer.id);
    check(inv.filter((i) => i.amount_paid > 0).length === 1, `still ONE paid invoice (${inv.map((i) => money(i.amount_paid)).join(", ")}) — nothing charged on the old day`);

    await clock.advance(firstEnd + 30 * DAY + 2 * 3600, "day 60 + 2 h: the free days are over");
    inv = await clock.invoices(customer.id);
    const paid = inv.filter((i) => i.amount_paid > 0);
    const second = paid[1];
    check(paid.length === 2 && second?.amount_paid === PRO.unit_amount && second.status === "paid", `second paid invoice: ${second ? money(second.amount_paid) : "none"} ${second?.status ?? ""} on ${second ? iso(second.created) : "—"}`);
    check(second && near(second.created, firstEnd + 30 * DAY, 2 * 3600), "charged at the moved date (period end + 30 d)");
    sub = await stripe.subscriptions.retrieve(sub.id);
    check(sub.status === "active" && near(periodEnd(sub), firstEnd + 60 * DAY, 2 * DAY), `then monthly from there: next period end ${iso(periodEnd(sub))}`);
  } finally {
    await clock.stop();
  }
}

// --- 2. a card-backed trial ---------------------------------------------------
{
  const clock = await new Clock("trial-hold", console.log).start();
  try {
    console.log("\n2. A 7-day card-backed trial; 30 free days on day 2 → charged on day 37");
    const customer = await clock.customer();
    let sub = await clock.subscribe(customer.id, PLUS.id, { trial_period_days: 7, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } });
    const trialEnd = sub.trial_end;
    const admin = fakeAdmin(profileFor(customer, sub, "trialing", "plus", "month"));
    await clock.advance(clock.t0 + 2 * DAY, "day 2");
    const result = await apply.grantFreeDays(admin, { userId: USER, tier: "plus", units: 1, source: "comp", grantedBy: null, note: null }, { stripe, now: new Date(clock.now * 1000) });
    check(result.ok === true, `grantFreeDays: ${result.ok ? result.note : result.error}`);
    sub = await stripe.subscriptions.retrieve(sub.id);
    check(sub.trial_end === trialEnd + 30 * DAY, `trial now ends ${iso(sub.trial_end)} = its own end + 30 d`);
    await clock.advance(trialEnd + DAY, "day 8: the old trial end has passed");
    let inv = await clock.invoices(customer.id);
    check(inv.every((i) => i.amount_paid === 0), `no charge on the old trial end (${inv.length} $0 invoice(s))`);
    await clock.advance(trialEnd + 30 * DAY + 2 * 3600, "day 37 + 2 h");
    inv = await clock.invoices(customer.id);
    const paid = inv.find((i) => i.amount_paid > 0);
    check(paid?.amount_paid === PLUS.unit_amount && near(paid.created, trialEnd + 30 * DAY, 2 * 3600), `first charge ${paid ? money(paid.amount_paid) : "none"} on ${paid ? iso(paid.created) : "—"}`);
  } finally {
    await clock.stop();
  }
}

// --- 3. an annual plan --------------------------------------------------------
if (PLUS_YEAR) {
  const clock = await new Clock("annual-hold", console.log).start();
  try {
    console.log("\n3. An annual Plus plan; 30 free days → the renewal moves by 30 days (asserted on the subscription)");
    const customer = await clock.customer();
    let sub = await clock.subscribe(customer.id, PLUS_YEAR.id);
    const yearEnd = periodEnd(sub);
    const admin = fakeAdmin(profileFor(customer, sub, "active", "plus", "year"));
    const result = await apply.grantFreeDays(admin, { userId: USER, tier: "plus", units: 1, source: "comp", grantedBy: null, note: null }, { stripe, now: new Date(clock.now * 1000) });
    check(result.ok === true, `grantFreeDays: ${result.ok ? result.note : result.error}`);
    sub = await stripe.subscriptions.retrieve(sub.id);
    check(sub.status === "trialing" && sub.trial_end === yearEnd + 30 * DAY, `renewal moved to ${iso(sub.trial_end)} = year end + 30 d`);
    const inv = await clock.invoices(customer.id);
    const paidInv = inv.filter((i) => i.amount_paid > 0);
    check(paidInv.length === 1 && paidInv[0].amount_paid === PLUS_YEAR.unit_amount && inv.every((i) => i.amount_paid > 0 || i.amount_due === 0), `nothing charged or credited (${inv.map((i) => money(i.amount_paid)).join(", ")}; the $0 one is the hold's own)`);
    const plan = freeDays.planFreeDays({ profile: admin.profile, sub, subscribedTier: "plus", tier: "plus", units: 1, now: new Date(clock.now * 1000) });
    check(plan.kind === "hold" && plan.startsAt === sub.trial_end, "a second grant would stack on the moved end");
  } finally {
    await clock.stop();
  }
} else {
  console.log("\n3. (skipped: no plus_annual lookup key in the sandbox catalog)");
}

// --- 4. revoke ----------------------------------------------------------------
{
  const clock = await new Clock("monthly-revoke", console.log).start();
  try {
    console.log("\n4. Scenario 1 revoked on day 10 → charged on day 30 after all");
    const customer = await clock.customer();
    let sub = await clock.subscribe(customer.id, PRO.id);
    const firstEnd = periodEnd(sub);
    const admin = fakeAdmin(profileFor(customer, sub, "active", "pro", "month"));
    await clock.advance(clock.t0 + 5 * DAY, "day 5");
    const granted = await apply.grantFreeDays(admin, { userId: USER, tier: "pro", units: 1, source: "comp", grantedBy: null, note: null }, { stripe, now: new Date(clock.now * 1000) });
    check(granted.ok === true, `grantFreeDays: ${granted.ok ? granted.note : granted.error}`);
    admin.profile.subscription_status = "trialing";
    await clock.advance(clock.t0 + 10 * DAY, "day 10");
    const revoked = await apply.revokeFreeDays(admin, { grantId: granted.grantId, revokedBy: null }, { stripe, now: new Date(clock.now * 1000) });
    check(revoked.ok === true, `revokeFreeDays: ${revoked.ok ? revoked.note : revoked.error}`);
    sub = await stripe.subscriptions.retrieve(sub.id);
    // Stripe drops a metadata key written as "".
    check(sub.trial_end === firstEnd && !sub.metadata[compStripe.TRIAL_END_BEFORE_COMP_KEY], `trial back on ${iso(sub.trial_end)}, metadata cleared`);
    check(admin.profile.comp_tier == null && admin.rows.plan_grants[0]?.status === "revoked", "overlay cleared, row revoked");
    await clock.advance(firstEnd + 2 * 3600, "day 30 + 2 h");
    const inv = await clock.invoices(customer.id);
    const second = inv.filter((i) => i.amount_paid > 0)[1];
    check(second?.amount_paid === PRO.unit_amount && near(second.created, firstEnd, 2 * 3600), `charged ${second ? money(second.amount_paid) : "nothing"} on the original day`);
  } finally {
    await clock.stop();
  }
}

console.log(failures === 0 ? "\nAll free-days scenarios passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
