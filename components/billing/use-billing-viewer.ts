"use client";

import { useEffect, useState } from "react";
import type { PlanTier } from "@/lib/billing/plans";
import { hasSupabaseSessionCookie } from "@/lib/supabase/session-cookie";
import type { HeaderUser } from "@/components/layout/site-header";

// ---------------------------------------------------------------------------
// The viewer's billing state for the storefront surfaces (/pricing, the
// upgrade modal). Auth-island pattern: the server HTML is the anonymous
// storefront (so /pricing stays static/ISR); after hydration a session cookie
// triggers ONE /api/me fetch that swaps in the signed-in CTAs. Anonymous
// visitors pay zero extra network. Every checkout/portal action re-validates
// on the server — this only decides which button to show.
// ---------------------------------------------------------------------------

export type BillingViewer = {
  /** False until /api/me answered (or there was no session cookie). */
  loaded: boolean;
  isSignedIn: boolean;
  /** Paid perks apply right now (live subscription, admin comp, or admin). */
  isPaid: boolean;
  /** The EFFECTIVE tier — what "Your current plan" means. */
  currentTier: PlanTier | null;
  /** Ever held a subscription (any status) — no trial copy for them. */
  hasSubscribed: boolean;
  /** A Stripe customer exists — the portal can open. */
  hasBillingAccount: boolean;
  /** A subscription Stripe still bills (active/trialing). */
  hasLiveSubscription: boolean;
  subscriptionStatus: string | null;
};

export const ANONYMOUS_BILLING_VIEWER: BillingViewer = {
  loaded: false,
  isSignedIn: false,
  isPaid: false,
  currentTier: null,
  hasSubscribed: false,
  hasBillingAccount: false,
  hasLiveSubscription: false,
  subscriptionStatus: null,
};

export function billingViewerFromUser(user: HeaderUser | null): BillingViewer {
  if (!user) return { ...ANONYMOUS_BILLING_VIEWER, loaded: true };
  return {
    loaded: true,
    isSignedIn: true,
    isPaid: user.isPaid ?? false,
    currentTier: user.tier ?? null,
    hasSubscribed: user.hasSubscribed ?? false,
    hasBillingAccount: user.hasBillingAccount ?? false,
    hasLiveSubscription: user.hasLiveSubscription ?? false,
    subscriptionStatus: user.subscriptionStatus ?? null,
  };
}

/** `enabled: false` defers the fetch (the upgrade modal is mounted on every
 *  page — it only asks once it opens). */
export function useBillingViewer(options: { enabled?: boolean } = {}): BillingViewer {
  const enabled = options.enabled ?? true;
  const [viewer, setViewer] = useState<BillingViewer>(ANONYMOUS_BILLING_VIEWER);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      // No session cookie → anonymous, zero network. (Resolved inside the
      // async body so the server HTML and the first client render stay the
      // identical anonymous storefront.)
      if (!hasSupabaseSessionCookie()) {
        if (!cancelled) setViewer({ ...ANONYMOUS_BILLING_VIEWER, loaded: true });
        return;
      }
      try {
        const res = await fetch("/api/me");
        const data: { user: HeaderUser | null } = res.ok
          ? await res.json()
          : { user: null };
        if (cancelled) return;
        setViewer(billingViewerFromUser(data.user));
      } catch {
        // Network hiccup — keep the anonymous storefront; the server
        // re-validates on checkout anyway.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return viewer;
}
