"use client";

import { useState } from "react";
import Link from "next/link";
import {
  PLANS,
  type BillingPeriod,
  type PaidTier,
  type PlanTier,
} from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PlanCard } from "./plan-card";
import { CheckoutButton } from "./checkout-button";
import { ManageBillingButton } from "./manage-billing-button";

type PricingPlansProps = {
  currentTier: PlanTier | null;
  isPaid: boolean;
  isSignedIn: boolean;
};

// Client wrapper for the pricing grid: owns the monthly/annual toggle and emits
// the right CTA per plan (signup link / Stripe checkout / portal). Enforcement
// is all server-side; this is just the storefront.
export function PricingPlans({
  currentTier,
  isPaid,
  isSignedIn,
}: PricingPlansProps) {
  const [period, setPeriod] = useState<BillingPeriod>("monthly");

  function ctaFor(tier: PlanTier, featured?: boolean): React.ReactNode {
    const variant = featured ? "primary" : "outline";
    if (tier === "free") {
      if (!isSignedIn) {
        return (
          <Button asChild variant="outline" className="w-full">
            <Link href="/signup">Get started free</Link>
          </Button>
        );
      }
      return null;
    }
    if (!isSignedIn) {
      return (
        <Button asChild variant={variant} className="w-full">
          <Link href="/signup">Sign up to upgrade</Link>
        </Button>
      );
    }
    if (isPaid) {
      // Already subscribed → switch/manage in the Stripe portal (avoids a
      // second subscription via Checkout).
      return (
        <ManageBillingButton variant={variant} className="w-full">
          Manage plan
        </ManageBillingButton>
      );
    }
    return (
      <CheckoutButton
        input={{ kind: "subscription", tier: tier as PaidTier, period }}
        variant={variant}
      >
        Choose {tier === "plus" ? "Plus" : "Pro"}
      </CheckoutButton>
    );
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

      <div className="mx-auto mt-8 grid max-w-5xl gap-6 md:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.tier}
            plan={plan}
            period={period}
            currentTier={currentTier}
            cta={ctaFor(plan.tier, plan.featured)}
          />
        ))}
      </div>
    </>
  );
}
