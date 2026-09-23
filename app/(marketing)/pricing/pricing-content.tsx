import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { BillingReturnToast } from "@/components/billing/billing-return-toast";
import { PricingPlans } from "@/components/billing/pricing-plans";
import { CreditPackGrid } from "@/components/billing/credit-pack-grid";
import { siteConfig } from "@/lib/site-config";
import type { BillingViewer } from "@/lib/billing/viewer";

// ---------------------------------------------------------------------------
// The storefront body, shared by two routes:
//   /pricing         → static/ISR, anonymous storefront (no viewer) — what
//                      every signed-out visitor and every crawler gets.
//   /pricing-member  → dynamic; proxy.ts rewrites a signed-in visitor's
//                      /pricing here so their real buttons are in the HTML.
//                      (The old single static page rendered the anonymous
//                      buttons first and swapped them after a /api/me fetch
//                      — "the button flashes and the text changes".)
// ---------------------------------------------------------------------------

export function PricingContent({ initialViewer }: { initialViewer?: BillingViewer }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
      <Suspense fallback={null}>
        <BillingReturnToast />
      </Suspense>
      {/* Header */}
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Choose the plan that fits your craft
        </span>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Legendary tools.{" "}
          <span className="bg-linear-to-r from-gold-strong to-primary-bright bg-clip-text text-transparent">
            Every creator.
          </span>
        </h1>
        <p className="text-base leading-7 text-muted">
          The card maker is free forever — every frame, every finish, every
          card type, and every AI tool, with 5 AI credits a month. Plans add
          far more monthly credits, watermark-free hi-res downloads, and
          Pro&apos;s deck-aware AI. You only ever pay for our technology, never
          for MTG-style rendering.
        </p>
        <p className="text-sm font-medium text-gold-strong">
          First time subscribing? Try any plan free for 7 days — no card required.
        </p>
      </div>

      {/* Plans (with monthly/annual toggle); viewer state hydrates
          client-side so the page stays static. */}
      <PricingPlans initialViewer={initialViewer} />

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
