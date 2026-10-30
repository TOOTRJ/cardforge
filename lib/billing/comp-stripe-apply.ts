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
  type CompCreditChange,
  type CompFacts,
  type CompTrialChange,
} from "@/lib/billing/comp-stripe";
import {
  clawBackCustomerBalance,
  creditCustomerBalance,
  netCreditPosted,
  periodCreditCents,
  unspentCreditCents,
} from "@/lib/billing/balance-credit";
import { formatMoney } from "@/lib/format/money";
import type { PlanTier } from "@/lib/billing/plans";

type AdminClient = ReturnType<typeof createAdminClient>;

export type CompStripeOutcome = {
  change: CompTrialChange | null;
  /** ISO trial end the subscription now has, when this call moved it. */
  trialEnd: string | null;
  /** A balance settlement on an ACTIVE plan (owner answer 1): what was
   *  posted — `postedCents` > 0 credited, < 0 clawed back. */
  credit?: { change: CompCreditChange; postedCents: number; keptCents: number; currency: string } | null;
  /** One line for the admin (null: nothing to say). */
  note: string | null;
  /** Stripe could not be read or written — the comp is saved all the same. */
  failed: boolean;
};

const NOTHING: CompStripeOutcome = { change: null, trialEnd: null, note: null, failed: false };

const STRIPE_FAILED_NOTE =
  "Stripe couldn't be updated — their subscription bills on its own dates. Try saving the comp again.";

/**
 * Bring the user's live Stripe subscription in line with their comp
 * (lib/billing/comp-stripe.ts) AFTER the profile's comp columns were written.
 * Best effort: the comp itself is the profile row; a Stripe failure is
 * reported, logged, and leaves the subscription as it was.
 *
 *   trialing → the trial is held to the comp's end (or put back);
 *   active   → the comp period's share of the price goes on the customer
 *              balance (or the unused part comes back).
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
    sub = await stripe.subscriptions.retrieve(subId);
    // The tier the subscription PAYS for, read from Stripe itself — the
    // profile's copy can lag a plan switch the webhook hasn't synced yet.
    subscribedTier =
      (await resolveSubscriptionTier(sub, stripe)) ?? ((profile?.subscription_tier ?? "free") as PlanTier);
  } catch (error) {
    return failed(userId, error);
  }

  if (sub.status === "active") {
    return applyCredit(stripe, sub, subscribedTier, comp, deps.now, userId);
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

/** An ACTIVE subscription: settle the comp's balance credit against the
 *  Stripe ledger (one key per grant; only the difference moves). */
async function applyCredit(
  stripe: Stripe,
  sub: Stripe.Subscription,
  subscribedTier: PlanTier,
  comp: CompFacts,
  now: Date | undefined,
  userId: string,
): Promise<CompStripeOutcome> {
  const change = compCreditChangeFor({ sub, subscribedTier, comp, now });
  const price = sub.items?.data?.[0]?.price ?? null;
  const currency = price?.currency ?? "usd";
  const money = (cents: number) => formatMoney(cents, currency);
  if (change.kind === "none") {
    return {
      change: null,
      trialEnd: null,
      credit: { change, postedCents: 0, keptCents: 0, currency },
      note: compCreditNote(change, { postedCents: 0, keptCents: 0, money }),
      failed: false,
    };
  }
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return failed(userId, new Error("subscription has no customer"));

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
    return out;
  }
  return {
    change: null,
    trialEnd: null,
    credit: { change, postedCents, keptCents, currency },
    note: compCreditNote(change, { postedCents, keptCents, money }),
    failed: false,
  };
}

function failed(userId: string, error: unknown): CompStripeOutcome {
  console.warn(
    `applyCompToSubscription(${userId}): stripe error`,
    error instanceof Error ? error.message : error,
  );
  return { change: null, trialEnd: null, note: STRIPE_FAILED_NOTE, failed: true };
}
