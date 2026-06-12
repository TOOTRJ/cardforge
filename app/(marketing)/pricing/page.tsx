import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { BillingReturnToast } from "@/components/billing/billing-return-toast";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getCurrentUser } from "@/lib/supabase/server";
import { PricingPlans } from "@/components/billing/pricing-plans";
import { CreditPackGrid } from "@/components/billing/credit-pack-grid";
import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Design custom MTG-style cards for free. Upgrade for more AI generation credits, watermark-free hi-res exports, the AI set generator, and premium frames. Monthly or annual.",
};

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  // Billing hidden for now — the page 404s until NEXT_PUBLIC_BILLING_ENABLED=true.
  if (!isBillingEnabled()) notFound();

  const user = await getCurrentUser();
  const entitlements = user ? await getEntitlements() : null;
  const currentTier = entitlements?.tier ?? null;
  const isPaid = entitlements?.isPaid ?? false;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <Suspense fallback={null}>
        <BillingReturnToast />
      </Suspense>
      {/* Header */}
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary-bright">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Simple, honest pricing
        </span>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Forge more with a plan
        </h1>
        <p className="text-base leading-7 text-muted">
          The card maker is free forever — every frame, every card type. Plans
          add AI generation credits, watermark-free hi-res exports, the AI set
          generator, and premium finishes. You only ever pay for our technology,
          never for MTG-style rendering.
        </p>
      </div>

      {/* Plans (with monthly/annual toggle) */}
      <PricingPlans
        currentTier={currentTier}
        isPaid={isPaid}
        isSignedIn={Boolean(user)}
      />

      {/* Credit packs */}
      <div className="mx-auto mt-20 max-w-3xl">
        <div className="mb-6 flex flex-col gap-2 text-center">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Need a top-up?
          </h2>
          <p className="text-sm leading-6 text-muted">
            Buy AI credits any time — on any plan, including Free. Purchased
            credits never expire.
          </p>
        </div>
        <CreditPackGrid />
      </div>

      {/* Disclaimer */}
      <p className="mx-auto mt-16 max-w-3xl text-center text-xs leading-5 text-subtle">
        {siteConfig.disclaimer}
      </p>
    </div>
  );
}
