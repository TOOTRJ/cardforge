import { Check, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard } from "@/components/ui/surface-card";
import { cn } from "@/lib/utils";
import type { BillingPeriod, PlanDisplay, PlanTier } from "@/lib/billing/plans";

type PlanCardProps = {
  plan: PlanDisplay;
  /** The viewer's current tier, to mark "Your plan". */
  currentTier?: PlanTier | null;
  /** Billing period to price for. */
  period?: BillingPeriod;
  /** CTA node (checkout / portal / signup button). Hidden when this is the
   *  viewer's current plan. */
  cta?: React.ReactNode;
};

// Presentational pricing tier card. The CTA is injected so this stays a pure
// presentational component (the interactive checkout lives in client buttons).
export function PlanCard({ plan, currentTier, period = "monthly", cta }: PlanCardProps) {
  const isCurrent = currentTier === plan.tier;
  const showAnnual =
    period === "annual" && plan.annualUsd != null && plan.annualUsd > 0;

  return (
    <SurfaceCard
      tone={plan.featured ? "gold" : "default"}
      className={cn(
        "relative flex flex-col gap-5 p-6",
        plan.featured && "ring-1 ring-gold/25",
      )}
    >
      {plan.featured ? (
        <Badge variant="gold" className="absolute -top-3 left-6 bg-surface">
          Most popular
        </Badge>
      ) : null}

      <div className="flex flex-col gap-1">
        <h3 className="font-display text-xl font-semibold text-foreground">
          {plan.name}
        </h3>
        <p className="text-sm leading-6 text-muted">{plan.tagline}</p>
      </div>

      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-4xl font-semibold tracking-tight text-foreground">
            ${showAnnual ? plan.annualUsd : plan.priceUsd}
          </span>
          <span className="text-sm text-muted">
            {plan.priceUsd === 0 ? "forever" : showAnnual ? "/ year" : "/ month"}
          </span>
        </div>
        {showAnnual ? (
          <span className="text-xs text-primary-bright">
            ≈ ${(plan.annualUsd! / 12).toFixed(2)}/mo · 2 months free
          </span>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2.5">
        {plan.features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2.5 text-sm leading-6 text-foreground"
          >
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary-bright" aria-hidden />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {plan.comingSoon?.length ? (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gold-strong">
            Coming soon!
          </span>
          <ul className="flex flex-col gap-2">
            {plan.comingSoon.map((feature) => (
              <li
                key={feature}
                className="flex items-start gap-2.5 text-sm leading-6 text-muted"
              >
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-auto pt-2">
        {isCurrent ? (
          <Badge
            variant="outline"
            className="flex w-full justify-center py-2 text-sm"
          >
            Your current plan
          </Badge>
        ) : (
          cta
        )}
      </div>
    </SurfaceCard>
  );
}
