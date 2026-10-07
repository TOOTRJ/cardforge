// ---------------------------------------------------------------------------
// "This subscription is ending on <date>" — the ONE reading of Stripe's
// cancellation fields, shared by the billing page's live read
// (lib/billing/subscription-details.ts) and the webhook's profile sync
// (lib/stripe/subscription-sync.ts).
//
// Stripe says "it will not renew" in three ways, and a reader that knows only
// the first tells a customer who cancelled that their plan renews:
//
//   1. `cancel_at_period_end: true`  — the classic flag.
//   2. `cancel_at: <timestamp>`      — a cancellation date. The Customer
//      Portal and newer API versions (flexible billing mode) write THIS and
//      can leave `cancel_at_period_end` false; the Dashboard's "cancel on a
//      custom date" does too.
//   3. a subscription schedule whose `end_behavior` is "cancel" — the
//      subscription ends with the schedule's last phase.
//
// Pure and dependency-free (no "server-only") so both sides and unit tests
// can import it. Structural input: Stripe.Subscription satisfies it.
// ---------------------------------------------------------------------------

export type EndingScheduleLike = {
  end_behavior?: string | null;
  phases: Array<{ end_date: number }>;
};

export type EndingSubscriptionLike = {
  status: string;
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  trial_end?: number | null;
  /** Only read when EXPANDED — an id says nothing about how it ends. */
  schedule?: string | EndingScheduleLike | { id: string } | null;
  items?: { data: Array<{ current_period_end?: number | null }> } | null;
};

/** A cancellation date this close after the period end is "at period end"
 *  (Stripe stamps both from the same clock; a minute covers any skew). */
const PERIOD_END_SLACK_SECONDS = 60;

function periodEndOf(sub: EndingSubscriptionLike): number | null {
  const end = sub.items?.data?.[0]?.current_period_end;
  return typeof end === "number" ? end : null;
}

function scheduleEndOf(schedule: EndingSubscriptionLike["schedule"]): number | null {
  if (!schedule || typeof schedule === "string" || !("phases" in schedule)) return null;
  if (schedule.end_behavior !== "cancel") return null;
  const ends = schedule.phases.map((phase) => phase.end_date).filter((end) => typeof end === "number");
  return ends.length > 0 ? Math.max(...ends) : null;
}

/**
 * When the subscription stops, in unix seconds — null when it renews (or has
 * already ended: a `canceled` subscription is not "ending", it is over).
 */
export function subscriptionEndsAt(sub: EndingSubscriptionLike | null | undefined): number | null {
  if (!sub || sub.status === "canceled" || sub.status === "incomplete_expired") return null;
  if (typeof sub.cancel_at === "number") return sub.cancel_at;
  if (sub.cancel_at_period_end) {
    // A trial's "period" is the trial itself.
    if (sub.status === "trialing" && typeof sub.trial_end === "number") return sub.trial_end;
    return periodEndOf(sub);
  }
  return scheduleEndOf(sub.schedule);
}

/**
 * The profile's `cancel_at_period_end` column: true when the subscription
 * stops at (or before) the end of the period the profile stores — so
 * "ends on <current_period_end>" is true wherever only the profile row is
 * read (Settings, the storefront buttons, the admin panel). A cancellation
 * dated in a LATER period still renews at this period's end; the billing
 * page's live read shows its exact date.
 */
export function endsByPeriodEnd(sub: EndingSubscriptionLike | null | undefined): boolean {
  if (!sub) return false;
  if (sub.cancel_at_period_end) return true;
  const endsAt = subscriptionEndsAt(sub);
  if (endsAt == null) return false;
  const periodEnd = periodEndOf(sub);
  return periodEnd == null || endsAt <= periodEnd + PERIOD_END_SLACK_SECONDS;
}
