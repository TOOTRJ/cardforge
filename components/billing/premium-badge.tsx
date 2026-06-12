import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";

// Small "Premium" chip placed next to paid-only controls. Cosmetic only — the
// real gating is enforced server-side.
export function PremiumBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-gold/45 bg-gold/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-gold-strong",
        className,
      )}
    >
      <Crown className="h-2.5 w-2.5" aria-hidden />
      Premium
    </span>
  );
}
