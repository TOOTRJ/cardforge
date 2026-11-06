import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { KeepPlanButton } from "@/components/billing/keep-plan-button";
import { ResumePlanButton } from "@/components/billing/resume-plan-button";
import { CARD_CAPACITY, SIGNUP_CREDITS, planForTier } from "@/lib/billing/plans";
import { isEndingStatus, type PlanStatus } from "@/lib/billing/plan-status";
import { formatMoney } from "@/lib/format/money";
import { LocalDate } from "@/components/ui/local-date";

// ---------------------------------------------------------------------------
// The billing page's plan card: what happens to the plan next, and the
// buttons that go with it. Both draw from ONE PlanStatus
// (lib/billing/plan-status.ts), so a plan that is ending can never be
// offered "Cancel plan" or described as renewing. Every date is a
// <LocalDate>: the viewer's own calendar day, as Stripe's portal shows it.
// ---------------------------------------------------------------------------

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="text-foreground">{children}</strong>;
}

export function PlanStatusLine({
  status,
  planName,
  priceLine,
  hasPaymentMethod,
  compExpiresAt,
  heldByComp = false,
  heldFrom = null,
}: {
  status: PlanStatus;
  /** The plan the viewer is on now ("Plus"). */
  planName: string;
  /** "$6.00 / month". */
  priceLine: string;
  hasPaymentMethod: boolean;
  compExpiresAt?: string | null;
  /** The trial Stripe reports is FREE DAYS added to the plan (a comp or a
   *  referral reward, lib/billing/free-days.ts): the copy never calls it
   *  "your free trial". */
  heldByComp?: boolean;
  /** When those free days START, when that is still ahead — the plan is
   *  paid through then (a hold given mid-period); null once they run. */
  heldFrom?: string | null;
}) {
  switch (status.kind) {
    case "delinquent":
      // The dunning grace (lib/billing/dunning.ts): the perks stay on while
      // Stripe retries the card, until the date; after it, they are paused.
      return status.graceUntil ? (
        <span className="text-danger">
          {"Your last payment didn't go through. We'll retry your card automatically; your "}
          {planName}
          {" perks stay on until "}
          <Strong><LocalDate iso={status.graceUntil} /></Strong>
          {" — update your card before then to keep them."}
        </span>
      ) : (
        <span className="text-danger">
          Your last payment didn&apos;t go through, so paid perks are paused. Update your card to restore them.
        </span>
      );
    // Text beside an element is written as string expressions: JSX text
    // holding an entity (&apos;) lost its edge spaces in the Next build
    // ("October 23, 2026and won't renew").
    case "trial_ending":
      if (heldByComp) {
        // A paying plan under free days (the trial Stripe reports is paid
        // time plus the days): it ends when they do.
        return (
          <>
            {"You cancelled your plan. It ends on "}
            <Strong><LocalDate iso={status.endsAt} format="stampYear" /></Strong>
            {`, when your free days end, and you won't be charged — you keep every ${planName} perk until then; afterwards you're on the free plan with your cards and any credits you have left. Changed your mind? Resume the plan below.`}
          </>
        );
      }
      return (
        <>
          {"You cancelled your free trial. It ends on "}
          <Strong><LocalDate iso={status.endsAt} /></Strong>
          {` and you won't be charged — you keep every ${planName} perk until then, and afterwards you're on the free plan with your cards and any credits you have left. Changed your mind? Resume the plan below.`}
        </>
      );
    case "stale":
      return (
        <>
          {"Stripe reports that this subscription has ended, but your account hasn't caught up yet. Nothing more is charged. If this page still says so tomorrow, let us know and we'll put it right."}
        </>
      );
    case "ending":
      if (status.billedBeforeAt) {
        return (
          <>
            {"This plan is set to end on "}
            <Strong><LocalDate iso={status.endsAt} /></Strong>
            {". Until then it is still billed as usual — next on "}
            <Strong><LocalDate iso={status.billedBeforeAt} /></Strong>
            {`. You keep every ${planName} perk until it ends; afterwards you're on the free plan with your cards and any credits you have left. Changed your mind? Resume the plan below.`}
          </>
        );
      }
      return (
        <>
          {"You cancelled this plan. It ends on "}
          <Strong><LocalDate iso={status.endsAt} /></Strong>
          {` and won't renew — nothing more is charged. You keep every ${planName} perk until then; afterwards you're on the free plan with your cards and any credits you have left. Changed your mind? Resume the plan below.`}
        </>
      );
    case "trial":
      if (heldByComp) {
        const after = hasPaymentMethod
          ? `, then ${planName} continues at ${priceLine} on the card below.`
          : ". Add a card in the portal before then to keep the plan — without one it simply ends.";
        if (heldFrom) {
          return (
            <>
              {"Your plan is paid through "}
              <Strong><LocalDate iso={heldFrom} format="stampYear" /></Strong>
              {". Your free days run from then until "}
              <Strong><LocalDate iso={status.trialEnd} format="stampYear" /></Strong>
              {after}
            </>
          );
        }
        return (
          <>
            {"Your free days run until "}
            <Strong><LocalDate iso={status.trialEnd} format="stampYear" /></Strong>
            {after}
          </>
        );
      }
      return (
        <>
          {"Your free trial ends on "}
          <Strong><LocalDate iso={status.trialEnd} /></Strong>
          {hasPaymentMethod
            ? `, then ${priceLine} on the card below.`
            : ". Add a card in the portal before then to keep the plan — without one it simply ends."}
        </>
      );
    case "pending_change": {
      const { pending } = status;
      const pendingPlanName = pending.tier ? planForTier(pending.tier).name : "a new plan";
      const pendingPriceLine =
        pending.amountCents != null && pending.interval
          ? ` (${formatMoney(pending.amountCents, pending.currency)} / ${pending.interval})`
          : "";
      return (
        <>
          {"Changes to "}
          <Strong>{pendingPlanName}</Strong>
          {`${pendingPriceLine} on `}
          <Strong><LocalDate iso={pending.startsAt} /></Strong>
          {`. You keep ${planName} and everything you paid for until then; nothing is charged now. Changed your mind? Keep your current plan below.`}
        </>
      );
    }
    case "renews":
      return (
        <>
          {"Renews on "}
          <Strong><LocalDate iso={status.renewsAt} /></Strong>
          {". Cancel any time — the plan runs to the end of the period you paid for."}
        </>
      );
    case "live":
      return <>Your plan is active.</>;
    case "comped":
      return (
        <>
          {compExpiresAt ? (
            <>
              {"Courtesy of the PipGlyph team until "}
              <LocalDate iso={compExpiresAt} format="stampYear" />
              {"."}
            </>
          ) : (
            "Courtesy of the PipGlyph team — no renewal, no card needed."
          )}
        </>
      );
    case "ended":
      return (
        <>
          {`Your previous plan has ended. You're on the free plan: every tool, up to ${CARD_CAPACITY.free} saved cards, unlimited decks, and the credits you have left — Free doesn't refill; a pack tops you up any time and a plan refills every month. Every card and deck you made stays yours.`}
        </>
      );
    default:
      return (
        <>
          {`Every tool is yours for free: all frames, the gallery, unlimited decks, ${SIGNUP_CREDITS} AI credits to start and up to ${CARD_CAPACITY.free} saved cards. Free doesn't refill — a credit pack tops you up any time, and plans add monthly credits, clean hi-res downloads and more room.`}
        </>
      );
  }
}

/** The badge beside the plan name for a plan that is set to stop — "Active"
 *  on a cancelled plan read as "nothing happened". */
export function endingBadgeLabel(status: PlanStatus): string | null {
  if (status.kind === "trial_ending") return "Trial ending";
  if (status.kind === "ending") return "Ending";
  if (status.kind === "stale") return "Ended";
  return null;
}

export function PlanActions({
  status,
  live,
  planName,
}: {
  status: PlanStatus;
  /** A subscription Stripe still bills (active / trialing). */
  live: boolean;
  planName: string;
}) {
  const ending = isEndingStatus(status);
  // Stripe says the subscription is over: nothing left to cancel or pay for.
  if (status.kind === "stale") live = false;
  return (
    <div className="flex flex-wrap gap-2 border-t border-border/50 pt-4">
      {status.kind === "delinquent" ? (
        <ManageBillingButton flow="payment_method_update" variant="primary" size="sm">
          Fix payment
        </ManageBillingButton>
      ) : null}
      {/* Un-cancels in the app, behind a confirm step that states the renewal
          date and price; the Customer Portal is only the fallback. */}
      {live && ending ? <ResumePlanButton planName={planName} surface="billing" /> : null}
      {live ? (
        <ManageBillingButton flow="payment_method_update" size="sm">
          Update payment method
        </ManageBillingButton>
      ) : null}
      <ManageBillingButton size="sm">Invoices &amp; receipts</ManageBillingButton>
      {live && status.kind === "pending_change" ? <KeepPlanButton>Keep {planName}</KeepPlanButton> : null}
      {live && !ending && status.kind !== "pending_change" ? (
        <ManageBillingButton flow="subscription_cancel" variant="ghost" size="sm">
          Cancel plan
        </ManageBillingButton>
      ) : null}
    </div>
  );
}
