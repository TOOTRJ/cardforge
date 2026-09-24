"use client";

import Link from "next/link";
import { Crown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckoutButton } from "./checkout-button";
import { CreditPackGrid } from "./credit-pack-grid";
import { ManageBillingButton } from "./manage-billing-button";
import { pricingCtaFor } from "./pricing-cta";
import { useBillingViewer } from "./use-billing-viewer";
import {
  PACK_SUBSCRIBER_DISCOUNT_PCT,
  PLANS,
  SIGNUP_CREDITS,
  TRIAL_DAYS,
  type PaidTier,
} from "@/lib/billing/plans";

export type UpgradeReason =
  | "credits"
  | "premium_frame"
  | "capacity"
  | "hi_res_export"
  | "pdf_export"
  | "batch_export"
  | "deck_aware_generation"
  | "subscriber_perks"
  | "deck_export"
  | "deck_guide"
  | "generic";

const REASON_COPY: Record<UpgradeReason, { title: string; description: string }> =
  {
    // The credits copy is viewer-aware (see creditsDescription below); this is
    // the free-account wording, also the fallback before the viewer loads.
    credits: {
      title: "You're out of AI credits",
      description: `Free accounts get ${SIGNUP_CREDITS} credits to start and don't refill. A pack tops you up any time, or a plan refills every month. Credits power AI card, idea and art generation — everything you've made stays exactly as it is.`,
    },
    premium_frame: {
      title: "That's a premium frame",
      description:
        "Original premium frames are part of a paid plan. Every MTG-style frame and finish stays free.",
    },
    capacity: {
      title: "Card limit reached",
      description:
        "Your forge is full. Upgrade for a much bigger library — up to unlimited saved cards on Pro.",
    },
    hi_res_export: {
      title: "Download it clean",
      description:
        "Paid plans remove the PipGlyph mark and unlock full-resolution (1500 × 2100) downloads. The free watermarked PNG is always available.",
    },
    pdf_export: {
      title: "Print-ready PDF export",
      description: "Clean, print-ready PDF export is a Plus feature.",
    },
    batch_export: {
      title: "Batch & whole-deck export",
      description: "Export a whole deck in one click with Pro.",
    },
    // AI deck/card generation itself is open to every tier — credits are
    // the only limiter (owner decision 2026-07-28). The ONE tier-gated AI
    // feature is designing a card FOR a specific deck (owner decision
    // 2026-09-15): the deck is analyzed and the card lands in it.
    deck_aware_generation: {
      title: "Design cards for your deck",
      description:
        "Pro can point the AI at one of your decks: it studies the deck's colors, curve and cards, then designs the card it's missing (and adds it to the deck) or themes a batch of ideas to it.",
    },
    subscriber_perks: {
      title: "Make the card yours, all the way down",
      description:
        "Plus and Pro downloads print without the pipglyph.com mark — or with your own footer mark — and let you choose the watermark on creatures and spells, or none at all. Custom frames are coming soon.",
    },
    deck_export: {
      title: "Download the whole deck",
      description:
        "Exporting a deck — the card images as a ZIP, print-ready PDFs, and the deck report with stats, how to play and combos — is a Pro feature. Copying and sharing the deck stays free.",
    },
    deck_guide: {
      title: "How to play & combos",
      description:
        "Pro members see an AI-written guide on every deck: the game plan, mulligan advice, the combos hiding in the list, and its weak spots. AI-generated decks come with one; any other deck can be analyzed for a credit.",
    },
    generic: {
      title: "Go premium",
      description: "More AI credits every month and clean hi-res exports.",
    },
  };

const PAID_PLANS = PLANS.filter((plan) => plan.tier !== "free");

function PlanCta({
  tier,
  featured,
  cta,
  isCurrent,
  loaded,
}: {
  tier: PaidTier;
  featured?: boolean;
  cta: ReturnType<typeof pricingCtaFor>;
  isCurrent: boolean;
  loaded: boolean;
}) {
  const variant = featured ? "primary" : "outline";
  if (isCurrent) return <Badge variant="outline">Your current plan</Badge>;
  if (!loaded) {
    return (
      <Button variant={variant} size="sm" className="w-auto" disabled>
        Loading…
      </Button>
    );
  }
  switch (cta.kind) {
    case "signup":
      return (
        <Button asChild variant={variant} size="sm" className="w-auto">
          <Link href="/signup">{cta.label}</Link>
        </Button>
      );
    case "portal":
      return (
        <ManageBillingButton variant={variant} size="sm" className="w-auto">
          {cta.label}
        </ManageBillingButton>
      );
    case "checkout":
      return (
        <CheckoutButton
          input={{ kind: "subscription", tier }}
          variant={variant}
          size="sm"
          className="w-auto"
        >
          {cta.label}
        </CheckoutButton>
      );
    default:
      return null;
  }
}

type UpgradeModalProps = {
  open: boolean;
  reason: UpgradeReason;
  onOpenChange: (open: boolean) => void;
};

/** Out of credits, for a subscriber: their plan refills — a pack is a top-up.
 *  The discount is promised only when it will actually apply (ACTIVE plan);
 *  a trial hears that it starts once the trial converts. */
function creditsDescription(subscriber: boolean, packDiscount: boolean): string {
  if (!subscriber) return REASON_COPY.credits.description;
  const discount = packDiscount
    ? `${PACK_SUBSCRIBER_DISCOUNT_PCT}% off for subscribers`
    : `the ${PACK_SUBSCRIBER_DISCOUNT_PCT}% subscriber discount starts once your trial converts`;
  return `Your plan refills every month — top up any time with a pack, ${discount}. Credits power AI card, idea and art generation — everything you've made stays exactly as it is.`;
}

export function UpgradeModal({ open, reason, onOpenChange }: UpgradeModalProps) {
  const copy = REASON_COPY[reason] ?? REASON_COPY.generic;
  // The same CTA table as /pricing, fetched only once the modal opens: a
  // lapsed subscriber sees "Choose Pro", a live one "Switch to Pro", a
  // broken card "Update payment" — never a trial the checkout won't grant.
  const viewer = useBillingViewer({ enabled: open });
  const subscriber = viewer.hasLiveSubscription;
  // Packs sell where the need is felt (owner decision 2026-09-24): the
  // out-of-credits case lists them right here. Free users see the plans
  // first (the trial is the bigger offer); subscribers see packs first, at
  // the subscriber price once the plan is ACTIVE (a trial hasn't paid yet).
  const showPacks = reason === "credits";
  const packDiscount = subscriber && viewer.subscriptionStatus === "active";
  const packs = showPacks ? (
    <section className="flex flex-col gap-2" aria-label="Credit packs">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
        Credit packs{packDiscount ? ` · ${PACK_SUBSCRIBER_DISCOUNT_PCT}% subscriber price` : " · never expire"}
      </p>
      <CreditPackGrid compact discounted={packDiscount} />
    </section>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-primary-bright" aria-hidden />
            {copy.title}
          </DialogTitle>
          <DialogDescription>
            {reason === "credits" ? creditsDescription(subscriber, packDiscount) : copy.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 py-5">
          {subscriber ? packs : null}
          {showPacks && !subscriber ? (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Plans</p>
          ) : null}
          {PAID_PLANS.map((plan) => (
            <div
              key={plan.tier}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 p-4"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-display text-base font-semibold text-foreground">
                    {plan.name}
                  </span>
                  {plan.featured ? <Badge variant="primary">Popular</Badge> : null}
                  <span className="text-sm text-muted">${plan.priceUsd}/mo</span>
                </div>
                <span className="truncate text-xs text-muted">{plan.tagline}</span>
              </div>
              <PlanCta
                tier={plan.tier as PaidTier}
                featured={plan.featured}
                cta={pricingCtaFor(viewer, plan.tier)}
                isCurrent={viewer.currentTier === plan.tier && viewer.hasLiveSubscription}
                loaded={viewer.loaded}
              />
            </div>
          ))}

          {!subscriber ? packs : null}

          {/* Honest trial framing: only an account that has never subscribed
              is promised the trial (checkout re-checks server-side). */}
          {!viewer.hasSubscribed ? (
            <p className="text-xs leading-5 text-gold-strong">
              {TRIAL_DAYS}-day free trial for first-time subscribers — no card
              required, cancel anytime.
            </p>
          ) : null}

          <Button asChild variant="ghost" size="sm" className="self-start">
            <Link
              href={viewer.isPaid ? "/dashboard/billing" : "/pricing"}
              onClick={() => onOpenChange(false)}
            >
              {viewer.isPaid ? "Open billing & credit packs →" : "See full pricing & credit packs →"}
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
