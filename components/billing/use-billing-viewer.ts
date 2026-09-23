"use client";

import { useEffect, useState } from "react";
import { hasSupabaseSessionCookie } from "@/lib/supabase/session-cookie";
import type { HeaderUser } from "@/components/layout/site-header";
import {
  ANONYMOUS_BILLING_VIEWER,
  billingViewerFromUser,
  type BillingViewer,
} from "@/lib/billing/viewer";

export { ANONYMOUS_BILLING_VIEWER, billingViewerFromUser, type BillingViewer };

// ---------------------------------------------------------------------------
// The viewer's billing state for the storefront surfaces. Two modes:
//
//   • `initial` given (the /pricing storefront): the server already rendered
//     the right buttons for this visitor — proxy.ts sends signed-in visitors
//     to the dynamic pricing-member route — so the hook just holds that
//     value. No fetch, no anonymous-first flash (the 2026-09-22 report:
//     "the button flashes and the text changes").
//   • no `initial` (the upgrade modal, mounted on every page): auth-island
//     pattern — a session cookie triggers ONE /api/me fetch once `enabled`.
//
// Every checkout/portal action re-validates on the server — this only
// decides which button to show.
// ---------------------------------------------------------------------------

export function useBillingViewer(
  options: { enabled?: boolean; initial?: BillingViewer } = {},
): BillingViewer {
  const { initial } = options;
  const enabled = (options.enabled ?? true) && !initial;
  const [viewer, setViewer] = useState<BillingViewer>(initial ?? ANONYMOUS_BILLING_VIEWER);

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

  return initial ?? viewer;
}
