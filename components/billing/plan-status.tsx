import { ManageBillingButton } from "@/components/billing/manage-billing-button";
import { KeepPlanButton } from "@/components/billing/keep-plan-button";
import { SIGNUP_CREDITS, planForTier } from "@/lib/billing/plans";
import { isEndingStatus, type PlanStatus } from "@/lib/billing/plan-status";
import { formatMoney } from "@/lib/format/money";
import { formatCalendarDate } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// The billing page's plan card: what happens to the plan next, and the
// buttons that go with it. Both draw from ONE PlanStatus
// (lib/billing/plan-status.ts), so a plan that is ending can never be
// offered "Cancel plan" or described as renewing.
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
}: {
  status: PlanStatus;
  /** The plan the viewer is on now ("Plus"). */
  planName: string;
  /** "$6.00 / month". */
  priceLine: string;
  hasPaymentMethod: boolean;
  compExpiresAt?: string | null;
}) {
  switch (status.kind) {
    case "delinquent":
      return (
        <span className="text-danger">
          Your last payment didn&apos;t go through, so paid perks are paused. Update your card to restore them.
        </span>
      );
    // Text beside an element is written as string expressions: JSX text
    // holding an entity (&apos;) lost its edge spaces in the Next build
    // ("October 23, 2026and won't renew").
    case "trial_ending":
      return (
        <>
          {"You cancelled your free trial. It ends on "}
          <Strong>{formatCalendarDate(status.endsAt)}</Strong>
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
            <Strong>{formatCalendarDate(status.endsAt)}</Strong>
            {". Until then it is still billed as usual — next on "}
            <Strong>{formatCalendarDate(status.billedBeforeAt)}</Strong>
            {`. You keep every ${planName} perk until it ends; afterwards you're on the free plan with your cards and any credits you have left. Changed your mind? Resume the plan below.`}
          </>
        );
      }
      return (
        <>
          {"You cancelled this plan. It ends on "}
          <Strong>{formatCalendarDate(status.endsAt)}</Strong>
          {` and won't renew — nothing more is charged. You keep every ${planName} perk until then; afterwards you're on the free plan with your cards and any credits you have left. Changed your mind? Resume the plan below.`}
        </>
      );
    case "trial":
      return (
        <>
          {"Your free trial ends on "}
          <Strong>{formatCalendarDate(status.trialEnd)}</Strong>
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
          <Strong>{formatCalendarDate(pending.startsAt)}</Strong>
          {`. You keep ${planName} and everything you paid for until then; nothing is charged now. Changed your mind? Keep your current plan below.`}
        </>
      );
    }
    case "renews":
      return (
        <>
          {"Renews on "}
          <Strong>{formatCalendarDate(status.renewsAt)}</Strong>
          {". Cancel any time — the plan runs to the end of the period you paid for."}
        </>
      );
    case "live":
      return <>Your plan is active.</>;
    case "comped":
      return (
        <>
          {compExpiresAt
            ? `Courtesy of the PipGlyph team until ${formatCalendarDate(compExpiresAt)}.`
            : "Courtesy of the PipGlyph team — no renewal, no card needed."}
        </>
      );
    case "ended":
      return (
        <>
          {"Your previous plan has ended. You're on the free plan: every tool, up to 50 saved cards, and the credits you have left — Free doesn't refill; a pack tops you up any time and a plan refills every month."}
        </>
      );
    default:
      return (
        <>
          {`Every tool is yours for free: all frames, the gallery, decks, ${SIGNUP_CREDITS} AI credits to start and up to 50 saved cards. Free doesn't refill — a credit pack tops you up any time, and plans add monthly credits, clean hi-res downloads and more room.`}
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
      {/* Stripe's portal un-cancels in one click ("Renew plan" / "Don't
          cancel plan"); there is no deep link to it, so it opens at home. */}
      {live && ending ? (
        <ManageBillingButton variant="primary" size="sm">
          Resume {planName}
        </ManageBillingButton>
      ) : null}
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
