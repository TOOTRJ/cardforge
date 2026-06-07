import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { planForTier, MONTHLY_CREDITS, type PlanTier } from "@/lib/billing/plans";

type BillingPanelProps = {
  tier: PlanTier;
  isPaid: boolean;
  status: string | null;
  credits: number;
  /** Pre-formatted renewal/cancel date (formatted server-side to avoid a
   *  hydration mismatch). Null when there's no active subscription. */
  renewLabel: string | null;
  cancelAtPeriodEnd: boolean;
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
}: BillingPanelProps) {
  const plan = planForTier(tier);
  const statusLabel = isPaid
    ? STATUS_LABEL[status ?? ""] ?? "Active"
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

      {renewLabel ? (
        <p className="text-xs leading-5 text-muted">
          {cancelAtPeriodEnd
            ? `Your plan ends on ${renewLabel}.`
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
              {credits}
            </span>
            <span className="text-xs text-muted">
              · {MONTHLY_CREDITS[tier]}/mo on {plan.name}
            </span>
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {isPaid ? (
          <ManageBillingButton size="sm">Manage subscription</ManageBillingButton>
        ) : (
          <Button asChild size="sm">
            <Link href="/pricing">Upgrade your plan</Link>
          </Button>
        )}
        <Button asChild variant="outline" size="sm">
          <Link href="/pricing">Buy credits</Link>
        </Button>
      </div>
    </div>
  );
}
