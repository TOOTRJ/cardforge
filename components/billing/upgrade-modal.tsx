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
  | "deck_gen"
  | "generic";

const REASON_COPY: Record<UpgradeReason, { title: string; description: string }> =
  {
    credits: {
      title: "You're out of AI credits",
      description:
        "Plans refill your credits every month — or grab a one-time pack. Credits power AI card and art generation. Your card and everything you've made stay exactly as they are.",
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
    deck_gen: {
      title: "AI deck generator",
      description:
        "Draft a whole themed deck with AI in minutes — a Pro feature.",
    },
    generic: {
      title: "Go premium",
      description:
        "More AI credits every month, clean hi-res exports, and AI deck generation.",
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
