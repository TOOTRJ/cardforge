import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  REFERRAL_ACTIVATION_WINDOW_DAYS,
  REFERRAL_CLAIM_WINDOW_DAYS,
  REFERRAL_LIFETIME_CAP,
  REFERRAL_MONTHLY_CAP,
  normalizeReferralCode,
} from "@/lib/referrals/rules";
import { referralFraudVerdict, type ReferralBlockReason } from "@/lib/referrals/fraud";
import { oneMonthCents, planReferralMonth, type ReferralRewardProfile } from "@/lib/referrals/reward";

// ---------------------------------------------------------------------------
// The referral program's server side — the service role only (0153: users
// read their rows, nobody but the server writes them). Two entry points:
//
//   recordReferralSignup  a NEW account arrived through a link (the signup
//                         action, and onboarding for a Google sign-up):
//                         one `referrals` row (unique per referee — the
//                         first claim wins) + a `referral_signup`
//                         notification to the referrer.
//   qualifyReferral       the account saved its FIRST card (createCardAction,
//                         on the first_card_saved milestone): signed_up →
//                         first_card (one-shot), the window, the fraud
//                         rules, the caps (claim_referral_reward, atomic),
//                         then each side's month and notification.
//
// Every step is best effort for the CALLER: a referral never fails a signup
// or a save. Each month is granted once — the status moves before any grant,
// and the Stripe credit carries an idempotency key per referral and side.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

const DAY_MS = 86_400_000;

const REWARD_PROFILE_COLUMNS =
  "is_admin, subscription_tier, subscription_status, stripe_customer_id, stripe_subscription_id, cancel_at_period_end, current_period_end, subscription_ends_at, comp_tier, comp_expires_at";

export type RecordReferralSignupResult =
  | { ok: true; referralId: string }
  | { ok: false; reason: "bad_code" | "unknown_code" | "self" | "not_new" | "exists" | "error" };

export async function recordReferralSignup(
  admin: AdminClient,
  input: { refereeId: string; code: unknown; now?: Date },
): Promise<RecordReferralSignupResult> {
  const code = normalizeReferralCode(input.code);
  if (!code) return { ok: false, reason: "bad_code" };
  const now = input.now ?? new Date();
  try {
    const { data: owner } = await admin
      .from("referral_codes")
      .select("user_id")
      .eq("code", code)
      .maybeSingle();
    if (!owner) return { ok: false, reason: "unknown_code" };
    if (owner.user_id === input.refereeId) return { ok: false, reason: "self" };

    // Only a NEW account: young, never subscribed, nothing saved yet.
    const { data: referee } = await admin
      .from("profiles")
      .select("created_at, subscription_status")
      .eq("id", input.refereeId)
      .maybeSingle();
    if (!referee) return { ok: false, reason: "error" };
    const age = now.getTime() - Date.parse(referee.created_at ?? "");
    if (!(age <= REFERRAL_CLAIM_WINDOW_DAYS * DAY_MS) || referee.subscription_status != null) {
      return { ok: false, reason: "not_new" };
    }
    const { count } = await admin
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", input.refereeId);
    if ((count ?? 0) > 0) return { ok: false, reason: "not_new" };

    const { data: row, error } = await admin
      .from("referrals")
      .insert({ referrer_id: owner.user_id, referee_id: input.refereeId, code })
      .select("id")
      .single();
    if (error || !row) {
      // 23505: the account already has its referral (first claim wins).
      return { ok: false, reason: error?.code === "23505" ? "exists" : "error" };
    }
    await notify(admin, {
      recipientId: owner.user_id,
      actorId: input.refereeId,
      type: "referral_signup",
      payload: { referralId: row.id },
    });
    return { ok: true, referralId: row.id };
  } catch (error) {
    console.warn("recordReferralSignup failed", error instanceof Error ? error.message : error);
    return { ok: false, reason: "error" };
  }
}

export type QualifyReferralResult =
  | { status: "none" }
  | { status: "expired" }
  | { status: "blocked"; reason: ReferralBlockReason }
  | { status: "rewarded" | "capped"; referrer: GrantedMonth; referee: GrantedMonth };

export type GrantedMonth =
  | { kind: "comp_month"; tier: string; expiresAt: string }
  | { kind: "balance_credit"; amountCents: number; currency: string }
  | { kind: "none"; reason: string };

export async function qualifyReferral(
  admin: AdminClient,
  refereeId: string,
  deps: { stripe?: Stripe | null; now?: Date } = {},
): Promise<QualifyReferralResult> {
  const now = deps.now ?? new Date();
  const stripe = deps.stripe ?? null;

  // signed_up → first_card, once: a second save (or a retry) finds nothing.
  const { data: moved } = await admin
    .from("referrals")
    .update({ status: "first_card", first_card_at: now.toISOString() })
    .eq("referee_id", refereeId)
    .eq("status", "signed_up")
    .select("id, referrer_id, signed_up_at");
  const referral = moved?.[0];
  if (!referral) return { status: "none" };

  if (now.getTime() - Date.parse(referral.signed_up_at) > REFERRAL_ACTIVATION_WINDOW_DAYS * DAY_MS) {
    await admin.from("referrals").update({ status: "expired" }).eq("id", referral.id);
    return { status: "expired" };
  }

  const [referrerEmail, refereeEmail, profiles] = await Promise.all([
    emailOf(admin, referral.referrer_id),
    emailOf(admin, refereeId),
    admin.from("profiles").select(`id, ${REWARD_PROFILE_COLUMNS}`).in("id", [referral.referrer_id, refereeId]),
  ]);
  const rows = (profiles.data ?? []) as Array<ReferralRewardProfile & { id: string }>;
  const referrer = rows.find((r) => r.id === referral.referrer_id) ?? null;
  const referee = rows.find((r) => r.id === refereeId) ?? null;

  const sameCard = await sharesCard(stripe, referrer?.stripe_customer_id, referee?.stripe_customer_id);
  const verdict = referralFraudVerdict({ referrerEmail, refereeEmail, sameCard });

  if (verdict.block && !verdict.refereeRewarded) {
    await admin
      .from("referrals")
      .update({ status: "blocked", block_reason: verdict.block, referrer_reward: "none", referee_reward: "none" })
      .eq("id", referral.id);
    return { status: "blocked", reason: verdict.block };
  }

  let outcome: "rewarded" | "capped" | "blocked";
  if (verdict.block) {
    // same_domain: the friend keeps their month, the referrer gets none.
    await admin
      .from("referrals")
      .update({ status: "blocked", block_reason: verdict.block, rewarded_at: now.toISOString() })
      .eq("id", referral.id);
    outcome = "blocked";
  } else {
    const { data: claimed, error } = await admin.rpc("claim_referral_reward", {
      p_referral_id: referral.id,
      p_monthly_cap: REFERRAL_MONTHLY_CAP,
      p_lifetime_cap: REFERRAL_LIFETIME_CAP,
    });
    if (error || (claimed !== "rewarded" && claimed !== "capped")) {
      console.warn(`qualifyReferral(${referral.id}): claim failed`, error?.message ?? claimed);
      return { status: "none" };
    }
    outcome = claimed;
  }

  const refereeMonth = await grantMonth(admin, stripe, refereeId, referee, { referralId: referral.id, side: "referee", now });
  const referrerMonth: GrantedMonth =
    outcome === "rewarded"
      ? await grantMonth(admin, stripe, referral.referrer_id, referrer, { referralId: referral.id, side: "referrer", now })
      : { kind: "none", reason: outcome === "capped" ? "cap" : (verdict.block ?? "blocked") };

  await admin
    .from("referrals")
    .update({
      referee_reward: refereeMonth.kind,
      referee_reward_detail: refereeMonth,
      referrer_reward: referrerMonth.kind,
      referrer_reward_detail: referrerMonth,
    })
    .eq("id", referral.id);

  if (refereeMonth.kind !== "none") {
    await notify(admin, {
      recipientId: refereeId,
      actorId: referral.referrer_id,
      type: "referral_reward",
      payload: { referralId: referral.id, side: "referee", ...rewardPayload(refereeMonth) },
    });
  }
  if (referrerMonth.kind !== "none") {
    await notify(admin, {
      recipientId: referral.referrer_id,
      actorId: refereeId,
      type: "referral_reward",
      payload: { referralId: referral.id, side: "referrer", ...rewardPayload(referrerMonth) },
    });
  }

  if (outcome === "blocked") return { status: "blocked", reason: verdict.block as ReferralBlockReason };
  return { status: outcome, referrer: referrerMonth, referee: refereeMonth };
}

function rewardPayload(month: GrantedMonth): Record<string, string | number> {
  if (month.kind === "comp_month") return { reward: "comp_month", tier: month.tier, until: month.expiresAt };
  if (month.kind === "balance_credit") {
    return { reward: "balance_credit", amountCents: month.amountCents, currency: month.currency };
  }
  return { reward: "none" };
}

/** Give one user their month (lib/referrals/reward.ts decides how). */
async function grantMonth(
  admin: AdminClient,
  stripe: Stripe | null,
  userId: string,
  profile: ReferralRewardProfile | null,
  ctx: { referralId: string; side: "referrer" | "referee"; now: Date },
): Promise<GrantedMonth> {
  if (!profile) return { kind: "none", reason: "no_profile" };
  let plan = planReferralMonth(profile, ctx.now);
  // A renewing plan with no Stripe to credit (no key): a comp month instead
  // — never nothing.
  if (plan.kind === "balance_credit" && !stripe) {
    plan = planReferralMonth({ ...profile, subscription_status: null }, ctx.now);
  }
  try {
    if (plan.kind === "none") return { kind: "none", reason: plan.reason };
    if (plan.kind === "comp_month") {
      const { error } = await admin
        .from("profiles")
        .update({ comp_tier: plan.tier, comp_expires_at: plan.expiresAt })
        .eq("id", userId);
      if (error) throw new Error(error.message);
      return { kind: "comp_month", tier: plan.tier, expiresAt: plan.expiresAt };
    }
    const sub = await (stripe as Stripe).subscriptions.retrieve(plan.subscriptionId);
    const price = sub.items?.data?.[0]?.price ?? null;
    const amountCents = oneMonthCents(price, plan.tier);
    const currency = price?.currency ?? "usd";
    await (stripe as Stripe).customers.createBalanceTransaction(
      plan.customerId,
      {
        amount: -amountCents,
        currency,
        description: "PipGlyph referral — one free month",
        metadata: { referral_id: ctx.referralId, side: ctx.side },
      },
      { idempotencyKey: `referral:${ctx.referralId}:${ctx.side}` },
    );
    return { kind: "balance_credit", amountCents, currency };
  } catch (error) {
    console.error(
      `[referrals] ${ctx.side} month for ${userId} (${ctx.referralId}) failed:`,
      error instanceof Error ? error.message : error,
    );
    return { kind: "none", reason: "grant_failed" };
  }
}

async function emailOf(admin: AdminClient, userId: string): Promise<string | null> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

/** A card fingerprint on both customers (Stripe's fingerprint is per card
 *  number within this account). False when either has no customer or
 *  Stripe can't be read — the other rules still run. */
async function sharesCard(
  stripe: Stripe | null,
  a: string | null | undefined,
  b: string | null | undefined,
): Promise<boolean> {
  if (!stripe || !a || !b) return false;
  try {
    const [left, right] = await Promise.all([
      stripe.customers.listPaymentMethods(a, { type: "card", limit: 20 }),
      stripe.customers.listPaymentMethods(b, { type: "card", limit: 20 }),
    ]);
    const prints = new Set(left.data.map((pm) => pm.card?.fingerprint).filter(Boolean));
    return right.data.some((pm) => pm.card?.fingerprint && prints.has(pm.card.fingerprint));
  } catch {
    return false;
  }
}

async function notify(
  admin: AdminClient,
  input: {
    recipientId: string;
    actorId: string | null;
    type: "referral_signup" | "referral_reward";
    payload: Record<string, string | number>;
  },
): Promise<void> {
  const { error } = await admin.from("notifications").insert({
    recipient_id: input.recipientId,
    actor_id: input.actorId,
    type: input.type,
    payload: input.payload,
  });
  // 23505: already told (0153's once-per-referral index).
  if (error && error.code !== "23505") {
    console.warn(`[referrals] ${input.type} notification failed:`, error.message);
  }
}
