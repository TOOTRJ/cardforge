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
import { PLANS, type PaidTier } from "@/lib/billing/plans";

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
    credits: {
      title: "You're out of AI credits",
      description:
        "Every plan refills monthly — 5 credits on Free, 30 on Plus, 100 on Pro — or grab a one-time pack that never expires. Credits power AI card, idea and art generation. Your card and everything you've made stay exactly as they are.",
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
    // AI deck/set/card generation itself is open to every tier — credits are
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

type UpgradeModalProps = {
  open: boolean;
  reason: UpgradeReason;
  onOpenChange: (open: boolean) => void;
};

export function UpgradeModal({ open, reason, onOpenChange }: UpgradeModalProps) {
  const copy = REASON_COPY[reason] ?? REASON_COPY.generic;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-primary-bright" aria-hidden />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 py-5">
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
              <CheckoutButton
                input={{ kind: "subscription", tier: plan.tier as PaidTier }}
                variant={plan.featured ? "primary" : "outline"}
                size="sm"
                className="w-auto"
              >
                Try {plan.name} free
              </CheckoutButton>
            </div>
          ))}

          {/* Honest trial framing: checkout re-checks eligibility server-side,
              so the footnote carries the "first-time" caveat rather than the
              button over-promising. */}
          <p className="text-xs leading-5 text-gold-strong">
            7-day free trial for first-time subscribers — no card required,
            cancel anytime.
          </p>

          <Button asChild variant="ghost" size="sm" className="self-start">
            <Link href="/pricing" onClick={() => onOpenChange(false)}>
              See full pricing &amp; credit packs →
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
