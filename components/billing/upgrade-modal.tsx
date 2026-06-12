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
        "Upgrade for a monthly credit allotment — or grab a one-time pack. Credits power AI card and art generation.",
    },
    premium_frame: {
      title: "That's a premium finish",
      description:
        "Foil, etched, and showcase finishes are part of a paid plan. Every MTG-style frame stays free.",
    },
    capacity: {
      title: "Card limit reached",
      description:
        "Upgrade for a much bigger library — up to unlimited saved cards on Pro.",
    },
    hi_res_export: {
      title: "Unlock hi-res, watermark-free exports",
      description:
        "Paid plans remove the watermark and unlock full-resolution downloads.",
    },
    pdf_export: {
      title: "Print-ready PDF export",
      description: "Clean, print-ready PDF export is a Plus feature.",
    },
    batch_export: {
      title: "Batch & whole-set export",
      description: "Export an entire set in one click with Pro.",
    },
    deck_gen: {
      title: "AI set generator",
      description:
        "Draft a whole themed set with AI in seconds — a Pro feature.",
    },
    generic: {
      title: "Go premium",
      description:
        "Unlock more AI credits, clean hi-res exports, premium finishes, and the AI set generator.",
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
                Choose {plan.name}
              </CheckoutButton>
            </div>
          ))}

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
