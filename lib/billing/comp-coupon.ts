import { TIER_RANK, type PlanTier } from "@/lib/billing/plans";
import { addMonthsUtc, periodMonthsAndDays } from "@/lib/billing/balance-credit";
import {
  COMP_CREDIT_GRANT_KEY,
  MAX_TRIAL_SECONDS,
  parseCompCreditGrant,
  type CompFacts,
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
//     an annual price would free the whole year. A switch between the two
//     moves the comp: monthly → annual takes the coupon off and credits the
//     rest of the comp (from the end of the invoice the coupon already
//     freed); annual → monthly claws the credit back (unspent part) and
//     frees the invoices still owed with a coupon.
// ---------------------------------------------------------------------------

/** Every comp coupon id starts with this; nothing else does. */
export const COMP_COUPON_PREFIX = "pipglyph_comp_100off_";

/** Subscription metadata key naming the coupon GRANT: `<startSec>:<endSec>:
 *  <months>` — the comp it frees invoices for and how many in all. "" /
 *  absent = none. */
export const COMP_COUPON_GRANT_KEY = "pipglyph_comp_coupon";

/** Subscription metadata key: the unix second an in-app plan switch moved a
 *  coupon comp onto the balance credit. While it is fresh the comp stays a
 *  credit (the customer may still be on the portal's confirm page — putting
 *  the coupon back then would free the switch's invoice). */
export const COMP_SWITCH_HOLD_KEY = "pipglyph_comp_switch";
export const COMP_SWITCH_HOLD_SECONDS = 86_400;

/** The comp's leftover days that round up to one more free invoice. */
export const COMP_COUPON_ROUND_UP_DAYS = 15;

/** The coupon's name on invoices and receipts. */
export function compCouponName(months: number): string {
  return `PipGlyph complimentary plan (${months} month${months === 1 ? "" : "s"} free)`;
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

/** An in-app plan switch moved the comp onto the credit less than a day ago. */
export function compSwitchHeld(meta: Record<string, string> | null | undefined, nowSec: number): boolean {
  const raw = Number(meta?.[COMP_SWITCH_HOLD_KEY] ?? "");
  return Number.isFinite(raw) && raw > 0 && nowSec - raw < COMP_SWITCH_HOLD_SECONDS;
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
 * period when that period's invoice fell inside our discount (it was $0),
 * else `nowSec`. A comp moved onto the balance credit is credited from here,
 * so the free invoice is never paid for twice.
 */
export function couponCoveredUntil(sub: CouponSubFacts, discount: DiscountLike | null, nowSec: number): number {
  const item = sub.items?.data?.[0];
  const start = item?.current_period_start ?? null;
  const end = item?.current_period_end ?? null;
  if (!discount || start == null || end == null || discount.start == null) return nowSec;
  const inside = start >= discount.start - 60 && (discount.end == null || start < discount.end);
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
      discountId: string;
      /** The grant's metadata when only its end moved inside the same months;
       *  null = nothing to write. */
      grantMeta: string | null;
    }
  | {
      kind: "remove";
      /** Our discount to take off (null: only the grant's metadata is left). */
      discountId: string | null;
      reason: "comp_released" | "comp_too_short";
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
  /** A NEW grant starts here (never later than now) instead of now: the
   *  start of the balance credit it replaces — the invoices since then,
   *  paid by that credit, count as already freed. */
  grantStartSec?: number;
}): CompCouponChange {
  const { sub, subscribedTier, comp } = input;
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (sub.status !== "active") return { kind: "none", reason: "not_active" };

  const stored = parseCompCouponGrant(sub.metadata);
  const open = stored && stored.endSec > nowSec ? stored : null;
  const discount = activeCompDiscountOf(sub, nowSec);
  const why = compHoldReason(comp, subscribedTier, nowSec);

  if (why == null) {
    const end = Math.floor(Date.parse(comp.expiresAt as string) / 1000);
    // A plan set to stop sees no more invoices: nothing to free (the comp
    // carries the perks after it). A grant already running is kept as it is.
    if (!open && isEnding(sub)) return { kind: "none", reason: "ending" };
    const startSec = open ? open.startSec : Math.min(nowSec, input.grantStartSec ?? nowSec);
    const months = compCouponMonths(startSec, end);
    const grant = { startSec, endSec: end, months };
    // Invoices the grant already freed (it has been on since its start — or
    // the credit it replaces paid them), and — a NEW grant over an earlier
    // comp's coupon still running — the ones that coupon still owes.
    const done = renewalsIn(sub, startSec, nowSec).length;
    const carry = !open && discount?.end != null ? renewalsIn(sub, nowSec, discount.end - 1).length : 0;
    const owed = months - done + carry;
    if (owed <= 0) {
      return open || discount
        ? { kind: "remove", discountId: discount?.id ?? null, reason: "comp_too_short" }
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

  // No comp holds the plan: a running grant's coupon comes off. An earlier
  // comp's coupon whose grant has ENDED (the comp expired) keeps freeing the
  // invoices it was sized for — those are the comp's own months.
  if (open) return { kind: "remove", discountId: discount?.id ?? null, reason: "comp_released" };
  return { kind: "none", reason: why === "no_comp" && isEnding(sub) ? "ending" : why };
}

/**
 * Should a subscription event re-run the comp's billing? Only when the plan
 * no longer matches how its comp is paid for: a coupon grant on a plan that
 * isn't monthly any more (a switch to annual), above the comp, or held for a
 * switch; or a balance-credit grant on a MONTHLY plan the comp holds (a
 * switch from annual, or a #688 credit from before BL1) — which moves onto
 * the coupon.
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
  const monthly = isMonthlyPrice(priceOf(sub));
  const held = compSwitchHeld(sub.metadata, nowSec);
  const coupon = parseCompCouponGrant(sub.metadata);
  const credit = parseCompCreditGrant(sub.metadata);
  const holds = compHoldReason(comp, input.subscribedTier, nowSec) == null;
  if (coupon && coupon.endSec > nowSec && (!monthly || held || !holds)) return true;
  if (credit && credit.endSec > nowSec && monthly && !held && holds) return true;
  return false;
}

/** Either comp grant is named on the subscription (the webhook's cheap
 *  first test before it reads the profile). */
export function hasCompBillingGrant(meta: Record<string, string> | null | undefined): boolean {
  return Boolean(meta?.[COMP_COUPON_GRANT_KEY] || meta?.[COMP_CREDIT_GRANT_KEY]);
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
      return "Their complimentary coupon is already on their Stripe subscription.";
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
