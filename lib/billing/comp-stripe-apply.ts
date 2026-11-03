import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { resolveSubscriptionTier, syncSubscriptionForUser } from "@/lib/stripe/subscription-sync";
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
  COMP_SWITCH_HOLD_KEY,
  activeCompDiscountOf,
  compBillingNeedsReconcile,
  compCouponChangeFor,
  compCouponGrantMeta,
  compCouponId,
  compCouponName,
  compCouponNote,
  compCouponOutlook,
  compDiscountsOf,
  compHoldReason,
  compSwitchHeld,
  couponCoveredUntil,
  discountsOf,
  hasCompBillingGrant,
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
import { formatMoney } from "@/lib/format/money";
import type { BillingPeriod, PlanTier } from "@/lib/billing/plans";

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

/**
 * Bring the user's live Stripe subscription in line with their comp
 * (lib/billing/comp-stripe.ts, lib/billing/comp-coupon.ts) AFTER the
 * profile's comp columns were written. Best effort: the comp itself is the
 * profile row; a Stripe failure is reported, logged, and leaves the
 * subscription as it was.
 *
 *   trialing → the trial is held to the comp's end (or put back);
 *   active, monthly → a 100%-off repeating coupon frees the comp's months of
 *              invoices (or comes off);
 *   active, annual  → the comp period's share of the price goes on the
 *              customer balance (or the unused part comes back).
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

/** An ACTIVE subscription: a monthly plan the comp is paid for with the
 *  coupon, anything else (annual, or a monthly plan an in-app switch is
 *  moving) with the balance credit. */
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
  const monthly = isMonthlyPrice(priceOf(facts)) && !compSwitchHeld(sub.metadata, nowSec);
  return monthly
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
  const notes: string[] = [];
  let credit: CompStripeOutcome["credit"] = null;
  let current = sub;

  // 1. A balance credit still open on this MONTHLY plan (the plan came from
  //    annual, or #688 credited it before BL1) is released FIRST, WHOLE: all
  //    of it that is still unspent comes back, and the coupon's grant starts
  //    where the credit's did — the invoices since then (paid by that
  //    credit: what stays with them) count as already freed, so the comp
  //    frees its months once, never a coupon on top of a credit for the same
  //    time. A failed claw-back stops here: no coupon is added.
  //    Only when the coupon would FREE an invoice: a comp that was cleared,
  //    dropped below the plan or has no invoice left to free stays #688's
  //    credit (its release keeps the time already lived through paid for).
  const creditGrant = parseCompCreditGrant(sub.metadata);
  let couponStartSec: number | undefined;
  if (creditGrant && creditGrant.endSec > nowSec) {
    couponStartSec = creditGrant.startSec;
    const would = compCouponChangeFor({
      sub: sub as unknown as CouponSubFacts,
      subscribedTier,
      comp,
      now,
      grantStartSec: couponStartSec,
    });
    if (would.kind !== "apply") return applyCreditPath(stripe, sub, subscribedTier, comp, now, userId);
    const release: CompCreditChange = {
      kind: "settle",
      grant: creditGrant,
      coverUntilSec: creditGrant.startSec,
      grantMeta: "",
      opensGrant: false,
      reason: "comp_released",
    };
    const settled = await settleCredit(stripe, sub, subscribedTier, release, userId, null);
    if (settled.failed) return settled.outcome;
    credit = settled.credit;
    current = settled.sub ?? current;
    const line = settled.outcome.note;
    if (line && settled.credit && (settled.credit.postedCents !== 0 || settled.credit.keptCents > 0)) notes.push(line);
  }

  // 2. The coupon.
  const facts = current as unknown as CouponSubFacts;
  const change = compCouponChangeFor({ sub: facts, subscribedTier, comp, now, grantStartSec: couponStartSec });
  const otherDiscounts = discountsOf(facts)
    .list.filter((d) => !compDiscountsOf(facts).some((ours) => ours.id === d.id))
    .map((d) => ({ discount: d.id }));
  const staleSwitch = Boolean(current.metadata?.[COMP_SWITCH_HOLD_KEY]);
  let coupon: CompCouponOutcome | null = null;
  try {
    if (change.kind === "apply") {
      const couponId = await ensureCompCoupon(stripe, change.couponMonths);
      const grantMeta = compCouponGrantMeta(change.grant);
      // ONE update: our old discount out, the new one in, the grant named —
      // a re-save reads the grant and does nothing; a retry posts once.
      const updated = await stripe.subscriptions.update(
        current.id,
        {
          discounts: [...otherDiscounts, { coupon: couponId }],
          proration_behavior: "none",
          metadata: { [COMP_COUPON_GRANT_KEY]: grantMeta, ...(staleSwitch ? { [COMP_SWITCH_HOLD_KEY]: "" } : {}) },
          expand: SUB_EXPAND,
        },
        { idempotencyKey: `comp-coupon:${current.id}:${grantMeta}:${couponId}:${change.replaces ?? "new"}` },
      );
      const attached = activeCompDiscountOf(updated as unknown as CouponSubFacts, nowSec);
      const endSec = attached?.end ?? Math.floor(addMonthsUtc(nowSec * 1000, change.couponMonths) / 1000);
      coupon = outlookOf(change, updated as unknown as CouponSubFacts, endSec, nowSec);
    } else if (change.kind === "keep") {
      if (change.grantMeta != null || staleSwitch) {
        await stripe.subscriptions.update(current.id, {
          metadata: {
            ...(change.grantMeta != null ? { [COMP_COUPON_GRANT_KEY]: change.grantMeta } : {}),
            ...(staleSwitch ? { [COMP_SWITCH_HOLD_KEY]: "" } : {}),
          },
        });
      }
      const kept = activeCompDiscountOf(facts, nowSec);
      coupon = outlookOf(change, facts, kept?.end ?? change.grant.endSec, nowSec);
    } else if (change.kind === "remove") {
      // Our discount(s) off — every one, should two ever be there — and the
      // grant closed, in one update. Invoices already issued stay as they are.
      const ours = compDiscountsOf(facts).map((d) => d.id);
      await stripe.subscriptions.update(
        current.id,
        {
          ...(ours.length ? { discounts: otherDiscounts.length ? otherDiscounts : "" } : {}),
          proration_behavior: "none",
          metadata: { [COMP_COUPON_GRANT_KEY]: "", ...(staleSwitch ? { [COMP_SWITCH_HOLD_KEY]: "" } : {}) },
        },
        { idempotencyKey: `comp-coupon:${current.id}:remove:${ours.join(",") || "meta"}:${current.metadata?.[COMP_COUPON_GRANT_KEY] ?? ""}` },
      );
      coupon = { change, freeInvoices: 0, chargedFrom: null };
    } else {
      coupon = { change, freeInvoices: 0, chargedFrom: null };
    }
  } catch (error) {
    const out = failed(userId, error);
    if (credit && credit.postedCents !== 0) {
      out.credit = credit;
      out.note = `${notes.join(" ")} ${STRIPE_FAILED_NOTE}`.trim();
    }
    return out;
  }
  const line = compCouponNote(change, coupon);
  if (line) notes.push(line);
  return {
    change: null,
    trialEnd: null,
    credit,
    coupon,
    note: notes.length ? notes.join(" ") : null,
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
 * A coupon under that id with any other shape is never applied.
 */
export async function ensureCompCoupon(stripe: Stripe, months: number): Promise<string> {
  const id = compCouponId(months);
  let coupon: Stripe.Coupon | null = null;
  try {
    coupon = await stripe.coupons.retrieve(id);
  } catch (error) {
    if (stripeCode(error) !== "resource_missing") throw error;
  }
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
        { idempotencyKey: `comp-coupon-create:${id}` },
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

// --- Annual (and a switch away from monthly): the balance credit ------------

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
  // Never a 100 % coupon on a plan that isn't monthly (it would free the
  // whole year): ours comes off. The credit then starts where the invoice
  // the coupon already freed ends — that time is paid for once.
  const grantStartSec = couponCoveredUntil(facts, activeCompDiscountOf(facts, nowSec), nowSec);
  const change = compCreditChangeFor({ sub, subscribedTier, comp, now, grantStartSec });
  const otherDiscounts = discountsOf(facts)
    .list.filter((d) => !ours.some((o) => o.id === d.id))
    .map((d) => ({ discount: d.id }));
  const takeOff =
    ours.length || couponGrant
      ? {
          ...(ours.length ? { discounts: otherDiscounts.length ? otherDiscounts : ("" as const) } : {}),
          proration_behavior: "none" as const,
          metadata: { [COMP_COUPON_GRANT_KEY]: "" } as Record<string, string>,
        }
      : null;
  if (change.kind === "none" && takeOff) {
    try {
      await stripe.subscriptions.update(sub.id, takeOff);
    } catch (error) {
      return failed(userId, error);
    }
  }
  const settled = await settleCredit(stripe, sub, subscribedTier, change, userId, change.kind === "settle" ? takeOff : null);
  if (!settled.failed && ours.length) {
    const line = "Took the complimentary coupon off their subscription (it is for monthly plans only).";
    settled.outcome.note = settled.outcome.note ? `${line} ${settled.outcome.note}` : line;
  }
  return settled.outcome;
}

/**
 * Settle a balance-credit change against the Stripe ledger (one key per
 * grant; only the difference moves). `firstUpdate` — the coupon coming off —
 * is written in the SAME update that names a new grant (or before any money
 * moves on an open one), so the two never both pay for the same time.
 */
async function settleCredit(
  stripe: Stripe,
  sub: Stripe.Subscription,
  subscribedTier: PlanTier,
  change: CompCreditChange,
  userId: string,
  firstUpdate: Stripe.SubscriptionUpdateParams | null,
): Promise<{ outcome: CompStripeOutcome; failed: boolean; credit: CompStripeOutcome["credit"]; sub: Stripe.Subscription | null }> {
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
      sub: null,
    };
  }
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) {
    return { outcome: failed(userId, new Error("subscription has no customer")), failed: true, credit: null, sub: null };
  }

  const ledgerKey = compCreditLedgerKey(sub.id, change.grant);
  const meta = { [COMP_CREDIT_LEDGER_KEY]: ledgerKey, supabase_user_id: userId };
  let postedCents = 0;
  let keptCents = 0;
  let updatedSub: Stripe.Subscription | null = null;
  try {
    // A NEW grant is named on the subscription before any money moves: a
    // re-save after a failure finds the same grant and its ledger.
    if (change.opensGrant || firstUpdate) {
      updatedSub = await stripe.subscriptions.update(sub.id, {
        ...(firstUpdate ?? {}),
        metadata: {
          ...(firstUpdate?.metadata ?? {}),
          ...(change.opensGrant ? { [COMP_CREDIT_GRANT_KEY]: change.grantMeta } : {}),
        },
      });
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
      updatedSub = await stripe.subscriptions.update(sub.id, { metadata: { [COMP_CREDIT_GRANT_KEY]: change.grantMeta } });
    }
  } catch (error) {
    const out = failed(userId, error);
    // Money that DID move before the failure is still reported.
    if (postedCents !== 0) {
      out.credit = { change, postedCents, keptCents, currency };
      out.note = `${compCreditNote(change, { postedCents, keptCents, money })} Saving the comp's record on Stripe failed — save the comp again.`;
    }
    return { outcome: out, failed: true, credit: out.credit ?? null, sub: null };
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
    // What the caller reads next: the subscription as it was, with the
    // metadata these updates wrote (an update's answer carries bare discount
    // ids — never let it replace the expanded ones).
    sub: updatedSub ? { ...sub, metadata: { ...(sub.metadata ?? {}), ...(updatedSub.metadata ?? {}) } } : null,
  };
}

function failed(userId: string, error: unknown): CompStripeOutcome {
  console.warn(
    `applyCompToSubscription(${userId}): stripe error`,
    error instanceof Error ? error.message : error,
  );
  return { change: null, trialEnd: null, note: STRIPE_FAILED_NOTE, failed: true };
}

// --- Plan switches while comped ------------------------------------------------

/**
 * BEFORE an in-app plan switch that is charged now (the portal's confirm
 * page): a comp coupon must not free the switch's invoice when the new plan
 * leaves its cover — an annual price (the coupon would free the year) or a
 * tier above the comp. The coupon comes off and the rest of the comp goes on
 * the balance credit (#688's), held there for a day (`COMP_SWITCH_HOLD_KEY`:
 * the customer may still be on the confirm page). A switch inside the
 * comp's cover (a Pro comp on Plus, switching to Pro monthly) keeps it.
 *
 * Throws when Stripe can't be moved: the caller must NOT open the switch then.
 */
export async function moveCompOffCouponForSwitch(
  stripe: Stripe,
  live: Stripe.Subscription,
  input: { userId: string; comp: CompFacts; target: { tier: PlanTier; period: BillingPeriod }; now?: Date },
): Promise<{ moved: boolean; note: string | null }> {
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const sub = await stripe.subscriptions.retrieve(live.id, { expand: SUB_EXPAND });
  const facts = sub as unknown as CouponSubFacts;
  if (discountsOf(facts).unreadable) throw new Error("subscription discounts not expanded");
  if (!activeCompDiscountOf(facts, nowSec)) return { moved: false, note: null };
  const stays = input.target.period === "monthly" && compHoldReason(input.comp, input.target.tier, nowSec) == null;
  if (stays) return { moved: false, note: null };
  const subscribedTier = (await resolveSubscriptionTier(sub, stripe)) ?? input.target.tier;
  const held = await stripe.subscriptions.update(sub.id, {
    metadata: { [COMP_SWITCH_HOLD_KEY]: String(nowSec) },
    expand: SUB_EXPAND,
  });
  const outcome = await applyCreditPath(stripe, held, subscribedTier, input.comp, input.now, input.userId);
  if (outcome.failed) throw new Error(outcome.note ?? "comp could not be moved off the coupon");
  return { moved: true, note: outcome.note };
}

/**
 * After `customer.subscription.updated`: when the plan no longer matches
 * how its comp is paid for (a switch between monthly and annual, a tier
 * above the comp, a switch hold that has run out, a #688 credit on a monthly
 * plan), re-run the comp on Stripe's CURRENT subscription. Idempotent — a
 * matching plan writes nothing, so its own update event stops here. Never
 * throws (the webhook's sync is what must succeed).
 */
export async function reconcileCompBilling(
  admin: AdminClient,
  stripe: Stripe,
  userId: string,
  eventSub: Stripe.Subscription,
  subscribedTier: PlanTier | null,
  now?: Date,
): Promise<CompStripeOutcome | null> {
  if (eventSub.status !== "active" || !hasCompBillingGrant(eventSub.metadata)) return null;
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
