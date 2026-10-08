import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { ResumePlanButton } from "@/components/billing/resume-plan-button";
import { getCurrentProfile } from "@/lib/supabase/server";
import { isBillingEnabled } from "@/lib/billing/flags";
import { planForTier, type PlanTier } from "@/lib/billing/plans";
import { LocalDateText } from "@/components/ui/local-date";
import { dateTextToString, type DateText } from "@/lib/format/dates";
import {
  planEndingOf,
  planEndingShortText,
  planEndingText,
  type PlanEnding,
} from "@/lib/billing/plan-ending";

// ---------------------------------------------------------------------------
// The dashboard's "your plan has been cancelled" notice. A subscriber who
// cancels keeps the plan until a date, so the dashboard still (rightly) says
// "Pro" — this says the rest: it was cancelled, when it ends, and how to
// stay. Read from the profile row (lib/billing/plan-ending.ts), no Stripe
// call; shown for a LIVE subscription only (an ended one is the free plan).
// ---------------------------------------------------------------------------

/** "Pro plan" → "Pro plan · ends Oct 23, 2026" for the dashboard badges —
 *  only when the badge's tier IS the subscription that is ending (a comp
 *  that outranks it keeps the plain label). */
export function planBadgeText(
  planName: string,
  ending: PlanEnding | null,
  subscriptionPlanName: string | null,
): DateText {
  if (!ending || subscriptionPlanName !== planName) return [`${planName} plan`];
  return [`${planName} plan · `, ...planEndingShortText(ending)];
}

/** The same label as a UTC string (no browser: a test, a server string). */
export function planBadgeLabel(
  planName: string,
  ending: PlanEnding | null,
  subscriptionPlanName: string | null,
): string {
  return dateTextToString(planBadgeText(planName, ending, subscriptionPlanName), "UTC");
}

/** The badge's label on the page: the date in the viewer's time zone. */
export function PlanBadgeLabel(props: {
  planName: string;
  ending: PlanEnding | null;
  subscriptionPlanName: string | null;
}) {
  // One element: a Badge is a flex row, and a bare text node beside the
  // <time> would lose its trailing space as a flex item of its own.
  return (
    <span>
      <LocalDateText
        parts={planBadgeText(props.planName, props.ending, props.subscriptionPlanName)}
      />
    </span>
  );
}

export function PlanEndingNotice({
  ending,
  planName,
  canResume,
}: {
  ending: PlanEnding;
  planName: string;
  /** A Stripe subscription exists to un-cancel (always, for a live plan —
   *  false only if the profile lost its link). */
  canResume: boolean;
}) {
  return (
    <SurfaceCard
      role="status"
      data-testid="plan-ending-notice"
      className="mt-6 flex flex-col gap-3 border-gold/40 bg-gold/5 p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elevated text-gold-strong">
          <CalendarClock className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <p className="font-display text-sm font-semibold text-foreground">
            {ending.kind === "trial" ? `Your ${planName} trial is ending` : `Your ${planName} plan is ending`}
          </p>
          <p className="text-xs leading-5 text-muted">
            <LocalDateText parts={planEndingText(ending, planName)} />
            {" Afterwards you're on the free plan, with your cards and any credits you have left."}
            {canResume ? ` Changed your mind? Resume ${planName} and it carries on as before.` : ""}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {canResume ? <ResumePlanButton planName={planName} surface="dashboard" /> : null}
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/billing">Billing</Link>
        </Button>
      </div>
    </SurfaceCard>
  );
}

/** Server wrapper: nothing unless the signed-in user's live plan is ending. */
export async function PlanEndingNoticeCard() {
  if (!isBillingEnabled()) return null;
  const profile = await getCurrentProfile();
  const ending = planEndingOf(profile);
  if (!ending || !profile) return null;
  const tier = (profile.subscription_tier ?? "free") as PlanTier;
  if (tier === "free") return null;
  return (
    <PlanEndingNotice
      ending={ending}
      planName={planForTier(tier).name}
      canResume={Boolean(profile.stripe_subscription_id && profile.stripe_customer_id)}
    />
  );
}
