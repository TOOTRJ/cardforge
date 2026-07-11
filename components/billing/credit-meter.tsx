"use client";

// CreditMeter — a small always-visible balance chip for AI surfaces (the
// research-backed "know before you hit zero" affordance). Auth-island
// pattern: renders nothing while billing is off, hydrates its own state
// from /api/me so it can sit inside any client component without prop
// threading. At zero it swaps to a soft paywall line — the free path around
// it must always remain usable (never a dead end).

import { useEffect, useState } from "react";
import { Coins, Sparkles } from "lucide-react";
import { isBillingEnabled } from "@/lib/billing/flags";
import { formatCredits } from "@/lib/billing/plans";
import { hasSupabaseSessionCookie } from "@/lib/supabase/session-cookie";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import type { HeaderUser } from "@/components/layout/site-header";
import { cn } from "@/lib/utils";

export function CreditMeter({ className }: { className?: string }) {
  const upgrade = useUpgradeModal();
  const [state, setState] = useState<{ credits: number; isPaid: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (!isBillingEnabled()) return;
    if (!hasSupabaseSessionCookie()) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/me");
        const data: { user: HeaderUser | null } = res.ok
          ? await res.json()
          : { user: null };
        if (cancelled || !data.user) return;
        setState({
          credits: data.user.credits ?? 0,
          isPaid: data.user.isPaid ?? false,
        });
      } catch {
        // Meter is advisory — on a hiccup just don't render it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isBillingEnabled() || state === null) return null;

  if (state.credits <= 0) {
    return (
      <button
        type="button"
        onClick={() => upgrade.open("credits")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-xs font-medium text-gold-strong transition-colors hover:border-gold/70",
          className,
        )}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        0 credits — start your free trial
      </button>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-elevated px-2.5 py-1 text-xs font-medium text-foreground",
        className,
      )}
      title={
        state.isPaid
          ? "AI credits remaining — they refill monthly"
          : "AI credits remaining"
      }
    >
      <Coins className="h-3.5 w-3.5 text-gold-strong" aria-hidden />
      {formatCredits(state.credits)}{" "}
      {state.credits === 1 ? "credit" : "credits"}
    </span>
  );
}
