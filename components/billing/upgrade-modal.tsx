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
import { ResumePlanButton } from "./resume-plan-button";
import { pricingCtaFor } from "./pricing-cta";
import { useBillingViewer } from "./use-billing-viewer";
import {
  CARDS_ARE_SAFE,
  PACK_SUBSCRIBER_DISCOUNT_PCT,
  PLANS,
  PRINT_PERK_COPY,
  SIGNUP_CREDITS,
  FREE_PERIOD_CREDITS,
  PLAN_CREDITS_ONCE,
  SIGNUP_BANK_DAYS,
  capacityHoldsLine,
  type PaidTier,
} from "@/lib/billing/plans";
import { LocalDate } from "@/components/ui/local-date";

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
  | "deck_activity"
  | "deck_history"
  | "generic";

const REASON_COPY: Record<UpgradeReason, { title: string; description: string }> =
  {
    // The credits copy is viewer-aware (see creditsDescription below); this is
    // the free-account wording, also the fallback before the viewer loads.
    credits: {
      title: "You're out of AI credits",
      description: `Free accounts get ${SIGNUP_CREDITS} credits to start. A pack tops you up any time, and a plan brings ${PLAN_CREDITS_ONCE.plus} (Plus) or ${PLAN_CREDITS_ONCE.pro} (Pro) credits with its first payment. Credits power AI card, idea and art generation — everything you've made stays exactly as it is.`,
    },
    premium_frame: {
      title: "That's a premium frame",
      description:
        "Original premium frames are part of a paid plan. Every MTG-style frame and finish stays free.",
    },
    // The owner's rule (2026-11-06): the plan's full limit while the plan
    // is active, then the soft cap — nothing is deleted when it ends.
    capacity: {
      title: "Your library is full",
      description: `${capacityHoldsLine()} ${CARDS_ARE_SAFE}`,
    },
    // The print perks are said from ONE source (TODO 6.26,
    // lib/billing/plans.ts PRINT_PERK_COPY) — the plan cards list the same.
    hi_res_export: {
      title: "Download it clean",
      description: PRINT_PERK_COPY.clean,
    },
    pdf_export: {
      title: "Print-ready PDF export",
      description: PRINT_PERK_COPY.pdf,
    },
    batch_export: {
      title: "Print sheets & batch export",
      description: PRINT_PERK_COPY.sheets,
    },
    // AI card generation itself is open to every tier — credits are the
    // only limiter (owner decision 2026-07-28; AI deck building is paused,
    // TODO DK1). The ONE tier-gated AI feature is designing a card FOR a
    // specific deck (owner decision 2026-09-15): the deck is analyzed and
    // the card lands in it — create-card AI, open during the pause (D5).
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
    // While AI deck building is paused (TODO DK1, lib/ai/deck-ai-pause.ts)
    // no deck guide is written: these two name only the guides decks
    // already have (owner D4).
    deck_export: {
      title: "Download the whole deck",
      description:
        "Exporting a deck — the card images as a ZIP, print-ready PDFs, and the deck report with its stats (and its how-to-play guide, if the deck has one) — is a Pro feature. Copying and sharing the decklist stays free.",
    },
    deck_guide: {
      title: "How to play & combos",
      description:
        "Pro members can read the AI-written guide a deck already has: the game plan, mulligan advice, the combos hiding in the list, and its weak spots. New guides are paused while we rebuild decks — they're coming back soon.",
    },
    deck_activity: {
      title: "See how your deck is doing",
      description:
        "Pro shows each of your decks' views and likes over the last 7, 30 or 90 days, against the period before — as charts and as a table.",
    },
    deck_history: {
      title: "Every version of your deck",
      description:
        "Plus keeps the last 30 days of each deck's changes and Pro keeps them all — see what changed, when, and put the deck back the way it was in one click. If Pro ends, older history is kept 30 days. Undo and redo while you edit stay free.",
    },
    generic: {
      title: "Go premium",
      description: "A stock of AI credits, clean hi-res exports and more room for your cards.",
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
  // The current plan, cancelled and still running: offer the way to stay.
  if (isCurrent && cta.kind === "resume") {
    return (
      <ResumePlanButton planName={cta.planName} surface="modal" variant={variant} size="sm">
        {cta.label}
      </ResumePlanButton>
    );
  }
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
          surface="modal"
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

/** Out of credits, for a subscriber: a pack is the top-up (plan credits are
 *  one-time). The discount is promised only when it will actually apply
 *  (ACTIVE plan); a trial hears that it starts once the trial converts. */
function creditsDescription(subscriber: boolean, packDiscount: boolean): string {
  if (!subscriber) return REASON_COPY.credits.description;
  const discount = packDiscount
    ? `${PACK_SUBSCRIBER_DISCOUNT_PCT}% off for subscribers`
    : `the ${PACK_SUBSCRIBER_DISCOUNT_PCT}% subscriber discount starts once your trial converts`;
  return `Top up any time with a pack, ${discount} — purchased credits never expire. Credits power AI card, idea and art generation — everything you've made stays exactly as it is.`;
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
      <CreditPackGrid compact discounted={packDiscount} surface="modal" />
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
                <span className="truncate text-xs text-muted">
                  {viewer.currentTier === plan.tier && viewer.hasLiveSubscription && viewer.subscriptionEnding
                    ? viewer.subscriptionEndsAt
                      ? (
                        <>
                          {"Your current plan — cancelled, ends "}
                          <LocalDate iso={viewer.subscriptionEndsAt} />
                        </>
                      )
                      : "Your current plan — cancelled, ends with the period you paid for"
                    : plan.tagline}
                </span>
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

          {/* Honest framing: only an account that has never subscribed is
              promised its free days (checkout re-checks server-side). The
              days are the bank's (0179): the signup days, plus any earned. */}
          {!viewer.hasSubscribed ? (
            <p className="text-xs leading-5 text-gold-strong">
              {`Your banked free days are your plan's free time — ${SIGNUP_BANK_DAYS} to start, more from referrals — with ${FREE_PERIOD_CREDITS} AI credits to try. Nothing is charged until the days end, and you can cancel anytime before then; your plan's credits land with the first payment.`}
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
