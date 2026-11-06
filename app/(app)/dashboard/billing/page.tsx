import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { Coins, CreditCard, Crown, Gift, Receipt, Sparkles } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BillingReturnToast } from "@/components/billing/billing-return-toast";
import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { PlanActions, PlanStatusLine, endingBadgeLabel } from "@/components/billing/plan-status";
import { PricingPlans } from "@/components/billing/pricing-plans";
import { CreditPackGrid } from "@/components/billing/credit-pack-grid";
import { createClient, getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { readOwnHoldGrant } from "@/lib/billing/plan-grants";
import { readBank } from "@/lib/billing/day-bank";
import { ApplyBankButton } from "@/components/billing/apply-bank-button";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getEntitlements } from "@/lib/billing/entitlements";
import { DELINQUENT_SUBSCRIPTION_STATUSES, billingViewerFromProfile } from "@/lib/billing/viewer";
import { isEndingStatus, planStatusOf } from "@/lib/billing/plan-status";
import {
  CARD_CAPACITY_UNLIMITED,
  FREE_PERIOD_CREDITS,
  PLAN_CREDITS_ONCE,
  PACK_SUBSCRIBER_DISCOUNT_PCT,
  SIGNUP_CREDITS,
  formatCredits,
  planForTier,
  planCreditsOnceFor,
} from "@/lib/billing/plans";
import { getCreditsUsedThisMonth } from "@/lib/ai/usage-queries";
import { getStripeBillingDetails, formatMoney } from "@/lib/billing/subscription-details";
import { isStripeConfigured } from "@/lib/stripe/client";
import { LocalDate } from "@/components/ui/local-date";
import { compOverLiveSubscription, liveCompChargeLine } from "@/lib/billing/comp-stripe";

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

const BANK_SOURCE_LABEL: Record<string, string> = {
  signup: "Welcome days",
  referral_friend: "A friend's link",
  referral_step: "Referral reward",
  admin: "From PipGlyph",
  promo: "Promotion",
};
const BANK_STATUS_LABEL: Record<string, string> = {
  banked: "banked",
  reserved: "being applied",
  applied: "applied",
  revoked: "not owed",
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
          cancel_at_period_end: profile.cancel_at_period_end ?? false,
          current_period_end: profile.current_period_end ?? null,
          subscription_ends_at: profile.subscription_ends_at ?? null,
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
  const delinquent = !live && status != null && DELINQUENT_SUBSCRIPTION_STATUSES.has(status);
  const comped =
    entitlements.isPaid && !live && !delinquent && (profile?.comp_tier != null || profile?.is_admin);
  // Free days over a LIVE subscription (lib/billing/free-days.ts): the perks
  // follow the comp, and the plan's next charge was moved out by the days
  // (the subscription reads `trialing` until then).
  const liveComp = live && profile ? compOverLiveSubscription(profile) : null;
  const heldByComp =
    liveComp != null &&
    liveCompChargeLine({
      status,
      compExpiresAt: liveComp.expiresAt,
      stripeTrialEnd: stripeDetails?.subscription?.trialEnd ?? null,
    }) === "held";
  // A hold on a PAYING plan whose start is still ahead (the plan is paid
  // through then): the viewer's own grant row. Applied: the free days run
  // from that start. Revoked: Stripe still reads `trialing` until that
  // start, where the plan simply renews — never "your free trial".
  const hold = status === "trialing" ? await readOwnHoldGrant(await createClient()) : null;
  // The viewer's days bank (0179, lib/billing/day-bank.ts): banked free days
  // a live plan can take now, or a checkout applies as its free period.
  const bank = await readBank(await createClient(), user.id);
  const paidThrough = hold?.status === "revoked" && !heldByComp ? hold.startsAt : null;
  const sub = stripeDetails?.subscription ?? null;
  const priceLine = sub?.amountCents != null && sub.interval
    ? `${formatMoney(sub.amountCents, sub.currency)} / ${sub.interval}`
    : plan.priceUsd > 0
      ? `$${plan.priceUsd} / month`
      : "Free forever";
  // What happens to the plan next — ONE decision for the copy, the badge and
  // the buttons (lib/billing/plan-status.ts). A cancelled plan ENDS: Stripe's
  // live answer first (cancel_at, cancel_at_period_end, a schedule that ends
  // in a cancellation), the webhook-written profile flag when Stripe is
  // unreachable. A scheduled downgrade is not a cancellation.
  const stripeStatus = planStatusOf({
    live,
    delinquent,
    graceUntil: entitlements.dunningGraceUntil,
    comped: Boolean(comped),
    status,
    subscription: sub,
    profile: {
      currentPeriodEnd: entitlements.currentPeriodEnd,
      cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
      endsAt: profile?.subscription_ends_at ?? null,
    },
  });
  const planStatus =
    stripeStatus.kind === "trial" && paidThrough ? { kind: "renews" as const, renewsAt: paidThrough } : stripeStatus;
  const ending = isEndingStatus(planStatus);
  // The plan grid below reads the same fact (the profile flag can lag the
  // live read until the next webhook event).
  const gridViewer = { ...viewer, subscriptionEnding: live && ending };
  // What a comp over a live plan means for the next charge
  // (lib/billing/comp-stripe.ts `liveCompChargeLine`).
  const liveCompLine = liveComp
    ? heldByComp
      ? " — nothing is charged before then; your plan then continues at its usual price."
      : " — your subscription keeps its own billing dates."
    : null;
  const capacity = entitlements.cardCapacity;
  // One-time plan credits (owner 2026-11-06): the tier's stock with the
  // first paid invoice — never a monthly figure.
  const planCredits = planCreditsOnceFor(entitlements.effectiveTier);
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
                  ? (endingBadgeLabel(planStatus) ?? (heldByComp ? "Free days" : STATUS_LABEL[status ?? ""] ?? status))
                  : comped
                    ? "Complimentary"
                    : "Free plan"}
              </Badge>
              <span className="text-sm text-muted">{comped ? "No charge" : priceLine}</span>
            </div>
          </div>

          <p className="text-sm leading-6 text-muted">
            <PlanStatusLine
              status={planStatus}
              planName={plan.name}
              priceLine={priceLine}
              hasPaymentMethod={Boolean(stripeDetails?.paymentMethod)}
              compExpiresAt={profile?.comp_expires_at ?? null}
              heldByComp={heldByComp}
              heldFrom={hold?.status === "applied" ? hold.startsAt : null}
            />
          </p>
          {liveComp ? (
            <p className="text-sm leading-6 text-muted">
              {planForTier(liveComp.tier).name} is complimentary
              {liveComp.expiresAt ? (
                <>
                  {" "}until <LocalDate iso={liveComp.expiresAt} format="stampYear" />
                </>
              ) : null}
              {liveCompLine}
            </p>
          ) : null}

          <dl className="grid gap-3 sm:grid-cols-3">
            <Stat
              label={planCredits > 0 ? "Plan credits" : "AI credits"}
              value={planCredits > 0 ? `${planCredits} with your first payment` : `${SIGNUP_CREDITS} to start`}
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
            <PlanActions status={planStatus} live={live} planName={plan.name} />
          ) : null}
        </SurfaceCard>
      </section>

      {/* ---- Banked free days (the days bank, 0179) ---- */}
      {!profile?.is_admin ? (
        <section className="mt-8" id="banked-days">
          <SurfaceCard className="flex flex-col gap-4 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-gold-strong">
                  <Gift className="h-5 w-5" aria-hidden />
                </span>
                <div className="flex flex-col">
                  <span className="text-[11px] uppercase tracking-wider text-subtle">Banked free days</span>
                  <span className="font-display text-2xl font-semibold text-foreground">
                    {bank.banked} day{bank.banked === 1 ? "" : "s"}
                    {bank.reserved > 0 ? (
                      <span className="ml-2 text-sm font-normal text-muted">({bank.reserved} being applied)</span>
                    ) : null}
                  </span>
                </div>
              </div>
              {bank.banked > 0 && live && !ending && !delinquent ? (
                <ApplyBankButton days={bank.banked} />
              ) : bank.banked > 0 && !live ? (
                <Button asChild size="sm">
                  <Link href="/pricing">Start a plan with {bank.banked} free day{bank.banked === 1 ? "" : "s"}</Link>
                </Button>
              ) : null}
            </div>
            <p className="text-sm leading-6 text-muted">
              {live
                ? "Banked days are added to the end of your plan's free period or paid time the moment you apply them — your next charge moves out by as many days. "
                : "Start a plan and your banked days are its free period, card on file: nothing is charged until they end. "}
              When the free days end, your plan bills at its usual price unless you cancel — and you can cancel any time on
              this page. Earn more by{" "}
              <Link href="/dashboard/referrals" className="text-primary-bright underline-offset-4 hover:underline">
                referring a friend
              </Link>
              .
            </p>
            {bank.entries.length > 0 ? (
              <ul className="divide-y divide-border/40 text-sm">
                {bank.entries.slice(0, 8).map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="text-foreground">
                      {BANK_SOURCE_LABEL[entry.source] ?? entry.source}
                      <span className="text-muted">
                        {" "}· <LocalDate iso={entry.createdAt} />
                      </span>
                    </span>
                    <span className="tabular-nums text-muted">
                      {entry.days} day{entry.days === 1 ? "" : "s"} · {BANK_STATUS_LABEL[entry.status] ?? entry.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </SurfaceCard>
        </section>
      ) : null}

      {/* ---- Change plan ---- */}
      <section className="mt-10" id="plans">
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
          {live ? "Change plan" : entitlements.isPaid ? "Plans" : "Upgrade"}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          {live && ending
            ? "Your plan is set to end. To stay on it, resume it above. Picking another plan here also keeps you subscribed: an upgrade applies right away (Stripe shows the prorated difference before you confirm) and renews; a downgrade resumes your plan and starts the lower one at the end of the period you've paid for."
            : live
            ? "Upgrades apply right away — Stripe shows the prorated difference before you confirm, and the plan keeps its renewal date. Downgrades (Pro to Plus, or annual to monthly) take effect at the end of the period you've paid for, so nothing is lost. Downgrading to Free is a cancellation: you keep the plan until the period ends."
            : delinquent
              ? "Your plan's last payment didn't go through. Update your card to keep it — the buttons below open the billing portal, never a second subscription."
              : entitlements.isPaid
              ? "Your account is unlocked without a subscription. Starting a plan is optional."
              : bank.banked > 0
                ? `Start a plan with your ${bank.banked} banked free day${bank.banked === 1 ? "" : "s"}: they're its free time, with ${FREE_PERIOD_CREDITS} AI credits to try. Nothing is charged until the days end — cancel anytime before then — and your plan's credits (${PLAN_CREDITS_ONCE.plus} on Plus, ${PLAN_CREDITS_ONCE.pro} on Pro) land with your first payment.`
                : `Start a plan with the free days you've banked — nothing is charged until they end, cancel anytime before then. Your plan's credits (${PLAN_CREDITS_ONCE.plus} on Plus, ${PLAN_CREDITS_ONCE.pro} on Pro) land with your first payment.`}
        </p>
        <PricingPlans initialViewer={gridViewer} surface="billing" />
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
            <Stat label="Plan credits" value={planCredits > 0 ? `${planCredits}, one-time` : "None"} />
            <Stat label="Purchased credits" value="never expire" />
          </dl>
          <div className="flex flex-col gap-2 border-t border-border/50 pt-4">
            <h3 className="font-display text-base font-semibold text-foreground">Need a top-up?</h3>
            <p className="text-sm leading-6 text-muted">
              Buy credits any time — on any plan. Purchased credits never expire and add to whatever you have.
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
                    <LocalDate iso={invoice.created} />
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
