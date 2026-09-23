import type { PlanTier } from "@/lib/billing/plans";
import type { HeaderUser } from "@/components/layout/site-header";
import type { Entitlements } from "@/lib/billing/entitlements";

// ---------------------------------------------------------------------------
// The viewer's billing state as the storefront sees it (/pricing, the upgrade
// modal). One shape, two producers: the server (app/(marketing)/pricing-
// member renders a signed-in visitor's buttons in the HTML, no flash) and the
// /api/me auth island (the upgrade modal, which lives on every page). Plain
// module — no "use client" — so both server components and the client hook
// can import it.
// ---------------------------------------------------------------------------

export type BillingViewer = {
  /** False until the viewer is known (server-provided viewers start true). */
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

export const LIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"]);

/** From the /api/me payload (client side). */
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

/** From the profile row + resolved entitlements (server side) — the same
 *  facts /api/me derives, so the two producers can never disagree. */
export function billingViewerFromProfile(
  profile: { subscription_status: string | null; stripe_customer_id: string | null } | null,
  entitlements: Pick<Entitlements, "isPaid" | "effectiveTier">,
): BillingViewer {
  const status = profile?.subscription_status ?? null;
  return {
    loaded: true,
    isSignedIn: true,
    isPaid: entitlements.isPaid,
    currentTier: entitlements.effectiveTier,
    hasSubscribed: status != null,
    hasBillingAccount: Boolean(profile?.stripe_customer_id),
    hasLiveSubscription: status != null && LIVE_SUBSCRIPTION_STATUSES.has(status),
    subscriptionStatus: status,
  };
}
