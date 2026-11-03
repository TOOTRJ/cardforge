import { TIER_RANK, type PlanTier } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// What an admin comp does to a LIVE Stripe subscription (audit 2026-10-30).
//
// A comp is a profile overlay (`profiles.comp_tier` / `comp_expires_at`,
// lib/billing/entitlements.ts): it raises the perks and never touched Stripe.
// So a user on a card-backed trial who was comped a free month was CHARGED
// when the 7-day trial ended — inside the "free" month — and the comp then
// covered perks they were already paying for. The owner's rule: a comp month
// is free, and the month after it is charged NORMALLY.
//
// The rule, two pure decisions (`compTrialChangeFor`, `compCreditChangeFor`):
//   • a TRIALING subscription that renews (not cancelled) under a comp of the
//     same or a higher tier with an end date: the trial is moved to end when
//     the comp ends (`trial_end` = the later of the two, never earlier than
//     Stripe's own), so the first charge lands the moment the comp ends — at
//     the subscription's own price ("charged normally"). The trial end it had
//     before the comp is kept in the subscription's metadata
//     (`TRIAL_END_BEFORE_COMP_KEY`), so clearing or shortening the comp puts it
//     back (or ends the trial now when that date has passed — the charge it
//     would have made already).
//   • an ACTIVE subscription (owner answer 1, 2026-10-30): the payer pays
//     NOTHING for the comp period — the comp's share of the subscription's
//     own price goes on the Stripe CUSTOMER BALANCE (`compCreditChangeFor`,
//     priced by lib/billing/balance-credit.ts `periodCreditCents`), and
//     Stripe takes it off the next invoices. Status, dates and trial are
//     untouched. One ledger key per comp grant (the subscription's
//     `COMP_CREDIT_GRANT_KEY` metadata names the grant; each balance
//     transaction carries it), so a re-save posts only the difference.
//     Shortening or revoking claws back the part not yet lived through,
//     capped at the credit still unspent on the balance.
//   • a cancelled (ending) subscription: left alone — it stops on its date and
//     the comp carries the perks after it; nothing is charged after the comp.
//   • a comp with NO end date on a trialing or paying user is REFUSED by the
//     admin action (owner answer 2, `compNeedsEndDate`); a free user may
//     still be comped with no expiry. Nor may such a comp run past 730 days
//     (Stripe's trial limit; the same bound for a credit).
//   • clearing a comp after the trial's own end has passed ends the trial
//     NOW and charges — the charge it would have made anyway (owner answer 3).
// ---------------------------------------------------------------------------

/** Subscription metadata key: the trial end (unix seconds) before a comp
 *  moved it. Cleared ("") when the comp no longer holds the trial. */
export const TRIAL_END_BEFORE_COMP_KEY = "pipglyph_trial_end_before_comp";

/** Stripe refuses a trial end more than 730 days out. */
export const MAX_TRIAL_SECONDS = 730 * 86_400;

export type CompSubscriptionFacts = {
  status: string | null | undefined;
  trial_end?: number | null;
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  metadata?: Record<string, string> | null;
};

export type CompTrialChange =
  | {
      kind: "set_trial_end";
      /** Unix seconds, or "now" (the trial is over: charge as it would have). */
      trialEnd: number | "now";
      /** The metadata value to write: the pre-comp trial end, or "" to clear. */
      beforeComp: string;
      /** Why: the comp holds the trial, or it no longer does. */
      reason: "comp_holds_trial" | "comp_released_trial";
    }
  | {
      kind: "none";
      reason:
        | "not_trialing"
        | "ending"
        | "comp_lower_tier"
        | "comp_no_expiry"
        | "comp_too_long"
        | "unchanged"
        | "no_comp";
    };

export type CompFacts = { tier: PlanTier | null; expiresAt: string | null };

function storedBeforeComp(sub: CompSubscriptionFacts): number | null {
  const raw = sub.metadata?.[TRIAL_END_BEFORE_COMP_KEY];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Is the subscription set to stop (either way Stripe says it on the object
 *  itself)? A schedule ending in a cancellation is not created by this app. */
function isEnding(sub: CompSubscriptionFacts): boolean {
  return Boolean(sub.cancel_at_period_end) || typeof sub.cancel_at === "number";
}

/**
 * The trial change a comp needs on the subscription the profile points at.
 * `subscribedTier` is the tier that subscription pays for.
 */
export function compTrialChangeFor(input: {
  sub: CompSubscriptionFacts;
  subscribedTier: PlanTier;
  comp: CompFacts;
  now?: Date;
}): CompTrialChange {
  const { sub, subscribedTier, comp } = input;
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (sub.status !== "trialing" || typeof sub.trial_end !== "number") {
    return { kind: "none", reason: "not_trialing" };
  }
  if (isEnding(sub)) return { kind: "none", reason: "ending" };

  const before = storedBeforeComp(sub);
  const original = before ?? sub.trial_end;

  // Does a comp hold this trial? Active, dated, at or above the plan paid for.
  const compExpirySec = comp.expiresAt ? Math.floor(Date.parse(comp.expiresAt) / 1000) : null;
  const compActive = comp.tier != null && (compExpirySec == null || compExpirySec > nowSec);
  let why: "comp_lower_tier" | "comp_no_expiry" | "comp_too_long" | "no_comp" | null = null;
  if (!compActive) why = "no_comp";
  else if (TIER_RANK[comp.tier as PlanTier] < TIER_RANK[subscribedTier]) why = "comp_lower_tier";
  else if (compExpirySec == null) why = "comp_no_expiry";
  else if (compExpirySec - nowSec > MAX_TRIAL_SECONDS) why = "comp_too_long";

  if (why == null) {
    const target = Math.max(original, compExpirySec as number);
    // Already there — or the trial outlasts the comp: nothing to move.
    if (target === sub.trial_end) return { kind: "none", reason: "unchanged" };
    return {
      kind: "set_trial_end",
      trialEnd: target,
      beforeComp: String(original),
      reason: "comp_holds_trial",
    };
  }

  // No comp holds the trial. If an earlier comp moved it, put it back.
  if (before != null) {
    return {
      kind: "set_trial_end",
      trialEnd: before > nowSec ? before : "now",
      beforeComp: "",
      reason: "comp_released_trial",
    };
  }
  return { kind: "none", reason: why };
}

/** One line for the admin toast / the user's notification. */
export function compStripeNote(change: CompTrialChange, opts: { live: boolean }): string | null {
  if (change.kind === "set_trial_end") {
    if (change.trialEnd === "now") return "Their trial had already passed its own end, so it ends now and is charged.";
    return change.reason === "comp_holds_trial"
      ? "Their Stripe trial now ends when the comp ends — the first charge lands then."
      : "Their Stripe trial is back on its own end date.";
  }
  if (!opts.live) return null;
  switch (change.reason) {
    case "not_trialing":
      return "Their Stripe subscription is neither trialing nor active, so it keeps billing on its own dates.";
    case "comp_no_expiry":
      return "No end date: their Stripe trial still converts and charges on its own date.";
    case "comp_too_long":
      return "Longer than Stripe allows for a trial: their trial still converts on its own date.";
    case "comp_lower_tier":
      return "The comp is below their plan, so it changes nothing.";
    default:
      return null;
  }
}

/** Stripe Checkout refuses a `trial_end` less than 48 hours out. */
export const CHECKOUT_MIN_TRIAL_SECONDS = 48 * 3600;

/**
 * A comped user who subscribes from the billing page is not charged while
 * the comp runs: Checkout starts the subscription with `trial_end` at the
 * comp's end (the same rule as above, for a subscription that doesn't exist
 * yet). Null when no comp holds it: none, expired, undated, below the plan
 * bought, too close for Checkout (48 h) or past Stripe's trial limit.
 */
export function compHoldsCheckoutUntil(
  comp: CompFacts,
  tier: PlanTier,
  now: Date = new Date(),
): number | null {
  if (comp.tier == null || comp.expiresAt == null) return null;
  if (TIER_RANK[comp.tier] < TIER_RANK[tier]) return null;
  const nowSec = Math.floor(now.getTime() / 1000);
  const end = Math.floor(Date.parse(comp.expiresAt) / 1000);
  if (!Number.isFinite(end)) return null;
  if (end - nowSec < CHECKOUT_MIN_TRIAL_SECONDS || end - nowSec > MAX_TRIAL_SECONDS) return null;
  return end;
}

/**
 * A comp that applies ON TOP of a live subscription (the billing page's
 * extra line — `comped` there means "no subscription"): unexpired and at or
 * above the plan paid for, else null. Same resolution as effectiveTierForProfile.
 */
export function compOverLiveSubscription(
  profile: { comp_tier?: string | null; comp_expires_at?: string | null; subscription_tier?: string | null },
  now: Date = new Date(),
): { tier: PlanTier; expiresAt: string | null } | null {
  const tier = profile.comp_tier === "plus" || profile.comp_tier === "pro" ? profile.comp_tier : null;
  if (!tier) return null;
  if (profile.comp_expires_at && Date.parse(profile.comp_expires_at) <= now.getTime()) return null;
  const paid = (profile.subscription_tier ?? "free") as PlanTier;
  // Below the plan paid for, it changes nothing. The SAME tier still counts:
  // it can hold a trial (compTrialChangeFor), and the page says so.
  if (TIER_RANK[tier] < TIER_RANK[paid]) return null;
  return { tier, expiresAt: profile.comp_expires_at ?? null };
}

/**
 * What the billing page says about the next charge under a comp over a live
 * plan. "Nothing is charged before then" ONLY when Stripe's own trial
 * really runs to the comp's end — a comp the trial could not be held for
 * (or a hold that failed) must not promise it.
 */
export function liveCompChargeLine(input: {
  status: string | null | undefined;
  ending: boolean;
  compExpiresAt: string | null;
  stripeTrialEnd: string | null | undefined;
}): "trial_held" | "balance_credit" | "own_dates" {
  if (!input.compExpiresAt) return "own_dates";
  if (input.status === "trialing") {
    return input.stripeTrialEnd != null && Date.parse(input.stripeTrialEnd) >= Date.parse(input.compExpiresAt)
      ? "trial_held"
      : "own_dates";
  }
  return input.status === "active" && !input.ending ? "balance_credit" : "own_dates";
}

// ---------------------------------------------------------------------------
// A comp on an ACTIVE (paying) subscription → a customer-balance credit
// (owner answer 1, 2026-10-30). docs/BILLING.md "Comps and a live
// subscription" has the maths; lib/billing/balance-credit.ts prices it.
// ---------------------------------------------------------------------------

/** Subscription metadata key naming the comp GRANT whose credit is on the
 *  customer's balance: `<startSec>:<endSec>` (the period it pays for). "" /
 *  absent = none. A grant whose end has passed is finished: the next comp
 *  opens a new one. */
export const COMP_CREDIT_GRANT_KEY = "pipglyph_comp_credit";

/** Balance-transaction metadata key: the ledger key of the grant a credit or
 *  claw-back belongs to (`compCreditLedgerKey`). */
export const COMP_CREDIT_LEDGER_KEY = "pipglyph_comp_grant";

export type CompCreditGrant = { startSec: number; endSec: number };

export function parseCompCreditGrant(meta: Record<string, string> | null | undefined): CompCreditGrant | null {
  const raw = meta?.[COMP_CREDIT_GRANT_KEY];
  if (!raw) return null;
  const m = /^(\d+):(\d+)$/.exec(raw);
  if (!m) return null;
  const startSec = Number(m[1]);
  const endSec = Number(m[2]);
  return endSec > startSec ? { startSec, endSec } : null;
}

/** One ledger key per comp grant: the subscription and the grant's start. */
export function compCreditLedgerKey(subscriptionId: string, grant: CompCreditGrant): string {
  return `comp:${subscriptionId}:${grant.startSec}`;
}

export type CompCreditChange =
  | {
      kind: "settle";
      /** The grant the credit belongs to (its START never moves). */
      grant: CompCreditGrant;
      /** The credit should pay for [grant.startSec, coverUntilSec). */
      coverUntilSec: number;
      /** The metadata to write (`<start>:<end>`, or "" once released). */
      grantMeta: string;
      /** A new grant writes its metadata BEFORE any money moves. */
      opensGrant: boolean;
      /**
       * comp_credits_period: a new or re-saved comp (credit the difference,
       *   or claw back when the ledger is over — a shortened comp);
       * comp_released: the comp no longer holds — only a CLAW-BACK of the
       *   time not yet lived through, never a fresh credit.
       */
      reason: "comp_credits_period" | "comp_released";
    }
  | {
      kind: "none";
      reason: "not_active" | "ending" | "comp_lower_tier" | "comp_no_expiry" | "comp_too_long" | "no_comp";
    };

/**
 * The balance credit a comp needs on an ACTIVE subscription. Pure: the
 * amounts are priced by the writer from the subscription's price and the
 * ledger (Stripe's balance transactions under `compCreditLedgerKey`).
 */
export function compCreditChangeFor(input: {
  sub: CompSubscriptionFacts;
  subscribedTier: PlanTier;
  comp: CompFacts;
  now?: Date;
}): CompCreditChange {
  const { sub, subscribedTier, comp } = input;
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (sub.status !== "active") return { kind: "none", reason: "not_active" };

  const stored = parseCompCreditGrant(sub.metadata);
  const open = stored && stored.endSec > nowSec ? stored : null;

  const compExpirySec = comp.expiresAt ? Math.floor(Date.parse(comp.expiresAt) / 1000) : null;
  const compActive = comp.tier != null && (compExpirySec == null || compExpirySec > nowSec);
  let why: "comp_lower_tier" | "comp_no_expiry" | "comp_too_long" | "no_comp" | null = null;
  if (!compActive) why = "no_comp";
  else if (TIER_RANK[comp.tier as PlanTier] < TIER_RANK[subscribedTier]) why = "comp_lower_tier";
  else if (compExpirySec == null) why = "comp_no_expiry";
  else if (compExpirySec - nowSec > MAX_TRIAL_SECONDS) why = "comp_too_long";

  if (why == null) {
    const end = compExpirySec as number;
    if (open) {
      return {
        kind: "settle",
        grant: open,
        // One grant pays for at most 730 days from its start.
        coverUntilSec: Math.min(end, open.startSec + MAX_TRIAL_SECONDS),
        grantMeta: `${open.startSec}:${end}`,
        opensGrant: false,
        reason: "comp_credits_period",
      };
    }
    // A plan set to stop never sees another invoice: a credit would sit on
    // the balance unused. The comp carries the perks after it ends.
    if (isEnding(sub)) return { kind: "none", reason: "ending" };
    return {
      kind: "settle",
      grant: { startSec: nowSec, endSec: end },
      coverUntilSec: end,
      grantMeta: `${nowSec}:${end}`,
      opensGrant: true,
      reason: "comp_credits_period",
    };
  }

  // No comp holds the plan any more: the time already lived through stays
  // paid for; the rest comes back (capped at what is unspent — the writer).
  if (open) {
    return {
      kind: "settle",
      grant: open,
      coverUntilSec: Math.max(open.startSec, Math.min(open.endSec, nowSec)),
      grantMeta: "",
      opensGrant: false,
      reason: "comp_released",
    };
  }
  return { kind: "none", reason: why === "no_comp" && isEnding(sub) ? "ending" : why };
}

/** The admin toast's line for a balance settlement (cents > 0 credited,
 *  < 0 clawed back; `keptCents` = a claw-back the unspent cap stopped). */
export function compCreditNote(
  change: CompCreditChange,
  moved: { postedCents: number; keptCents: number; money: (cents: number) => string },
): string | null {
  if (change.kind === "none") {
    switch (change.reason) {
      case "ending":
        return "Their plan is cancelled and stops on its own date, so nothing is credited; the comp carries the perks after it.";
      case "comp_lower_tier":
        return "The comp is below their plan, so it changes nothing.";
      default:
        return null;
    }
  }
  const { postedCents, keptCents, money } = moved;
  const kept = keptCents > 0 ? ` ${money(keptCents)} had already paid an invoice and stays with them.` : "";
  if (postedCents > 0) {
    return `Credited ${money(postedCents)} to their Stripe balance for the comp period — their next invoices take it, so they pay nothing for it.`;
  }
  if (postedCents < 0) return `Took back ${money(-postedCents)} of unused comp credit from their Stripe balance.${kept}`;
  if (keptCents > 0) return `No unused comp credit was left to take back.${kept}`;
  return change.reason === "comp_released"
    ? "No comp credit was left to take back."
    : "Their comp credit is already on their Stripe balance.";
}

/** The subscription statuses that are "trialing or paying": a comp on them
 *  needs an end date (owner answer 2, 2026-10-30) — Stripe can't hold a
 *  trial open-ended, and an open-ended credit has no amount. `past_due` is
 *  a payer in dunning: Stripe still retries the card. */
const NEEDS_END_DATE = new Set(["trialing", "active", "past_due"]);

export function compNeedsEndDate(subscriptionStatus: string | null | undefined): boolean {
  return NEEDS_END_DATE.has(subscriptionStatus ?? "");
}

/** The admin action's refusal for a comp a live subscription can't take, or
 *  null when it may be saved. */
export function compEndDateError(input: {
  subscriptionStatus: string | null | undefined;
  tier: PlanTier | null;
  expiresAt: string | null;
  now?: Date;
}): string | null {
  if (input.tier == null || !compNeedsEndDate(input.subscriptionStatus)) return null;
  if (input.expiresAt == null) {
    return "This user has a live Stripe subscription (trialing or paying): set an expiry date. A comp with no end date is for free users only.";
  }
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const end = Math.floor(Date.parse(input.expiresAt) / 1000);
  if (end - nowSec > MAX_TRIAL_SECONDS) {
    return "A comp on a live Stripe subscription can run at most 730 days. Pick an earlier expiry.";
  }
  return null;
}
