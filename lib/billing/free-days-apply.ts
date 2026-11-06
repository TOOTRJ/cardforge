import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { resolveSubscriptionTier, syncSubscriptionForUser } from "@/lib/stripe/subscription-sync";
import { HOLD_FROM_KEY, TRIAL_END_BEFORE_COMP_KEY } from "@/lib/billing/comp-stripe";
import {
  freeDaysNote,
  isoOf,
  planFreeDays,
  planRevoke,
  revokeNote,
  type FreeDaysPlan,
  type FreeDaysProfile,
  type FreeDaysSubscription,
  type GrantSource,
  type OverlayWrite,
  type PlanGrantFacts,
} from "@/lib/billing/free-days";
import { planForTier, type PaidTier, type PlanTier } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// The writer behind lib/billing/free-days.ts: `grantFreeDays` for every
// caller (the admin's comp today, PR F's referral reward), `revokeFreeDays`
// for the admin. Order of writes:
//   1. the profile and its CURRENT Stripe subscription are read (a Stripe
//      read that fails refuses the grant — the shape can't be decided);
//   2. the grant is a ROW first (`plan_grants`, status pending);
//   3. a hold updates Stripe under the idempotency key `plan-grant:<id>`
//      (a retried request moves the trial once); a failure marks the row
//      `failed` with the error and nothing else changes;
//   4. the perks overlay is written and the row marked `applied` — from
//      here the credit sweep counts it.
// No balance credit, no coupon: the ONE Stripe primitive is `trial_end`.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

/** A `pending` grant older than this never finished (the process died
 *  between the row and its Stripe write): marked failed, so it no longer
 *  blocks the user's next grant. */
export const STALE_PENDING_MS = 10 * 60_000;

const TIER_NAME = (tier: PaidTier) => planForTier(tier).name;

const PROFILE_COLUMNS =
  "id, is_admin, subscription_status, subscription_tier, stripe_customer_id, stripe_subscription_id, comp_tier, comp_expires_at";

type ProfileRow = FreeDaysProfile & {
  id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

export type GrantFreeDaysInput = {
  userId: string;
  tier: PaidTier;
  /** 30-day units; null = no end (staff). */
  units: number | null;
  source: GrantSource;
  grantedBy: string | null;
  note: string | null;
};

export type GrantFreeDaysResult =
  | {
      ok: true;
      grantId: string;
      plan: Exclude<FreeDaysPlan, { kind: "refused" }>;
      /** The free days' end (ISO), null for an open-ended grant. */
      endsAt: string | null;
      /** A hold: the Stripe trial's new end (ISO). */
      holdEndsAt: string | null;
      /** One line for the admin. */
      note: string;
      /** Something after the Stripe write did not land (logged). */
      warning?: string;
    }
  | { ok: false; error: string };

async function readState(
  admin: AdminClient,
  userId: string,
  stripe: Stripe | null,
): Promise<
  | { ok: true; profile: ProfileRow; sub: Stripe.Subscription | null; subscribedTier: PlanTier | null }
  | { ok: false; error: string }
> {
  const { data, error } = await admin.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
  if (error || !data) return { ok: false, error: error ? "Couldn't read the profile." : "No user with that id." };
  const profile = data as unknown as ProfileRow;
  if (!profile.stripe_subscription_id || !stripe) return { ok: true, profile, sub: null, subscribedTier: null };
  try {
    const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
    // The tier the subscription PAYS for, from Stripe itself — the profile's
    // copy can lag a plan switch the webhook hasn't synced yet.
    const subscribedTier = await resolveSubscriptionTier(sub, stripe);
    return { ok: true, profile, sub, subscribedTier };
  } catch (err) {
    console.warn(`grantFreeDays(${userId}): stripe read failed`, err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't read their Stripe subscription — nothing was granted. Try again in a moment." };
  }
}

function stripeOf(deps: { stripe?: Stripe }): Stripe | null {
  if (deps.stripe) return deps.stripe;
  return isStripeConfigured() ? getStripe() : null;
}

function cut(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 300);
}

async function resync(
  admin: AdminClient,
  stripe: Stripe,
  userId: string,
  updated: Stripe.Subscription,
  customerId: string | null,
): Promise<string | null> {
  // The profile's period / trial dates follow at once (the webhook's
  // subscription.updated does the same a moment later). Stripe IS updated
  // by now: a failed resync must not read as a failed grant.
  try {
    await syncSubscriptionForUser(admin, stripe, userId, { currentSub: updated, customerId });
    return null;
  } catch (error) {
    console.warn(`grantFreeDays(${userId}): resync after the trial change failed`, cut(error));
    return "The profile's dates catch up with the next webhook (or press Resync).";
  }
}

export async function grantFreeDays(
  admin: AdminClient,
  input: GrantFreeDaysInput,
  deps: { stripe?: Stripe; now?: Date } = {},
): Promise<GrantFreeDaysResult> {
  const stripe = stripeOf(deps);
  const state = await readState(admin, input.userId, stripe);
  if (!state.ok) return state;
  const { profile, sub, subscribedTier } = state;

  const plan = planFreeDays({
    profile,
    sub: sub as FreeDaysSubscription | null,
    subscribedTier,
    tier: input.tier,
    units: input.units,
    now: deps.now,
  });
  if (plan.kind === "refused") return { ok: false, error: plan.error };

  const startsAt = plan.kind === "below_plan" ? Math.floor((deps.now ?? new Date()).getTime() / 1000) : plan.startsAt;
  const endsAt = plan.kind === "below_plan" ? startsAt + (input.units ?? 0) * 30 * 86_400 : plan.endsAt;
  // ONE grant in flight per user (0176's partial unique index): a row left
  // `pending` by a crash would block the user for good, so one older than
  // STALE_PENDING_MS is marked failed first.
  await admin
    .from("plan_grants")
    .update({ status: "failed", stripe_error: "stale: never finished" })
    .eq("user_id", input.userId)
    .eq("status", "pending")
    .lt("created_at", new Date((deps.now ?? new Date()).getTime() - STALE_PENDING_MS).toISOString());
  const { data: inserted, error: insertError } = await admin
    .from("plan_grants")
    .insert({
      user_id: input.userId,
      tier: input.tier,
      units: input.units,
      source: input.source,
      granted_by: input.grantedBy,
      note: input.note,
      applied_as: plan.kind === "hold" ? "subscription_hold" : plan.kind === "below_plan" ? "below_plan" : "overlay",
      stripe_subscription_id: plan.kind === "hold" ? plan.subscriptionId : null,
      held_from: plan.kind === "hold" ? plan.was : null,
      starts_at: isoOf(startsAt),
      ends_at: endsAt == null ? null : isoOf(endsAt),
      credits_from: isoOf(startsAt),
      status: "pending",
    })
    .select("id")
    .single();
  const grantId = (inserted as { id?: string } | null)?.id;
  if (insertError || !grantId) {
    if (insertError?.code === "23505") {
      return { ok: false, error: "Another grant for this user is being applied right now. Try again in a moment." };
    }
    console.warn(`grantFreeDays(${input.userId}): insert failed`, insertError?.message);
    return { ok: false, error: "Couldn't record the grant. Nothing was granted." };
  }

  const warnings: string[] = [];
  let holdEndsAt: string | null = null;
  if (plan.kind === "hold") {
    let updated: Stripe.Subscription;
    try {
      updated = await (stripe as Stripe).subscriptions.update(
        plan.subscriptionId,
        {
          trial_end: plan.trialEnd,
          proration_behavior: "none",
          // A card that goes missing before the days end: the plan ends,
          // never a past-due invoice (the billing page says so).
          trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
          metadata: { [TRIAL_END_BEFORE_COMP_KEY]: plan.beforeComp, [HOLD_FROM_KEY]: plan.was },
        },
        { idempotencyKey: `plan-grant:${grantId}` },
      );
    } catch (error) {
      console.warn(`grantFreeDays(${input.userId}): stripe update failed`, cut(error));
      await admin.from("plan_grants").update({ status: "failed", stripe_error: cut(error) }).eq("id", grantId);
      return {
        ok: false,
        error: "Stripe couldn't be updated — nothing was granted (the attempt is listed as failed). Try again.",
      };
    }
    holdEndsAt = typeof updated.trial_end === "number" ? isoOf(updated.trial_end) : isoOf(plan.trialEnd);
    const resyncNote = await resync(admin, stripe as Stripe, input.userId, updated, profile.stripe_customer_id);
    if (resyncNote) warnings.push(resyncNote);
  }

  if (plan.kind !== "below_plan") {
    const { error } = await admin.from("profiles").update(plan.overlay).eq("id", input.userId);
    if (error) {
      console.error(`grantFreeDays(${input.userId}): overlay write failed`, error.message);
      if (plan.kind === "overlay") {
        await admin.from("plan_grants").update({ status: "failed", stripe_error: `overlay: ${error.message}` }).eq("id", grantId);
        return { ok: false, error: "Couldn't write the complimentary access. Nothing was granted." };
      }
      warnings.push("Stripe was updated, but the profile's complimentary columns couldn't be written — save the grant's overlay by hand or tell the dev.");
    }
  }
  const { error: applyError } = await admin.from("plan_grants").update({ status: "applied" }).eq("id", grantId);
  if (applyError) {
    console.error(`grantFreeDays(${input.userId}): status write failed`, applyError.message);
    warnings.push("The grant is still listed as pending (its credits wait until it reads applied).");
  }

  return {
    ok: true,
    grantId,
    plan,
    endsAt: endsAt == null ? null : isoOf(endsAt),
    holdEndsAt,
    note: freeDaysNote(plan, TIER_NAME),
    ...(warnings.length ? { warning: warnings.join(" ") } : {}),
  };
}

// ---------------------------------------------------------------------------

export type RevokeFreeDaysResult =
  | { ok: true; overlay: OverlayWrite; chargesNow: boolean; note: string; warning?: string }
  | { ok: false; error: string };

type GrantRow = PlanGrantFacts & { user_id: string };

export async function revokeFreeDays(
  admin: AdminClient,
  input: { grantId: string; revokedBy: string | null },
  deps: { stripe?: Stripe; now?: Date } = {},
): Promise<RevokeFreeDaysResult> {
  const { data: grantRow, error: grantError } = await admin
    .from("plan_grants")
    .select("id, user_id, tier, units, ends_at, status")
    .eq("id", input.grantId)
    .maybeSingle();
  if (grantError || !grantRow) return { ok: false, error: "No grant with that id." };
  const grant = grantRow as unknown as GrantRow;
  if (grant.status !== "applied") return { ok: false, error: "Only an applied grant can be revoked." };

  const { data: siblings } = await admin
    .from("plan_grants")
    .select("id, user_id, tier, units, ends_at, status")
    .eq("user_id", grant.user_id)
    .eq("status", "applied")
    .order("created_at", { ascending: false });
  const applied = ((siblings ?? []) as unknown as GrantRow[]);
  if (applied[0] && applied[0].id !== grant.id) {
    return { ok: false, error: "Only the newest grant can be revoked. Revoke the later ones first." };
  }

  const stripe = stripeOf(deps);
  const state = await readState(admin, grant.user_id, stripe);
  if (!state.ok) return { ok: false, error: state.error.replace("nothing was granted", "nothing was revoked") };
  const { profile, sub } = state;

  const plan = planRevoke({
    grant,
    profile,
    sub: sub as FreeDaysSubscription | null,
    otherGrants: applied.filter((g) => g.id !== grant.id),
    now: deps.now,
  });
  if (plan.kind === "refused") return { ok: false, error: plan.error };

  const warnings: string[] = [];
  if (plan.trial) {
    let updated: Stripe.Subscription;
    try {
      updated = await (stripe as Stripe).subscriptions.update(
        plan.trial.subscriptionId,
        {
          trial_end: plan.trial.trialEnd,
          proration_behavior: "none",
          metadata: { [TRIAL_END_BEFORE_COMP_KEY]: plan.trial.beforeComp },
        },
        { idempotencyKey: `plan-grant-revoke:${grant.id}` },
      );
    } catch (error) {
      console.warn(`revokeFreeDays(${grant.user_id}): stripe update failed`, cut(error));
      return { ok: false, error: "Stripe couldn't be updated — nothing was revoked. Try again." };
    }
    const resyncNote = await resync(admin, stripe as Stripe, grant.user_id, updated, profile.stripe_customer_id);
    if (resyncNote) warnings.push(resyncNote);
  }

  const { error: overlayError } = await admin.from("profiles").update(plan.overlay).eq("id", grant.user_id);
  if (overlayError) {
    console.error(`revokeFreeDays(${grant.user_id}): overlay write failed`, overlayError.message);
    warnings.push("The profile's complimentary columns couldn't be written — tell the dev.");
  }
  const { error: rowError } = await admin
    .from("plan_grants")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: input.revokedBy })
    .eq("id", grant.id);
  if (rowError) {
    console.error(`revokeFreeDays(${grant.user_id}): status write failed`, rowError.message);
    warnings.push("The grant still reads applied — tell the dev.");
  }
  return {
    ok: true,
    overlay: plan.overlay,
    chargesNow: plan.trial?.trialEnd === "now",
    note: revokeNote(plan, TIER_NAME),
    ...(warnings.length ? { warning: warnings.join(" ") } : {}),
  };
}
