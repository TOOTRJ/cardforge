#!/usr/bin/env node
// ---------------------------------------------------------------------------
// The monthly comp coupon (TODO BL1) against the Stripe SANDBOX, on test
// clocks: the SAME functions the admin's comp action calls
// (`applyCompToSubscription`, `releaseScheduleForCompChange` in
// lib/billing/comp-stripe-apply.ts), loaded from lib/ in-process, and every
// invoice's amount asserted. docs/BILLING.md "The sandbox test-clock check".
//
//   node --env-file=.env.local scripts/stripe-sandbox-comp-check.mjs
//   (npm run stripe:sandbox-comp-check)
//
// Reads ONE variable, STRIPE_TEST_KEY — a sandbox key (sk_test_… / rk_test_…),
// checked BEFORE anything else and never printed. Every other STRIPE_*,
// Supabase or secret-looking variable is dropped from this process before
// the app's code is loaded, so nothing here can reach a live key or a
// database. Each scenario's test clock (and with it its customer and
// subscription) is deleted in `finally`. The comp coupons it makes
// (`pipglyph_comp_100off_<N>m`) are the app's own deterministic sandbox
// coupons and are left for reuse. Exit 1 on any wrong amount.
// ---------------------------------------------------------------------------

import path from "node:path";
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
const apply = await load("lib/billing/comp-stripe-apply.ts");
const compStripe = await load("lib/billing/comp-stripe.ts");
const balance = await load("lib/billing/balance-credit.ts");
const coupon = await load("lib/billing/comp-coupon.ts");

const stripe = new Stripe(KEY, { apiVersion: "2026-05-27.dahlia", maxNetworkRetries: 2 });

// --- helpers -----------------------------------------------------------------

/** An error as one printable line — with anything key-shaped scrubbed
 *  (Stripe's own messages echo a masked key with its last characters). */
const safeMessage = (error) =>
  String(error instanceof Error ? error.message : error).replace(/\b(sk|rk|pk)_(test|live)_[*A-Za-z0-9]+/g, "[key]");

// The app's own code logs Stripe errors with console.warn / console.error:
// the same scrub, and one line per error (never a stack with request data).
for (const level of ["warn", "error"]) {
  const write = console[level].bind(console);
  console[level] = (...args) => write(...args.map((a) => (typeof a === "string" || a instanceof Error ? safeMessage(a) : a)));
}
process.on("unhandledRejection", (error) => {
  console.error(`Stopped: ${safeMessage(error)}`);
  process.exit(1);
});

const HOUR = 3600;
const DAY = 86400;
const iso = (sec) => new Date(sec * 1000).toISOString();
const monthsAfter = (sec, n) => Math.floor(balance.addMonthsUtc(sec * 1000, n) / 1000);
const money = (cents) => `$${(cents / 100).toFixed(2)}`;

/** The admin client the apply functions read the profile through — the
 *  profile row only; every write (the trial path's profile resync) is a
 *  no-op. No database is touched. */
function fakeAdmin(profile) {
  const answer = (data) => ({ data, error: null });
  return {
    from(table) {
      let writing = false;
      const b = {
        select: () => b,
        eq: () => b,
        neq: () => b,
        in: () => b,
        is: () => b,
        gte: () => b,
        lte: () => b,
        order: () => b,
        limit: () => b,
        update: () => ((writing = true), b),
        insert: () => ((writing = true), b),
        upsert: () => ((writing = true), b),
        delete: () => ((writing = true), b),
        maybeSingle: async () => answer(table === "profiles" && !writing ? profile : null),
        single: async () => answer(table === "profiles" && !writing ? profile : null),
        then: (ok, ko) => Promise.resolve(answer(table === "profiles" && !writing ? [profile] : null)).then(ok, ko),
      };
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
    this.clock = await stripe.testHelpers.testClocks.create({ frozen_time: this.t0, name: `pipglyph comp check: ${this.name}` });
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
  async delete() {
    if (this.clock) await stripe.testHelpers.testClocks.del(this.clock.id);
  }
}

async function customerWithCard(clock) {
  const customer = await stripe.customers.create({
    test_clock: clock.clock.id,
    name: `PipGlyph comp check (${clock.name})`,
    metadata: { pipglyph_sandbox_check: "comp" },
  });
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  return { customer, pm };
}

async function invoicesOf(subId) {
  const list = await stripe.invoices.list({ subscription: subId, limit: 100 });
  return list.data.sort((a, b) => a.created - b.created);
}

function printInvoices(log, invoices, t0) {
  invoices.forEach((inv, i) => {
    const day = Math.round((inv.created - t0) / DAY);
    log(
      `  invoice ${i + 1}: day ${String(day).padStart(3)}  ${inv.billing_reason?.padEnd(20) ?? ""}  ` +
        `total ${money(inv.total).padStart(7)}  credit on balance ${money(Math.max(0, -(inv.starting_balance ?? 0))).padStart(7)}  ` +
        `charged ${money(inv.amount_due).padStart(7)}  ${inv.status}`,
    );
  });
}

/** Assert the invoices' charged amounts (amount_due) and that each is paid. */
function expectAmounts(result, invoices, expected) {
  const got = invoices.map((i) => i.amount_due);
  const ok = got.length === expected.length && got.every((v, i) => v === expected[i]);
  const unpaid = invoices.filter((i) => i.status !== "paid");
  result.amounts = got;
  result.expected = expected;
  if (!ok) result.errors.push(`charged ${got.map(money).join(", ")} — expected ${expected.map(money).join(", ")}`);
  if (unpaid.length) result.errors.push(`${unpaid.length} invoice(s) not paid: ${unpaid.map((i) => i.status).join(", ")}`);
}

function check(result, cond, what) {
  if (!cond) result.errors.push(what);
}

// --- scenarios ---------------------------------------------------------------

/** 1. A 3-month comp on a monthly Plus plan, saved a day into the period. */
async function compOverPeriods(ctx) {
  const { clock, price, log, result } = ctx;
  const { customer, pm } = await customerWithCard(clock);
  const sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.plus_monthly.id }], default_payment_method: pm.id });
  const profile = { stripe_customer_id: customer.id, stripe_subscription_id: sub.id, subscription_tier: "plus", subscription_status: "active" };
  const admin = fakeAdmin(profile);
  await clock.advance(clock.t0 + DAY, "one day into the period");
  const comp = { tier: "plus", expiresAt: iso(monthsAfter(clock.now, 3)) };
  const out = await apply.applyCompToSubscription(admin, "sandbox-user", comp, { stripe, now: new Date(clock.now * 1000) });
  log(`  comp saved (3 months): ${out.note}`);
  check(result, !out.failed && out.coupon?.change.kind === "apply", `the comp did not attach a coupon (${out.coupon?.change.kind ?? "none"})`);
  const again = await apply.applyCompToSubscription(admin, "sandbox-user", comp, { stripe, now: new Date(clock.now * 1000) });
  check(result, !again.failed && again.coupon?.change.kind !== "apply", "a re-save attached a second coupon");
  const read = await stripe.subscriptions.retrieve(sub.id, { expand: ["discounts"] });
  check(result, coupon.compDiscountsOf(read).length === 1, `expected ONE comp discount, found ${coupon.compDiscountsOf(read).length}`);
  for (let k = 1; k <= 4; k++) await clock.advance(monthsAfter(clock.t0, k) + 2 * HOUR, `renewal ${k} + 2h`);
  const invoices = await invoicesOf(sub.id);
  printInvoices(log, invoices, clock.t0);
  const P = price.plus_monthly.unit_amount;
  expectAmounts(result, invoices, [P, 0, 0, 0, P]);
}

/** 2. The same comp, revoked after the first free renewal. */
async function revokeMidway(ctx) {
  const { clock, price, log, result } = ctx;
  const { customer, pm } = await customerWithCard(clock);
  const sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.plus_monthly.id }], default_payment_method: pm.id });
  const profile = { stripe_customer_id: customer.id, stripe_subscription_id: sub.id, subscription_tier: "plus", subscription_status: "active" };
  const admin = fakeAdmin(profile);
  await clock.advance(clock.t0 + DAY, "one day into the period");
  const comp = { tier: "plus", expiresAt: iso(monthsAfter(clock.now, 3)) };
  const out = await apply.applyCompToSubscription(admin, "sandbox-user", comp, { stripe, now: new Date(clock.now * 1000) });
  log(`  comp saved (3 months): ${out.note}`);
  check(result, out.coupon?.change.kind === "apply", "the comp did not attach a coupon");
  await clock.advance(monthsAfter(clock.t0, 1) + 2 * HOUR, "renewal 1 + 2h");
  const revoke = await apply.applyCompToSubscription(admin, "sandbox-user", { tier: null, expiresAt: null }, { stripe, now: new Date(clock.now * 1000) });
  log(`  comp REVOKED: ${revoke.note}`);
  check(result, !revoke.failed && revoke.coupon?.change.kind === "remove", `the revoke did not remove the coupon (${revoke.coupon?.change.kind ?? "none"})`);
  for (let k = 2; k <= 3; k++) await clock.advance(monthsAfter(clock.t0, k) + 2 * HOUR, `renewal ${k} + 2h`);
  const invoices = await invoicesOf(sub.id);
  printInvoices(log, invoices, clock.t0);
  const P = price.plus_monthly.unit_amount;
  expectAmounts(result, invoices, [P, 0, P, P]);
}

/** 3. A comp saved while a Pro → Plus downgrade is scheduled. */
async function compWithScheduledDowngrade(ctx) {
  const { clock, price, log, result } = ctx;
  const { customer, pm } = await customerWithCard(clock);
  const sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.pro_monthly.id }], default_payment_method: pm.id });
  // The downgrade as lib/stripe/actions.ts scheduleDowngrade makes it.
  const schedule = await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
  const current = schedule.phases[0];
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    phases: [
      {
        start_date: current.start_date,
        end_date: current.end_date,
        items: current.items.map((it) => ({ price: typeof it.price === "string" ? it.price : it.price.id, quantity: it.quantity ?? 1 })),
      },
      { items: [{ price: price.plus_monthly.id, quantity: 1 }], duration: { interval: "month", interval_count: 1 }, proration_behavior: "none" },
    ],
  });
  log(`  downgrade to Plus scheduled (${schedule.id})`);
  const profile = { stripe_customer_id: customer.id, stripe_subscription_id: sub.id, subscription_tier: "pro", subscription_status: "active" };
  const admin = fakeAdmin(profile);
  await clock.advance(clock.t0 + DAY, "one day into the period");
  // The admin action's order: release FIRST, the comp only if it worked.
  // A comp BELOW the plan puts nothing on Stripe: the user's own change stays (P2).
  const below = await apply.releaseScheduleForCompChange(
    admin,
    "sandbox-user",
    { tier: "plus", expiresAt: iso(monthsAfter(clock.now, 2)) },
    { stripe, now: new Date(clock.now * 1000) },
  );
  check(result, below.ok && below.cancelled == null, "a comp below the plan released the user's scheduled change");
  const kept = await stripe.subscriptions.retrieve(sub.id);
  check(result, kept.schedule != null, "the schedule is gone after a comp that holds nothing");
  const comp = { tier: "pro", expiresAt: iso(monthsAfter(clock.now, 2)) };
  const release = await apply.releaseScheduleForCompChange(admin, "sandbox-user", comp, { stripe, now: new Date(clock.now * 1000) });
  log(`  release: ${release.ok ? release.note : `REFUSED — ${release.error}`}`);
  check(
    result,
    release.ok && release.cancelled === "Plus (monthly)" && /scheduled change to Plus \(monthly\) was cancelled/.test(release.note ?? ""),
    "the scheduled downgrade was not released with its note",
  );
  const out = await apply.applyCompToSubscription(admin, "sandbox-user", comp, { stripe, now: new Date(clock.now * 1000) });
  log(`  comp saved (Pro, 2 months): ${out.note}`);
  check(result, out.coupon?.change.kind === "apply", "the comp did not attach a coupon");
  const read = await stripe.subscriptions.retrieve(sub.id);
  check(result, read.schedule == null, "the subscription still has a schedule");
  for (let k = 1; k <= 3; k++) await clock.advance(monthsAfter(clock.t0, k) + 2 * HOUR, `renewal ${k} + 2h`);
  const invoices = await invoicesOf(sub.id);
  printInvoices(log, invoices, clock.t0);
  const after = await stripe.subscriptions.retrieve(sub.id);
  check(result, after.items.data[0]?.price.id === price.pro_monthly.id, "the plan moved off Pro (the released downgrade ran)");
  const P = price.pro_monthly.unit_amount;
  expectAmounts(result, invoices, [P, 0, 0, P]);
}

/** 4. A comp on a card-backed TRIAL: the trial is held to the comp's end. */
async function trialing(ctx) {
  const { clock, price, log, result } = ctx;
  const { customer, pm } = await customerWithCard(clock);
  const sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: price.plus_monthly.id }],
    default_payment_method: pm.id,
    trial_period_days: 7,
  });
  const profile = { stripe_customer_id: customer.id, stripe_subscription_id: sub.id, subscription_tier: "plus", subscription_status: "trialing" };
  const admin = fakeAdmin(profile);
  await clock.advance(clock.t0 + DAY, "trial day 1");
  const compEnd = monthsAfter(clock.now, 1);
  const out = await apply.applyCompToSubscription(admin, "sandbox-user", { tier: "plus", expiresAt: iso(compEnd) }, { stripe, now: new Date(clock.now * 1000) });
  log(`  comp saved (1 month): ${out.note ?? "—"}  trial end → ${out.trialEnd}`);
  check(result, !out.failed && out.trialEnd != null && Math.abs(Date.parse(out.trialEnd) / 1000 - compEnd) < 60, "the trial was not held to the comp's end");
  await clock.advance(clock.t0 + 8 * DAY, "past the 7-day trial's own end");
  const mid = await stripe.subscriptions.retrieve(sub.id);
  check(result, mid.status === "trialing", `the subscription is ${mid.status} on day 8 (expected still trialing)`);
  await clock.advance(compEnd + 2 * HOUR, "the comp's end + 2h");
  await clock.advance(monthsAfter(compEnd, 1) + 2 * HOUR, "one month later + 2h");
  const invoices = await invoicesOf(sub.id);
  printInvoices(log, invoices, clock.t0);
  const P = price.plus_monthly.unit_amount;
  // The trial's own $0 invoice, Stripe's $0 `subscription_update` invoice
  // for the moved trial end (seen in the first run), then the first charge
  // at the comp's end and the next renewal.
  check(result, invoices[1]?.billing_reason === "subscription_update", "no $0 invoice for the moved trial end");
  expectAmounts(result, invoices, [0, 0, P, P]);
}

/** 5. A #688 balance credit already on a monthly plan (made before BL1),
 *  the comp re-saved INSIDE the renewal's draft window (the P1 scenario):
 *  it must stay a credit and run out untouched — nothing clawed back. */
async function preexisting688Credit(ctx) {
  const { clock, price, log, result } = ctx;
  const { customer, pm } = await customerWithCard(clock);
  const sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.plus_monthly.id }], default_payment_method: pm.id });
  const profile = { stripe_customer_id: customer.id, stripe_subscription_id: sub.id, subscription_tier: "plus", subscription_status: "active" };
  const admin = fakeAdmin(profile);
  await clock.advance(clock.t0 + DAY, "one day into the period");
  const comp = { tier: "plus", expiresAt: iso(monthsAfter(clock.now, 3)) };
  // #688's credit, written exactly as its settleCredit did: the grant named
  // on the subscription, then ONE balance transaction under its ledger key.
  const live = await stripe.subscriptions.retrieve(sub.id);
  const change = compStripe.compCreditChangeFor({ sub: live, subscribedTier: "plus", comp, now: new Date(clock.now * 1000) });
  if (change.kind !== "settle") throw new Error(`could not model the #688 credit (${change.reason})`);
  await stripe.subscriptions.update(sub.id, { metadata: { [compStripe.COMP_CREDIT_GRANT_KEY]: change.grantMeta } });
  const cents = balance.periodCreditCents({ price: live.items.data[0].price, tier: "plus", startSec: change.grant.startSec, endSec: change.coverUntilSec });
  const ledgerKey = compStripe.compCreditLedgerKey(sub.id, change.grant);
  await balance.creditCustomerBalance(stripe, {
    customerId: customer.id,
    cents,
    currency: live.items.data[0].price.currency,
    description: "PipGlyph complimentary plan — the comp period is free",
    metadata: { [compStripe.COMP_CREDIT_LEDGER_KEY]: ledgerKey, supabase_user_id: "sandbox-user", kind: "comp_credit" },
    idempotencyKey: `${ledgerKey}:0->${cents}:credit`,
  });
  log(`  #688 credit posted: ${money(cents)} for 3 months`);
  await clock.advance(monthsAfter(clock.t0, 1) + 5 * 60, "renewal 1 + 5 min — the renewal is a DRAFT");
  const draft = (await invoicesOf(sub.id)).at(-1);
  log(`  renewal 1 invoice is ${draft?.status} when the comp is re-saved`);
  const resave = await apply.applyCompToSubscription(admin, "sandbox-user", comp, { stripe, now: new Date(clock.now * 1000) });
  log(`  comp re-saved: ${resave.note ?? "—"}`);
  check(result, !resave.failed && resave.credit != null && resave.credit.postedCents === 0, `the re-save moved money (${resave.credit?.postedCents ?? "no credit path"})`);
  check(result, resave.coupon == null, "the re-save attached a coupon to a #688 credit");
  const afterResave = await stripe.customers.retrieve(customer.id);
  check(result, afterResave.balance === -cents, `the balance is ${money(-afterResave.balance)}, expected ${money(cents)} (a claw-back?)`);
  await clock.advance(monthsAfter(clock.t0, 1) + 2 * HOUR, "renewal 1 + 2h (finalized)");
  for (let k = 2; k <= 4; k++) await clock.advance(monthsAfter(clock.t0, k) + 2 * HOUR, `renewal ${k} + 2h`);
  const invoices = await invoicesOf(sub.id);
  printInvoices(log, invoices, clock.t0);
  const txns = await stripe.customers.listBalanceTransactions(customer.id, { limit: 100 });
  const clawbacks = txns.data.filter((t) => t.metadata?.kind === "comp_clawback");
  check(result, clawbacks.length === 0, `${clawbacks.length} claw-back transaction(s) posted`);
  const P = price.plus_monthly.unit_amount;
  check(result, cents === 3 * P, `the 3-month credit was ${money(cents)}, expected ${money(3 * P)}`);
  expectAmounts(result, invoices, [P, 0, 0, 0, P]);
}

/** A monthly Plus plan with a comp of one month + 16 days saved a day in:
 *  the 15-day round-up makes it a 2-month coupon that outlives the comp. */
async function roundedUpComp(ctx) {
  const { clock, price, log, result } = ctx;
  const { customer, pm } = await customerWithCard(clock);
  const sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.plus_monthly.id }], default_payment_method: pm.id });
  const profile = { stripe_customer_id: customer.id, stripe_subscription_id: sub.id, subscription_tier: "plus", subscription_status: "active" };
  const admin = fakeAdmin(profile);
  await clock.advance(clock.t0 + DAY, "one day into the period");
  const firstEnd = monthsAfter(clock.now, 1) + 16 * DAY;
  const first = await apply.applyCompToSubscription(admin, "sandbox-user", { tier: "plus", expiresAt: iso(firstEnd) }, {
    stripe,
    now: new Date(clock.now * 1000),
  });
  log(`  comp 1 saved (1 month + 16 days → ${first.coupon?.change.couponMonths ?? "?"} months): ${first.note}`);
  check(result, first.coupon?.change.kind === "apply" && first.coupon.change.couponMonths === 2, "comp 1 did not attach a 2-month coupon");
  await clock.advance(monthsAfter(clock.t0, 1) + 2 * HOUR, "renewal 1 + 2h");
  // Two days after comp 1 ended: its coupon still covers renewal 2.
  await clock.advance(firstEnd + 2 * DAY, "comp 1 ended two days ago; its coupon still runs");
  return { sub, admin };
}

/** 6. STACKING (finding P2): a second comp over the first's rounded-up tail
 *  frees the UNION — renewal 2 once — never one invoice more. */
async function stacking(ctx) {
  const { clock, price, log, result } = ctx;
  const { sub, admin } = await roundedUpComp(ctx);
  const second = await apply.applyCompToSubscription(admin, "sandbox-user", { tier: "plus", expiresAt: iso(monthsAfter(clock.now, 1)) }, {
    stripe,
    now: new Date(clock.now * 1000),
  });
  log(`  comp 2 saved (1 month): ${second.note}`);
  check(result, second.coupon?.change.kind === "apply" && second.coupon.change.couponMonths === 1, `comp 2's coupon was ${second.coupon?.change.couponMonths ?? "?"} months, expected 1 (the union)`);
  for (let k = 2; k <= 3; k++) await clock.advance(monthsAfter(clock.t0, k) + 2 * HOUR, `renewal ${k} + 2h`);
  const invoices = await invoicesOf(sub.id);
  printInvoices(log, invoices, clock.t0);
  const P = price.plus_monthly.unit_amount;
  expectAmounts(result, invoices, [P, 0, 0, P]);
}

/** 7. A comp CLEARED during its rounded-up tail (finding P1): the tail comes
 *  off — the next renewal is charged. */
async function clearedTail(ctx) {
  const { clock, price, log, result } = ctx;
  const { sub, admin } = await roundedUpComp(ctx);
  const cleared = await apply.applyCompToSubscription(admin, "sandbox-user", { tier: null, expiresAt: null }, {
    stripe,
    now: new Date(clock.now * 1000),
  });
  log(`  comp CLEARED during the tail: ${cleared.note}`);
  check(result, !cleared.failed && cleared.coupon?.change.kind === "remove", `the clear did not remove the tail (${cleared.coupon?.change.kind ?? "none"})`);
  await clock.advance(monthsAfter(clock.t0, 2) + 2 * HOUR, "renewal 2 + 2h");
  const invoices = await invoicesOf(sub.id);
  printInvoices(log, invoices, clock.t0);
  const P = price.plus_monthly.unit_amount;
  expectAmounts(result, invoices, [P, 0, P]);
}

/** A client whose FIRST subscription read answers `stale` (a read made
 *  before another apply wrote) — every other call is the real one. */
function staleOnce(stale) {
  let used = false;
  const subs = new Proxy(stripe.subscriptions, {
    get(target, prop) {
      if (prop === "retrieve") {
        return async (...args) => {
          if (!used) {
            used = true;
            return stale;
          }
          return target.retrieve(...args);
        };
      }
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return new Proxy(stripe, {
    get(target, prop) {
      if (prop === "subscriptions") return subs;
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/** The comp's balance transactions on a customer (credits < 0). */
async function compLedgerOf(customerId) {
  const list = await stripe.customers.listBalanceTransactions(customerId, { limit: 100 });
  return list.data.filter((t) => t.metadata?.[compStripe.COMP_CREDIT_LEDGER_KEY]);
}

/** 8. ANNUAL plan: two applies of the same comp racing (round-3 item 3) —
 *  at once (an admin save beside the webhook's re-apply), and seconds apart
 *  from one stale read. Each must credit the period ONCE. */
async function creditRace(ctx) {
  const { clock, price, log, result } = ctx;
  if (!price.plus_annual) throw new Error("The sandbox catalog has no plus_annual lookup key (docs/BILLING.md §2).");
  const comp = { tier: "plus", expiresAt: iso(clock.now + 60 * DAY) };
  for (const mode of ["concurrent", "stale read, 4 s apart"]) {
    const { customer, pm } = await customerWithCard(clock);
    const sub = await stripe.subscriptions.create({ customer: customer.id, items: [{ price: price.plus_annual.id }], default_payment_method: pm.id });
    const profile = { stripe_customer_id: customer.id, stripe_subscription_id: sub.id, subscription_tier: "plus", subscription_status: "active" };
    const admin = fakeAdmin(profile);
    const at = (dt) => new Date((clock.now + dt) * 1000);
    let outs;
    if (mode === "concurrent") {
      outs = await Promise.all([
        apply.applyCompToSubscription(admin, "sandbox-user", comp, { stripe, now: at(0) }),
        apply.applyCompToSubscription(admin, "sandbox-user", comp, { stripe, now: at(4) }),
      ]);
    } else {
      const before = await stripe.subscriptions.retrieve(sub.id, { expand: ["discounts"] });
      const a = await apply.applyCompToSubscription(admin, "sandbox-user", comp, { stripe, now: at(0) });
      const b = await apply.applyCompToSubscription(admin, "sandbox-user", comp, { stripe: staleOnce(before), now: at(4) });
      outs = [a, b];
    }
    const ledger = await compLedgerOf(customer.id);
    const credits = ledger.filter((t) => t.amount < 0);
    const read = await stripe.subscriptions.retrieve(sub.id);
    const target = balance.periodCreditCents({
      price: price.plus_annual,
      tier: "plus",
      startSec: compStripe.parseCompCreditGrant(read.metadata)?.startSec ?? clock.now,
      endSec: Math.floor(Date.parse(comp.expiresAt) / 1000),
    });
    log(
      `  ${mode}: ${outs.map((o) => (o.failed ? "failed" : `posted ${money(o.credit?.postedCents ?? 0)}`)).join(" | ")}; ` +
        `comp credits on the balance: ${credits.map((t) => money(-t.amount)).join(", ") || "none"} (period ${money(target)})`,
    );
    check(result, credits.length === 1, `${mode}: ${credits.length} comp credits posted — expected ONE`);
    check(result, credits.length !== 1 || -credits[0].amount === target, `${mode}: the credit is not the period's price`);
    check(result, outs.some((o) => !o.failed), `${mode}: neither apply succeeded`);
  }
}

/** Read-only: the sandbox's portal configurations — is there one with plan
 *  switching OFF (the owner step)? Never creates or changes one. */
async function portalConfigurations() {
  const list = await stripe.billingPortal.configurations.list({ limit: 100, active: true });
  const noSwitch = list.data.filter((c) => !c.features?.subscription_update?.enabled);
  const login = list.data.filter((c) => c.login_page?.enabled);
  console.log(
    `Sandbox portal configurations (active): ${list.data.length}; with plan switching OFF: ${
      noSwitch.length ? noSwitch.map((c) => `${c.id}${c.is_default ? " (default)" : ""}`).join(", ") : "none"
    }; with the no-code login page ON: ${login.length ? login.map((c) => `${c.id}${c.is_default ? " (default)" : ""}`).join(", ") : "none"}`,
  );
}

// --- run -----------------------------------------------------------------------

const SCENARIOS = [
  ["1. comp over 3 periods", compOverPeriods],
  ["2. revoke mid-way", revokeMidway],
  ["3. comp while a downgrade is scheduled", compWithScheduledDowngrade],
  ["4. comp on a trialing plan", trialing],
  ["5. a pre-existing #688 credit runs out untouched", preexisting688Credit],
  ["6. a second comp over the first's rounded-up tail (the union)", stacking],
  ["7. a comp cleared during its rounded-up tail", clearedTail],
  ["8. annual credit: two applies of one comp racing credit once", creditRace],
];

const only = process.argv.slice(2).map(Number).filter(Boolean);
let price;
try {
  price = await prices();
} catch (error) {
  console.error(`Couldn't read the sandbox catalog: ${safeMessage(error)}`);
  process.exit(1);
}
console.log(`Sandbox prices: Plus monthly ${money(price.plus_monthly.unit_amount)}, Pro monthly ${money(price.pro_monthly.unit_amount)}`);
try {
  await portalConfigurations();
} catch (error) {
  console.log(`(Couldn't list the portal configurations: ${safeMessage(error)})`);
}

const results = await Promise.all(
  SCENARIOS.filter((_, i) => !only.length || only.includes(i + 1)).map(async ([name, run]) => {
    const lines = [];
    const log = (line) => lines.push(line);
    const result = { name, errors: [], amounts: null, expected: null, lines };
    const clock = new Clock(name, log);
    try {
      await clock.start();
      await run({ clock, price, log, result });
    } catch (error) {
      result.errors.push(`crashed: ${safeMessage(error)}`);
    } finally {
      try {
        await clock.delete();
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
  for (const line of r.lines) console.log(line);
  if (r.amounts) console.log(`  charged per invoice: ${r.amounts.map(money).join(" → ")}`);
  for (const e of r.errors) console.log(`  ✗ ${e}`);
  if (r.errors.length) failures++;
}
console.log(`\n${failures ? `${failures} scenario(s) FAILED` : "All scenarios passed"}; test clocks deleted.`);
process.exit(failures ? 1 : 0);
