import { activeCompDiscountOf, type CouponSubFacts } from "@/lib/billing/comp-coupon";
import { TIER_RANK, type PlanTier } from "@/lib/billing/plans";
import { dateTextToString, type DateText } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// No plan switches while a comp is on (owner 2026-11-02, TODO BL1).
//
// A comp on a live subscription is paid for in Stripe — a held trial, a
// monthly plan's 100%-off coupon, an annual plan's balance credit
// (lib/billing/comp-stripe.ts, lib/billing/comp-coupon.ts). Every way of
// carrying that across a plan switch leaked money in the independent check
// (a coupon freeing the new plan's first invoice or a whole year, a credit
// paying a renewal after the comp ended, proration paying an already free
// period out again). So while a comp holds the plan, the plan does not
// change: every in-app switch refuses — the storefront's buttons
// (`pricingCtaFor` → "comp_locked"), the server action (never trust the
// button), a scheduled downgrade — and the Customer Portal opens without
// plan switching (lib/stripe/portal.ts). After the comp's end it all opens
// again by itself.
//
// "A comp holds the plan": an UNEXPIRED comp at or above the tier the live
// subscription pays for (`compOverLiveSubscription`'s rule), on a
// subscription Stripe still has (trialing, active, or in dunning). A comp
// below the plan changes nothing in Stripe, so it locks nothing. The comp is
// the PROFILE's — never something read from Stripe: a failed Stripe read
// can never claim a comp.
// ---------------------------------------------------------------------------

/** Subscription statuses a comp's billing can sit on. */
const LOCKABLE_STATUSES: ReadonlySet<string> = new Set(["trialing", "active", "past_due", "unpaid"]);

export type PlanSwitchLock = {
  /** ISO end of the comp (null: a legacy comp with no end date). */
  until: string | null;
};

export function compPlanSwitchLock(
  input: {
    compTier: string | null | undefined;
    compExpiresAt: string | null | undefined;
    /** The tier the live subscription pays for. */
    subscribedTier: string | null | undefined;
    subscriptionStatus: string | null | undefined;
  },
  now: Date = new Date(),
): PlanSwitchLock | null {
  const comp = input.compTier === "plus" || input.compTier === "pro" ? input.compTier : null;
  if (!comp) return null;
  if (!LOCKABLE_STATUSES.has(input.subscriptionStatus ?? "")) return null;
  if (input.compExpiresAt) {
    const end = Date.parse(input.compExpiresAt);
    if (!Number.isFinite(end) || end <= now.getTime()) return null;
  }
  const paid = (input.subscribedTier === "plus" || input.subscribedTier === "pro" ? input.subscribedTier : "free") as PlanTier;
  if (TIER_RANK[comp] < TIER_RANK[paid]) return null;
  return { until: input.compExpiresAt ?? null };
}

/** A monthly comp's 100%-off coupon still running on the subscription
 *  (read EXPANDED). It can outlive the comp itself — the owner's 15-day
 *  round-up (`COMP_COUPON_ROUND_UP_DAYS`) frees one more invoice than whole
 *  months — and while it runs it frees whatever invoice a switch would make
 *  (a prorated upgrade at $0). So the lock holds until the COUPON ends too.
 *  It is our own coupon on Stripe's subscription, never a comp guessed from
 *  a failed read: the caller refuses without claiming one when it can't read. */
export function couponPlanSwitchLock(sub: CouponSubFacts, nowSec: number): PlanSwitchLock | null {
  const discount = activeCompDiscountOf(sub, nowSec);
  if (!discount) return null;
  return { until: discount.end != null ? new Date(discount.end * 1000).toISOString() : null };
}

/** The later of two locks (null = no end date, the latest of all). */
export function laterPlanSwitchLock(a: PlanSwitchLock | null, b: PlanSwitchLock | null): PlanSwitchLock | null {
  if (!a) return b;
  if (!b) return a;
  if (a.until == null || b.until == null) return { until: null };
  return Date.parse(a.until) >= Date.parse(b.until) ? a : b;
}

/** The one line a refused switch says, as parts (the date a `<LocalDate>`). */
export function compPlanLockText(until: string | null): DateText {
  return until
    ? ["Your plan is complimentary until ", { date: until }, " — you can change plans after that."]
    : ["Your plan is complimentary right now — you can change plans after it ends."];
}

/** The same line as a string in `timeZone` (a server action's error: "UTC";
 *  a toast in the browser: `undefined`, the viewer's own zone). */
export function compPlanLockMessage(until: string | null, timeZone: string | undefined): string {
  return dateTextToString(compPlanLockText(until), timeZone);
}

/** A billing action's error as the browser shows it: a comp lock re-worded
 *  with its date in the viewer's own zone, anything else as sent. */
export function billingActionErrorText(result: {
  error: string;
  compLock?: { until: string | null; note?: string };
}): string {
  if (!result.compLock) return result.error;
  const line = compPlanLockMessage(result.compLock.until, undefined);
  return result.compLock.note ? `${line} ${result.compLock.note}` : line;
}
