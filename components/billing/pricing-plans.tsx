"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PLANS, type BillingPeriod, type PaidTier, type PlanTier } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PlanCard } from "./plan-card";
import { CheckoutButton } from "./checkout-button";
import { ManageBillingButton } from "./manage-billing-button";
import { pricingCtaFor } from "./pricing-cta";
import { useBillingViewer } from "./use-billing-viewer";
import type { BillingViewer } from "@/lib/billing/viewer";
import { trackFunnelEvent } from "@/lib/analytics/funnel-client";

// Client wrapper for the pricing grid: owns the monthly/annual toggle and emits
// the right CTA per plan (signup link / Stripe checkout / portal) from the
// pricingCtaFor table. Enforcement is all server-side; this is the storefront.
//
// Anonymous visitors get the static/ISR storefront (no viewer → the hook
// resolves "anonymous" without a fetch). Signed-in visitors never see it:
// proxy.ts rewrites their /pricing to the dynamic pricing-member route, which
// passes the viewer it resolved on the server, so the HTML already carries
// their buttons — no anonymous-first flash, no text swap after hydration.
export function PricingPlans({
  initialViewer,
  surface = "pricing",
}: {
  initialViewer?: BillingViewer;
  /** Funnel: where this grid is shown (`pricing_view.surface`, `cta_click.surface`). */
  surface?: "pricing" | "billing";
}) {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const viewer = useBillingViewer({ initial: initialViewer });
  // One pricing_view per mount (a ref keeps React's dev double-effect to one).
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    trackFunnelEvent("pricing_view", { surface });
  }, [surface]);

  function ctaFor(tier: PlanTier, featured?: boolean): React.ReactNode {
    const variant = featured ? "primary" : "outline";
    const cta = pricingCtaFor(viewer, tier);
    switch (cta.kind) {
      case "signup":
        return (
          <Button asChild variant={tier === "free" ? "outline" : variant} className="w-full">
            <Link
              href="/signup"
              onClick={() => trackFunnelEvent("cta_click", { surface, kind: "signup", tier })}
            >
              {cta.label}
            </Link>
          </Button>
        );
      case "portal":
        return (
          <ManageBillingButton variant={tier === "free" ? "outline" : variant} className="w-full">
            {cta.label}
          </ManageBillingButton>
        );
      case "checkout":
        return (
          <CheckoutButton
            input={{ kind: "subscription", tier: tier as PaidTier, period }}
            surface={surface}
            variant={variant}
          >
            {cta.label}
          </CheckoutButton>
        );
      default:
        return null;
    }
  }

  return (
    <>
      <div className="mt-10 flex justify-center">
        <div
          role="tablist"
          aria-label="Billing period"
          className="flex w-fit items-center gap-1 rounded-full border border-border/70 bg-surface/80 p-1"
        >
          {(["monthly", "annual"] as const).map((option) => {
            const active = period === option;
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPeriod(option)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                {option === "monthly" ? "Monthly" : "Annual"}
                {option === "annual" ? (
                  <span className="ml-1.5 text-xs opacity-80">2 mo free</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.tier}
            plan={plan}
            period={period}
            currentTier={viewer.currentTier}
            cta={ctaFor(plan.tier, plan.featured)}
          />
        ))}
      </div>
    </>
  );
}
