import { formatCalendarDate } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// "This account's plan has been cancelled and ends on <date>" — read from the
// PROFILE ROW alone, for every page that names the plan without calling
// Stripe: the dashboard, Settings, the header menu, the upgrade modal and the
// admin directory. ONE reading, so no surface can say "Pro" about a plan
// that is on its way out without saying so.
//
// The sync (lib/stripe/subscription-sync.ts) writes the facts:
//   subscription_ends_at      the exact date the subscription stops (0135)
//   subscription_canceled_at  when the cancellation was requested (0135)
//   cancel_at_period_end      "stops at the stored period end" — the only
//                             fact a row synced before 0135 has, so it is
//                             the fallback, dated by `current_period_end`.
//
// Pure and dependency-light (no "server-only"): server components, the
// /api/me island and unit tests share it. The billing page's plan card keeps
// its own, richer decision (lib/billing/plan-status.ts) because it also has
// Stripe's live answer; both agree by construction on the profile's part.
// ---------------------------------------------------------------------------

export type PlanEndingProfile = {
  subscription_status?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  subscription_ends_at?: string | null;
  subscription_canceled_at?: string | null;
};

export type PlanEnding = {
  /** A cancelled TRIAL ends without a charge; a cancelled plan was paid for. */
  kind: "plan" | "trial";
  /** ISO timestamp the subscription stops. */
  endsAt: string;
  /** Set when the end date is PAST the next renewal (a custom cancel date, a
   *  schedule that ends in a cancellation): the plan is still billed on this
   *  date first, so "nothing more is charged" would be false. */
  billedBeforeAt: string | null;
  /** When the cancellation was requested, if the sync stored it. */
  canceledAt: string | null;
};

const LIVE: ReadonlySet<string> = new Set(["active", "trialing"]);
/** Same slack as lib/billing/subscription-ending.ts. */
const PERIOD_END_SLACK_MS = 60_000;

function validIso(value: string | null | undefined): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * The pending cancellation of a LIVE subscription, or null: the plan renews,
 * there is no live subscription, or it has already ended (a `canceled`
 * status is "ended", never "ending").
 */
export function planEndingOf(profile: PlanEndingProfile | null | undefined): PlanEnding | null {
  if (!profile) return null;
  const status = profile.subscription_status ?? null;
  if (!status || !LIVE.has(status)) return null;
  const periodEnd = validIso(profile.current_period_end);
  const endsAt =
    validIso(profile.subscription_ends_at) ?? (profile.cancel_at_period_end ? periodEnd : null);
  if (!endsAt) return null;
  const billedFirst =
    periodEnd != null && Date.parse(endsAt) > Date.parse(periodEnd) + PERIOD_END_SLACK_MS;
  return {
    // A trial that is billed before it ends has converted by then: a plan.
    kind: status === "trialing" && !billedFirst ? "trial" : "plan",
    endsAt,
    billedBeforeAt: billedFirst ? periodEnd : null,
    canceledAt: validIso(profile.subscription_canceled_at),
  };
}

/**
 * The sentence every signed-in summary shows — the same wording family as
 * the billing page's plan card.
 */
export function planEndingSentence(ending: PlanEnding, planName: string): string {
  const date = formatCalendarDate(ending.endsAt);
  if (ending.kind === "trial") {
    return `You cancelled your ${planName} free trial. It ends on ${date} and you won't be charged. You keep ${planName} until then.`;
  }
  if (ending.billedBeforeAt) {
    return `Your ${planName} plan is set to end on ${date}. It is still billed as usual until then — next on ${formatCalendarDate(ending.billedBeforeAt)}.`;
  }
  return `Your ${planName} plan was cancelled and ends on ${date}. You keep ${planName} until then.`;
}

/** The short form for a badge or a menu row: "ends Oct 23, 2026". */
export function planEndingShort(ending: Pick<PlanEnding, "kind" | "endsAt">): string {
  const date = new Date(ending.endsAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${ending.kind === "trial" ? "trial ends" : "ends"} ${date}`;
}

/** The admin directory's plan label: "cancelled, ends Oct 23, 2026". */
export function planEndingAdminLabel(ending: PlanEnding): string {
  const short = planEndingShort(ending).replace(/^trial ends /, "ends ");
  if (ending.kind === "trial") return `trial cancelled, ${short}`;
  return ending.billedBeforeAt ? `cancelled, ${short} (billed first)` : `cancelled, ${short}`;
}
