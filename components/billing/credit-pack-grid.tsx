import { Coins } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { CheckoutButton } from "./checkout-button";
import {
  CREDIT_PACKS,
  PACK_ORDER,
  discountedPackPriceUsd,
  formatUsd,
} from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

type CreditPackGridProps = {
  /** Show the subscriber price (an ACTIVE Plus/Pro subscription — the
   *  checkout action applies the coupon server-side; this is display only). */
  discounted?: boolean;
  /** Tight three-up rows for the upgrade modal. */
  compact?: boolean;
  className?: string;
};

// Consumable credit top-up packs (one-time purchase). Purchased credits never
// expire, so this monetizes everyone — Free accounts (5 credits at signup, no
// refill) most of all. Server-safe: no hooks; callers pass `discounted`.
export function CreditPackGrid({ discounted = false, compact = false, className }: CreditPackGridProps) {
  return (
    <div className={cn("grid sm:grid-cols-3", compact ? "gap-2" : "gap-4", className)}>
      {PACK_ORDER.map((key) => {
        const pack = CREDIT_PACKS[key];
        const price = discounted ? discountedPackPriceUsd(key) : pack.priceUsd;
        const priceLine = discounted ? (
          <>
            <s className="text-subtle">{formatUsd(pack.priceUsd)}</s> {formatUsd(price)} for subscribers
            {compact ? null : " · never expires"}
          </>
        ) : (
          <>
            {formatUsd(price)} one-time{compact ? "" : " · never expires"}
          </>
        );
        if (compact) {
          return (
            <div
              key={key}
              className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background/40 p-3"
            >
              <span className="font-display text-sm font-semibold text-foreground">{pack.credits} credits</span>
              <span className="text-xs text-muted">{priceLine}</span>
              <CheckoutButton input={{ kind: "pack", pack: key }} variant="outline" size="sm">
                Buy {pack.credits} credits
              </CheckoutButton>
            </div>
          );
        }
        return (
          <SurfaceCard key={key} className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-gold-strong">
                <Coins className="h-5 w-5" aria-hidden />
              </span>
              <div className="flex flex-col">
                <span className="font-display text-lg font-semibold text-foreground">
                  {pack.credits} credits
                </span>
                <span className="text-sm text-muted">{priceLine}</span>
              </div>
            </div>
            <CheckoutButton input={{ kind: "pack", pack: key }} variant="outline">
              Buy {pack.credits} credits
            </CheckoutButton>
          </SurfaceCard>
        );
      })}
    </div>
  );
}
