import { TIER_RANK, type PlanTier } from "@/lib/billing/plans";
import { addMonthsUtc, periodMonthsAndDays } from "@/lib/billing/balance-credit";
import {
  MAX_TRIAL_SECONDS,
  TRIAL_END_BEFORE_COMP_KEY,
  compCreditChangeFor,
  compTrialChangeFor,
  parseCompCreditGrant,
  type CompFacts,
  type CompSubscriptionFacts,
} from "@/lib/billing/comp-stripe";
import { formatUtcDate } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// A comp on a MONTHLY paid plan → a 100%-off repeating COUPON (TODO BL1,
// owner 2026-11-02, after #688). The pure half; the writer is
// lib/billing/comp-stripe-apply.ts.
//
// #688 credited the customer BALANCE for a comp on an active plan. A credit
// is spent by billing period, so a comp that started just before a renewal
// paid that whole renewal and a revoke could only claw back what was still
// unspent (sandbox: ~$4.42 kept for an 8-day comp). On a MONTHLY plan the
// comp is now a Stripe coupon on the subscription instead:
//
//   • 100 % off, `duration: "repeating"`, `duration_in_months` = the comp's
//     months — the coupon frees exactly that many monthly invoices and the
//     invoice after them is charged as usual. Nothing is pro-rated; the
//     invoices name the comp ("PipGlyph complimentary plan").
//   • ONE coupon per length, reused by a DETERMINISTIC id
//     (`compCouponId(months)` = `pipglyph_comp_100off_<n>m`), created by the
//     server on first use. Never a promotion code, never a code a client can
//     send: the id only ever reaches Stripe from this module's writer.
//   • The comp's months: whole calendar months from the grant's start to the
//     comp's end (`periodMonthsAndDays`: a period ending within a day of a
//     whole month counts as that month), leftover days ≥ 15 rounding UP to
//     one more month. A comp under half a month frees no invoice.
//   • ONE grant per comp, named in the subscription's metadata
//     (`COMP_COUPON_GRANT_KEY` = `<startSec>:<endSec>:<months>`), written in
//     the SAME update that attaches or removes the discount — so a re-save
//     reads it and does nothing (idempotent: never a second coupon, never a
//     double discount). Extending or shortening a running comp keeps the
//     grant's start and re-sizes the coupon to the months still owed
//     (`months − the renewals already freed since the start`).
//   • Revoking (clearing, dropping below the plan) removes the discount: the
//     next invoice is charged as usual. An invoice already issued at $0
//     stays as it is (nothing is pro-rated, nothing clawed back).
//   • ANNUAL plans keep #688's pro-rated balance credit — a 100 % coupon on
//     an annual price would free the whole year.
//   • NO PLAN SWITCH while a comp is on (owner 2026-11-02, after the
//     independent check: every way of moving a comp between the coupon and
//     the credit around a switch leaked money). The app refuses every
//     switch (lib/billing/comp-switch-lock.ts), the portal opens without
//     plan switching for a comped customer (lib/stripe/portal.ts), and a
//     comp change releases a scheduled downgrade FIRST
//     (`releaseScheduleForCompChange`, lib/billing/comp-stripe-apply.ts).
//   • A #688 balance credit already running is NEVER moved onto a coupon
//     (owner 2026-11-02): it runs out under #688's rules — a claw-back while
//     a renewal's invoice is still a draft (the balance is applied when it
//     FINALIZES, about an hour later) charged a comped user.
// // ---------------------------------------------------------------------------

/** Every comp coupon id starts with this; nothing else does. */
export const COMP_COUPON_PREFIX = "pipglyph_comp_100off_";

/** Subscription metadata key naming the coupon GRANT: `<startSec>:<endSec>:
 *  <months>` — the comp it frees invoices for and how many in all. "" /
 *  absent = none. */
export const COMP_COUPON_GRANT_KEY = "pipglyph_comp_coupon";

/**
 * The comp's leftover days that round up to one more free invoice — and so
 * the shortest comp that frees an invoice on a MONTHLY plan at all: a comp
 * under 15 days covers no invoice (its perks still apply; the plan bills as
 * usual). Owner 2026-11-02 (BL1): keep it at 15 days. The admin's comp
 * form says it (`COMP_COUPON_SHORT_NOTE`); docs/BILLING.md has the rule.
 */
export const COMP_COUPON_ROUND_UP_DAYS = 15;

/** The comp form's line for the rule above. */
export const COMP_COUPON_SHORT_NOTE = `On a monthly plan, a comp under ${COMP_COUPON_ROUND_UP_DAYS} days doesn't cover an invoice (15 days or more over whole months frees one more).`;

/** Stripe refuses a coupon `name` longer than this ("must be at most 40
 *  characters") — the sandbox run caught the first name (43). */
export const STRIPE_COUPON_NAME_MAX = 40;

/** The coupon's name on invoices and receipts (≤ 39 characters for any
 *  comp a save allows — 730 days at most, so two-digit months). */
export function compCouponName(months: number): string {
  return `PipGlyph complimentary (${months} month${months === 1 ? "" : "s"} free)`;
}

/** The ONE coupon id for a comp of `months` monthly invoices. */
export function compCouponId(months: number): string {
  if (!Number.isInteger(months) || months < 1) throw new Error(`compCouponId: bad months ${months}`);
  return `${COMP_COUPON_PREFIX}${months}m`;
}

export function isCompCouponId(id: string | null | undefined): boolean {
  return typeof id === "string" && /^pipglyph_comp_100off_\d+m$/.test(id);
}

/** The coupon Stripe holds under one of our ids is exactly what we create —
 *  anything else (edited in the dashboard, a stranger's) is never applied. */
export function isCompCouponShape(
  coupon: {
    id?: string | null;
    percent_off?: number | null;
    amount_off?: number | null;
    duration?: string | null;
    duration_in_months?: number | null;
    valid?: boolean | null;
  },
  months: number,
): boolean {
  return (
    coupon.id === compCouponId(months) &&
    coupon.percent_off === 100 &&
    (coupon.amount_off == null || coupon.amount_off === 0) &&
    coupon.duration === "repeating" &&
    coupon.duration_in_months === months &&
    coupon.valid !== false
  );
}

// --- The subscription as this module reads it --------------------------------

export type PriceLike = {
  unit_amount?: number | null;
  currency?: string | null;
  recurring?: { interval?: string | null; interval_count?: number | null } | null;
} | null;

export type DiscountLike = {
  id: string;
  start?: number | null;
  end?: number | null;
  source?: { coupon?: string | { id: string } | null } | null;
};

export type CouponSubFacts = {
  status: string | null | undefined;
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  billing_cycle_anchor?: number | null;
  metadata?: Record<string, string> | null;
  /** Read EXPANDED (`expand: ["discounts"]`): a bare id can't be told apart. */
  discounts?: Array<string | DiscountLike> | null;
  items?: {
    data?: Array<{
      current_period_start?: number | null;
      current_period_end?: number | null;
      price?: PriceLike;
    }>;
  } | null;
};

/** A price that bills every ONE month — the only kind the coupon is for. */
export function isMonthlyPrice(price: PriceLike | undefined): boolean {
  return price?.recurring?.interval === "month" && (price.recurring.interval_count ?? 1) === 1;
}

export function priceOf(sub: CouponSubFacts): PriceLike {
  return sub.items?.data?.[0]?.price ?? null;
}

function couponIdOf(discount: DiscountLike): string | null {
  const c = discount.source?.coupon;
  if (!c) return null;
  return typeof c === "string" ? c : c.id;
}

/** The discounts as objects; `unreadable` when one is a bare id (not
 *  expanded) — the writer then refuses rather than risk a second coupon. */
export function discountsOf(sub: CouponSubFacts): { list: DiscountLike[]; unreadable: boolean } {
  const list: DiscountLike[] = [];
  let unreadable = false;
  for (const d of sub.discounts ?? []) {
    if (typeof d === "string") unreadable = true;
    else if (d && typeof d.id === "string") list.push(d);
  }
  return { list, unreadable };
}

/** Our comp discount(s) on the subscription (normally at most one). */
export function compDiscountsOf(sub: CouponSubFacts): DiscountLike[] {
  return discountsOf(sub).list.filter((d) => isCompCouponId(couponIdOf(d)));
}

/** Our comp discount that is still running at `nowSec`, if any. */
export function activeCompDiscountOf(sub: CouponSubFacts, nowSec: number): DiscountLike | null {
  return compDiscountsOf(sub).find((d) => d.end == null || d.end > nowSec) ?? null;
}

export function couponMonthsOfDiscount(discount: DiscountLike): number | null {
  const m = /_(\d+)m$/.exec(couponIdOf(discount) ?? "");
  return m ? Number(m[1]) : null;
}

export type CompCouponGrant = { startSec: number; endSec: number; months: number };

export function parseCompCouponGrant(meta: Record<string, string> | null | undefined): CompCouponGrant | null {
  const raw = meta?.[COMP_COUPON_GRANT_KEY];
  if (!raw) return null;
  const m = /^(\d+):(\d+):(\d+)$/.exec(raw);
  if (!m) return null;
  const grant = { startSec: Number(m[1]), endSec: Number(m[2]), months: Number(m[3]) };
  return grant.endSec > grant.startSec ? grant : null;
}

export function compCouponGrantMeta(grant: CompCouponGrant): string {
  return `${grant.startSec}:${grant.endSec}:${grant.months}`;
}

/** How many monthly invoices a comp from `startSec` to `endSec` frees. */
export function compCouponMonths(startSec: number, endSec: number): number {
  const { months, days } = periodMonthsAndDays(startSec, endSec);
  return months + (days >= COMP_COUPON_ROUND_UP_DAYS ? 1 : 0);
}

// --- The plan's monthly renewals ---------------------------------------------

/**
 * The subscription's monthly renewal times (unix seconds) around `aroundSec`:
 * the billing-cycle anchor moved by whole calendar months (Stripe's own rule,
 * the day clamped to the month's last), checked against the current period's
 * end; that end itself is the base when the anchor doesn't land on it.
 */
function renewalSeries(sub: CouponSubFacts, aroundSec: number): number[] {
  const periodEnd = sub.items?.data?.[0]?.current_period_end ?? null;
  const anchor = sub.billing_cycle_anchor ?? null;
  let base = periodEnd ?? anchor;
  if (base == null) return [];
  if (anchor != null && periodEnd != null) {
    // Does the anchor's series reach the period end (± a minute)?
    const steps = Math.round((periodEnd - anchor) / (30.436875 * 86_400));
    const hit = [steps - 1, steps, steps + 1].some(
      (n) => Math.abs(Math.floor(addMonthsUtc(anchor * 1000, n) / 1000) - periodEnd) <= 60,
    );
    base = hit ? anchor : periodEnd;
  }
  const offset = Math.round((aroundSec - base) / (30.436875 * 86_400));
  const out: number[] = [];
  for (let n = offset - 30; n <= offset + 40; n += 1) {
    out.push(Math.floor(addMonthsUtc(base * 1000, n) / 1000));
  }
  return out;
}

/** Renewals in (afterSec, upToSec]. */
export function renewalsIn(sub: CouponSubFacts, afterSec: number, upToSec: number): number[] {
  if (!(upToSec > afterSec)) return [];
  return renewalSeries(sub, afterSec).filter((t) => t > afterSec && t <= upToSec);
}

/** The first renewal at or after `sec` (null when the series is unknown). */
export function firstRenewalAtOrAfter(sub: CouponSubFacts, sec: number): number | null {
  return renewalSeries(sub, sec).find((t) => t >= sec) ?? null;
}

/** What a coupon ending at `endSec` still frees, seen at `nowSec`: the free
 *  invoices left and the first one charged as usual. */
export function compCouponOutlook(
  sub: CouponSubFacts,
  endSec: number,
  nowSec: number,
): { freeInvoices: number; chargedFromSec: number | null } {
  return {
    freeInvoices: renewalsIn(sub, nowSec, endSec - 1).length,
    chargedFromSec: firstRenewalAtOrAfter(sub, Math.max(endSec, nowSec + 1)),
  };
}

/**
 * Where the coupon has already paid the plan up to: the end of the CURRENT
 * period when that period's invoice was one the comp's coupon freed, else
 * `nowSec`. Keyed off the comp's GRANT (its start never moves while it is
 * open) and a comp discount still on the subscription — never the
 * discount's own `start`: an extended or shortened comp's discount is
 * replaced mid-period, and its start says nothing about the invoice the
 * one before it freed. Used when a coupon comp must move onto the balance
 * credit (a plan changed outside the app), so that time is paid once.
 */
export function couponCoveredUntil(
  sub: CouponSubFacts,
  grant: CompCouponGrant | null,
  discount: DiscountLike | null,
  nowSec: number,
): number {
  const item = sub.items?.data?.[0];
  const start = item?.current_period_start ?? null;
  const end = item?.current_period_end ?? null;
  if (!grant || !discount || start == null || end == null) return nowSec;
  // The current period's invoice came after the grant began and before the
  // comp's end — with our discount still on, it was a free one.
  const inside = start >= grant.startSec - 60 && start < grant.endSec;
  return inside ? Math.max(nowSec, end) : nowSec;
}

// --- The decision --------------------------------------------------------------

export type CompCouponChange =
  | {
      kind: "apply";
      /** The grant (its START never moves while it is open). */
      grant: CompCouponGrant;
      /** The coupon to attach: the invoices still owed. */
      couponMonths: number;
      /** Our discount it replaces (removed in the same update), if any. */
      replaces: string | null;
      reason: "comp_frees_invoices";
    }
  | {
      kind: "keep";
      grant: CompCouponGrant;
      /** Our discount still on (null: its months are already freed — the
       *  grant alone stays named until the comp's end). */
      discountId: string | null;
      /** The grant's metadata when only its end moved inside the same months;
       *  null = nothing to write. */
      grantMeta: string | null;
    }
  | {
      kind: "remove";
      /** Our discount to take off (null: only the grant's metadata is left). */
      discountId: string | null;
      reason: "comp_released" | "comp_too_short";
      /** The grant's metadata to write with it — absent: the grant is
       *  closed (""); a value: the comp still holds and stays named. */
      grantMeta?: string;
    }
  | {
      kind: "none";
      reason:
        | "not_active"
        | "ending"
        | "comp_lower_tier"
        | "comp_no_expiry"
        | "comp_too_long"
        | "comp_too_short"
        | "no_comp";
    };

function isEnding(sub: CouponSubFacts): boolean {
  return Boolean(sub.cancel_at_period_end) || typeof sub.cancel_at === "number";
}

/** Does a comp hold a plan of `subscribedTier` at `nowSec`? The same rule as
 *  the trial hold and the credit (lib/billing/comp-stripe.ts). */
export function compHoldReason(
  comp: CompFacts,
  subscribedTier: PlanTier,
  nowSec: number,
): null | "comp_lower_tier" | "comp_no_expiry" | "comp_too_long" | "no_comp" {
  const compExpirySec = comp.expiresAt ? Math.floor(Date.parse(comp.expiresAt) / 1000) : null;
  const compActive = comp.tier != null && (compExpirySec == null || compExpirySec > nowSec);
  if (!compActive) return "no_comp";
  if (TIER_RANK[comp.tier as PlanTier] < TIER_RANK[subscribedTier]) return "comp_lower_tier";
  if (compExpirySec == null) return "comp_no_expiry";
  if (compExpirySec - nowSec > MAX_TRIAL_SECONDS) return "comp_too_long";
  return null;
}

/**
 * The coupon a comp needs on an ACTIVE MONTHLY subscription (`sub` read with
 * its discounts expanded). Pure; the writer attaches / removes it.
 */
export function compCouponChangeFor(input: {
  sub: CouponSubFacts;
  subscribedTier: PlanTier;
  comp: CompFacts;
  now?: Date;
}): CompCouponChange {
  const { sub, subscribedTier, comp } = input;
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const stored = parseCompCouponGrant(sub.metadata);
  const open = stored && stored.endSec > nowSec ? stored : null;
  const discount = activeCompDiscountOf(sub, nowSec);
  const why = compHoldReason(comp, subscribedTier, nowSec);

  // A CLEARED comp (no tier on the profile — an admin's revoke) takes our
  // discount off even after its grant ended: a rounded-up coupon's tail
  // (`COMP_COUPON_ROUND_UP_DAYS`) would otherwise keep freeing invoices —
  // and, once nothing on the profile named a comp, any plan switched onto
  // (finding P1). A comp that merely EXPIRED keeps its tail: those free
  // invoices are its own rounded-up months.
  const clearedTail = why != null && comp.tier == null && discount != null;

  if (sub.status !== "active") {
    // A plan in dunning (past_due, unpaid…) is never given a coupon — but a
    // REVOKE (or a comp that no longer holds) takes ours off whatever the
    // status: once the card is fixed, the next invoice must be charged. (An
    // expired comp's coupon keeps its own months, as on an active plan.)
    if ((why != null && open) || clearedTail) {
      return { kind: "remove", discountId: discount?.id ?? null, reason: "comp_released" };
    }
    return { kind: "none", reason: "not_active" };
  }

  if (why == null) {
    const end = Math.floor(Date.parse(comp.expiresAt as string) / 1000);
    // A plan set to stop sees no more invoices: nothing to free (the comp
    // carries the perks after it). A grant already running is kept as it is.
    if (!open && isEnding(sub)) return { kind: "none", reason: "ending" };
    const startSec = open ? open.startSec : nowSec;
    const months = compCouponMonths(startSec, end);
    const grant = { startSec, endSec: end, months };
    // Invoices the grant already freed (it has been on since its start),
    // and — a NEW grant over an earlier comp's coupon still running — the
    // ones that coupon still owes. Both free the NEXT renewals, so they
    // overlap: the new coupon frees the union, the larger of the two —
    // never their sum (finding P2: a comp landing on an earlier comp's
    // rounded-up tail freed one invoice too many).
    const done = renewalsIn(sub, startSec, nowSec).length;
    const carry = !open && discount?.end != null ? renewalsIn(sub, nowSec, discount.end - 1).length : 0;
    const owed = Math.max(months - done, carry);
    if (owed <= 0) {
      // Nothing more to free. An OPEN grant stays named — moved to the new
      // end — so the comp-ending reminder keeps the coupon's wording (the
      // next renewal is the charge) instead of falling back to #688's credit
      // copy (finding P3e); only a discount still running comes off.
      if (open) {
        const meta = compCouponGrantMeta(grant);
        if (!discount) {
          return {
            kind: "keep",
            grant,
            discountId: null,
            grantMeta: sub.metadata?.[COMP_COUPON_GRANT_KEY] === meta ? null : meta,
          };
        }
        return { kind: "remove", discountId: discount.id, reason: "comp_too_short", grantMeta: meta };
      }
      return discount
        ? { kind: "remove", discountId: discount.id, reason: "comp_too_short" }
        : { kind: "none", reason: "comp_too_short" };
    }
    if (open && discount && open.months === months) {
      const meta = compCouponGrantMeta(grant);
      return {
        kind: "keep",
        grant,
        discountId: discount.id,
        grantMeta: sub.metadata?.[COMP_COUPON_GRANT_KEY] === meta ? null : meta,
      };
    }
    return { kind: "apply", grant, couponMonths: owed, replaces: discount?.id ?? null, reason: "comp_frees_invoices" };
  }

  // No comp holds the plan: a running grant's coupon comes off, and so does
  // a CLEARED comp's tail. An earlier comp's coupon whose grant has ENDED
  // (the comp expired, still named) keeps freeing the invoices it was sized
  // for — those are the comp's own months.
  if (open || clearedTail) return { kind: "remove", discountId: discount?.id ?? null, reason: "comp_released" };
  return { kind: "none", reason: why === "no_comp" && isEnding(sub) ? "ending" : why };
}

/**
 * Will saving `comp` leave it PAID FOR in Stripe on this subscription — a
 * held trial, our coupon grant, or a #688 credit grant — so the plan is
 * locked while it runs? The same branches as `applyCompToSubscription`
 * (comp-stripe-apply.ts), read before anything is written: an admin's comp
 * change releases a scheduled downgrade ONLY then (finding P2 — a comp below
 * the plan, too short to free an invoice, on an ending plan… changes nothing
 * in Stripe and must not cancel the user's own scheduled change).
 * `sub` read with its discounts expanded.
 */
export function compPaidInStripe(input: {
  sub: CouponSubFacts & CompSubscriptionFacts;
  subscribedTier: PlanTier;
  comp: CompFacts;
  now?: Date;
}): boolean {
  const { sub, subscribedTier, comp, now } = input;
  const nowSec = Math.floor((now ?? new Date()).getTime() / 1000);
  if (compHoldReason(comp, subscribedTier, nowSec) != null) return false;
  if (sub.status === "trialing") {
    const t = compTrialChangeFor({ sub, subscribedTier, comp, now });
    if (t.kind === "set_trial_end") return t.reason === "comp_holds_trial";
    return t.reason === "unchanged" && Boolean(sub.metadata?.[TRIAL_END_BEFORE_COMP_KEY]);
  }
  if (sub.status !== "active") return false;
  const credit = parseCompCreditGrant(sub.metadata);
  const creditRunning = credit != null && credit.endSec > nowSec;
  if (isMonthlyPrice(priceOf(sub)) && !creditRunning) {
    const c = compCouponChangeFor({ sub, subscribedTier, comp, now });
    return c.kind === "apply" || c.kind === "keep" || (c.kind === "remove" && c.grantMeta != null);
  }
  const c = compCreditChangeFor({ sub, subscribedTier, comp, now });
  return c.kind === "settle" && c.reason === "comp_credits_period";
}

/**
 * Should a subscription event re-run the comp's billing? A SAFETY NET only —
 * the app refuses plan switches while a comp is on and the comped portal
 * offers none, so this is a plan changed outside both (the Stripe
 * dashboard): a coupon grant on a plan that isn't monthly any more (a 100 %
 * coupon would free the year) or that the comp no longer holds. A #688
 * balance credit is NEVER moved (owner 2026-11-02): it runs out by itself.
 */
export function compBillingNeedsReconcile(input: {
  sub: CouponSubFacts;
  subscribedTier: PlanTier | null;
  comp: CompFacts;
  now?: Date;
}): boolean {
  const { sub, comp } = input;
  if (sub.status !== "active" || !input.subscribedTier) return false;
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const coupon = parseCompCouponGrant(sub.metadata);
  if (!coupon || coupon.endSec <= nowSec) return false;
  const monthly = isMonthlyPrice(priceOf(sub));
  const holds = compHoldReason(comp, input.subscribedTier, nowSec) == null;
  return !monthly || !holds;
}

const DUNNING_STATUSES: ReadonlySet<string> = new Set(["past_due", "unpaid", "incomplete", "paused"]);

/**
 * Did this `customer.subscription.updated` bring a plan BACK to billing —
 * an ending plan resumed (in the app, the portal or the dashboard) or a
 * dunning plan paid up — so a comp saved while it couldn't take one (an
 * ending plan frees no invoice; dunning gets no coupon, no credit) is
 * applied now (finding P3d)? `previous` = the event's
 * `previous_attributes` (only the fields that changed).
 */
export function compBillingReactivated(
  sub: { status?: string | null; cancel_at_period_end?: boolean | null; cancel_at?: number | null },
  previous: { status?: string | null; cancel_at_period_end?: boolean | null; cancel_at?: number | null } | null | undefined,
): boolean {
  if (!previous) return false;
  if (sub.status !== "active" && sub.status !== "trialing") return false;
  const recovered = typeof previous.status === "string" && DUNNING_STATUSES.has(previous.status);
  const wasEnding = previous.cancel_at_period_end === true || typeof previous.cancel_at === "number";
  const resumed = wasEnding && !sub.cancel_at_period_end && typeof sub.cancel_at !== "number";
  return recovered || resumed;
}

/** A coupon grant is named on the subscription (the webhook's cheap first
 *  test before it reads the profile). */
export function hasCompCouponGrant(meta: Record<string, string> | null | undefined): boolean {
  return Boolean(meta?.[COMP_COUPON_GRANT_KEY]);
}

/** The admin toast's line for a coupon change. */
export function compCouponNote(
  change: CompCouponChange,
  outlook?: { freeInvoices: number; chargedFrom: string | null } | null,
): string | null {
  switch (change.kind) {
    case "apply": {
      const n = outlook?.freeInvoices ?? change.couponMonths;
      const from = outlook?.chargedFrom ? ` Billing resumes as usual on ${formatUtcDate(outlook.chargedFrom)}.` : "";
      return `Their next ${n === 1 ? "monthly invoice is" : `${n} monthly invoices are`} free — a 100%-off complimentary coupon on their Stripe subscription.${from}`;
    }
    case "keep":
      return change.discountId
        ? "Their complimentary coupon is already on their Stripe subscription."
        : "The complimentary coupon has already freed the invoices this comp covers; their next invoice is charged as usual.";
    case "remove":
      return change.reason === "comp_too_short"
        ? "The comp no longer reaches another invoice: the complimentary coupon is off and their next invoice is charged as usual."
        : "Removed the complimentary coupon from their Stripe subscription — their next invoice is charged as usual.";
    case "none":
      switch (change.reason) {
        case "ending":
          return "Their plan is cancelled and stops on its own date, so no invoice is freed; the comp carries the perks after it.";
        case "comp_lower_tier":
          return "The comp is below their plan, so it changes nothing.";
        case "comp_too_short":
          return "Shorter than half a month: no monthly invoice is freed, so their plan bills as usual.";
        default:
          return null;
      }
  }
}
