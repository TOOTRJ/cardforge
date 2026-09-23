import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isBillingEnabled } from "@/lib/billing/flags";
import { PricingContent } from "./pricing-content";

export const metadata: Metadata = {
  title: "Pricing",
  alternates: { canonical: "/pricing" },
  description:
    "Design custom MTG-style cards for free — every AI tool included, 5 AI credits a month. Upgrade for more monthly credits, watermark-free hi-res downloads and deck-aware AI — first-time subscribers get a 7-day free trial, no card required. Monthly or annual.",
};

// ISR: this is the ANONYMOUS storefront — identical for every signed-out
// visitor and crawler, so it lives on the CDN. It never reads cookies. A
// signed-in visitor never sees it: proxy.ts rewrites their /pricing request
// to app/(marketing)/pricing-member, which resolves the viewer on the server
// and renders their real buttons into the HTML (no anonymous-first flash).
export const revalidate = 300;

export default function PricingPage() {
  // Billing hidden for now — the page 404s until NEXT_PUBLIC_BILLING_ENABLED=true.
  if (!isBillingEnabled()) notFound();
  return <PricingContent />;
}
