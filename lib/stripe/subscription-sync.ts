import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  currentCreditPeriod,
  DELINQUENT_SUBSCRIPTION_STATUSES,
  TIER_RANK,
  type PlanTier,
} from "@/lib/billing/plans";
import { grantMonthlyCreditsForPeriod } from "@/lib/billing/credit-refill";
import { tierForPrice, tierForProduct, type PriceLike } from "./config";

// ---------------------------------------------------------------------------
// Subscription → profile sync. The ONE place that decides what a customer's
// Stripe state means for their profile row, shared by the webhook (every
// customer.subscription.* event), the admin "Resync from Stripe" tool, and
// the admin billing-health check.
//
// Two failure modes this exists to prevent (both hit real customers):
//
//   1. UNRESOLVABLE PRICE. A subscription can sit on a price the env vars
//      don't list (Customer Portal plan switches, recreated prices). The
//      old handler mapped it to "free" and wrote status "active" — a paying
//      customer with no paid perks. Now the tier is resolved from the price
//      itself (lib/stripe/config.ts tierForPrice) and, if even that fails, an
//      ACTIVE subscription never demotes: the previous paid tier is kept (or
//      Plus, the lowest paid tier, when there was none) and the failure is
//      logged loudly for the admin health check to surface.
//
//   2. MULTIPLE SUBSCRIPTIONS. A customer can hold two subscriptions at once
//      (a lingering no-card trial plus the paid plan they bought next).
//      Webhook events for BOTH rewrite the same profile row, so "last event
//      wins" let the trial's later cancellation demote the paid plan. Now
//      every event lists the customer's subscriptions and writes the state
//      of the PRIMARY one (live, highest tier, newest) — event order can no
//      longer matter. When the Stripe API isn't reachable the event's own
//      subscription is used, which is the old (single-subscription) behaviour.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

export const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"]);

export function isLiveStatus(status: string | null | undefined): boolean {
  return status != null && ACTIVE_STATUSES.has(status);
}

/** Structural subscription shape — Stripe.Subscription satisfies it, and unit
 *  tests can build one without the SDK. */
export type SubscriptionLike = {
  id: string;
  status: string;
  customer?: string | { id: string } | null;
  created?: number;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string> | null;
  items: {
    data: Array<{
      id?: string;
      price?: PriceLike | null;
      current_period_end?: number | null;
    }>;
  };
};

export function customerIdOf(
  customer: SubscriptionLike["customer"] | Stripe.Customer | Stripe.DeletedCustomer | undefined,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

/** Rank used to choose the primary subscription. An unresolved tier sits
 *  between Plus and Pro: it outranks a known Plus (it's probably the Pro the
 *  customer just bought) but never beats a KNOWN Pro. */
function primaryRank(tier: PlanTier | null): number {
  return tier == null ? TIER_RANK.plus + 0.5 : TIER_RANK[tier];
}

/**
 * Among a customer's subscriptions, the one whose state the profile should
 * reflect: live (active/trialing) subscriptions only, highest tier first,
 * newest first on ties. Null when nothing is live.
 */
export function pickPrimarySubscription<T extends SubscriptionLike>(
  subscriptions: readonly T[],
  tierOf: (sub: T) => PlanTier | null,
): T | null {
  const live = subscriptions.filter((sub) => isLiveStatus(sub.status));
  if (live.length === 0) return null;
  return [...live].sort((a, b) => {
    const byTier = primaryRank(tierOf(b)) - primaryRank(tierOf(a));
    if (byTier !== 0) return byTier;
    return (b.created ?? 0) - (a.created ?? 0);
  })[0];
}

/** Tier from the subscription's first item price — env id, price/product
 *  fields, then amount; a lazy product fetch is the last resort. */
export async function resolveSubscriptionTier(
  sub: SubscriptionLike,
  stripe: Stripe,
): Promise<PlanTier | null> {
  const price = sub.items?.data?.[0]?.price ?? null;
  const direct = tierForPrice(price);
  if (direct) return direct;
  const productId = typeof price?.product === "string" ? price.product : null;
  if (!productId) return null;
  try {
    const product = await stripe.products.retrieve(productId);
    return tierForProduct(product);
  } catch {
    return null;
  }
}

async function listCustomerSubscriptions(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription[] | null> {
  try {
    const list = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
    });
    return list.data;
  } catch {
    // No API (unit tests), a transient Stripe error, or a restricted key —
    // fall back to event-only sync rather than failing the webhook.
    return null;
  }
}

type BillingSlice = {
  subscription_tier: string | null;
  subscription_status: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
};

async function readBillingSlice(
  admin: AdminClient,
  userId: string,
): Promise<BillingSlice> {
  const { data } = await admin
    .from("profiles")
    .select(
      "subscription_tier, subscription_status, stripe_subscription_id, stripe_customer_id",
    )
    .eq("id", userId)
    .maybeSingle();
  const row = (data ?? {}) as Partial<BillingSlice>;
  return {
    subscription_tier: row.subscription_tier ?? null,
    subscription_status: row.subscription_status ?? null,
    stripe_subscription_id: row.stripe_subscription_id ?? null,
    stripe_customer_id: row.stripe_customer_id ?? null,
  };
}

export type SubscriptionSyncResult = {
  userId: string;
  /** The subscription whose state was written (null = nothing live and no
   *  event subscription — the profile was left as it was). */
  subscriptionId: string | null;
  tier: PlanTier;
  status: string | null;
  /** True when the price could not be mapped to a tier and the previous /
   *  fallback tier was kept — surfaced by the admin health check. */
  unresolvedPrice: boolean;
  /** Where the written state came from. */
  source: "primary" | "event" | "none";
};

export type SyncOptions = {
  /** The subscription the webhook event carried, if any. */
  eventSub?: SubscriptionLike;
  /** The event was customer.subscription.deleted for `eventSub`. */
  eventDeleted?: boolean;
  /** Known customer id (webhook path) — otherwise read from the profile. */
  customerId?: string | null;
};

/**
 * Write the profile's subscription columns from the customer's CURRENT Stripe
 * state. Never demotes an active subscriber on an unmapped price; never lets
 * a stale event for a secondary subscription overwrite the primary one.
 */
export async function syncSubscriptionForUser(
  admin: AdminClient,
  stripe: Stripe,
  userId: string,
  options: SyncOptions = {},
): Promise<SubscriptionSyncResult> {
  const { eventSub, eventDeleted = false } = options;
  const previous = await readBillingSlice(admin, userId);
  const customerId =
    options.customerId ??
    customerIdOf(eventSub?.customer) ??
    previous.stripe_customer_id;

  // Prefer the customer's full subscription list; the event object is
  // merged over it so a just-deleted subscription can't read as live.
  const listed = customerId ? await listCustomerSubscriptions(stripe, customerId) : null;
  let candidates: SubscriptionLike[] | null = listed;
  if (candidates && eventSub) {
    const merged = candidates.filter((sub) => sub.id !== eventSub.id);
    merged.push(
      eventDeleted ? { ...eventSub, status: "canceled" } : eventSub,
    );
    candidates = merged;
  }

  let chosen: SubscriptionLike | null = null;
  let source: SubscriptionSyncResult["source"] = "none";
  if (candidates) {
    // Tier resolution per candidate is cheap (no API unless the price is
    // truly opaque) — cache so pickPrimary's comparator doesn't refetch.
    const tiers = new Map<string, PlanTier | null>();
    for (const sub of candidates) {
      if (isLiveStatus(sub.status)) {
        tiers.set(sub.id, await resolveSubscriptionTier(sub, stripe));
      }
    }
    chosen = pickPrimarySubscription(candidates, (sub) => tiers.get(sub.id) ?? null);
    source = chosen ? "primary" : "event";
  }
  if (!chosen) {
    // Nothing live (or no API): the event's subscription describes the new
    // state — a cancellation, a past_due, or (API-less) the plain old path.
    chosen = eventSub ?? null;
    source = chosen ? "event" : "none";
  }
  if (!chosen) {
    return {
      userId,
      subscriptionId: null,
      tier: (previous.subscription_tier ?? "free") as PlanTier,
      status: previous.subscription_status,
      unresolvedPrice: false,
      source,
    };
  }

  const chosenDeleted = eventDeleted && eventSub?.id === chosen.id;
  const status = chosenDeleted ? "canceled" : chosen.status;
  const live = isLiveStatus(status);
  const resolved = chosenDeleted ? null : await resolveSubscriptionTier(chosen, stripe);
  const previousTier = (previous.subscription_tier ?? "free") as PlanTier;

  let tier: PlanTier;
  let unresolvedPrice = false;
  if (chosenDeleted) {
    tier = "free";
  } else if (resolved) {
    tier = resolved;
  } else if (live) {
    // Paying customer, unknown price: NEVER free. Keep what they had, or
    // the lowest paid tier so they at least get paid perks, and shout.
    tier = previousTier !== "free" ? previousTier : "plus";
    unresolvedPrice = true;
    console.error(
      `[stripe] Could not map price ${chosen.items?.data?.[0]?.price?.id ?? "?"} on subscription ${chosen.id} to a tier for user ${userId}; kept tier "${tier}". Set STRIPE_PRICE_* or put tier=plus|pro in the price/product metadata.`,
    );
  } else {
    // Lapsed/past-due: the status gates perks; keep the display tier.
    tier = previousTier;
  }

  const item = chosen.items?.data?.[0];
  const periodEnd =
    !chosenDeleted && item?.current_period_end
      ? new Date(item.current_period_end * 1000).toISOString()
      : null;

  const { error: writeError } = await admin
    .from("profiles")
    .update({
      subscription_tier: tier,
      subscription_status: status,
      stripe_subscription_id: chosenDeleted ? null : chosen.id,
      current_period_end: periodEnd,
      cancel_at_period_end: chosenDeleted ? false : Boolean(chosen.cancel_at_period_end),
    })
    .eq("id", userId);
  // A failed profile write must surface: the webhook then 500s and Stripe
  // retries (handlers are idempotent). The old handler discarded this error
  // and acked the event, leaving the profile silently out of sync.
  if (writeError) {
    throw new Error(`Profile subscription write failed for ${userId}: ${writeError.message}`);
  }

  return {
    userId,
    subscriptionId: chosenDeleted ? null : chosen.id,
    tier,
    status,
    unresolvedPrice,
    source,
  };
}

/**
 * Grant this month's allotment for the synced state (idempotent per user per
 * month; mid-month upgrades top up the delta — lib/billing/credit-refill.ts).
 * A TRIAL gets exactly one grant, at creation: `isCreationEvent` must only
 * be true for the subscription.created event of the synced subscription.
 * Throws on RPC failure so a webhook 500s and Stripe retries.
 */
export async function grantCreditsForSync(
  result: SubscriptionSyncResult,
  admin: AdminClient,
  opts: { isCreationEvent: boolean },
): Promise<void> {
  if (!result.subscriptionId || !isLiveStatus(result.status)) return;
  if (result.status === "trialing" && !opts.isCreationEvent) return;
  if (result.tier === "free") return;
  const granted = await grantMonthlyCreditsForPeriod(
    admin,
    result.userId,
    result.tier,
    currentCreditPeriod(),
  );
  if (!granted.ok) {
    throw new Error(`Credit grant failed for ${result.userId}: ${granted.error}`);
  }
}

/** The customer's newest subscription whose payment is broken (past_due,
 *  unpaid, incomplete) — the checkout action sends such a customer to the
 *  portal to fix the card instead of selling them a second subscription
 *  that would bill twice once Stripe's retry on the old invoice succeeds. */
export async function findDelinquentSubscription(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription | null> {
  const subs = await listCustomerSubscriptions(stripe, customerId);
  if (!subs) return null;
  return (
    subs
      .filter((sub) => DELINQUENT_SUBSCRIPTION_STATUSES.has(sub.status))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0] ?? null
  );
}

/** The customer's live subscription (if any) — what the checkout action
 *  consults before starting a SECOND subscription. */
export async function findLiveSubscription(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription | null> {
  const subs = await listCustomerSubscriptions(stripe, customerId);
  if (!subs) return null;
  const tiers = new Map<string, PlanTier | null>();
  for (const sub of subs) {
    if (isLiveStatus(sub.status)) tiers.set(sub.id, await resolveSubscriptionTier(sub, stripe));
  }
  return pickPrimarySubscription(subs, (sub) => tiers.get(sub.id) ?? null);
}
