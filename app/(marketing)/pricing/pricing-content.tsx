import { Suspense } from "react";
import { Layers, Sparkles } from "lucide-react";
import { BillingReturnToast } from "@/components/billing/billing-return-toast";
import { PricingPlans } from "@/components/billing/pricing-plans";
import { CreditPackGrid } from "@/components/billing/credit-pack-grid";
import { siteConfig } from "@/lib/site-config";
import { FREE_PERIOD_CREDITS, PLAN_CREDITS_ONCE, SIGNUP_BANK_DAYS, SIGNUP_CREDITS } from "@/lib/billing/plans";
import type { BillingViewer } from "@/lib/billing/viewer";
import { CARDS_ARE_SAFE, capacityFactsLine, capacityHoldsLine, planForTier } from "@/lib/billing/plans";
import { capacityTone, capacityUpgradeLink, type CardCapacity } from "@/lib/billing/capacity-copy";
import { PageContainer } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";

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

// The headline is the saved-card cap (owner finding 2026-11-06: people pay
// to save more cards — docs/research/card-capacity-conversion-2026-11.md),
// in the owner's rule: "while a Plus or Pro plan is active the account has
// the plan's full card limit" — never a permanent promise. "Save more
// cards." over that rule with its numbers (every one from CARD_CAPACITY),
// then the soft-cap fact. A signed-in visitor (the member twin passes
// `capacity`) sees their own meter under it — the decision is made here,
// so the number is here.
export function PricingContent({
  initialViewer,
  capacity = null,
}: {
  initialViewer?: BillingViewer;
  /** The signed-in viewer's saved cards against their cap (pricing-member). */
  capacity?: CardCapacity | null;
}) {
  return (
    <PageContainer size="wide" className="py-16 lg:py-24">
      <Suspense fallback={null}>
        <BillingReturnToast />
      </Suspense>
      {/* Header */}
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {capacityFactsLine()}
        </span>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Save{" "}
          <span className="bg-linear-to-r from-gold-strong to-primary-bright bg-clip-text text-transparent">
            more cards.
          </span>
        </h1>
        <p className="text-lg font-semibold leading-7 text-foreground">
          {capacityHoldsLine()}
        </p>
        <PricingCapacityMeter capacity={capacity} />
        <p className="text-base leading-7 text-muted">
          {CARDS_ARE_SAFE}{" "}
          {`The card maker is free forever: every frame, every finish, every card type, and every AI tool, with ${SIGNUP_CREDITS} AI credits to get you started. Plans add their card limit, a one-time stock of AI credits, watermark-free hi-res downloads, and Pro's deck-aware AI; credit packs top you up any time and never expire. You only ever pay for our technology, never for MTG-style rendering.`}
        </p>
        <p className="text-sm font-medium text-gold-strong">
          {`Every new account starts with ${SIGNUP_BANK_DAYS} free days in the bank — start any plan with them, with ${FREE_PERIOD_CREDITS} AI credits to play with. Nothing is charged until the days end, cancel anytime before then, and your plan's credits (${PLAN_CREDITS_ONCE.plus} on Plus, ${PLAN_CREDITS_ONCE.pro} on Pro) land with your first payment. Refer a friend to bank more.`}
        </p>
      </div>

      {/* Plans (with monthly/annual toggle); viewer state hydrates
          client-side so the page stays static. */}
      {/* The plans keep their 1152 px row in the wide frame (TODO WD10):
          three plan cards side by side read as a comparison only while each
          stays near 360 px. */}
      <div className="mx-auto max-w-6xl">
        <PricingPlans initialViewer={initialViewer} />
      </div>

      {/* Credit packs */}
      <div className="mx-auto mt-20 max-w-3xl">
        <div className="mb-6 flex flex-col gap-2 text-center">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Need a top-up?
          </h2>
          <p className="text-sm leading-6 text-muted">
            Buy AI credits any time — on any plan, including Free. Purchased
            credits never expire, and Plus and Pro members pay 20% less.
          </p>
        </div>
        <CreditPackGrid surface="pricing" />
      </div>

      {/* Disclaimer */}
      <p className="mx-auto mt-16 max-w-3xl text-center text-xs leading-5 text-subtle">
        {siteConfig.disclaimer}
      </p>
    </PageContainer>
  );
}

/** "You've saved 48 of 50 cards on Free — Plus holds 500." — the viewer's
 *  own meter, toned by how close the cap is (the same rule as My Cards).
 *  Nothing for an anonymous visitor or an unlimited plan. */
function PricingCapacityMeter({ capacity }: { capacity: CardCapacity | null }) {
  if (!capacity || capacity.cap < 0) return null;
  const tone = capacityTone(capacity);
  const next = capacityUpgradeLink(capacity.tier);
  const used = capacity.used.toLocaleString("en-US");
  const cap = capacity.cap.toLocaleString("en-US");
  const plan = planForTier(capacity.tier).name;
  return (
    <p
      role="status"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium",
        tone === "danger"
          ? "border-danger/50 bg-danger/10 text-foreground"
          : tone === "warning"
            ? "border-gold/50 bg-gold/10 text-foreground"
            : "border-border/70 bg-surface/80 text-muted",
      )}
    >
      <Layers className="h-4 w-4 shrink-0 text-gold-strong" aria-hidden />
      <span>
        {capacity.used >= capacity.cap
          ? `Your ${plan} library is full — ${used} of ${cap} cards saved, all of them safe.`
          : `You've saved ${used} of ${cap} cards on ${plan}.`}
        {next ? ` ${next.label}.` : ""}
      </span>
    </p>
  );
}
