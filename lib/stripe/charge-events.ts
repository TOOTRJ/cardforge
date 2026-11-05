import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdminsOnce } from "@/lib/billing/credit-alerts";
import { customerIdOf } from "@/lib/stripe/subscription-sync";

// ---------------------------------------------------------------------------
// Money going BACK (billing audit 2026-11-05, P2-2; migration 0174). Until
// this the webhook ignored `charge.refunded`, `charge.dispute.*` and Radar's
// early fraud warnings: a charged-back credit pack kept its credits, a
// refunded invoice stayed "paid" in the Revenue panel, and nobody was told.
//
// What each event does:
//   * charge.refunded — the sale the charge paid for (matched by payment
//     intent on billing_pack_payments / billing_payments) is marked with the
//     refunded amount; a PACK's credits follow the money through
//     reconcile_pack_withdrawal (the refunded share of the pack's credits is
//     taken back, never below a zero balance); every admin is told once per
//     (charge, amount refunded).
//   * charge.dispute.created / closed — the sale is marked with the dispute
//     and its status; a pack's credits are taken back while the dispute is
//     open or lost and given back when it is won; admins are told once per
//     (dispute, status). Access on a SUBSCRIPTION is left to Stripe's own
//     "cancel the subscription on a dispute" setting (docs/BILLING.md).
//   * radar.early_fraud_warning.created — admins are told once per warning,
//     with the sale it concerns if one matches. Nothing else moves.
//
// A charge that matches no sale (a pack or invoice from before the payment
// intent was logged, or something paid outside the app) still alerts the
// admins, as "unmatched". Every write here is idempotent: the row marks are
// absolute values, the claw-back reconciles to a target, the alerts dedupe
// on their key. A database error throws so the webhook 500s and Stripe
// retries; a missing Stripe read falls back to the event's own numbers.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

export const BILLING_ALERT = "billing_alert";

export type BillingAlertKind = "refund" | "dispute" | "dispute_closed" | "fraud_warning";

export type BillingAlertPayload = {
  dedupeKey: string;
  alert: BillingAlertKind;
  chargeId: string;
  paymentIntentId: string | null;
  /** The refunded amount, the disputed amount, or the charge's amount. */
  amountCents: number;
  currency: string;
  userId: string | null;
  /** Which log the charge matched, or null (unmatched). */
  saleKind: "pack" | "invoice" | null;
  /** The pack's Checkout session id or the invoice id. */
  saleId: string | null;
  disputeStatus?: string | null;
  disputeReason?: string | null;
  /** Credits taken back (negative) or given back (positive) by this event. */
  creditsDelta?: number;
  /** The charge's own customer, for an unmatched charge. */
  stripeCustomerId?: string | null;
};

/** Dispute statuses while which the network has the money (or keeps it). */
const DISPUTE_WITHDRAWN: ReadonlySet<string> = new Set(["needs_response", "under_review", "lost"]);

type Sale =
  | { kind: "pack"; id: string; userId: string | null; amountCents: number; disputeStatus: string | null }
  | { kind: "invoice"; id: string; userId: string | null; amountCents: number; disputeStatus: string | null };

const idOf = (ref: string | { id: string } | null | undefined): string | null =>
  !ref ? null : typeof ref === "string" ? ref : ref.id;

/** The sale a payment intent paid for, from either log. */
async function findSale(paymentIntentId: string | null, admin: AdminClient): Promise<Sale | null> {
  if (!paymentIntentId) return null;
  const { data: pack, error: packError } = await admin
    .from("billing_pack_payments")
    .select("checkout_session_id, user_id, amount_cents, dispute_status")
    .eq("payment_intent_id", paymentIntentId)
    .limit(1)
    .maybeSingle();
  if (packError) throw new Error(`billing_pack_payments read failed: ${packError.message}`);
  if (pack) {
    return {
      kind: "pack",
      id: pack.checkout_session_id,
      userId: pack.user_id,
      amountCents: pack.amount_cents,
      disputeStatus: pack.dispute_status ?? null,
    };
  }
  const { data: invoice, error: invoiceError } = await admin
    .from("billing_payments")
    .select("invoice_id, user_id, amount_cents, dispute_status")
    .eq("payment_intent_id", paymentIntentId)
    .limit(1)
    .maybeSingle();
  if (invoiceError) throw new Error(`billing_payments read failed: ${invoiceError.message}`);
  if (invoice) {
    return {
      kind: "invoice",
      id: invoice.invoice_id,
      userId: invoice.user_id,
      amountCents: invoice.amount_cents,
      disputeStatus: invoice.dispute_status ?? null,
    };
  }
  return null;
}

type SaleMark = {
  refunded_cents?: number;
  refunded_at?: string;
  dispute_id?: string;
  dispute_status?: string | null;
  disputed_at?: string;
};

async function markSale(sale: Sale, values: SaleMark, admin: AdminClient): Promise<void> {
  const { error } =
    sale.kind === "pack"
      ? await admin.from("billing_pack_payments").update(values).eq("checkout_session_id", sale.id)
      : await admin.from("billing_payments").update(values).eq("invoice_id", sale.id);
  if (error) throw new Error(`${sale.kind} sale mark failed for ${sale.id}: ${error.message}`);
}

/** Reconcile a pack's credits to what was withdrawn. Returns the credits
 *  moved this call (negative = taken back). Throws on a database error. */
async function reconcilePackCredits(sale: Sale, withdrawnCents: number, admin: AdminClient): Promise<number> {
  if (sale.kind !== "pack") return 0;
  const { data, error } = await admin.rpc("reconcile_pack_withdrawal", {
    p_session: sale.id,
    p_withdrawn_cents: Math.max(0, Math.round(withdrawnCents)),
  });
  if (error) throw new Error(`reconcile_pack_withdrawal failed for ${sale.id}: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { credits_delta?: number } | null | undefined;
  return typeof row?.credits_delta === "number" ? row.credits_delta : 0;
}

async function findUserIdByCustomer(customerId: string | null, admin: AdminClient): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await admin.from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
  return data?.id ?? null;
}

/** What the event's amounts mean for a pack once a dispute is in play: the
 *  larger of the refund and an open / lost dispute's amount. */
function withdrawnFor(input: {
  amountRefunded: number;
  disputeStatus: string | null;
  disputeAmount: number;
}): number {
  const disputed = input.disputeStatus && DISPUTE_WITHDRAWN.has(input.disputeStatus) ? input.disputeAmount : 0;
  return Math.max(input.amountRefunded, disputed);
}

export async function handleChargeRefunded(
  charge: Stripe.Charge,
  deps: { admin: AdminClient },
  eventCreated?: number,
): Promise<void> {
  const { admin } = deps;
  const paymentIntentId = idOf(charge.payment_intent);
  const amountRefunded = Math.max(0, charge.amount_refunded ?? 0);
  if (amountRefunded <= 0) return;
  const sale = await findSale(paymentIntentId, admin);
  const at = new Date((eventCreated ?? charge.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  let creditsDelta = 0;
  if (sale) {
    await markSale(sale, { refunded_cents: amountRefunded, refunded_at: at }, admin);
    creditsDelta = await reconcilePackCredits(
      sale,
      withdrawnFor({ amountRefunded, disputeStatus: sale.disputeStatus, disputeAmount: sale.amountCents }),
      admin,
    );
  }
  await notifyAdminsOnce(admin, {
    type: BILLING_ALERT,
    payload: {
      dedupeKey: `refund:${charge.id}:${amountRefunded}`,
      alert: "refund",
      chargeId: charge.id,
      paymentIntentId,
      amountCents: amountRefunded,
      currency: charge.currency ?? "usd",
      userId: sale?.userId ?? (await findUserIdByCustomer(customerIdOf(charge.customer ?? undefined), admin)),
      saleKind: sale?.kind ?? null,
      saleId: sale?.id ?? null,
      creditsDelta,
      stripeCustomerId: customerIdOf(charge.customer ?? undefined),
    } satisfies BillingAlertPayload,
  });
}

export async function handleDispute(
  dispute: Stripe.Dispute,
  deps: { admin: AdminClient; stripe: Stripe },
  opts: { closed: boolean; eventCreated?: number },
): Promise<void> {
  const { admin, stripe } = deps;
  const chargeId = idOf(dispute.charge) ?? "";
  let paymentIntentId = idOf(dispute.payment_intent);
  // The charge's refund state and customer (the dispute carries neither): a
  // failed read falls back to the event alone.
  let charge: Stripe.Charge | null = null;
  try {
    charge = chargeId ? await stripe.charges.retrieve(chargeId) : null;
  } catch {
    charge = null;
  }
  paymentIntentId = paymentIntentId ?? idOf(charge?.payment_intent);
  const sale = await findSale(paymentIntentId, admin);
  const status = dispute.status ?? null;
  const at = new Date((opts.eventCreated ?? dispute.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  let creditsDelta = 0;
  if (sale) {
    await markSale(
      sale,
      { dispute_id: dispute.id, dispute_status: status, ...(opts.closed ? {} : { disputed_at: at }) },
      admin,
    );
    creditsDelta = await reconcilePackCredits(
      sale,
      withdrawnFor({
        amountRefunded: Math.max(0, charge?.amount_refunded ?? 0),
        disputeStatus: status,
        disputeAmount: Math.max(0, dispute.amount ?? 0),
      }),
      admin,
    );
  }
  await notifyAdminsOnce(admin, {
    type: BILLING_ALERT,
    payload: {
      dedupeKey: `dispute:${dispute.id}:${status ?? "unknown"}`,
      alert: opts.closed ? "dispute_closed" : "dispute",
      chargeId,
      paymentIntentId,
      amountCents: Math.max(0, dispute.amount ?? 0),
      currency: dispute.currency ?? "usd",
      userId: sale?.userId ?? (await findUserIdByCustomer(customerIdOf(charge?.customer ?? undefined), admin)),
      saleKind: sale?.kind ?? null,
      saleId: sale?.id ?? null,
      disputeStatus: status,
      disputeReason: dispute.reason ?? null,
      creditsDelta,
      stripeCustomerId: customerIdOf(charge?.customer ?? undefined),
    } satisfies BillingAlertPayload,
  });
}

export async function handleEarlyFraudWarning(
  warning: Stripe.Radar.EarlyFraudWarning,
  deps: { admin: AdminClient; stripe: Stripe },
): Promise<void> {
  const { admin, stripe } = deps;
  const chargeId = idOf(warning.charge) ?? "";
  let paymentIntentId = idOf(warning.payment_intent);
  let charge: Stripe.Charge | null = null;
  try {
    charge = chargeId ? await stripe.charges.retrieve(chargeId) : null;
  } catch {
    charge = null;
  }
  paymentIntentId = paymentIntentId ?? idOf(charge?.payment_intent);
  const sale = await findSale(paymentIntentId, admin);
  await notifyAdminsOnce(admin, {
    type: BILLING_ALERT,
    payload: {
      dedupeKey: `fraud:${warning.id}`,
      alert: "fraud_warning",
      chargeId,
      paymentIntentId,
      amountCents: Math.max(0, charge?.amount ?? 0),
      currency: charge?.currency ?? "usd",
      userId: sale?.userId ?? (await findUserIdByCustomer(customerIdOf(charge?.customer ?? undefined), admin)),
      saleKind: sale?.kind ?? null,
      saleId: sale?.id ?? null,
      disputeReason: warning.fraud_type ?? null,
      stripeCustomerId: customerIdOf(charge?.customer ?? undefined),
    } satisfies BillingAlertPayload,
  });
}
