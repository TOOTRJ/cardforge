import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { ResumePlanButton } from "@/components/billing/resume-plan-button";
import { planEndingSentence, type PlanEnding } from "@/lib/billing/plan-ending";
import {
  formatCredits,
  planForTier,
  MONTHLY_CREDITS,
  type PlanTier,
} from "@/lib/billing/plans";

type BillingPanelProps = {
  tier: PlanTier;
  isPaid: boolean;
  status: string | null;
  credits: number;
  /** Pre-formatted renewal/cancel date (formatted server-side to avoid a
   *  hydration mismatch). Null when there's no active subscription. */
  renewLabel: string | null;
  cancelAtPeriodEnd: boolean;
  /** The live plan is cancelled and ends on a date — the profile's stored
   *  state (lib/billing/plan-ending.ts), the same source as the dashboard
   *  notice. Wins over `cancelAtPeriodEnd` + `renewLabel`. */
  planEnding?: PlanEnding | null;
  /** The user has a Stripe customer — the portal can open for them. A comp'd
   *  user without one used to see a "Manage subscription" button that could
   *  only fail; a past-due subscriber (isPaid false) had NO way to reach the
   *  portal and fix their card. */
  hasBillingAccount: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
  unpaid: "Unpaid",
  paused: "Paused",
};

export function BillingPanel({
  tier,
  isPaid,
  status,
  credits,
  renewLabel,
  cancelAtPeriodEnd,
  planEnding = null,
  hasBillingAccount,
}: BillingPanelProps) {
  const plan = planForTier(tier);
  // Ending = the stored date, or (a caller without one) the old flag.
  const ending = isPaid && (planEnding != null || (cancelAtPeriodEnd && renewLabel != null));
  // A lapsed paid plan shows its real status (Past due / Unpaid / …) rather
  // than pretending to be the free plan.
  const lapsed = !isPaid && tier !== "free" && status != null;
  const statusLabel = isPaid
    ? ending
      ? planEnding?.kind === "trial" || (!planEnding && status === "trialing")
        ? "Trial ending"
        : "Ending"
      : STATUS_LABEL[status ?? ""] ?? "Active"
    : lapsed
      ? STATUS_LABEL[status ?? ""] ?? "Lapsed"
      : "Free plan";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-4 py-3">
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wider text-subtle">
            Current plan
          </span>
          <span className="font-display text-lg font-semibold text-foreground">
            {plan.name}
          </span>
        </div>
        <Badge variant={isPaid ? "primary" : "outline"}>{statusLabel}</Badge>
      </div>

      {lapsed ? (
        <p className="text-xs leading-5 text-danger">
          Your last payment didn&apos;t go through, so paid perks are paused.
          Update your card under Manage subscription to restore them.
        </p>
      ) : isPaid && planEnding ? (
        <p className="text-xs leading-5 text-muted" data-testid="settings-plan-ending">
          {planEndingSentence(planEnding, plan.name)}
          {planEnding.billedBeforeAt ? "" : " Nothing more is charged."}
          {` Changed your mind? Resume ${plan.name} below.`}
        </p>
      ) : renewLabel ? (
        <p className="text-xs leading-5 text-muted">
          {cancelAtPeriodEnd
            ? status === "trialing"
              ? `You cancelled your trial: it ends on ${renewLabel} and you won't be charged.`
              : `You cancelled this plan: it ends on ${renewLabel} and won't renew. You keep your perks until then.`
            : status === "trialing"
              ? `Your free trial ends on ${renewLabel}.`
              : `Renews on ${renewLabel}.`}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-4 py-3">
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wider text-subtle">
            AI credits
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="font-display text-lg font-semibold text-foreground">
              {formatCredits(credits)}
            </span>
            <span className="text-xs text-muted">
              · {MONTHLY_CREDITS[tier]}/mo on {plan.name}
            </span>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/dashboard/billing">Billing &amp; subscription</Link>
        </Button>
        {/* A cancelled plan resumes in the app (confirm step → one click). */}
        {hasBillingAccount && ending ? (
          <ResumePlanButton planName={plan.name} surface="settings" variant="outline" />
        ) : null}
        {hasBillingAccount ? (
          <ManageBillingButton size="sm">
            {isPaid
              ? ending
                ? "Billing portal"
                : "Manage subscription"
              : lapsed
                ? "Fix payment"
                : "Billing history"}
          </ManageBillingButton>
        ) : null}
        {!isPaid ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/pricing">{lapsed ? "See plans" : "Upgrade your plan"}</Link>
          </Button>
        ) : null}
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/billing#packs">Buy credits</Link>
        </Button>
      </div>
    </div>
  );
}
