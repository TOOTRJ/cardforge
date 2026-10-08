import type { PendingChangeSummary } from "@/lib/billing/subscription-details";

// ---------------------------------------------------------------------------
// What the billing page's plan card says about the plan's FUTURE — one pure
// decision, so the order of the cases is unit-tested. The order is the bug
// this file exists for: "your trial ends, then $6 on the card below" and
// "Renews on …" used to be decided before (or without) asking whether the
// customer had cancelled.
//
//   delinquent      payment broken — perks paused
//   trial_ending    a CANCELLED trial: it ends, nothing is charged
//   stale           Stripe says the subscription is already OVER while the
//                   profile still says live (a missed webhook) — never "renews"
//   ending          a cancelled plan: it ends on a date, perks kept until then;
//                   `billedBeforeAt` when that date is past the next renewal
//                   (a custom cancel date, a schedule that ends in a
//                   cancellation) — then "nothing more is charged" is false
//   trial           a running trial that converts (or lapses without a card)
//   pending_change  a scheduled downgrade — NOT a cancellation
//   renews          the plan renews
//   comped / ended / free   no live subscription
// ---------------------------------------------------------------------------

export type PlanStatus =
  | { kind: "delinquent" }
  | { kind: "trial_ending"; endsAt: string }
  | { kind: "stale" }
  | { kind: "ending"; endsAt: string; billedBeforeAt?: string }
  | { kind: "trial"; trialEnd: string }
  | { kind: "pending_change"; pending: PendingChangeSummary }
  | { kind: "renews"; renewsAt: string }
  | { kind: "live" }
  | { kind: "comped" }
  | { kind: "ended" }
  | { kind: "free" };

export type PlanStatusInput = {
  /** A subscription Stripe still bills (active / trialing). */
  live: boolean;
  delinquent: boolean;
  comped: boolean;
  /** `profiles.subscription_status`. */
  status: string | null;
  /** The live Stripe read, when there is one. */
  subscription: {
    /** Stripe's own status for the subscription the profile points at. */
    status?: string | null;
    trialEnd: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    endsAt: string | null;
    pendingChange: PendingChangeSummary | null;
  } | null;
  /** The profile row's copy — the fallback when Stripe can't be read. */
  profile: {
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    /** `profiles.subscription_ends_at` (0135) — the exact date, when synced. */
    endsAt?: string | null;
  };
};

const OVER_STATUSES: ReadonlySet<string> = new Set(["canceled", "incomplete_expired"]);
/** Same slack as lib/billing/subscription-ending.ts. */
const PERIOD_END_SLACK_MS = 60_000;

export function planStatusOf(input: PlanStatusInput): PlanStatus {
  const { live, delinquent, comped, status, subscription: sub, profile } = input;
  if (delinquent) return { kind: "delinquent" };
  if (live) {
    // The profile says live, Stripe says it is over: the page must not
    // promise a renewal on the strength of a row a webhook never updated.
    if (sub?.status && OVER_STATUSES.has(sub.status)) return { kind: "stale" };
    const periodEnd = sub?.currentPeriodEnd ?? profile.currentPeriodEnd;
    // Stripe's own answer wins; the profile's flag (written by the webhook)
    // is the fallback, dated by the period end it stores.
    const endsAt = sub
      ? sub.endsAt ?? (sub.cancelAtPeriodEnd ? periodEnd : null)
      : (profile.endsAt ?? (profile.cancelAtPeriodEnd ? periodEnd : null));
    if (endsAt) {
      // The next charge: a trial converts at its end, a plan renews at its
      // period end. An end date beyond it is NOT "nothing more is charged".
      const nextBill = status === "trialing" ? (sub?.trialEnd ?? periodEnd) : periodEnd;
      if (nextBill && Date.parse(endsAt) > Date.parse(nextBill) + PERIOD_END_SLACK_MS) {
        return { kind: "ending", endsAt, billedBeforeAt: nextBill };
      }
      return status === "trialing" ? { kind: "trial_ending", endsAt } : { kind: "ending", endsAt };
    }
    if (status === "trialing" && sub?.trialEnd) return { kind: "trial", trialEnd: sub.trialEnd };
    if (sub?.pendingChange) return { kind: "pending_change", pending: sub.pendingChange };
    if (periodEnd) return { kind: "renews", renewsAt: periodEnd };
    return { kind: "live" };
  }
  if (comped) return { kind: "comped" };
  if (status === "canceled") return { kind: "ended" };
  return { kind: "free" };
}

/** The plan is set to stop — the page offers "Resume", never "Cancel". */
export function isEndingStatus(status: PlanStatus): boolean {
  return status.kind === "ending" || status.kind === "trial_ending";
}
