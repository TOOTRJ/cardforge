import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Coins, CreditCard, Crown, Receipt, Sparkles } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BillingReturnToast } from "@/components/billing/billing-return-toast";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { KeepPlanButton } from "@/components/billing/keep-plan-button";
import { PricingPlans } from "@/components/billing/pricing-plans";
import { CreditPackGrid } from "@/components/billing/credit-pack-grid";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getEntitlements } from "@/lib/billing/entitlements";
import { billingViewerFromProfile } from "@/lib/billing/viewer";
import {
  CARD_CAPACITY_UNLIMITED,
  MONTHLY_CREDITS,
  PACK_SUBSCRIBER_DISCOUNT_PCT,
  SIGNUP_CREDITS,
  formatCredits,
  planForTier,
} from "@/lib/billing/plans";
import { getCreditsUsedThisMonth } from "@/lib/ai/usage-queries";
import { getStripeBillingDetails, formatMoney } from "@/lib/billing/subscription-details";
import { isStripeConfigured } from "@/lib/stripe/client";
import { formatCalendarDate } from "@/lib/format/dates";

export const metadata: Metadata = {
  title: "Billing & subscription",
  description: "Your plan, renewal, payment method, invoices and AI credits.",
  robots: { index: false, follow: false },
};

// ---------------------------------------------------------------------------
// /dashboard/billing — the one place a signed-in user manages money:
//   • the plan they're on (tier, status, price, renewal / trial end / cancel
//     date) with portal shortcuts (card, invoices, cancel);
//   • changing plan — the same PricingPlans grid as the storefront, fed the
//     server-resolved viewer, so Plus ↔ Pro and monthly ↔ annual switch in
//     place and Free users start a trial;
//   • AI credits (balance, allotment, used this month) + the credit packs;
//   • what Stripe knows: card on file and recent invoices (best effort).
// Paid accounts are sent here from /pricing (the storefront is for buyers).
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Free trial",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
  unpaid: "Unpaid",
  paused: "Paused",
};

export default async function BillingPage() {
  if (!isBillingEnabled()) notFound();
  if (!isSupabaseConfigured()) redirect("/login");
  const user = await getCurrentUser();
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent("/dashboard/billing")}`);

  const [profile, entitlements, creditsUsed] = await Promise.all([
    getCurrentProfile(),
    getEntitlements(),
    getCreditsUsedThisMonth(),
  ]);
  const viewer = billingViewerFromProfile(
    profile
      ? {
          subscription_status: profile.subscription_status ?? null,
          stripe_customer_id: profile.stripe_customer_id ?? null,
        }
      : null,
    entitlements,
  );
  const stripeDetails = await getStripeBillingDetails(
    profile?.stripe_customer_id,
    profile?.stripe_subscription_id,
  );

  const plan = planForTier(entitlements.effectiveTier);
  const status = entitlements.status;
  const live = viewer.hasLiveSubscription;
  const delinquent = !live && status != null && ["past_due", "unpaid", "incomplete"].includes(status);
  const comped =
    entitlements.isPaid && !live && !delinquent && (profile?.comp_tier != null || profile?.is_admin);
  const sub = stripeDetails?.subscription ?? null;
  const priceLine = sub?.amountCents != null && sub.interval
    ? `${formatMoney(sub.amountCents, sub.currency)} / ${sub.interval}`
    : plan.priceUsd > 0
      ? `$${plan.priceUsd} / month`
      : "Free forever";
  const periodEnd = sub?.currentPeriodEnd ?? entitlements.currentPeriodEnd;
  const cancelScheduled = sub?.cancelAtPeriodEnd ?? entitlements.cancelAtPeriodEnd;
  // A downgrade scheduled for the end of the period (Pro → Plus, annual →
  // monthly) — the plan card says so and offers to keep the current plan.
  const pending = live ? (sub?.pendingChange ?? null) : null;
  const pendingPlanName = pending?.tier ? planForTier(pending.tier).name : "a new plan";
  const pendingPriceLine =
    pending?.amountCents != null && pending.interval
      ? ` (${formatMoney(pending.amountCents, pending.currency)} / ${pending.interval})`
      : "";
  const capacity = entitlements.cardCapacity;
  const monthlyCredits = MONTHLY_CREDITS[entitlements.effectiveTier];
  // Packs at the subscriber price for an ACTIVE subscription (a no-card trial
  // hasn't paid yet) — the checkout action applies the same rule.
  const packDiscount = live && status === "active";

  return (
    <DashboardShell>
      <Suspense fallback={null}>
        <BillingReturnToast />
      </Suspense>
      <PageHeader
        eyebrow="Account"
        title="Billing & subscription"
        description="Your plan, what it costs, when it renews, the card on file, your invoices and your AI credits — all in one place."
      />

      {/* ---- Current plan ---- */}
      <section className="mt-8">
        <SurfaceCard className="flex flex-col gap-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-gold-strong">
                <Crown className="h-5 w-5" aria-hidden />
              </span>
              <div className="flex flex-col">
                <span className="text-[11px] uppercase tracking-wider text-subtle">Current plan</span>
                <span className="font-display text-2xl font-semibold text-foreground">
                  {plan.name}
                  {comped ? <span className="ml-2 text-sm font-normal text-muted">(complimentary)</span> : null}
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant={entitlements.isPaid ? "primary" : "outline"}>
                {live || delinquent
                  ? (STATUS_LABEL[status ?? ""] ?? status)
                  : comped
                    ? "Complimentary"
                    : "Free plan"}
              </Badge>
              <span className="text-sm text-muted">{comped ? "No charge" : priceLine}</span>
            </div>
          </div>

          <p className="text-sm leading-6 text-muted">
            {delinquent ? (
              <span className="text-danger">
                Your last payment didn&apos;t go through, so paid perks are paused. Update your card to restore them.
              </span>
            ) : live && status === "trialing" && sub?.trialEnd ? (
              <>
                Your free trial ends on <strong className="text-foreground">{formatCalendarDate(sub.trialEnd)}</strong>
                {stripeDetails?.paymentMethod
                  ? `, then ${priceLine} on the card below.`
                  : ". Add a card in the portal before then to keep the plan — without one it simply ends."}
              </>
            ) : live && pending ? (
              <>
                Changes to <strong className="text-foreground">{pendingPlanName}</strong>
                {pendingPriceLine} on <strong className="text-foreground">{formatCalendarDate(pending.startsAt)}</strong>. You keep {plan.name} and everything you paid for until then; nothing is charged now. Changed your mind? Keep your current plan below.
              </>
            ) : live && cancelScheduled && periodEnd ? (
              <>
                Your plan is set to end on <strong className="text-foreground">{formatCalendarDate(periodEnd)}</strong>. You keep every perk until then. Changed your mind? Reactivate it in the portal.
              </>
            ) : live && periodEnd ? (
              <>
                Renews on <strong className="text-foreground">{formatCalendarDate(periodEnd)}</strong>. Cancel any time — the plan runs to the end of the period you paid for.
              </>
            ) : comped ? (
              profile?.comp_expires_at
                ? `Courtesy of the PipGlyph team until ${formatCalendarDate(profile.comp_expires_at)}.`
                : "Courtesy of the PipGlyph team — no renewal, no card needed."
            ) : status === "canceled" ? (
              "Your previous plan has ended. You're on the free plan: every tool, up to 50 saved cards, and the credits you have left — Free doesn't refill; a pack tops you up any time and a plan refills every month."
            ) : (
              `Every tool is yours for free: all frames, the gallery, decks, ${SIGNUP_CREDITS} AI credits to start and up to 50 saved cards. Free doesn't refill — a credit pack tops you up any time, and plans add monthly credits, clean hi-res downloads and more room.`
            )}
          </p>

          <dl className="grid gap-3 sm:grid-cols-3">
            <Stat
              label={monthlyCredits > 0 ? "AI credits a month" : "AI credits"}
              value={monthlyCredits > 0 ? String(monthlyCredits) : `${SIGNUP_CREDITS} at sign-up`}
            />
            <Stat
              label="Saved cards"
              value={capacity === CARD_CAPACITY_UNLIMITED ? "Unlimited" : `Up to ${capacity}`}
            />
            <Stat
              label="Downloads"
              value={entitlements.removeWatermark ? "Clean, hi-res + PDF" : "Watermarked PNG"}
            />
          </dl>

          {viewer.hasBillingAccount ? (
            <div className="flex flex-wrap gap-2 border-t border-border/50 pt-4">
              {delinquent ? (
                <ManageBillingButton flow="payment_method_update" variant="primary" size="sm">
                  Fix payment
                </ManageBillingButton>
              ) : null}
              {live ? (
                <ManageBillingButton flow="payment_method_update" size="sm">
                  Update payment method
                </ManageBillingButton>
              ) : null}
              <ManageBillingButton size="sm">Invoices &amp; receipts</ManageBillingButton>
              {live && pending ? (
                <KeepPlanButton>Keep {plan.name}</KeepPlanButton>
              ) : null}
              {live && !cancelScheduled && !pending ? (
                <ManageBillingButton flow="subscription_cancel" variant="ghost" size="sm">
                  Cancel plan
                </ManageBillingButton>
              ) : null}
              {live && cancelScheduled ? (
                <ManageBillingButton size="sm">Reactivate plan</ManageBillingButton>
              ) : null}
            </div>
          ) : null}
        </SurfaceCard>
      </section>

      {/* ---- Change plan ---- */}
      <section className="mt-10" id="plans">
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
          {live ? "Change plan" : entitlements.isPaid ? "Plans" : "Upgrade"}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          {live
            ? "Upgrades apply right away — Stripe shows the prorated difference before you confirm, and the plan keeps its renewal date. Downgrades (Pro to Plus, or annual to monthly) take effect at the end of the period you've paid for, so nothing is lost. Downgrading to Free is a cancellation: you keep the plan until the period ends."
            : entitlements.isPaid
              ? "Your account is unlocked without a subscription. Starting a plan is optional."
              : "First-time subscribers get a 7-day free trial: 25 AI credits to try, nothing charged until day 7, cancel anytime. Your plan's full monthly credits arrive with your first payment."}
        </p>
        <PricingPlans initialViewer={viewer} surface="billing" />
      </section>

      {/* ---- Credits ---- */}
      <section className="mt-12" id="packs">
        <SurfaceCard className="flex flex-col gap-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-gold-strong">
                <Coins className="h-5 w-5" aria-hidden />
              </span>
              <div className="flex flex-col">
                <span className="text-[11px] uppercase tracking-wider text-subtle">AI credits</span>
                <span className="font-display text-2xl font-semibold text-foreground">
                  {formatCredits(entitlements.credits)} <span className="text-base font-normal text-muted">available</span>
                </span>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/usage">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                AI usage &amp; ledger
              </Link>
            </Button>
          </div>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Stat label="Used this month" value={String(creditsUsed)} />
            <Stat label="Monthly refill" value={monthlyCredits > 0 ? String(monthlyCredits) : "None"} />
            <Stat label="Purchased credits" value="never expire" />
          </dl>
          <div className="flex flex-col gap-2 border-t border-border/50 pt-4">
            <h3 className="font-display text-base font-semibold text-foreground">Need a top-up?</h3>
            <p className="text-sm leading-6 text-muted">
              Buy credits any time — on any plan. Purchased credits never expire and stack with any plan credits.
              {packDiscount
                ? ` As a subscriber you pay ${PACK_SUBSCRIBER_DISCOUNT_PCT}% less — the discount is applied at checkout.`
                : ` Plus and Pro members pay ${PACK_SUBSCRIBER_DISCOUNT_PCT}% less.`}
            </p>
          </div>
          <CreditPackGrid discounted={packDiscount} surface="billing" />
        </SurfaceCard>
      </section>

      {/* ---- Payment & invoices ---- */}
      <section className="mt-10">
        <SurfaceCard className="flex flex-col gap-5 p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-gold-strong">
              <CreditCard className="h-5 w-5" aria-hidden />
            </span>
            <div className="flex flex-col">
              <span className="text-[11px] uppercase tracking-wider text-subtle">Payment &amp; invoices</span>
              <span className="font-display text-lg font-semibold text-foreground">
                {stripeDetails?.paymentMethod
                  ? `${capitalize(stripeDetails.paymentMethod.brand)} •••• ${stripeDetails.paymentMethod.last4}`
                  : viewer.hasBillingAccount
                    ? "No card on file"
                    : "No billing account yet"}
              </span>
              {stripeDetails?.paymentMethod ? (
                <span className="text-xs text-muted">
                  Expires {String(stripeDetails.paymentMethod.expMonth).padStart(2, "0")}/{stripeDetails.paymentMethod.expYear}
                </span>
              ) : null}
            </div>
          </div>

          {!isStripeConfigured() ? (
            <p className="text-sm text-muted">
              Stripe isn&apos;t connected in this environment, so payment details and invoices can&apos;t be shown here.
            </p>
          ) : !viewer.hasBillingAccount ? (
            <p className="text-sm text-muted">
              A billing account is created the first time you start a plan or buy credits. Nothing is stored until then.
            </p>
          ) : stripeDetails === null ? (
            <p className="text-sm text-muted">
              Couldn&apos;t reach Stripe just now. Open the portal for your invoices and payment method.
            </p>
          ) : stripeDetails.invoices.length === 0 ? (
            <p className="text-sm text-muted">No invoices yet.</p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-md border border-border/60">
              {stripeDetails.invoices.map((invoice) => (
                <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="flex items-center gap-2 text-foreground">
                    <Receipt className="h-4 w-4 text-subtle" aria-hidden />
                    {formatCalendarDate(invoice.created)}
                    {invoice.number ? <span className="font-mono text-xs text-subtle">{invoice.number}</span> : null}
                  </span>
                  <span className="flex items-center gap-3">
                    <Badge variant={invoice.status === "paid" ? "primary" : "outline"}>
                      {invoice.status === "paid" ? "Paid" : capitalize(invoice.status ?? "open")}
                    </Badge>
                    <span className="text-foreground">{formatMoney(invoice.amountCents, invoice.currency)}</span>
                    {invoice.hostedUrl ? (
                      <a
                        href={invoice.hostedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-primary-bright underline-offset-4 hover:underline"
                      >
                        View
                      </a>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {viewer.hasBillingAccount && isStripeConfigured() ? (
            <div className="flex flex-wrap gap-2 border-t border-border/50 pt-4">
              <ManageBillingButton size="sm">Open the Stripe portal</ManageBillingButton>
              <span className="self-center text-xs text-muted">
                Receipts, tax details, address and card changes live there.
              </span>
            </div>
          ) : null}
        </SurfaceCard>
      </section>
    </DashboardShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/40 bg-background/40 px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-wider text-subtle">{label}</dt>
      <dd className="font-display text-lg font-semibold tracking-tight text-foreground">{value}</dd>
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
