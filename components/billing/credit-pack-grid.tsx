import { Coins } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { CheckoutButton } from "./checkout-button";
import { CREDIT_PACKS, type PackKey } from "@/lib/billing/plans";

const PACK_ORDER: PackKey[] = ["small", "large"];

// Consumable credit top-up packs (one-time purchase). Purchased credits never
// expire, so this monetizes everyone — not just subscribers.
export function CreditPackGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {PACK_ORDER.map((key) => {
        const pack = CREDIT_PACKS[key];
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
                <span className="text-sm text-muted">
                  ${pack.priceUsd} one-time · never expires
                </span>
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
