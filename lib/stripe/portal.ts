import "server-only";

import type Stripe from "stripe";

// ---------------------------------------------------------------------------
// The Customer Portal for a customer whose plan is COMPED (owner 2026-11-02,
// TODO BL1): no plan switching while a comp is on
// (lib/billing/comp-switch-lock.ts). The default portal configuration lets
// a subscriber switch plans from its home page — a switch the app never
// sees before it happens, so a comp's coupon freed the new plan's first
// invoice (or a whole year). A comped customer's session therefore opens
// with the owner's NO-SWITCH configuration (`subscription_update` off,
// everything else as the default: invoices, card, cancel), read from
// `STRIPE_PORTAL_CONFIG_NO_PLAN_SWITCH` (a `bpc_…` id, one per Stripe
// mode — docs/BILLING.md "The no-switch portal configuration").
//
// FAIL CLOSED: without that id a comped customer gets no portal HOME (it
// would offer switching). A deep-linked flow that is not a plan change
// (update the card, cancel) still opens, and its completion redirects back
// to the app instead of the portal's home.
// ---------------------------------------------------------------------------

export const NO_SWITCH_PORTAL_CONFIG_ENV = "STRIPE_PORTAL_CONFIG_NO_PLAN_SWITCH";

/** The no-switch configuration id, or null when unset / not a `bpc_` id. */
export function noSwitchPortalConfiguration(): string | null {
  const raw = process.env[NO_SWITCH_PORTAL_CONFIG_ENV]?.trim();
  return raw && /^bpc_[A-Za-z0-9]+$/.test(raw) ? raw : null;
}

type FlowData = Stripe.BillingPortal.SessionCreateParams.FlowData;

const PLAN_CHANGE_FLOWS: ReadonlySet<string> = new Set(["subscription_update", "subscription_update_confirm"]);

/**
 * The portal session to create, or null when it must NOT open: a comped
 * customer asking for the portal home (or a plan-change flow) with no
 * no-switch configuration set.
 */
export function portalSessionParams(input: {
  customer: string;
  returnUrl: string;
  flowData?: FlowData;
  /** A comp holds this customer's plan in Stripe — or that couldn't be
   *  read (lib/stripe/plan-switch-lock.ts): fail closed. */
  comped: boolean;
}): Stripe.BillingPortal.SessionCreateParams | null {
  const { customer, returnUrl, flowData, comped } = input;
  const base = { customer, return_url: returnUrl };
  if (!comped) return { ...base, ...(flowData ? { flow_data: flowData } : {}) };
  if (flowData && PLAN_CHANGE_FLOWS.has(flowData.type)) return null;
  const configuration = noSwitchPortalConfiguration();
  if (configuration) return { ...base, configuration, ...(flowData ? { flow_data: flowData } : {}) };
  if (!flowData) return null;
  return {
    ...base,
    flow_data: {
      ...flowData,
      // Never land on the default configuration's home page afterwards.
      after_completion: { type: "redirect", redirect: { return_url: returnUrl } },
    },
  };
}
