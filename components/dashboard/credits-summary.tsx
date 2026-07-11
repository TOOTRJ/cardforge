import Link from "next/link";
import { Coins } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import {
  getCreditSnapshot,
  getCreditsUsedThisMonth,
} from "@/lib/ai/usage-queries";
import { isBillingEnabled } from "@/lib/billing/flags";
import { formatCredits, isUnlimitedCredits } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CreditsSummaryCard — dashboard panel showing the user's AI credit balance,
// how many they've used this calendar month, and their monthly allotment,
// with a progress bar. Server component; RLS-scoped data. Gated behind the
// billing flag (credits only exist when billing is on).
// ---------------------------------------------------------------------------

export async function CreditsSummaryCard() {
  if (!isBillingEnabled()) return null;

  const [snapshot, used] = await Promise.all([
    getCreditSnapshot(),
    getCreditsUsedThisMonth(),
  ]);

  const { balance, monthlyAllotment, tier, isPaid } = snapshot;
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  const lowCredits = balance <= 5 && !isUnlimitedCredits(balance);
  const pct =
    monthlyAllotment > 0
      ? Math.min(100, Math.round((used / monthlyAllotment) * 100))
      : 0;

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
        <Badge variant={isPaid ? "primary" : "outline"}>{tierLabel} plan</Badge>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Remaining"
          value={formatCredits(balance)}
          unit="credits"
          emphasis={lowCredits ? "danger" : "default"}
        />
        <Stat label="Used this month" value={used} unit="credits" />
        <Stat label="Monthly allotment" value={monthlyAllotment} unit="credits" />
      </div>

      <div className="flex flex-col gap-1.5">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-background/60"
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={monthlyAllotment}
          aria-label="Credits used this month"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              lowCredits ? "bg-danger" : "bg-accent",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-subtle">
          {used} of {monthlyAllotment} monthly credits used ({pct}%).
        </p>
      </div>

      <Link
        href={isPaid ? "/settings#billing" : "/pricing"}
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
