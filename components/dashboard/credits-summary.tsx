import Link from "next/link";
import { Coins } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import {
  getCreditSnapshot,
  getCreditsUsedThisMonth,
} from "@/lib/ai/usage-queries";
import { isBillingEnabled } from "@/lib/billing/flags";
import { SIGNUP_CREDITS, formatCredits, isLowCredits, planForTier } from "@/lib/billing/plans";
import { getEntitlements } from "@/lib/billing/entitlements";
import { PlanBadgeLabel } from "@/components/dashboard/plan-ending-notice";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CreditsSummaryCard — dashboard panel showing the user's AI credit balance,
// how many they've used this calendar month, and the plan's one-time credits
// (owner 2026-11-06: no monthly allotment, no progress bar against one).
// Server component; RLS-scoped data. Gated behind the billing flag (credits
// only exist when billing is on).
// ---------------------------------------------------------------------------

export async function CreditsSummaryCard() {
  if (!isBillingEnabled()) return null;

  const [snapshot, used, entitlements] = await Promise.all([
    getCreditSnapshot(),
    getCreditsUsedThisMonth(),
    getEntitlements(),
  ]);

  const { balance, planCredits, tier, isPaid } = snapshot;
  const tierLabel = planForTier(tier).name;
  const lowCredits = isLowCredits(balance, isPaid);

  return (
    <SurfaceCard className="mt-6 flex flex-col gap-5 p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-gold-strong">
            <Coins className="h-5 w-5" aria-hidden />
          </span>
          <div className="flex flex-col">
            <span className="font-display text-sm font-semibold tracking-wide text-foreground">
              AI generation credits
            </span>
            <span className="text-xs text-muted">
              1 credit = 1 AI card or art generation.
            </span>
          </div>
        </div>
        <Badge variant={isPaid ? "primary" : "outline"}>
          {/* A cancelled plan says when it ends, right where it is named. */}
          <PlanBadgeLabel
            planName={tierLabel}
            ending={entitlements.planEnding}
            subscriptionPlanName={planForTier(entitlements.tier).name}
          />
        </Badge>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Remaining"
          value={formatCredits(balance)}
          unit="credits"
          emphasis={lowCredits ? "danger" : "default"}
        />
        <Stat label="Used this month" value={used} unit="credits" />
        {planCredits > 0 ? (
          <Stat label="Plan credits" value={planCredits} unit="one-time" />
        ) : (
          <Stat label="Plan credits" value="None" unit={`${SIGNUP_CREDITS} to start`} />
        )}
      </div>

      <p className="text-xs leading-5 text-subtle">
        {planCredits > 0
          ? `Your plan's ${planCredits} credits came with its first payment, once — they never expire, and a credit pack adds more any time.`
          : `Free accounts start with ${SIGNUP_CREDITS} credits. A credit pack tops you up any time (they never expire), and a plan brings its own stock with its first payment.`}
      </p>

      <Link
        href={isPaid ? "/dashboard/billing" : "/pricing"}
        className="text-xs font-semibold text-primary-bright underline-offset-4 hover:underline"
      >
        {isPaid
          ? "Manage plan or buy more credits →"
          : "Upgrade or buy a credit pack for more →"}
      </Link>
    </SurfaceCard>
  );
}

function Stat({
  label,
  value,
  unit,
  emphasis = "default",
}: {
  label: string;
  value: number | string;
  unit: string;
  emphasis?: "default" | "danger";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md border border-border/40 bg-background/40 px-3 py-2.5",
        emphasis === "danger" && "border-danger/40 bg-danger/5",
      )}
    >
      <span className="text-[11px] uppercase tracking-wider text-subtle">
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-display text-2xl font-semibold tracking-tight",
            emphasis === "danger" ? "text-danger" : "text-foreground",
          )}
        >
          {value}
        </span>
        <span className="text-xs text-muted">{unit}</span>
      </span>
    </div>
  );
}
