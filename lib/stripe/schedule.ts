import "server-only";

import type Stripe from "stripe";

// The subscription schedule a scheduled downgrade puts on a subscription
// (lib/stripe/actions.ts scheduleDowngrade). Shared by the billing actions
// and the admin's comp change (lib/billing/comp-stripe-apply.ts), which
// releases a pending downgrade BEFORE it touches the subscription (owner
// 2026-11-02, TODO BL1). Kept out of the "use server" actions file: every
// export there is a callable server action.

export function scheduleIdOf(schedule: Stripe.Subscription["schedule"]): string | null {
  if (!schedule) return null;
  return typeof schedule === "string" ? schedule : schedule.id;
}

/** Drop a pending plan change (the subscription stays on its current
 *  price). A no-op without one. */
export async function releasePendingChange(stripe: Stripe, sub: Stripe.Subscription): Promise<void> {
  const scheduleId = scheduleIdOf(sub.schedule);
  if (scheduleId) await stripe.subscriptionSchedules.release(scheduleId);
}
