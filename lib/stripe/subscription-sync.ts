import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import {

  DELINQUENT_SUBSCRIPTION_STATUSES,
  TIER_RANK,
  type PlanTier,
} from "@/lib/billing/plans";
import { grantFreePeriodCredits, grantPlanCreditsOnce } from "@/lib/billing/credit-refill";
import { HOLD_FROM_KEY, TRIAL_END_BEFORE_COMP_KEY } from "@/lib/billing/comp-stripe";
import {
  endsByPeriodEnd,
  subscriptionEndsAt,
  type EndingScheduleLike,
} from "@/lib/billing/subscription-ending";
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
  /** A cancellation DATE: the Customer Portal and newer API versions set
   *  this and may leave `cancel_at_period_end` false. */
  cancel_at?: number | null;
  /** When the pending cancellation was requested. */
  canceled_at?: number | null;
  metadata?: Record<string, string> | null;
  trial_end?: number | null;
  /** Set once the subscription has ended (deleted events). */
  ended_at?: number | null;
  default_payment_method?: string | { id: string } | null;
  default_source?: string | { id: string } | null;
  /** A subscription schedule attached to it (a pending plan change) — an id
   *  unless the caller expanded it. */
  schedule?: string | { id: string } | (EndingScheduleLike & { id?: string }) | null;
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
    // Stripe's page maximum. A customer with more subscriptions than one
    // page holds (years of monthly trials and cancels) had the live one
    // outside the newest 20 (audit 2026-11-05, nice-to-have).
    const list = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
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
  /** When the sync first saw the payment broken (0174); null = paying. */
  payment_failed_at: string | null;
};

async function readBillingSlice(
  admin: AdminClient,
  userId: string,
): Promise<BillingSlice> {
  let { data, error } = await admin
    .from("profiles")
    .select(
      "subscription_tier, subscription_status, stripe_subscription_id, stripe_customer_id, payment_failed_at",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error && isMissingDunningColumn(error)) {
    // The code is live before migration 0174: read what the old schema holds.
    ({ data, error } = await admin
      .from("profiles")
      .select("subscription_tier, subscription_status, stripe_subscription_id, stripe_customer_id")
      .eq("id", userId)
      .maybeSingle());
  }
  const row = (data ?? {}) as Partial<BillingSlice>;
  return {
    subscription_tier: row.subscription_tier ?? null,
    subscription_status: row.subscription_status ?? null,
    stripe_subscription_id: row.stripe_subscription_id ?? null,
    stripe_customer_id: row.stripe_customer_id ?? null,
    payment_failed_at: row.payment_failed_at ?? null,
  };
}

export type SubscriptionSyncResult = {
  userId: string;
  /** The subscription whose state was written (null = nothing live and no
   *  subscription given — the profile was left as it was — or it ended). */
  subscriptionId: string | null;
  tier: PlanTier;
  status: string | null;
  /** True when the price could not be mapped to a tier and the previous /
   *  fallback tier was kept — surfaced by the admin health check. */
  unresolvedPrice: boolean;
  /** Where the written state came from. */
  source: "primary" | "event" | "none";
  /** ISO date the synced subscription is set to stop (cancelled, still
   *  live) — null when it renews. What `subscription_ends_at` was written as. */
  endsAt?: string | null;
  /** The live subscription's billing interval (0175) — what
   *  `billing_interval` was written as; null when nothing is live. */
  billingInterval?: "month" | "year" | null;
  /** ISO instant the payment was first seen broken (past_due / unpaid) —
   *  what `payment_failed_at` was written as; null while it pays. */
  paymentFailedAt?: string | null;
  /** What a free-days hold was added to (0181, the subscription's
   *  `pipglyph_hold_from`): 'active' = a PAYING plan that reads `trialing`
   *  until the days end; what `subscription_held_from` was written as. */
  heldFrom?: "active" | "trialing" | null;
};

const iso = (seconds: number | null | undefined): string | null =>
  typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;

/**
 * How the chosen subscription ends, however Stripe says it (cancel_at, the
 * flag, or a schedule that ends in a cancellation). The list / event object
 * carries a schedule only as an id, so that third way needs one read — made
 * only for a live subscription that has a schedule and no cancellation of
 * its own (a pending downgrade, usually: `end_behavior: release`).
 */
async function endingStateOf(
  chosen: SubscriptionLike,
  stripe: Stripe,
): Promise<{ endsAt: string | null; byPeriodEnd: boolean; canceledAt: string | null }> {
  let sub = chosen;
  if (
    isLiveStatus(sub.status) &&
    typeof sub.schedule === "string" &&
    subscriptionEndsAt(sub) == null
  ) {
    try {
      const schedule = await stripe.subscriptionSchedules.retrieve(sub.schedule);
      sub = { ...sub, schedule };
    } catch {
      // No API (unit tests) or a transient error: the cancellation fields
      // alone decide, as before.
    }
  }
  const endsAt = iso(subscriptionEndsAt(sub));
  return {
    endsAt,
    byPeriodEnd: endsByPeriodEnd(sub),
    canceledAt: endsAt ? iso(sub.canceled_at) : null,
  };
}

/** PostgREST / Postgres "no such column" for the 0135 columns — a deploy
 *  that reaches the database before its migration does. */
function isMissingEndingColumn(error: { code?: string; message?: string }): boolean {
  return (
    (error.code === "PGRST204" || error.code === "42703") &&
    /subscription_(ends|canceled)_at/.test(error.message ?? "")
  );
}

/** The same for 0175's `billing_interval`. */
function isMissingIntervalColumn(error: { code?: string; message?: string }): boolean {
  return (
    (error.code === "PGRST204" || error.code === "42703") &&
    /billing_interval/.test(error.message ?? "")
  );
}

/** The same for 0181's `subscription_held_from`. */
function isMissingHeldFromColumn(error: { code?: string; message?: string }): boolean {
  return (
    (error.code === "PGRST204" || error.code === "42703") &&
    /subscription_held_from/.test(error.message ?? "")
  );
}

/** The same for 0174's `payment_failed_at`. */
function isMissingDunningColumn(error: { code?: string; message?: string }): boolean {
  return (
    (error.code === "PGRST204" || error.code === "42703") &&
    /payment_failed_at/.test(error.message ?? "")
  );
}

/** Read one subscription by id — null when Stripe can't be read (no API in
 *  unit tests, a transient error, a restricted key). */
async function retrieveSubscription(
  stripe: Stripe,
  id: string,
): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(id);
  } catch {
    return null;
  }
}

/** A subscription that is over for good. `incomplete_expired` is the other
 *  terminal status, but it never entitled anyone — only `canceled` ends a
 *  plan the profile may be showing. */
const ENDED_STATUS = "canceled";

/** The statuses that mean "the payment is broken" and anchor the dunning
 *  grace: past_due (Stripe is retrying) and unpaid (it gave up). An
 *  `incomplete` first payment never paid, so it anchors nothing. */
const DUNNING_STATUSES: ReadonlySet<string> = new Set(["past_due", "unpaid"]);

export type SyncOptions = {
  /**
   * The subscription a WEBHOOK EVENT carried — a snapshot taken when the
   * event was generated, possibly long ago (out-of-order delivery, a retry).
   * It names the subscription to sync; its fields are trusted only when
   * Stripe cannot be read, or for `eventDeleted`.
   */
  eventSub?: SubscriptionLike;
  /**
   * A subscription the caller has JUST read from or written to Stripe (a
   * `retrieve`, an `update` response). Taken as current and not read again —
   * it may carry more than a plain read would (an expanded schedule). Wins
   * over `eventSub` when both are given.
   */
  currentSub?: SubscriptionLike;
  /** The subscription given (`currentSub` / `eventSub`) has ENDED: the event
   *  was customer.subscription.deleted, or the caller read it as canceled. */
  eventDeleted?: boolean;
  /** Known customer id (webhook path) — otherwise read from the profile. */
  customerId?: string | null;
};

/**
 * Write the profile's subscription columns from the customer's CURRENT Stripe
 * state. Never demotes an active subscriber on an unmapped price; never lets
 * a stale event for a secondary subscription overwrite the primary one; never
 * writes an event's own snapshot while Stripe can be read (a late or retried
 * event would store a state the subscription has already left).
 */
export async function syncSubscriptionForUser(
  admin: AdminClient,
  stripe: Stripe,
  userId: string,
  options: SyncOptions = {},
): Promise<SubscriptionSyncResult> {
  const { eventSub, currentSub, eventDeleted = false } = options;
  const given = currentSub ?? eventSub;
  const previous = await readBillingSlice(admin, userId);
  const customerId =
    options.customerId ??
    customerIdOf(given?.customer) ??
    previous.stripe_customer_id;

  // Stripe's CURRENT state: the customer's subscriptions, and — for a
  // webhook event — the event's own subscription read again by id. Neither
  // read is the event's snapshot, so the order events arrive in (and a
  // retry of an old one) cannot change what is written.
  const [listed, reread] = await Promise.all([
    customerId ? listCustomerSubscriptions(stripe, customerId) : null,
    eventSub && !currentSub ? retrieveSubscription(stripe, eventSub.id) : null,
  ]);

  // The given subscription as it is NOW: the caller's own fresh object, else
  // the read by id, else its row in the list. Only when none of those exists
  // (Stripe unreachable, or the reads don't know it yet) does the event's
  // snapshot stand in.
  const fresh: SubscriptionLike | null =
    currentSub ??
    reread ??
    (given ? (listed?.find((sub) => sub.id === given.id) ?? null) : null);
  let subject: SubscriptionLike | null = fresh ?? eventSub ?? null;
  // It has ended when the caller says so (the `deleted` event: terminal, so
  // it wins even over a read that still shows it live) or when Stripe's own
  // read says so — an old `updated` event arriving after the deletion must
  // not bring the plan back. A read counts only alongside the list: without
  // it nobody knows whether another subscription is live.
  const subjectEnded =
    subject != null &&
    (eventDeleted || (fresh?.status === ENDED_STATUS && listed != null));
  if (subject && subjectEnded && subject.status !== ENDED_STATUS) {
    subject = { ...subject, status: ENDED_STATUS };
  }

  // The list could not be read, and the subscription given is NOT live while
  // the profile sits on a DIFFERENT subscription that is: this is an event
  // for a secondary subscription (the superseded trial's `deleted`, a late
  // event for a plan that ended long ago), and without the list nothing
  // says the other one has stopped. Writing the given one's state here is
  // the 2026-09 demotion again, on a transient Stripe error — write nothing.
  // The stored subscription's own events (its `deleted` clears the id, and
  // this guard with it) keep the profile right.
  if (
    listed == null &&
    subject != null &&
    !isLiveStatus(subject.status) &&
    previous.stripe_subscription_id != null &&
    previous.stripe_subscription_id !== subject.id &&
    isLiveStatus(previous.subscription_status)
  ) {
    console.warn(
      `[stripe] Subscription list unreadable for user ${userId}: left the profile on live subscription ${previous.stripe_subscription_id} rather than writing ${subject.status} from ${subject.id}.`,
    );
    return {
      userId,
      subscriptionId: null,
      tier: (previous.subscription_tier ?? "free") as PlanTier,
      status: previous.subscription_status,
      unresolvedPrice: false,
      source: "none",
    };
  }

  let candidates: SubscriptionLike[] | null = listed;
  if (candidates && subject) {
    const merged = candidates.filter((sub) => sub.id !== subject.id);
    merged.push(subject);
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
    // Nothing live (or no API): the given subscription describes the new
    // state — a cancellation, a past_due, or (API-less) the plain old path.
    // An empty list with no subscription given writes NOTHING: a transient
    // empty read must never demote anyone.
    chosen = subject;
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

  const chosenDeleted = subjectEnded && subject?.id === chosen.id;
  const status = chosenDeleted ? ENDED_STATUS : chosen.status;
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

  // "Stops at the end of the stored period", however Stripe says it — the
  // flag alone missed a `cancel_at` date, and Settings then told a customer
  // who had cancelled that the plan renews. The exact DATE is stored beside
  // it (0135): the dashboard, Settings and the admin directory read the
  // profile alone, and a date in a later period has no other home.
  const ending = chosenDeleted
    ? { endsAt: null, byPeriodEnd: false, canceledAt: null }
    : await endingStateOf(chosen, stripe);
  // The dunning grace's anchor (lib/billing/dunning.ts, 0174): the FIRST
  // moment the sync sees the payment broken is kept through every later
  // event of the same failure (Stripe retries the same invoice; each retry
  // re-delivers past_due), and cleared the moment it pays or ends. A TRIAL
  // whose first charge declines gets no grace (it never paid; the perks
  // were the trial's) — the stamp stays null for that whole dunning run.
  const broken = !chosenDeleted && DUNNING_STATUSES.has(status);
  // A PAYING plan under a free-days hold read `trialing` on Stripe until
  // the days ended (lib/billing/free-days.ts): its declined renewal after
  // them is a payer's, with the grace. The hold's metadata says so (the
  // status is past_due by now, so the key alone is read).
  const heldPayer = !chosenDeleted && chosen.metadata?.[HOLD_FROM_KEY] === "active";
  const fromTrial =
    !heldPayer &&
    (previous.subscription_status === "trialing" ||
      (DUNNING_STATUSES.has(previous.subscription_status ?? "") && previous.payment_failed_at == null));
  const paymentFailedAt = broken
    ? (previous.payment_failed_at ?? (fromTrial ? null : new Date().toISOString()))
    : null;
  const base = {
    subscription_tier: tier,
    subscription_status: status,
    stripe_subscription_id: chosenDeleted ? null : chosen.id,
    current_period_end: periodEnd,
    cancel_at_period_end: ending.byPeriodEnd,
  };
  const endingColumns = {
    subscription_ends_at: live ? ending.endsAt : null,
    subscription_canceled_at: live ? ending.canceledAt : null,
  };
  // The plan's interval (0175): what the refill cron reads to tell a
  // monthly plan (the invoice grants) from an annual one (the cron grants).
  const rawInterval = chosenDeleted ? null : (item?.price?.recurring?.interval ?? null);
  const billingInterval: "month" | "year" | null =
    live && (rawInterval === "month" || rawInterval === "year") ? rawInterval : null;
  // What a free-days hold was added to (0181): the profile-only readers
  // (lib/billing/plan-ending.ts) tell a held PAYER from a trial by it.
  const rawHeldFrom = chosenDeleted ? null : (chosen.metadata?.[HOLD_FROM_KEY] ?? null);
  const heldFrom: "active" | "trialing" | null =
    live && (rawHeldFrom === "active" || rawHeldFrom === "trialing") ? rawHeldFrom : null;
  let { error: writeError } = await admin
    .from("profiles")
    .update({
      ...base,
      ...endingColumns,
      payment_failed_at: paymentFailedAt,
      billing_interval: billingInterval,
      subscription_held_from: heldFrom,
    })
    .eq("id", userId);
  if (writeError && isMissingHeldFromColumn(writeError)) {
    // The code is live before migration 0181: write what the schema holds.
    console.error(
      `[stripe] profiles.subscription_held_from is missing (migration 0181 not applied?) — synced ${userId} without it.`,
    );
    ({ error: writeError } = await admin
      .from("profiles")
      .update({ ...base, ...endingColumns, payment_failed_at: paymentFailedAt, billing_interval: billingInterval })
      .eq("id", userId));
  }
  if (writeError && isMissingIntervalColumn(writeError)) {
    // The code is live before migration 0175: write what the schema holds.
    console.error(
      `[stripe] profiles.billing_interval is missing (migration 0175 not applied?) — synced ${userId} without it.`,
    );
    ({ error: writeError } = await admin
      .from("profiles")
      .update({ ...base, ...endingColumns, payment_failed_at: paymentFailedAt })
      .eq("id", userId));
  }
  if (writeError && isMissingDunningColumn(writeError)) {
    // The code is live before migration 0174: write what the schema holds.
    console.error(
      `[stripe] profiles.payment_failed_at is missing (migration 0174 not applied?) — synced ${userId} without it.`,
    );
    ({ error: writeError } = await admin
      .from("profiles")
      .update({ ...base, ...endingColumns })
      .eq("id", userId));
  }
  if (writeError && isMissingEndingColumn(writeError)) {
    // The code is live before migration 0135: write what the old schema
    // holds rather than failing every webhook until it lands.
    console.error(
      `[stripe] profiles.subscription_ends_at is missing (migration 0135 not applied?) — synced ${userId} without it.`,
    );
    ({ error: writeError } = await admin.from("profiles").update(base).eq("id", userId));
  }
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
    endsAt: live ? ending.endsAt : null,
    billingInterval,
    paymentFailedAt,
    heldFrom,
  };
}

/**
 * The credits a synced state earns (lib/billing/credit-refill.ts, owner
 * 2026-11-06 — one-time, never a refill):
 *   • a subscription CREATED `trialing` (the checkout applied the bank):
 *     the free-period credits, once per account — `isCreationEvent` must only
 *     be true for the subscription.created event of the synced subscription;
 *   • a PAID invoice (`paid`: money taken) on a live Plus / Pro plan: the
 *     tier's one-time stock, once per account and tier (Pro after Plus the
 *     difference). Any other sync — a cancel click, a portal change, a
 *     proration, the admin's resync — grants nothing.
 * Throws on RPC failure so a webhook 500s and Stripe retries.
 */
export async function grantCreditsForSync(
  result: SubscriptionSyncResult,
  admin: AdminClient,
  opts: {
    isCreationEvent: boolean;
    /** The sync was driven by a PAID invoice — `invoice.paid` with
     *  `amount_paid > 0` on a subscription invoice. */
    paid?: boolean;
  },
): Promise<void> {
  if (!result.subscriptionId || !isLiveStatus(result.status)) return;
  if (result.tier === "free") return;
  if (result.status === "trialing") {
    if (!opts.isCreationEvent) return;
    const bonus = await grantFreePeriodCredits(admin, result.userId);
    if (!bonus.ok) throw new Error(`Free-period credit grant failed for ${result.userId}: ${bonus.error}`);
    return;
  }
  if (!opts.paid) return;
  const granted = await grantPlanCreditsOnce(admin, result.userId, result.tier);
  if (!granted.ok) {
    throw new Error(`Plan credit grant failed for ${result.userId}: ${granted.error}`);
  }
}

/** Stripe checks the subscription's default payment method AND the
 *  customer's when a trial ends — mirror that everywhere the app asks
 *  "does this trial have a card?". */
export async function subscriptionHasPaymentMethod(
  sub: SubscriptionLike,
  stripe: Stripe,
): Promise<boolean> {
  if (sub.default_payment_method || sub.default_source) return true;
  const customerId = customerIdOf(sub.customer);
  if (!customerId) return false;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ("deleted" in customer && customer.deleted) return false;
    return Boolean(customer.invoice_settings?.default_payment_method || customer.default_source);
  } catch {
    return false;
  }
}

/** A deleted subscription that never converted: it ended at (or before) its
 *  trial end — cancelled during the trial, or the trial expired unpaid.
 *
 *  A trial an admin COMP held (lib/billing/comp-stripe.ts) is judged against
 *  the trial it would have had WITHOUT the comp (`TRIAL_END_BEFORE_COMP_KEY`):
 *  cancelled during the comp's extra time — or during a comp hold that was
 *  never a free trial at all (a comped former subscriber's checkout: the key
 *  is the checkout time) — it is not a lapsed trial, and gets no
 *  `trial_lapsed` row or win-back offer. */
export function isUnconvertedTrial(sub: SubscriptionLike): boolean {
  if (typeof sub.trial_end !== "number" || typeof sub.ended_at !== "number") return false;
  // A paying plan held by free days was never a trial (lib/billing/free-days.ts).
  if (sub.metadata?.[HOLD_FROM_KEY] === "active") return false;
  const rawBefore = sub.metadata?.[TRIAL_END_BEFORE_COMP_KEY];
  const before = rawBefore ? Number(rawBefore) : NaN;
  const trialEnd = Number.isFinite(before) && before > 0 ? Math.min(before, sub.trial_end) : sub.trial_end;
  return sub.ended_at <= trialEnd + 60;
}

/** The newest subscription in `subs` whose payment is broken (past_due,
 *  unpaid, incomplete). */
function delinquentSubscriptionIn(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  return (
    subs
      .filter((sub) => DELINQUENT_SUBSCRIPTION_STATUSES.has(sub.status))
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0] ?? null
  );
}

/** The live (primary) subscription in `subs`: the same pick the sync makes —
 *  live, highest tier, newest. */
async function liveSubscriptionIn(
  subs: Stripe.Subscription[],
  stripe: Stripe,
): Promise<Stripe.Subscription | null> {
  const tiers = new Map<string, PlanTier | null>();
  for (const sub of subs) {
    if (isLiveStatus(sub.status)) tiers.set(sub.id, await resolveSubscriptionTier(sub, stripe));
  }
  return pickPrimarySubscription(subs, (sub) => tiers.get(sub.id) ?? null);
}

/** The customer's newest subscription whose payment is broken (past_due,
 *  unpaid, incomplete) — the checkout action sends such a customer to the
 *  portal to fix the card instead of selling them a second subscription
 *  that would bill twice once Stripe's retry on the old invoice succeeds.
 *  `null` for "none" AND for "the list could not be read": a caller that
 *  must tell the two apart uses findCheckoutSubscriptions. */
export async function findDelinquentSubscription(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription | null> {
  const subs = await listCustomerSubscriptions(stripe, customerId);
  if (!subs) return null;
  return delinquentSubscriptionIn(subs);
}

/** The customer's live subscription (if any). `null` for "none" AND for
 *  "the list could not be read" — fine for a read that only ADDS something
 *  (the admin page, a pack's subscriber discount), never for one that
 *  decides whether to SELL (findCheckoutSubscriptions). */
export async function findLiveSubscription(
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription | null> {
  const subs = await listCustomerSubscriptions(stripe, customerId);
  if (!subs) return null;
  return liveSubscriptionIn(subs, stripe);
}

/** What the checkout action must know before it may start a subscription,
 *  from ONE read of the customer's list: their live subscription and their
 *  newest delinquent one. `null` = the list could NOT be read (a transient
 *  Stripe error, a restricted key) and the caller must REFUSE: reading
 *  "nothing found" as "no subscription" when nothing could be read is how an
 *  active subscriber was sold a second subscription, charged at once
 *  (billing audit 2026-11-05, P1-2). An empty list answers both as null. */
export async function findCheckoutSubscriptions(
  stripe: Stripe,
  customerId: string,
): Promise<{ live: Stripe.Subscription | null; delinquent: Stripe.Subscription | null } | null> {
  const subs = await listCustomerSubscriptions(stripe, customerId);
  if (!subs) return null;
  return { live: await liveSubscriptionIn(subs, stripe), delinquent: delinquentSubscriptionIn(subs) };
}
