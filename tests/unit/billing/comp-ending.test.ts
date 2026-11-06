import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// "Your complimentary plan ends soon" (owner 2026-11-02): every comp, 7 days
// and 1 day before it ends — a comp_ending notification + an account email.
// lib/billing/comp-ending.ts decides; lib/billing/comp-ending-run.ts sends.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  resolveSubscriptionTier: vi.fn(),
  subscriptionHasPaymentMethod: vi.fn(),
  getRecipientFor: vi.fn(),
  sendEmail: vi.fn(),
  emailConfigured: true,
  billing: true,
  /** trial_ending rows the runner finds for a held trial's 1-day window. */
  trialRows: [] as Array<{ id: string; payload: Record<string, unknown> }>,
}));
vi.mock("@/lib/stripe/subscription-sync", () => ({
  resolveSubscriptionTier: h.resolveSubscriptionTier,
  subscriptionHasPaymentMethod: h.subscriptionHasPaymentMethod,
}));
vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => h.billing }));
vi.mock("@/lib/stripe/client", () => ({ getStripe: vi.fn(), isStripeConfigured: () => false }));
vi.mock("@/lib/email/preferences", () => ({ getRecipientFor: h.getRecipientFor }));
vi.mock("@/lib/email/send", () => ({
  isEmailConfigured: () => h.emailConfigured,
  sendEmail: h.sendEmail,
}));

import {
  compEndingDedupeKey,
  compEndingPlanFor,
  compEndingWindowOf,
  isCompHeldTrial,
} from "@/lib/billing/comp-ending";
import { sendCompEndingReminders } from "@/lib/billing/comp-ending-run";
import { TRIAL_END_BEFORE_COMP_KEY } from "@/lib/billing/comp-stripe";
import { describeNotification } from "@/lib/notifications/describe";
import { compEndingEmail, trialEndingEmail } from "@/lib/email/messages";

const NOW = new Date("2026-11-02T14:30:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);
const DAY = 86_400;
const iso = (s: number) => new Date(s * 1000).toISOString();
const IN_5D = iso(nowSec + 5 * DAY); // the 7-day window
const IN_12H = iso(nowSec + 12 * 3600); // the 1-day window
const sec = (v: string) => Math.floor(Date.parse(v) / 1000);

const PLUS_MONTHLY = { unit_amount: 600, currency: "usd", recurring: { interval: "month" } };
const sub = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  trial_end: null,
  cancel_at_period_end: false,
  cancel_at: null,
  metadata: {} as Record<string, string>,
  default_payment_method: { id: "pm_1", card: { last4: "4242" } },
  items: { data: [{ current_period_end: nowSec + 20 * DAY, price: PLUS_MONTHLY }] },
  ...over,
});
const heldTrial = (compEnd: string) =>
  sub({
    status: "trialing",
    trial_end: sec(compEnd),
    metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(nowSec - 2 * DAY) },
  });

// ---------------------------------------------------------------------------
describe("the windows, the dedupe key and the held-trial test", () => {
  it("7 days out → '7d'; 1 day out → '1d'; further, past or undated → none", () => {
    expect(compEndingWindowOf(iso(nowSec + 7 * DAY), NOW)).toBe("7d");
    expect(compEndingWindowOf(IN_5D, NOW)).toBe("7d");
    expect(compEndingWindowOf(iso(nowSec + DAY + 1), NOW)).toBe("7d");
    expect(compEndingWindowOf(iso(nowSec + DAY), NOW)).toBe("1d");
    expect(compEndingWindowOf(IN_12H, NOW)).toBe("1d");
    expect(compEndingWindowOf(iso(nowSec + 7 * DAY + 1), NOW)).toBeNull();
    expect(compEndingWindowOf(iso(nowSec - 1), NOW)).toBeNull(); // expired
    expect(compEndingWindowOf(null, NOW)).toBeNull(); // cleared / undated
    expect(compEndingWindowOf("not a date", NOW)).toBeNull();
  });
  it("one key per comp END per window — a re-dated comp gets fresh reminders", () => {
    expect(compEndingDedupeKey(IN_5D, "7d")).toBe(`comp_ending:${sec(IN_5D)}:7d`);
    expect(compEndingDedupeKey(IN_5D, "1d")).not.toBe(compEndingDedupeKey(IN_5D, "7d"));
    expect(compEndingDedupeKey(iso(sec(IN_5D) + DAY), "7d")).not.toBe(compEndingDedupeKey(IN_5D, "7d"));
  });
  it("a held trial: trialing, the pre-comp key set, its end the comp's end (± a minute)", () => {
    expect(isCompHeldTrial(heldTrial(IN_5D), IN_5D)).toBe(true);
    expect(isCompHeldTrial({ ...heldTrial(IN_5D), trial_end: sec(IN_5D) + 30 }, IN_5D)).toBe(true);
    expect(isCompHeldTrial({ ...heldTrial(IN_5D), metadata: {} }, IN_5D)).toBe(false); // an ordinary trial
    expect(isCompHeldTrial({ ...heldTrial(IN_5D), trial_end: sec(IN_5D) + 3 * DAY }, IN_5D)).toBe(false); // the 7-day trial outlasts it
    expect(isCompHeldTrial({ ...heldTrial(IN_5D), status: "active" }, IN_5D)).toBe(false);
    expect(isCompHeldTrial(heldTrial(IN_5D), null)).toBe(false);
  });
});

describe("what the end means — every user type × window", () => {
  const plan = (s: ReturnType<typeof sub> | null, window: "7d" | "1d", compEnd = window === "7d" ? IN_5D : IN_12H, subscribedTier: "plus" | "pro" | null = "plus") =>
    compEndingPlanFor({ compTier: "plus", compExpiresAt: compEnd, window, sub: s, subscribedTier });

  it.each(["7d", "1d"] as const)("FREE user (no live plan), %s: free", (w) => {
    expect(plan(null, w, undefined, null)).toEqual({ send: true, kind: "free" });
    expect(plan(sub({ status: "canceled" }), w)).toEqual({ send: true, kind: "free" });
  });
  it("comp-HELD trial: the 7-day reminder is sent; the 1-day stands down ONLY when the trial reminder went out", () => {
    expect(plan(heldTrial(IN_5D), "7d")).toEqual({ send: true, kind: "held_trial" });
    const oneDay = (trialReminderSent?: boolean) =>
      compEndingPlanFor({ compTier: "plus", compExpiresAt: IN_12H, window: "1d", sub: heldTrial(IN_12H), subscribedTier: "plus", trialReminderSent });
    expect(oneDay(true)).toEqual({ send: false, reason: "trial_reminder_covers" });
    // A comp re-dated to end within a day: Stripe may send no trial_will_end.
    expect(oneDay(false)).toEqual({ send: true, kind: "held_trial" });
    expect(oneDay(undefined)).toEqual({ send: true, kind: "held_trial" });
  });
  it("a next charge INSIDE the comp (the credit reduces it) is not named as 'after the comp'", () => {
    const early = sub({ items: { data: [{ current_period_end: nowSec + 2 * DAY, price: PLUS_MONTHLY }] } });
    expect(plan(early, "7d")).toEqual({ send: true, kind: "paying", nextChargeAt: null });
  });
  it.each(["7d", "1d"] as const)("PAYING user on a credit, %s: the next invoice as usual", (w) => {
    expect(plan(sub(), w)).toEqual({ send: true, kind: "paying", nextChargeAt: iso(nowSec + 20 * DAY) });
  });
  it("a trial that runs on past the comp: 'paying', the next charge at the trial's end", () => {
    const t = sub({ status: "trialing", trial_end: sec(IN_5D) + 3 * DAY });
    expect(plan(t, "7d")).toEqual({ send: true, kind: "paying", nextChargeAt: iso(sec(IN_5D) + 3 * DAY) });
  });
  it("a cancelled plan: past the comp → plan_ending; ending with it → free", () => {
    expect(plan(sub({ cancel_at_period_end: true }), "7d")).toEqual({
      send: true,
      kind: "plan_ending",
      planEndsAt: iso(nowSec + 20 * DAY),
    });
    expect(plan(sub({ cancel_at: sec(IN_5D) - DAY }), "7d")).toEqual({ send: true, kind: "free" });
  });
  it("a comp BELOW the plan paid for: nothing to say", () => {
    expect(plan(sub(), "7d", IN_5D, "pro")).toEqual({ send: false, reason: "comp_below_plan" });
  });
});

// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
function db(profiles: Row[], opts: { inserted?: Set<string> } = {}) {
  const seen = opts.inserted ?? new Set<string>();
  return chainClient((table, calls) => {
    if (table === "profiles") return { data: profiles };
    if (table === "notifications" && called(calls, "select")) return { data: h.trialRows };
    if (table === "notifications" && called(calls, "insert")) {
      const row = payloadOf(calls, "insert") as { recipient_id: string; payload: { dedupeKey: string } };
      const key = `${row.recipient_id}|${row.payload.dedupeKey}`;
      if (seen.has(key)) return { error: { message: "duplicate key", code: "23505" } };
      seen.add(key);
      return {};
    }
    return {};
  });
}
function stripeWith(s: Row | null) {
  return {
    subscriptions: { retrieve: vi.fn().mockResolvedValue(s) },
    customers: { retrieve: vi.fn().mockResolvedValue({ id: "cus_1", invoice_settings: { default_payment_method: { card: { last4: "1881" } } } }) },
  };
}
const profile = (over: Row = {}): Row => ({
  id: "u1",
  is_admin: false,
  comp_tier: "plus",
  comp_expires_at: IN_5D,
  subscription_status: null,
  stripe_subscription_id: null,
  ...over,
});
const inserts = (stub: ReturnType<typeof db>) =>
  stub.forTable("notifications").filter((e) => called(e.calls, "insert")).map((e) => payloadOf(e.calls, "insert") as { type: string; payload: Row });

beforeEach(() => {
  h.emailConfigured = true;
  h.billing = true;
  h.trialRows = [];
  h.subscriptionHasPaymentMethod.mockReset().mockResolvedValue(true);
  h.resolveSubscriptionTier.mockReset().mockResolvedValue("plus");
  h.getRecipientFor.mockReset().mockResolvedValue({ email: "u1@example.test", unsubscribeToken: "tok" });
  h.sendEmail.mockReset().mockResolvedValue({ ok: true, id: "em_1" });
});

describe("sendCompEndingReminders — the daily run", () => {
  it("reads only live comps ending inside the look-ahead (never expired, cleared or undated)", async () => {
    const stub = db([]);
    await sendCompEndingReminders(stub.client as never, { stripe: null, now: NOW });
    const read = stub.forTable("profiles")[0].calls;
    expect(called(read, "in", "comp_tier")).toBe(true);
    expect(read.find((c) => c.method === "gt")?.args).toEqual(["comp_expires_at", NOW.toISOString()]);
    expect(read.find((c) => c.method === "lte")?.args).toEqual(["comp_expires_at", iso(nowSec + 7 * DAY)]);
  });

  it.each([
    ["7d", IN_5D],
    ["1d", IN_12H],
  ])("FREE user, %s: notification + account email, keyed per comp per window", async (window, end) => {
    const stub = db([profile({ comp_expires_at: end })]);
    const out = await sendCompEndingReminders(stub.client as never, { stripe: null, now: NOW });
    expect(inserts(stub)).toEqual([
      expect.objectContaining({
        recipient_id: "u1",
        type: "comp_ending",
        payload: { dedupeKey: `comp_ending:${sec(end)}:${window}`, window, kind: "free", tier: "plus", expiresAt: end },
      }),
    ]);
    expect(h.sendEmail.mock.calls[0][0].html).toContain("/dashboard/billing");
    expect(h.sendEmail.mock.calls[0][0].html).not.toContain("/pricing");
    expect(inserts(stub)).toEqual([
      expect.objectContaining({
      }),
    ]);
    expect(h.getRecipientFor).toHaveBeenCalledWith(stub.client, "u1", "account");
    const [email, options] = h.sendEmail.mock.calls[0];
    expect(email.subject).toMatch(/^Your complimentary PipGlyph Plus ends /);
    expect(email.text).toContain("After that you'll be on Free");
    expect(options).toEqual({ idempotencyKey: `comp-ending:u1:comp_ending:${sec(end)}:${window}` });
    expect(out).toMatchObject({ checked: 1, notified: 1, emailed: 1 });
  });

  it("HELD trial, 7d: the card ending and the price, from Stripe's CURRENT subscription", async () => {
    const stripe = stripeWith(heldTrial(IN_5D));
    const stub = db([profile({ subscription_status: "trialing", stripe_subscription_id: "sub_1" })]);
    await sendCompEndingReminders(stub.client as never, { stripe: stripe as never, now: NOW });
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1", { expand: ["default_payment_method"] });
    expect(inserts(stub)[0].payload).toMatchObject({
      kind: "held_trial",
      subscribedTier: "plus",
      priceLabel: "$6 / month",
      cardLast4: "4242",
      hasPaymentMethod: true,
    });
    const email = h.sendEmail.mock.calls[0][0];
    expect(email.text).toContain("Your card ending ••4242 will be charged $6 / month then");
    expect(email.text).toContain("Cancel on the billing page before that date");
    expect(email.text).not.toMatch(/\btrial\b/i);
  });

  it("HELD trial, card only on the customer: its last four from the invoice default", async () => {
    const stripe = stripeWith({ ...heldTrial(IN_5D), default_payment_method: null });
    const stub = db([profile({ subscription_status: "trialing", stripe_subscription_id: "sub_1" })]);
    await sendCompEndingReminders(stub.client as never, { stripe: stripe as never, now: NOW });
    expect(inserts(stub)[0].payload).toMatchObject({ cardLast4: "1881" });
  });

  it("HELD trial, 1d: NO comp_ending — the 3-day trial reminder spoke for it (one email, not two)", async () => {
    h.trialRows = [{ id: "n_t", payload: { subscriptionId: "sub_1", trialEnd: IN_12H, compHold: true } }];
    const stripe = stripeWith(heldTrial(IN_12H));
    const stub = db([profile({ comp_expires_at: IN_12H, subscription_status: "trialing", stripe_subscription_id: "sub_1" })]);
    const out = await sendCompEndingReminders(stub.client as never, { stripe: stripe as never, now: NOW });
    expect(inserts(stub)).toEqual([]);
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(out).toMatchObject({ skipped: 1, notified: 0 });
    // It asked for THIS subscription's trial reminders.
    const read = stub.forTable("notifications").find((e) => called(e.calls, "select"))!.calls;
    expect(read.find((c) => c.method === "eq" && c.args[0] === "type")?.args).toEqual(["type", "trial_ending"]);
    expect(read.find((c) => c.method === "eq" && c.args[0] === "payload->>subscriptionId")?.args[1]).toBe("sub_1");
  });

  it("HELD trial, 1d, but NO trial reminder went out for this end (re-dated under a day): the 1-day comp_ending is sent", async () => {
    // A reminder for the OLD end, or a plain trial reminder, does not count.
    h.trialRows = [
      { id: "n_old", payload: { subscriptionId: "sub_1", trialEnd: IN_5D, compHold: true } },
      { id: "n_plain", payload: { subscriptionId: "sub_1", trialEnd: IN_12H } },
    ];
    const stripe = stripeWith(heldTrial(IN_12H));
    const stub = db([profile({ comp_expires_at: IN_12H, subscription_status: "trialing", stripe_subscription_id: "sub_1" })]);
    const out = await sendCompEndingReminders(stub.client as never, { stripe: stripe as never, now: NOW });
    expect(inserts(stub)[0].payload).toMatchObject({ kind: "held_trial", window: "1d" });
    expect(out).toMatchObject({ notified: 1, emailed: 1 });
  });

  it("HELD trial with NO card: says nothing is charged — the plan simply ends", async () => {
    h.subscriptionHasPaymentMethod.mockResolvedValue(false);
    const stripe = stripeWith({ ...heldTrial(IN_5D), default_payment_method: null });
    stripe.customers.retrieve.mockResolvedValue({ id: "cus_1", invoice_settings: { default_payment_method: null } });
    const stub = db([profile({ subscription_status: "trialing", stripe_subscription_id: "sub_1" })]);
    await sendCompEndingReminders(stub.client as never, { stripe: stripe as never, now: NOW });
    expect(inserts(stub)[0].payload).toMatchObject({ kind: "held_trial", hasPaymentMethod: false, cardLast4: null });
    const email = h.sendEmail.mock.calls[0][0];
    expect(email.text).toContain("There's no card on your account, so the plan simply ends then — nothing is charged.");
    expect(email.text).not.toMatch(/will be charged/);
  });

  it("a payer comped ABOVE their plan (Pro comp on Plus): told they go back to Plus at Plus's price", async () => {
    const stripe = stripeWith(sub());
    const stub = db([profile({ comp_tier: "pro", subscription_status: "active", stripe_subscription_id: "sub_1" })]);
    await sendCompEndingReminders(stub.client as never, { stripe: stripe as never, now: NOW });
    expect(inserts(stub)[0].payload).toMatchObject({ kind: "paying", tier: "pro", subscribedTier: "plus", priceLabel: "$6 / month" });
    const email = h.sendEmail.mock.calls[0][0];
    expect(email.subject).toMatch(/^Your complimentary PipGlyph Pro ends /);
    expect(email.text).toContain("and you go back to Plus ($6 / month).");
    expect(email.text).not.toMatch(/stay exactly as they are/);
  });

  it("a held Plus trial comped PRO: the comp names Pro, the charge is Plus's", async () => {
    const stripe = stripeWith(heldTrial(IN_5D));
    const stub = db([profile({ comp_tier: "pro", subscription_status: "trialing", stripe_subscription_id: "sub_1" })]);
    await sendCompEndingReminders(stub.client as never, { stripe: stripe as never, now: NOW });
    const email = h.sendEmail.mock.calls[0][0];
    expect(email.text).toContain("Your complimentary Pro period ends on");
    expect(email.text).toContain("After that you go back to Plus ($6 / month): your card ending ••4242 will be charged $6 / month then.");
    expect(email.text).not.toMatch(/Pro carries on/);
  });

  it("billing OFF: nothing is read or sent (the copy would be false)", async () => {
    h.billing = false;
    const stub = db([profile()]);
    const out = await sendCompEndingReminders(stub.client as never, { stripe: null, now: NOW });
    expect(out).toMatchObject({ disabled: true, checked: 0, notified: 0 });
    expect(stub.log).toEqual([]);
  });

  it.each([
    ["7d", IN_5D],
    ["1d", IN_12H],
  ])("PAYING user on a credit, %s: the next invoice date and price", async (window, end) => {
    const stripe = stripeWith(sub());
    const stub = db([profile({ comp_expires_at: end, subscription_status: "active", stripe_subscription_id: "sub_1" })]);
    await sendCompEndingReminders(stub.client as never, { stripe: stripe as never, now: NOW });
    expect(inserts(stub)[0].payload).toEqual({
      dedupeKey: `comp_ending:${sec(end)}:${window}`,
      window,
      kind: "paying",
      tier: "plus",
      subscribedTier: "plus",
      expiresAt: end,
      priceLabel: "$6 / month",
      nextChargeAt: iso(nowSec + 20 * DAY),
    });
    expect(h.sendEmail.mock.calls[0][0].text).toMatch(
      /Your next invoice, on .+, is charged as usual \(\$6 \/ month\)\./,
    );
  });

  it("DEDUPE: a second run the same day (or a later one in the same window) sends nothing", async () => {
    const inserted = new Set<string>();
    await sendCompEndingReminders(db([profile()], { inserted }).client as never, { stripe: null, now: NOW });
    h.sendEmail.mockClear();
    const again = db([profile()], { inserted });
    const out = await sendCompEndingReminders(again.client as never, { stripe: null, now: new Date(NOW.getTime() + 86_400_000) });
    expect(out).toMatchObject({ alreadySent: 1, notified: 0, emailed: 0 });
    expect(h.sendEmail).not.toHaveBeenCalled();
    // …and the 1-day window is its own reminder.
    const lastDay = db([profile()], { inserted });
    const later = await sendCompEndingReminders(lastDay.client as never, { stripe: null, now: new Date(Date.parse(IN_5D) - 3_600_000) });
    expect(later).toMatchObject({ notified: 1 });
  });

  it("a RE-DATED comp is reminded afresh (its end is in the key)", async () => {
    const inserted = new Set<string>();
    await sendCompEndingReminders(db([profile()], { inserted }).client as never, { stripe: null, now: NOW });
    const moved = iso(sec(IN_5D) + DAY);
    const out = await sendCompEndingReminders(db([profile({ comp_expires_at: moved })], { inserted }).client as never, {
      stripe: null,
      now: NOW,
    });
    expect(out).toMatchObject({ notified: 1, alreadySent: 0 });
  });

  it("an expired, cleared or undated comp — or an admin — is never told", async () => {
    const stub = db([
      profile({ id: "a", comp_expires_at: iso(nowSec - 60) }),
      profile({ id: "b", comp_tier: null }),
      profile({ id: "c", comp_expires_at: null }),
      profile({ id: "d", is_admin: true }),
    ]);
    const out = await sendCompEndingReminders(stub.client as never, { stripe: null, now: NOW });
    expect(inserts(stub)).toEqual([]);
    expect(out).toMatchObject({ checked: 4, skipped: 4, notified: 0 });
  });

  it("EMAIL OPT-OUT (no account-list recipient): the notification still lands, no email", async () => {
    h.getRecipientFor.mockResolvedValue(null);
    const stub = db([profile()]);
    const out = await sendCompEndingReminders(stub.client as never, { stripe: null, now: NOW });
    expect(inserts(stub)).toHaveLength(1);
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(out).toMatchObject({ notified: 1, emailed: 0 });
  });

  it("a payer whose subscription can't be read is skipped (tomorrow retries); the run goes on", async () => {
    const stripe = stripeWith(null);
    stripe.subscriptions.retrieve.mockRejectedValueOnce(new Error("stripe down"));
    const stub = db([
      profile({ id: "payer", subscription_status: "active", stripe_subscription_id: "sub_1" }),
      profile({ id: "free" }),
    ]);
    const out = await sendCompEndingReminders(stub.client as never, { stripe: stripe as never, now: NOW });
    expect(out).toMatchObject({ checked: 2, errors: 1, notified: 1 });
    expect(inserts(stub).map((r) => (r as unknown as { recipient_id: string }).recipient_id)).toEqual(["free"]);
  });
});

// ---------------------------------------------------------------------------
describe("the copy (bell + email)", () => {
  const bell = (payload: Row, type = "comp_ending") =>
    describeNotification({ type, actor: null, card: null, threadId: null, payload }, { isAdmin: false });

  it("free: back on Free, what they keep, the upgrade link", () => {
    const d = bell({ kind: "free", tier: "plus", expiresAt: IN_5D });
    expect(d.subject).toBe("Your complimentary Plus");
    expect(d.body).toMatch(/^ends on .+\. After that you'll be on Free — every card and deck you've made stays yours/);
    expect(d.href).toBe("/dashboard/billing");
  });
  it("held trial: the card ending and the price, how to cancel", () => {
    const d = bell({ kind: "held_trial", tier: "plus", subscribedTier: "plus", expiresAt: IN_5D, cardLast4: "4242", priceLabel: "$6 / month", hasPaymentMethod: true });
    expect(d.body).toMatch(/; then your card ending ••4242 will be charged \$6 \/ month — cancel on the billing page/);
    expect(d.href).toBe("/dashboard/billing");
    // Comped above the trial's plan: back to Plus, at Plus's price.
    expect(bell({ kind: "held_trial", tier: "pro", subscribedTier: "plus", expiresAt: IN_5D, cardLast4: "4242", priceLabel: "$6 / month", hasPaymentMethod: true }).body).toMatch(
      /; you go back to Plus \(\$6 \/ month\); your card ending ••4242 will be charged \$6 \/ month/,
    );
    // No card: nothing is charged.
    expect(bell({ kind: "held_trial", tier: "plus", subscribedTier: "plus", expiresAt: IN_5D, hasPaymentMethod: false }).body).toMatch(
      /no card on your account, so the plan simply ends then — nothing is charged/,
    );
  });
  it("paying: the next invoice as usual; plan_ending: nothing more is charged", () => {
    expect(bell({ kind: "paying", tier: "pro", subscribedTier: "pro", expiresAt: IN_5D, nextChargeAt: IN_5D, priceLabel: "$15 / month" }).body).toMatch(
      /your next invoice, on .+, is charged as usual \(\$15 \/ month\)\./,
    );
    // The next charge falls inside the comp: no date is promised.
    expect(bell({ kind: "paying", tier: "pro", subscribedTier: "pro", expiresAt: IN_5D, nextChargeAt: null, priceLabel: "$15 / month" }).body).toMatch(
      /invoices after that are charged as usual \(\$15 \/ month\)\./,
    );
    // Comped above the plan: back to Plus.
    expect(bell({ kind: "paying", tier: "pro", subscribedTier: "plus", expiresAt: IN_5D, nextChargeAt: null, priceLabel: "$6 / month" }).body).toMatch(
      /; you go back to Plus \(\$6 \/ month\); invoices after that are charged as usual\./,
    );
    expect(bell({ kind: "plan_ending", tier: "plus", expiresAt: IN_5D, planEndsAt: IN_5D }).body).toMatch(/nothing more is charged/);
  });
  it("the TRIAL reminder for a comp-held trial never calls it a trial", () => {
    const payload = { tier: "plus", trialEnd: IN_5D, hasPaymentMethod: true, amountCents: 600, currency: "usd", interval: "month" };
    const held = bell({ ...payload, compHold: true }, "trial_ending");
    expect(held.subject).toBe("Your complimentary Plus");
    expect(held.body).toMatch(/your card is charged \$6 \/ month then/);
    expect(`${held.subject} ${held.body}`).not.toMatch(/trial/i);
    // Otherwise unchanged.
    expect(bell(payload, "trial_ending").subject).toBe("Your Plus trial");
    // A Plus trial held by a PRO comp: names Pro, charges Plus — as the comp reminder does.
    const proOverPlus = bell({ ...payload, compHold: true, compTier: "pro" }, "trial_ending");
    expect(proOverPlus.subject).toBe("Your complimentary Pro");
    expect(proOverPlus.body).toMatch(/you go back to Plus and your card is charged \$6 \/ month then/);

    const recipient = { email: "u1@example.test", unsubscribeToken: "tok" };
    const base = { plan: "Plus", trialEndsAt: IN_5D, hasPaymentMethod: true, priceLabel: "$6 / month" };
    const heldEmail = trialEndingEmail(recipient, { ...base, compHold: true });
    expect(heldEmail.subject).toMatch(/^Your complimentary PipGlyph Plus ends /);
    expect(heldEmail.text).toContain("Your card will be charged $6 / month then");
    expect(heldEmail.text.replace(/You're receiving this[^\n]*/, "")).not.toMatch(/trial/i);
    expect(trialEndingEmail(recipient, base).subject).toMatch(/^Your PipGlyph Plus trial ends /);
    const proHeld = trialEndingEmail(recipient, { ...base, compHold: true, compPlan: "Pro" });
    expect(proHeld.subject).toMatch(/^Your complimentary PipGlyph Pro ends /);
    expect(proHeld.text).toContain("After that you go back to Plus ($6 / month): your card will be charged $6 / month then.");
    const noCard = trialEndingEmail(recipient, { ...base, hasPaymentMethod: false, compHold: true });
    expect(noCard.text).toContain("nothing is charged");
  });
  it("every email uses the one shell (unsubscribe headers on the account list)", () => {
    const email = compEndingEmail({ email: "u1@example.test", unsubscribeToken: "tok" }, { kind: "free", plan: "Plus", expiresAt: IN_5D });
    expect(email.headers).toHaveProperty("List-Unsubscribe");
    expect(email.html).toContain("Keep Plus");
    expect(email.html).toContain("/dashboard/billing");
  });
});

// ---------------------------------------------------------------------------
describe("0161 — the comp_ending kind", () => {
  const dir = join(process.cwd(), "supabase/migrations");
  const strip = (sql: string) =>
    sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
  const kinds = (sql: string) => {
    const all = [...sql.matchAll(/add constraint notifications_type_check\s+check \(\s*type in \(([\s\S]*?)\)\s*\)/g)];
    return [...(all.at(-1)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  };
  const SQL = strip(readFileSync(join(dir, "0161_comp_ending_notifications.sql"), "utf8"));

  it("the CHECK is 0156's kinds (the last to redefine it) plus comp_ending — nothing dropped", () => {
    const before = kinds(strip(readFileSync(join(dir, "0156_moderation_lock.sql"), "utf8")));
    expect(before.length).toBeGreaterThan(20);
    expect(kinds(SQL)).toEqual([...before, "comp_ending"]);
  });
  it("no later migration redefined the CHECK in between", () => {
    for (const f of ["0157_commander_row.sql", "0158_gallery_discover_shuffle_fix.sql", "0159_profile_links.sql", "0160_admin_articles.sql"]) {
      expect(readFileSync(join(dir, f), "utf8")).not.toContain("notifications_type_check");
    }
  });
  it("dedupes with a unique partial index on (dedupeKey, recipient), for this kind only; creates nothing to grant", () => {
    expect(SQL.replace(/\s+/g, " ")).toContain(
      "create unique index if not exists notifications_comp_ending_once_idx on public.notifications ((payload ->> 'dedupeKey'), recipient_id) where type = 'comp_ending';",
    );
    expect(SQL).not.toMatch(/create (table|view|(or replace )?function)/i);
    expect(readFileSync(join(dir, "0161_comp_ending_notifications.sql"), "utf8")).toMatch(/Grants: none needed/);
  });
});

// ---------------------------------------------------------------------------
describe("/api/cron/comp-ending", () => {
  it("answers 500 when a profile failed (the run is visible as failed), 200 otherwise", async () => {
    vi.resetModules();
    const run = vi.fn();
    vi.doMock("@/lib/billing/comp-ending-run", () => ({ sendCompEndingReminders: run }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
    vi.doMock("@/lib/api/cron-auth", () => ({ cronRouteGuard: () => null }));
    const { GET } = await import("@/app/api/cron/comp-ending/route");
    run.mockResolvedValueOnce({ checked: 2, notified: 1, emailed: 1, alreadySent: 0, skipped: 0, errors: 1 });
    let res = await GET(new Request("http://x/api/cron/comp-ending"));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, errors: 1 });
    run.mockResolvedValueOnce({ checked: 1, notified: 1, emailed: 1, alreadySent: 0, skipped: 0, errors: 0 });
    res = await GET(new Request("http://x/api/cron/comp-ending"));
    expect(res.status).toBe(200);
    vi.doUnmock("@/lib/billing/comp-ending-run");
    vi.doUnmock("@/lib/supabase/admin");
    vi.doUnmock("@/lib/api/cron-auth");
  });
});
