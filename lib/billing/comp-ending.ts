import { TIER_RANK, type PlanTier } from "@/lib/billing/plans";
import { TRIAL_END_BEFORE_COMP_KEY } from "@/lib/billing/comp-stripe";

// ---------------------------------------------------------------------------
// "Your complimentary plan ends soon" (owner 2026-11-02) — the pure half.
// The daily cron (/api/cron/comp-ending → lib/billing/comp-ending-run.ts)
// tells EVERY user whose admin comp is about to end, 7 days and 1 day before
// `comp_expires_at`: a `comp_ending` notification + an "account" email.
//
//   window   the comp ends in (now + 1 d, now + 7 d] → "7d";
//            in (now, now + 1 d] → "1d". A daily run that missed a day
//            still catches each window; a comp set inside a window is told
//            once for it. Expired, cleared and undated comps are never told.
//   dedupe   ONE per comp per window: `comp_ending:<end epoch>:<window>`,
//            a unique partial index (0161) on it + the recipient. The key
//            carries the comp's END, so a re-dated comp is told afresh.
//   kind     what the end MEANS, read from Stripe's CURRENT subscription:
//              free        no live plan (or one that ends with the comp):
//                          back on Free — what they keep + the upgrade link;
//              held_trial  the comp holds a card-backed trial
//                          (lib/billing/comp-stripe.ts): the card is charged
//                          the plan's price at the comp's end;
//              paying      an active plan (or a trial that runs on past the
//                          comp): the next invoice is charged as usual;
//              plan_ending a cancelled plan that runs past the comp: it
//                          ends on its own date, nothing more is charged.
//   one email per moment: a comp-held trial is ALSO reminded by Stripe's
//            trial_will_end (3 days before — the trial reminder speaks for
//            the comp there, lib/stripe/webhook-handlers.ts), so the 1-day
//            `comp_ending` SKIPS a held trial; its 7-day one is sent.
// ---------------------------------------------------------------------------

export type CompEndingWindow = "7d" | "1d";
export type CompEndingKind = "free" | "held_trial" | "paying" | "plan_ending";

const DAY_MS = 86_400_000;
/** The look-ahead the cron reads: the widest window. */
export const COMP_ENDING_LOOKAHEAD_MS = 7 * DAY_MS;
/** A comp-held trial ends at the comp's end, to the second (Checkout and
 *  the admin's hold both write the comp's floor(seconds)); a minute of play. */
const HELD_TRIAL_TOLERANCE_SECONDS = 60;

/** The window a comp ending at `expiresAt` is in, or null (not yet, past,
 *  unreadable). */
export function compEndingWindowOf(expiresAt: string | null | undefined, now: Date = new Date()): CompEndingWindow | null {
  if (!expiresAt) return null;
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return null;
  const left = end - now.getTime();
  if (left <= 0) return null;
  if (left <= DAY_MS) return "1d";
  if (left <= COMP_ENDING_LOOKAHEAD_MS) return "7d";
  return null;
}

/** One reminder per comp per window — the comp's END is in the key. */
export function compEndingDedupeKey(expiresAt: string, window: CompEndingWindow): string {
  return `comp_ending:${Math.floor(Date.parse(expiresAt) / 1000)}:${window}`;
}

export type CompEndingSub = {
  status: string;
  trial_end?: number | null;
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  current_period_end?: number | null;
  metadata?: Record<string, string> | null;
  items?: { data?: Array<{ current_period_end?: number | null }> } | null;
};

/** Does a comp HOLD this trial — the trial a comp moved (or Checkout started
 *  held) and that ends when the comp ends? The ONE test: the trial reminder
 *  rewords itself on it, and the 1-day comp reminder stands down on it. */
export function isCompHeldTrial(sub: CompEndingSub | null | undefined, compExpiresAt: string | null | undefined): boolean {
  if (!sub || sub.status !== "trialing" || typeof sub.trial_end !== "number") return false;
  if (!sub.metadata?.[TRIAL_END_BEFORE_COMP_KEY]) return false;
  if (!compExpiresAt) return false;
  const compSec = Math.floor(Date.parse(compExpiresAt) / 1000);
  if (!Number.isFinite(compSec)) return false;
  return Math.abs(sub.trial_end - compSec) <= HELD_TRIAL_TOLERANCE_SECONDS;
}

function periodEndOf(sub: CompEndingSub): number | null {
  const item = sub.items?.data?.[0]?.current_period_end;
  if (typeof item === "number") return item;
  return typeof sub.current_period_end === "number" ? sub.current_period_end : null;
}

const LIVE = new Set(["trialing", "active", "past_due"]);

export type CompEndingPlan =
  | { send: true; kind: "free" }
  | { send: true; kind: "held_trial" }
  | { send: true; kind: "paying"; nextChargeAt: string | null }
  | { send: true; kind: "plan_ending"; planEndsAt: string }
  | { send: false; reason: "comp_below_plan" | "trial_reminder_covers" };

/**
 * What a comp's end means for this user, from Stripe's CURRENT subscription
 * (`sub` null = none, or none live). `subscribedTier` is the tier that
 * subscription pays for.
 */
export function compEndingPlanFor(input: {
  compTier: PlanTier;
  compExpiresAt: string;
  window: CompEndingWindow;
  sub: CompEndingSub | null;
  subscribedTier: PlanTier | null;
  /** A `trial_ending` reminder (compHold) already went out for THIS trial
   *  end — read by the runner only for a held trial's 1-day window. */
  trialReminderSent?: boolean;
}): CompEndingPlan {
  const { sub } = input;
  if (!sub || !LIVE.has(sub.status)) return { send: true, kind: "free" };
  // A comp below the plan paid for changed nothing — its end changes nothing.
  if (input.subscribedTier && TIER_RANK[input.compTier] < TIER_RANK[input.subscribedTier]) {
    return { send: false, reason: "comp_below_plan" };
  }
  const compSec = Math.floor(Date.parse(input.compExpiresAt) / 1000);
  const ending = Boolean(sub.cancel_at_period_end) || typeof sub.cancel_at === "number";
  if (ending) {
    const endsSec = typeof sub.cancel_at === "number" ? sub.cancel_at : (periodEndOf(sub) ?? compSec);
    return endsSec <= compSec + HELD_TRIAL_TOLERANCE_SECONDS
      ? { send: true, kind: "free" }
      : { send: true, kind: "plan_ending", planEndsAt: new Date(endsSec * 1000).toISOString() };
  }
  if (isCompHeldTrial(sub, input.compExpiresAt)) {
    // 1 day out, the trial reminder (3 days out, reworded for the comp)
    // speaks for this moment — but ONLY when it really went out for this
    // end: a comp re-dated to end within a day may get no trial_will_end
    // from Stripe at all, and the user must not be charged unreminded.
    return input.window === "1d" && input.trialReminderSent === true
      ? { send: false, reason: "trial_reminder_covers" }
      : { send: true, kind: "held_trial" };
  }
  const next =
    sub.status === "trialing" && typeof sub.trial_end === "number" ? sub.trial_end : periodEndOf(sub);
  // A next charge INSIDE the comp (a plan the days could not be added to:
  // past due, or a hold that failed) is not "after the comp" — no date is
  // named then; the copy says invoices after the comp's end are charged as
  // usual.
  return {
    send: true,
    kind: "paying",
    nextChargeAt: next != null && next > compSec ? new Date(next * 1000).toISOString() : null,
  };
}

/** The `comp_ending` notification payload (also the email's input). */
export type CompEndingPayload = {
  dedupeKey: string;
  window: CompEndingWindow;
  kind: CompEndingKind;
  /** The COMP's tier (what ends). */
  tier: PlanTier;
  /** The tier the live subscription PAYS for — what they go back to; absent
   *  with no live plan. Differs from `tier` when a payer was comped higher. */
  subscribedTier?: PlanTier | null;
  expiresAt: string;
  /** "$6 / month" — the subscription's own price from Stripe. */
  priceLabel?: string | null;
  /** The next charge, only when it falls after the comp's end. */
  nextChargeAt?: string | null;
  cardLast4?: string | null;
  /** Held trial: a card (or other payment method) is on file. */
  hasPaymentMethod?: boolean;
  planEndsAt?: string | null;
};
