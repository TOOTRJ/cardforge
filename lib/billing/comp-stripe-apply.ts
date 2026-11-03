import "server-only";

import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { resolveSubscriptionTier, syncSubscriptionForUser } from "@/lib/stripe/subscription-sync";
import { releasePendingChange } from "@/lib/stripe/schedule";
import {
  COMP_CREDIT_GRANT_KEY,
  COMP_CREDIT_LEDGER_KEY,
  TRIAL_END_BEFORE_COMP_KEY,
  compCreditChangeFor,
  compCreditLedgerKey,
  compCreditNote,
  compStripeNote,
  compTrialChangeFor,
  parseCompCreditGrant,
  type CompCreditChange,
  type CompFacts,
  type CompTrialChange,
} from "@/lib/billing/comp-stripe";
import {
  COMP_COUPON_GRANT_KEY,
  activeCompDiscountOf,
  compBillingNeedsReconcile,
  compCouponChangeFor,
  compCouponGrantMeta,
  compCouponId,
  compCouponName,
  compCouponNote,
  compCouponOutlook,
  compDiscountsOf,
  couponCoveredUntil,
  discountsOf,
  hasCompCouponGrant,
  isCompCouponShape,
  isMonthlyPrice,
  parseCompCouponGrant,
  priceOf,
  type CompCouponChange,
  type CouponSubFacts,
} from "@/lib/billing/comp-coupon";
import {
  addMonthsUtc,
  clawBackCustomerBalance,
  creditCustomerBalance,
  netCreditPosted,
  periodCreditCents,
  unspentCreditCents,
} from "@/lib/billing/balance-credit";
import { pendingChangeOf, type ScheduleLike } from "@/lib/billing/subscription-details";
import { formatMoney } from "@/lib/format/money";
import type { PlanTier } from "@/lib/billing/plans";

type AdminClient = ReturnType<typeof createAdminClient>;

export type CompCouponOutcome = {
  change: CompCouponChange;
  /** Monthly invoices still free under the coupon, seen now. */
  freeInvoices: number;
  /** ISO: the first invoice charged as usual again (null: unknown / none). */
  chargedFrom: string | null;
};

export type CompStripeOutcome = {
  change: CompTrialChange | null;
  /** ISO trial end the subscription now has, when this call moved it. */
  trialEnd: string | null;
  /** A balance settlement on an ACTIVE plan (owner answer 1): what was
   *  posted — `postedCents` > 0 credited, < 0 clawed back. */
  credit?: { change: CompCreditChange; postedCents: number; keptCents: number; currency: string } | null;
  /** The comp's 100%-off coupon on an active MONTHLY plan (BL1). */
  coupon?: CompCouponOutcome | null;
  /** One line for the admin (null: nothing to say). */
  note: string | null;
  /** Stripe could not be read or written — the comp is saved all the same. */
  failed: boolean;
};

const NOTHING: CompStripeOutcome = { change: null, trialEnd: null, note: null, failed: false };

const STRIPE_FAILED_NOTE =
  "Stripe couldn't be updated — their subscription bills on its own dates. Try saving the comp again.";

/** The subscription with what this module reads: its discounts as objects
 *  (a bare discount id can't be told apart from ours). */
const SUB_EXPAND = ["discounts"];

/** Statuses a coupon grant can be left on after the plan stopped paying —
 *  a revoke still takes ours off there (finding P3e). */
const DUNNING = new Set(["past_due", "unpaid", "incomplete", "paused"]);

/**
 * Bring the user's live Stripe subscription in line with their comp
 * (lib/billing/comp-stripe.ts, lib/billing/comp-coupon.ts) AFTER the
 * profile's comp columns were written. Best effort: the comp itself is the
 * profile row; a Stripe failure is reported (`failed`, shown to the admin
 * as an error), logged, and leaves the subscription as it was.
 *
 *   trialing → the trial is held to the comp's end (or put back);
 *   active, monthly → a 100%-off repeating coupon frees the comp's months of
 *              invoices (or comes off) — unless a #688 balance credit is
 *              still running there: it stays a credit and runs out under
 *              #688's rules (never clawed back to attach a coupon);
 *   active, annual  → the comp period's share of the price goes on the
 *              customer balance (or the unused part comes back);
 *   dunning   → a revoke takes the comp's coupon off; nothing is added.
 */
export async function applyCompToSubscription(
  admin: AdminClient,
  userId: string,
  comp: CompFacts,
  deps: { stripe?: Stripe; now?: Date } = {},
): Promise<CompStripeOutcome> {
  if (!deps.stripe && !isStripeConfigured()) return NOTHING;
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id, stripe_subscription_id, subscription_tier, subscription_status")
    .eq("id", userId)
    .maybeSingle();
  const subId = profile?.stripe_subscription_id ?? null;
  if (!subId) return NOTHING;
  const live = profile?.subscription_status === "active" || profile?.subscription_status === "trialing";

  const stripe = deps.stripe ?? getStripe();
  let sub: Stripe.Subscription;
  let subscribedTier: PlanTier;
  try {
    sub = await stripe.subscriptions.retrieve(subId, { expand: SUB_EXPAND });
    // The tier the subscription PAYS for, read from Stripe itself — the
    // profile's copy can lag a plan switch the webhook hasn't synced yet.
    subscribedTier =
      (await resolveSubscriptionTier(sub, stripe)) ?? ((profile?.subscription_tier ?? "free") as PlanTier);
  } catch (error) {
    return failed(userId, error);
  }

  if (sub.status === "active") {
    return applyActive(stripe, sub, subscribedTier, comp, deps.now, userId);
  }
  if (DUNNING.has(sub.status)) {
    const facts = sub as unknown as CouponSubFacts;
    if (parseCompCouponGrant(sub.metadata) || compDiscountsOf(facts).length) {
      if (discountsOf(facts).unreadable) return failed(userId, new Error("subscription discounts not expanded"));
      return applyCoupon(stripe, sub, subscribedTier, comp, deps.now, userId);
    }
  }

  const change = compTrialChangeFor({ sub, subscribedTier, comp, now: deps.now });
  if (change.kind === "none") {
    return { change, trialEnd: null, note: compStripeNote(change, { live }), failed: false };
  }
  let updated: Stripe.Subscription;
  try {
    updated = await stripe.subscriptions.update(subId, {
      trial_end: change.trialEnd,
      proration_behavior: "none",
      metadata: { [TRIAL_END_BEFORE_COMP_KEY]: change.beforeComp },
    });
  } catch (error) {
    return failed(userId, error);
  }
  const trialEnd = typeof updated.trial_end === "number" ? new Date(updated.trial_end * 1000).toISOString() : null;
  const outcome: CompStripeOutcome = { change, trialEnd, note: compStripeNote(change, { live }), failed: false };
  // The profile's period / trial dates follow at once (the webhook's
  // subscription.updated does the same a moment later). Stripe IS updated
  // by now: a failed resync must not tell the admin otherwise.
  try {
    await syncSubscriptionForUser(admin, stripe, userId, {
      currentSub: updated,
      customerId: profile?.stripe_customer_id ?? null,
    });
  } catch (error) {
    console.warn(
      `applyCompToSubscription(${userId}): resync after the trial change failed`,
      error instanceof Error ? error.message : error,
    );
    outcome.note = `${outcome.note ?? ""} The profile's dates catch up with the next webhook (or press Resync).`.trim();
  }
  return outcome;
}

/** An ACTIVE subscription: a monthly plan's comp is the coupon; an annual
 *  plan's — or a monthly plan still carrying a #688 credit — the credit. */
async function applyActive(
  stripe: Stripe,
  sub: Stripe.Subscription,
  subscribedTier: PlanTier,
  comp: CompFacts,
  now: Date | undefined,
  userId: string,
): Promise<CompStripeOutcome> {
  const facts = sub as unknown as CouponSubFacts;
  const nowSec = Math.floor((now ?? new Date()).getTime() / 1000);
  // Never guess which discount is ours: refuse rather than add a second.
  if (discountsOf(facts).unreadable) return failed(userId, new Error("subscription discounts not expanded"));
  // A #688 credit still running is NEVER clawed back to attach a coupon
  // (owner 2026-11-02): its balance pays the next invoices only when they
  // FINALIZE, about an hour after the renewal's draft — a claw-back in that
  // window charged a comped user (finding P1). The comp stays a credit.
  const credit = parseCompCreditGrant(sub.metadata);
  const creditRunning = credit != null && credit.endSec > nowSec;
  return isMonthlyPrice(priceOf(facts)) && !creditRunning
    ? applyCoupon(stripe, sub, subscribedTier, comp, now, userId)
    : applyCreditPath(stripe, sub, subscribedTier, comp, now, userId);
}

// --- Monthly: the coupon -----------------------------------------------------

async function applyCoupon(
  stripe: Stripe,
  sub: Stripe.Subscription,
  subscribedTier: PlanTier,
  comp: CompFacts,
  now: Date | undefined,
  userId: string,
): Promise<CompStripeOutcome> {
  const nowSec = Math.floor((now ?? new Date()).getTime() / 1000);
  const facts = sub as unknown as CouponSubFacts;
  const change = compCouponChangeFor({ sub: facts, subscribedTier, comp, now });
  const otherDiscounts = discountsOf(facts)
    .list.filter((d) => !compDiscountsOf(facts).some((ours) => ours.id === d.id))
    .map((d) => ({ discount: d.id }));
  let coupon: CompCouponOutcome;
  try {
    if (change.kind === "apply") {
      // The coupon is found (or made) BEFORE anything changes: a failure
      // here leaves the subscription exactly as it was.
      const couponId = await ensureCompCoupon(stripe, change.couponMonths);
      const grantMeta = compCouponGrantMeta(change.grant);
      // ONE update: our old discount out, the new one in, the grant named —
      // nothing is removed unless the new discount goes on with it; a
      // re-save reads the grant and does nothing; a retry posts once.
      const updated = await stripe.subscriptions.update(
        sub.id,
        {
          discounts: [...otherDiscounts, { coupon: couponId }],
          proration_behavior: "none",
          metadata: { [COMP_COUPON_GRANT_KEY]: grantMeta },
          expand: SUB_EXPAND,
        },
        { idempotencyKey: `comp-coupon:${sub.id}:${grantMeta}:${couponId}:${change.replaces ?? "new"}` },
      );
      const attached = activeCompDiscountOf(updated as unknown as CouponSubFacts, nowSec);
      const endSec = attached?.end ?? Math.floor(addMonthsUtc(nowSec * 1000, change.couponMonths) / 1000);
      coupon = outlookOf(change, updated as unknown as CouponSubFacts, endSec, nowSec);
    } else if (change.kind === "keep") {
      if (change.grantMeta != null) {
        await stripe.subscriptions.update(sub.id, { metadata: { [COMP_COUPON_GRANT_KEY]: change.grantMeta } });
      }
      const kept = activeCompDiscountOf(facts, nowSec);
      coupon = outlookOf(change, facts, kept?.end ?? change.grant.endSec, nowSec);
    } else if (change.kind === "remove") {
      // Our discount(s) off — every one, should two ever be there — and the
      // grant closed, in one update, WHATEVER the status (a revoke on a plan
      // in dunning too). Invoices already issued stay as they are.
      const ours = compDiscountsOf(facts).map((d) => d.id);
      await stripe.subscriptions.update(
        sub.id,
        {
          ...(ours.length ? { discounts: otherDiscounts.length ? otherDiscounts : "" } : {}),
          proration_behavior: "none",
          metadata: { [COMP_COUPON_GRANT_KEY]: "" },
        },
        { idempotencyKey: `comp-coupon:${sub.id}:remove:${ours.join(",") || "meta"}:${sub.metadata?.[COMP_COUPON_GRANT_KEY] ?? ""}` },
      );
      coupon = { change, freeInvoices: 0, chargedFrom: null };
    } else {
      coupon = { change, freeInvoices: 0, chargedFrom: null };
    }
  } catch (error) {
    return failed(userId, error);
  }
  return {
    change: null,
    trialEnd: null,
    credit: null,
    coupon,
    note: compCouponNote(change, coupon),
    failed: false,
  };
}

function outlookOf(change: CompCouponChange, sub: CouponSubFacts, endSec: number, nowSec: number): CompCouponOutcome {
  const o = compCouponOutlook(sub, endSec, nowSec);
  return {
    change,
    freeInvoices: o.freeInvoices,
    chargedFrom: o.chargedFromSec != null ? new Date(o.chargedFromSec * 1000).toISOString() : null,
  };
}

/** Error codes the Stripe SDK puts on a StripeError. */
function stripeCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { code?: unknown; raw?: { code?: unknown } };
  if (typeof e.code === "string") return e.code;
  return typeof e.raw?.code === "string" ? e.raw.code : null;
}

/**
 * The ONE coupon for a comp of `months` invoices: read by its deterministic
 * id, created on first use (100 % off, repeating, `duration_in_months`).
 * A coupon under that id with any other shape is never applied — nor one
 * whose create answer came back other than the shape asked for.
 *
 * The create's idempotency key is FRESH per create (finding P3f): a fixed
 * key let Stripe replay, within 24 h, the answer for a coupon since DELETED
 * — a recreate then "succeeded" without a coupon to attach.
 */
export async function ensureCompCoupon(stripe: Stripe, months: number): Promise<string> {
  const id = compCouponId(months);
  let coupon: Stripe.Coupon | null = null;
  try {
    coupon = await stripe.coupons.retrieve(id);
  } catch (error) {
    if (stripeCode(error) !== "resource_missing") throw error;
  }
  if (coupon && (coupon as { deleted?: boolean }).deleted === true) coupon = null;
  if (!coupon) {
    try {
      coupon = await stripe.coupons.create(
        {
          id,
          percent_off: 100,
          duration: "repeating",
          duration_in_months: months,
          name: compCouponName(months),
          metadata: { pipglyph_kind: "comp" },
        },
        { idempotencyKey: `comp-coupon-create:${id}:${randomUUID()}` },
      );
    } catch (error) {
      // Two saves at once: the other one created it.
      if (stripeCode(error) !== "resource_already_exists") throw error;
      coupon = await stripe.coupons.retrieve(id);
    }
  }
  if (!isCompCouponShape(coupon, months)) {
    throw new Error(`Stripe coupon ${id} is not the 100%-off ${months}-month comp coupon; refusing to apply it.`);
  }
  return id;
}

// --- Annual: the balance credit -------------------------------------------------

async function applyCreditPath(
  stripe: Stripe,
  sub: Stripe.Subscription,
  subscribedTier: PlanTier,
  comp: CompFacts,
  now: Date | undefined,
  userId: string,
): Promise<CompStripeOutcome> {
  const nowSec = Math.floor((now ?? new Date()).getTime() / 1000);
  const facts = sub as unknown as CouponSubFacts;
  const ours = compDiscountsOf(facts);
  const couponGrant = parseCompCouponGrant(sub.metadata);
  const openCouponGrant = couponGrant && couponGrant.endSec > nowSec ? couponGrant : null;
  // A coupon left on a plan that isn't monthly any more (changed outside the
  // app — switches are refused while comped) comes off: a 100 % coupon on an
  // annual price would free the year. The credit then starts where the
  // invoice the coupon already freed ends, so that time is paid for once —
  // read from the comp's GRANT, never the discount's own start.
  const grantStartSec = couponCoveredUntil(facts, openCouponGrant, activeCompDiscountOf(facts, nowSec), nowSec);
  const change = compCreditChangeFor({ sub, subscribedTier, comp, now, grantStartSec });
  const otherDiscounts = discountsOf(facts)
    .list.filter((d) => !ours.some((o) => o.id === d.id))
    .map((d) => ({ discount: d.id }));
  const takeOff: Stripe.SubscriptionUpdateParams | null =
    ours.length || couponGrant
      ? {
          ...(ours.length ? { discounts: otherDiscounts.length ? otherDiscounts : ("" as const) } : {}),
          proration_behavior: "none" as const,
          metadata: { [COMP_COUPON_GRANT_KEY]: "" },
        }
      : null;

  // The credit FIRST, the coupon off AFTER (finding P3a): value is only
  // removed once its replacement is in place. A failure between the two
  // leaves the coupon on and the credit's grant named — a re-save finds the
  // grant and its ledger (nothing posted twice) and takes the coupon off.
  const settled = await settleCredit(stripe, sub, subscribedTier, change, userId);
  if (settled.failed || !takeOff) return settled.outcome;
  try {
    await stripe.subscriptions.update(sub.id, takeOff);
  } catch (error) {
    const out = failed(userId, error);
    out.credit = settled.credit;
    out.note = `${settled.outcome.note ?? ""} Their complimentary coupon couldn't be taken off — save the comp again.`.trim();
    return out;
  }
  if (ours.length) {
    const line = "Took the complimentary coupon off their subscription (it is for monthly plans only).";
    settled.outcome.note = settled.outcome.note ? `${line} ${settled.outcome.note}` : line;
  }
  return settled.outcome;
}

/**
 * Settle a balance-credit change against the Stripe ledger (one key per
 * grant; only the difference moves). A NEW grant is named on the
 * subscription before any money moves.
 */
async function settleCredit(
  stripe: Stripe,
  sub: Stripe.Subscription,
  subscribedTier: PlanTier,
  change: CompCreditChange,
  userId: string,
): Promise<{ outcome: CompStripeOutcome; failed: boolean; credit: CompStripeOutcome["credit"] }> {
  const price = sub.items?.data?.[0]?.price ?? null;
  const currency = price?.currency ?? "usd";
  const money = (cents: number) => formatMoney(cents, currency);
  if (change.kind === "none") {
    const credit = { change, postedCents: 0, keptCents: 0, currency };
    return {
      outcome: {
        change: null,
        trialEnd: null,
        credit,
        note: compCreditNote(change, { postedCents: 0, keptCents: 0, money }),
        failed: false,
      },
      failed: false,
      credit,
    };
  }
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) {
    return { outcome: failed(userId, new Error("subscription has no customer")), failed: true, credit: null };
  }

  const ledgerKey = compCreditLedgerKey(sub.id, change.grant);
  const meta = { [COMP_CREDIT_LEDGER_KEY]: ledgerKey, supabase_user_id: userId };
  let postedCents = 0;
  let keptCents = 0;
  try {
    // A NEW grant is named on the subscription before any money moves: a
    // re-save after a failure finds the same grant and its ledger.
    if (change.opensGrant) {
      await stripe.subscriptions.update(sub.id, { metadata: { [COMP_CREDIT_GRANT_KEY]: change.grantMeta } });
    }
    const target = periodCreditCents({
      price,
      tier: subscribedTier,
      startSec: change.grant.startSec,
      endSec: change.coverUntilSec,
    });
    const net = await netCreditPosted(stripe, customerId, COMP_CREDIT_LEDGER_KEY, ledgerKey);
    const delta = target - net;
    // The idempotency key names the ledger's state before AND after: a
    // retried request (or two admins saving at once) posts once.
    const idempotencyKey = `${ledgerKey}:${net}->${target}`;
    if (delta > 0 && change.reason === "comp_credits_period") {
      await creditCustomerBalance(stripe, {
        customerId,
        cents: delta,
        currency,
        description: "PipGlyph complimentary plan — the comp period is free",
        metadata: { ...meta, kind: "comp_credit" },
        idempotencyKey: `${idempotencyKey}:credit`,
      });
      postedCents = delta;
    } else if (delta < 0) {
      // Only what is still UNSPENT comes back: credit an invoice already
      // used paid for time the user had, and is never turned into a debt.
      const customer = await stripe.customers.retrieve(customerId);
      const unspent = "deleted" in customer && customer.deleted ? 0 : unspentCreditCents(customer as Stripe.Customer);
      const claw = Math.min(-delta, unspent);
      keptCents = -delta - claw;
      if (claw > 0) {
        await clawBackCustomerBalance(stripe, {
          customerId,
          cents: claw,
          currency,
          description: "PipGlyph complimentary plan — unused comp credit returned",
          metadata: { ...meta, kind: "comp_clawback" },
          idempotencyKey: `${idempotencyKey}:clawback`,
        });
        postedCents = -claw;
      }
    }
    if (!change.opensGrant && sub.metadata?.[COMP_CREDIT_GRANT_KEY] !== change.grantMeta) {
      await stripe.subscriptions.update(sub.id, { metadata: { [COMP_CREDIT_GRANT_KEY]: change.grantMeta } });
    }
  } catch (error) {
    const out = failed(userId, error);
    // Money that DID move before the failure is still reported.
    if (postedCents !== 0) {
      out.credit = { change, postedCents, keptCents, currency };
      out.note = `${compCreditNote(change, { postedCents, keptCents, money })} Saving the comp's record on Stripe failed — save the comp again.`;
    }
    return { outcome: out, failed: true, credit: out.credit ?? null };
  }
  const credit = { change, postedCents, keptCents, currency };
  return {
    outcome: {
      change: null,
      trialEnd: null,
      credit,
      note: compCreditNote(change, { postedCents, keptCents, money }),
      failed: false,
    },
    failed: false,
    credit,
  };
}

function failed(userId: string, error: unknown): CompStripeOutcome {
  console.warn(
    `applyCompToSubscription(${userId}): stripe error`,
    error instanceof Error ? error.message : error,
  );
  return { change: null, trialEnd: null, note: STRIPE_FAILED_NOTE, failed: true };
}

// --- A comp change while a downgrade is scheduled ----------------------------

export type ScheduleReleaseOutcome =
  | { ok: true; note: string | null }
  | { ok: false; error: string };

const TIER_LABEL: Record<string, string> = { free: "Free", plus: "Plus", pro: "Pro" };

/**
 * BEFORE an admin's comp change (grant, extend, shorten, revoke) touches
 * the profile or Stripe: a downgrade scheduled for the end of the period
 * (lib/stripe/actions.ts scheduleDowngrade) is RELEASED first (owner
 * 2026-11-02, TODO BL1) — its next phase would otherwise carry the
 * subscription's discounts as they were when it was made, and no switch may
 * happen while a comp is on anyway. `ok: false` = the release (or the read
 * that finds it) failed: the caller must NOT change the comp — never half
 * applied. A subscription with no pending change is left untouched.
 */
export async function releaseScheduleForCompChange(
  admin: AdminClient,
  userId: string,
  deps: { stripe?: Stripe } = {},
): Promise<ScheduleReleaseOutcome> {
  if (!deps.stripe && !isStripeConfigured()) return { ok: true, note: null };
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_subscription_id, subscription_status")
    .eq("id", userId)
    .maybeSingle();
  const subId = profile?.stripe_subscription_id ?? null;
  const status = profile?.subscription_status ?? null;
  if (!subId || status === "canceled" || status === "incomplete_expired") return { ok: true, note: null };
  const stripe = deps.stripe ?? getStripe();
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(subId, { expand: ["schedule.phases.items.price"] });
  } catch (error) {
    console.warn(
      `releaseScheduleForCompChange(${userId}): read failed`,
      error instanceof Error ? error.message : error,
    );
    return {
      ok: false,
      error: "Couldn't read their Stripe subscription to check for a scheduled plan change — the comp was not changed. Try again.",
    };
  }
  const schedule = sub.schedule;
  if (!schedule) return { ok: true, note: null };
  const pending = typeof schedule === "string" ? null : pendingChangeOf(schedule as unknown as ScheduleLike);
  // A schedule with no phase ahead changes nothing at a phase boundary.
  if (typeof schedule !== "string" && !pending) return { ok: true, note: null };
  try {
    await releasePendingChange(stripe, sub);
  } catch (error) {
    console.warn(
      `releaseScheduleForCompChange(${userId}): release failed`,
      error instanceof Error ? error.message : error,
    );
    return {
      ok: false,
      error: "Their scheduled plan change couldn't be cancelled on Stripe — the comp was not changed. Try again.",
    };
  }
  const to = pending?.tier
    ? `${TIER_LABEL[pending.tier] ?? pending.tier}${pending.interval ? ` (${pending.interval === "year" ? "annual" : "monthly"})` : ""}`
    : "another plan";
  return { ok: true, note: `The scheduled change to ${to} was cancelled.` };
}

// --- The webhook's safety net -----------------------------------------------------

/**
 * After `customer.subscription.updated`: a coupon comp on a plan that no
 * longer fits it (changed outside the app — the app refuses plan switches
 * while comped and the comped portal offers none) is re-run on Stripe's
 * CURRENT subscription: off an annual price (onto the credit), off a plan
 * the comp no longer holds. A #688 credit is never touched here. Idempotent
 * — a matching plan writes nothing. Never throws (the webhook's sync is
 * what must succeed).
 */
export async function reconcileCompBilling(
  admin: AdminClient,
  stripe: Stripe,
  userId: string,
  eventSub: Stripe.Subscription,
  subscribedTier: PlanTier | null,
  now?: Date,
): Promise<CompStripeOutcome | null> {
  if (eventSub.status !== "active" || !hasCompCouponGrant(eventSub.metadata)) return null;
  try {
    const { data } = await admin.from("profiles").select("comp_tier, comp_expires_at").eq("id", userId).maybeSingle();
    const row = data as { comp_tier?: string | null; comp_expires_at?: string | null } | null;
    const comp: CompFacts = {
      tier: row?.comp_tier === "plus" || row?.comp_tier === "pro" ? row.comp_tier : null,
      expiresAt: row?.comp_expires_at ?? null,
    };
    if (!compBillingNeedsReconcile({ sub: eventSub as unknown as CouponSubFacts, subscribedTier, comp, now })) return null;
    const outcome = await applyCompToSubscription(admin, userId, comp, { stripe, now });
    if (outcome.failed) console.warn(`reconcileCompBilling(${userId}): ${outcome.note}`);
    return outcome;
  } catch (error) {
    console.warn(`reconcileCompBilling(${userId}) failed:`, error instanceof Error ? error.message : error);
    return null;
  }
}
