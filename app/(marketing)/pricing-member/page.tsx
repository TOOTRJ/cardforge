import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { ANONYMOUS_BILLING_VIEWER, billingViewerFromProfile } from "@/lib/billing/viewer";
import { PricingContent } from "../pricing/pricing-content";

// ---------------------------------------------------------------------------
// /pricing for SIGNED-IN visitors — the dynamic twin of the static /pricing.
//
// Reached only through the proxy.ts rewrite (a session cookie on /pricing);
// the visible URL stays /pricing and a direct hit on this path 308s there.
// Reading the session here keeps the anonymous page on the CDN while every
// signed-in visitor gets their own buttons in the server HTML: "Your current
// plan", "Try Plus free for 7 days", "Switch to Pro", "Update payment" —
// never the anonymous storefront first.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing",
  alternates: { canonical: "/pricing" },
  robots: { index: false, follow: true },
  description:
    "Design custom MTG-style cards for free — every AI tool included, 5 AI credits a month. Upgrade for more monthly credits, watermark-free hi-res downloads and deck-aware AI — first-time subscribers get a 7-day free trial, no card required. Monthly or annual.",
};

export default async function PricingMemberPage() {
  if (!isBillingEnabled()) notFound();
  const user = await getCurrentUser();
  if (!user) {
    // A stale cookie without a session: the anonymous storefront, resolved.
    return <PricingContent initialViewer={{ ...ANONYMOUS_BILLING_VIEWER, loaded: true }} />;
  }
  const [profile, entitlements] = await Promise.all([getCurrentProfile(), getEntitlements()]);
  const viewer = billingViewerFromProfile(
    profile
      ? {
          subscription_status: profile.subscription_status ?? null,
          stripe_customer_id: profile.stripe_customer_id ?? null,
        }
      : null,
    entitlements,
  );
  // A paid account (live Plus/Pro, an admin comp, an admin) has nothing to
  // shop for here: its plan, plan changes and credit packs live on the
  // billing page (owner decision 2026-09-22 — the storefront is hidden once
  // a user is Plus or Pro).
  if (viewer.isPaid) redirect("/dashboard/billing");
  return <PricingContent initialViewer={viewer} />;
}
