import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { resolveSubscriptionTier } from "@/lib/stripe/subscription-sync";
import {
  COMP_ENDING_LOOKAHEAD_MS,
  compEndingDedupeKey,
  compEndingPlanFor,
  compEndingWindowOf,
  type CompEndingPayload,
  type CompEndingSub,
} from "@/lib/billing/comp-ending";
import type { PlanTier } from "@/lib/billing/plans";
import { formatMoney } from "@/lib/format/money";
import { getRecipientFor } from "@/lib/email/preferences";
import { compEndingEmail } from "@/lib/email/messages";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";

// ---------------------------------------------------------------------------
// The daily "your complimentary plan ends soon" run (/api/cron/comp-ending;
// the rules: lib/billing/comp-ending.ts). Per profile whose comp ends inside
// a window: Stripe's CURRENT subscription decides the kind and supplies the
// price and card (the same rule as the trial reminder: never a snapshot);
// the notification insert is the dedupe (0161's unique index — a 23505 is
// "already told", and then no email either); the email goes to the
// "account" list through `email_preferences`, keyed per comp per window.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

const TIER_NAME: Record<string, string> = { plus: "Plus", pro: "Pro" };
const LIVE = new Set(["trialing", "active", "past_due"]);
const PAGE = 500;

type CompProfile = {
  id: string;
  is_admin: boolean | null;
  comp_tier: string | null;
  comp_expires_at: string | null;
  subscription_status: string | null;
  stripe_subscription_id: string | null;
};

export type CompEndingRunResult = {
  checked: number;
  notified: number;
  emailed: number;
  alreadySent: number;
  skipped: number;
  errors: number;
};

function priceLabelOf(sub: Stripe.Subscription): string | null {
  const price = sub.items?.data?.[0]?.price;
  if (!price || typeof price.unit_amount !== "number") return null;
  const interval = price.recurring?.interval;
  return `${formatMoney(price.unit_amount, price.currency ?? "usd")}${interval ? ` / ${interval}` : ""}`;
}

/** The card's last four: the subscription's default payment method, else
 *  the customer's invoice default. Null when neither is a card. */
async function cardLast4Of(stripe: Stripe, sub: Stripe.Subscription): Promise<string | null> {
  const fromPm = (pm: unknown) =>
    pm && typeof pm === "object" && "card" in pm ? ((pm as Stripe.PaymentMethod).card?.last4 ?? null) : null;
  const direct = fromPm(sub.default_payment_method);
  if (direct) return direct;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if ("deleted" in customer && customer.deleted) return null;
    return fromPm((customer as Stripe.Customer).invoice_settings?.default_payment_method);
  } catch {
    return null;
  }
}

export async function sendCompEndingReminders(
  admin: AdminClient,
  deps: { stripe?: Stripe | null; now?: Date } = {},
): Promise<CompEndingRunResult> {
  const now = deps.now ?? new Date();
  const stripe = deps.stripe !== undefined ? deps.stripe : isStripeConfigured() ? getStripe() : null;
  const result: CompEndingRunResult = { checked: 0, notified: 0, emailed: 0, alreadySent: 0, skipped: 0, errors: 0 };
  const until = new Date(now.getTime() + COMP_ENDING_LOOKAHEAD_MS).toISOString();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, is_admin, comp_tier, comp_expires_at, subscription_status, stripe_subscription_id")
      .in("comp_tier", ["plus", "pro"])
      .gt("comp_expires_at", now.toISOString())
      .lte("comp_expires_at", until)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`comp-ending: profiles read failed: ${error.message}`);
    const rows = (data ?? []) as CompProfile[];
    for (const profile of rows) {
      result.checked += 1;
      try {
        await remindOne(admin, stripe, profile, now, result);
      } catch (err) {
        result.errors += 1;
        console.warn(`[comp-ending] ${profile.id}:`, err instanceof Error ? err.message : err);
      }
    }
    if (rows.length < PAGE) break;
  }
  return result;
}

async function remindOne(
  admin: AdminClient,
  stripe: Stripe | null,
  profile: CompProfile,
  now: Date,
  result: CompEndingRunResult,
): Promise<void> {
  const tier = profile.comp_tier === "plus" || profile.comp_tier === "pro" ? (profile.comp_tier as PlanTier) : null;
  const expiresAt = profile.comp_expires_at;
  const window = compEndingWindowOf(expiresAt, now);
  // Admins are unlimited; an expired, cleared or undated comp is never told.
  if (profile.is_admin || !tier || !expiresAt || !window) {
    result.skipped += 1;
    return;
  }

  // Stripe's CURRENT subscription, when the profile points at a live one.
  let sub: Stripe.Subscription | null = null;
  let subscribedTier: PlanTier | null = null;
  if (profile.stripe_subscription_id && LIVE.has(profile.subscription_status ?? "")) {
    if (!stripe) {
      // No way to say what the end means for a payer: tomorrow's run retries.
      result.skipped += 1;
      return;
    }
    sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id, {
      expand: ["default_payment_method"],
    });
    subscribedTier = await resolveSubscriptionTier(sub, stripe);
  }

  const plan = compEndingPlanFor({
    compTier: tier,
    compExpiresAt: expiresAt,
    window,
    sub: sub as unknown as CompEndingSub | null,
    subscribedTier,
  });
  if (!plan.send) {
    result.skipped += 1;
    return;
  }

  const payload: CompEndingPayload = {
    dedupeKey: compEndingDedupeKey(expiresAt, window),
    window,
    kind: plan.kind,
    tier,
    expiresAt,
    ...(sub && plan.kind !== "free" ? { priceLabel: priceLabelOf(sub) } : {}),
    ...(plan.kind === "paying" ? { nextChargeAt: plan.nextChargeAt } : {}),
    ...(plan.kind === "plan_ending" ? { planEndsAt: plan.planEndsAt } : {}),
    ...(plan.kind === "held_trial" && sub && stripe ? { cardLast4: await cardLast4Of(stripe, sub) } : {}),
  };

  const { error } = await admin.from("notifications").insert({
    recipient_id: profile.id,
    actor_id: null,
    type: "comp_ending",
    payload,
  });
  if (error) {
    if (error.code === "23505") {
      // Told already for this comp and window (0161's index): no email either.
      result.alreadySent += 1;
      return;
    }
    throw new Error(`notification insert failed: ${error.message}`);
  }
  result.notified += 1;

  if (!isEmailConfigured()) return;
  try {
    // The "account" list, gated by email_preferences (the trial reminder's way).
    const recipient = await getRecipientFor(admin, profile.id, "account");
    if (!recipient) return;
    const sent = await sendEmail(
      compEndingEmail(recipient, {
        kind: plan.kind,
        plan: TIER_NAME[tier] ?? "PipGlyph",
        expiresAt,
        priceLabel: payload.priceLabel ?? null,
        nextChargeAt: payload.nextChargeAt ?? null,
        cardLast4: payload.cardLast4 ?? null,
        planEndsAt: payload.planEndsAt ?? null,
      }),
      { idempotencyKey: `comp-ending:${profile.id}:${payload.dedupeKey}` },
    );
    if (sent.ok) result.emailed += 1;
  } catch (err) {
    console.warn(`[comp-ending] email for ${profile.id} failed:`, err instanceof Error ? err.message : err);
  }
}
