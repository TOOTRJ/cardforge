import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/supabase";
import {
  REFERRAL_ACTIVATION_WINDOW_DAYS,
  REFERRAL_CLAIM_WINDOW_DAYS,
  REFERRAL_CONFIRM_WINDOW_DAYS,
  REFERRAL_GRANT_MAX_ATTEMPTS,
  REFERRAL_LIFETIME_CAP,
  REFERRAL_MONTHLY_CAP,
  REFERRAL_MONTH_DAYS,
  REFERRAL_SWEEP_BATCH,
  normalizeReferralCode,
} from "@/lib/referrals/rules";
import { normalizeReferralEmail, referralFraudVerdict, type ReferralBlockReason } from "@/lib/referrals/fraud";
import { referralEmailFingerprint, referralEmailHashKey } from "@/lib/referrals/email-fingerprint";
import { planReferralMonth, type ReferralRewardProfile } from "@/lib/referrals/reward";
import { creditCustomerBalance, oneMonthCents } from "@/lib/billing/balance-credit";
import { MONTHLY_CREDITS } from "@/lib/billing/plans";
import { isBillingEnabled } from "@/lib/billing/flags";

// ---------------------------------------------------------------------------
// The referral program's server side — the service role only (0164: users
// read their rows, nobody but the server writes them). Entry points:
//
//   recordReferralSignup  a NEW account arrived through a link (the signup
//                         action, and onboarding for a Google sign-up): one
//                         `referrals` row (unique per referee — the first
//                         claim wins). Nobody is told yet: nothing is earned
//                         until the friend qualifies.
//   qualifyReferral       the account saved its FIRST card (createCardAction,
//                         on the first_card_saved milestone): signed_up →
//                         first_card (one-shot), the activation window, then
//                         the reward step at once (owner 2026-11-02: no hold).
//   rewardReferral        a first_card row: both emails CONFIRMED (else it
//                         waits — the sweep looks again), the fraud rules,
//                         the caps (claim_referral_reward, atomic), then each
//                         side's month (grantOwedSides).
//   sweepReferralRewards  the cron's retry (/api/cron/referral-rewards):
//                         first_card rows not claimed yet, and claimed rows
//                         with a side still owed.
//
// Nothing here runs while billing is off (NEXT_PUBLIC_BILLING_ENABLED): the
// rows wait. Every step is best effort for the CALLER: a referral never
// fails a signup or a save. Each month is granted once — a side's reward
// column is written once (the database checks it under a lock for a Plus
// month; a balance credit carries a Stripe idempotency key per referral and
// side), so the sweep can retry anything.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

const DAY_MS = 86_400_000;

const REWARD_PROFILE_COLUMNS =
  "is_admin, subscription_tier, subscription_status, stripe_customer_id, stripe_subscription_id, cancel_at_period_end, current_period_end, subscription_ends_at, comp_tier, comp_expires_at";

const REFERRAL_ROW_COLUMNS =
  "id, referrer_id, referee_id, status, block_reason, first_card_at, referrer_reward, referee_reward, grant_attempts";

type ReferralRow = {
  id: string;
  referrer_id: string;
  referee_id: string | null;
  status: string;
  block_reason?: string | null;
  first_card_at: string | null;
  referrer_reward: string | null;
  referee_reward: string | null;
  grant_attempts?: number | null;
};

type Side = "referrer" | "referee";

export type RewardDeps = { stripe?: Stripe | null; now?: Date; billingEnabled?: boolean };

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
    // Keep the email's fingerprint (no address, no user id) — it outlives
    // the account. The account is created normally whatever it finds; the
    // reward step judges (owner 2026-11-02).
    const user = await authUserOf(admin, input.refereeId);
    await recordEmailFingerprint(admin, row.id, user?.email ?? null);
    return { ok: true, referralId: row.id };
  } catch (error) {
    console.warn("recordReferralSignup failed", error instanceof Error ? error.message : error);
    return { ok: false, reason: "error" };
  }
}

export type GrantedMonth =
  | { kind: "plus_month"; tier: "plus"; startsAt: string; expiresAt: string; credits: number }
  | { kind: "balance_credit"; amountCents: number; currency: string }
  | { kind: "none"; reason: string };

export type RewardReferralResult =
  | { status: "none" }
  | { status: "expired" }
  | { status: "waiting"; reason: "billing_off" | "email_unconfirmed" | "hash_key_missing" | "check_failed" }
  | { status: "blocked"; reason: ReferralBlockReason; referee: GrantedMonth | null }
  | { status: "rewarded" | "capped"; referrer: GrantedMonth | null; referee: GrantedMonth | null };

export type QualifyReferralResult = RewardReferralResult;

export async function qualifyReferral(
  admin: AdminClient,
  refereeId: string,
  deps: RewardDeps = {},
): Promise<QualifyReferralResult> {
  const now = deps.now ?? new Date();

  // signed_up → first_card, once: a second save (or a retry) finds nothing.
  const { data: moved } = await admin
    .from("referrals")
    .update({ status: "first_card", first_card_at: now.toISOString() })
    .eq("referee_id", refereeId)
    .eq("status", "signed_up")
    .select(`${REFERRAL_ROW_COLUMNS}, signed_up_at`);
  const referral = (moved?.[0] ?? null) as (ReferralRow & { signed_up_at: string }) | null;
  if (!referral) return { status: "none" };

  if (now.getTime() - Date.parse(referral.signed_up_at) > REFERRAL_ACTIVATION_WINDOW_DAYS * DAY_MS) {
    await admin
      .from("referrals")
      .update({ status: "expired", referrer_reward: "none", referee_reward: "none" })
      .eq("id", referral.id);
    return { status: "expired" };
  }

  return rewardReferral(admin, referral, deps);
}

/** The reward step for one first_card row. Safe to run again (the sweep):
 *  only a first_card row is claimed, once. */
export async function rewardReferral(
  admin: AdminClient,
  referral: ReferralRow,
  deps: RewardDeps = {},
): Promise<RewardReferralResult> {
  const now = deps.now ?? new Date();
  const stripe = deps.stripe ?? null;
  if (!(deps.billingEnabled ?? isBillingEnabled())) return { status: "waiting", reason: "billing_off" };
  if (referral.status !== "first_card") return { status: "none" };

  // The friend's account is gone: nobody is rewarded (the row stays — it is
  // evidence, never cascaded).
  if (!referral.referee_id) {
    const moved = await settleFirstCard(admin, referral.id, {
      status: "blocked",
      block_reason: "account_deleted",
      referrer_reward: "none",
      referee_reward: "none",
    });
    return moved ? { status: "blocked", reason: "account_deleted", referee: null } : { status: "none" };
  }
  const refereeId = referral.referee_id;

  const [referrerUser, refereeUser, profiles] = await Promise.all([
    authUserOf(admin, referral.referrer_id),
    authUserOf(admin, refereeId),
    admin.from("profiles").select(`id, ${REWARD_PROFILE_COLUMNS}`).in("id", [referral.referrer_id, refereeId]),
  ]);

  // Both emails CONFIRMED before either side is rewarded (owner 2026-11-02).
  // With confirmations off (the local stack), GoTrue confirms at signup, so
  // the rule still holds and still passes there.
  if (!refereeUser?.confirmed || !referrerUser?.confirmed) {
    const since = referral.first_card_at ? Date.parse(referral.first_card_at) : now.getTime();
    if (now.getTime() - since > REFERRAL_CONFIRM_WINDOW_DAYS * DAY_MS) {
      const moved = await settleFirstCard(admin, referral.id, {
        status: "expired",
        referrer_reward: "none",
        referee_reward: "none",
      });
      return moved ? { status: "expired" } : { status: "none" };
    }
    return { status: "waiting", reason: "email_unconfirmed" };
  }

  // One email, one referral month — judged on a keyed hash, so no key, no
  // reward (fail closed; the sweep grants once the key is set).
  const hashKey = referralEmailHashKey();
  if (!hashKey) {
    console.error(`[referrals] ${referral.id} waits: REFERRAL_EMAIL_HASH_KEY is not set (no reward without it).`);
    return { status: "waiting", reason: "hash_key_missing" };
  }

  const rows = (profiles.data ?? []) as Array<ReferralRewardProfile & { id: string }>;
  const referrer = rows.find((r) => r.id === referral.referrer_id) ?? null;
  const referee = rows.find((r) => r.id === refereeId) ?? null;

  const sameCard = await sharesCard(stripe, referrer?.stripe_customer_id, referee?.stripe_customer_id);
  const verdict = referralFraudVerdict({
    referrerEmail: referrerUser.email,
    refereeEmail: refereeUser.email,
    sameCard,
  });

  let fullBlock: ReferralBlockReason | null = verdict.block && !verdict.refereeRewarded ? verdict.block : null;
  if (!fullBlock) {
    const reused = await emailReused(admin, referral.id, refereeId, refereeUser.email, hashKey);
    if (reused === "error") return { status: "waiting", reason: "check_failed" };
    if (reused) fullBlock = "email_reused";
  }

  if (fullBlock) {
    const moved = await settleFirstCard(admin, referral.id, {
      status: "blocked",
      block_reason: fullBlock,
      referrer_reward: "none",
      referee_reward: "none",
    });
    if (!moved) return { status: "none" };
    // The friend is never told why (anti-enumeration); the referrer reads
    // "not eligible", never a reason.
    await notifyNoMonth(admin, referral.referrer_id, refereeId, referral.id, "not_eligible");
    return { status: "blocked", reason: fullBlock, referee: null };
  }

  let outcome: "rewarded" | "capped" | "blocked";
  if (verdict.block) {
    // same_domain: the friend keeps their month, the referrer gets none.
    const moved = await settleFirstCard(admin, referral.id, {
      status: "blocked",
      block_reason: verdict.block,
      rewarded_at: now.toISOString(),
      referrer_reward: "none",
      referrer_reward_detail: { kind: "none", reason: verdict.block },
    });
    if (!moved) return { status: "none" };
    outcome = "blocked";
    await notifyNoMonth(admin, referral.referrer_id, refereeId, referral.id, "not_eligible");
  } else {
    const { data: claimed, error } = await admin.rpc("claim_referral_reward", {
      p_referral_id: referral.id,
      p_monthly_cap: REFERRAL_MONTHLY_CAP,
      p_lifetime_cap: REFERRAL_LIFETIME_CAP,
    });
    if (error) {
      console.warn(`[referrals] claim ${referral.id} failed:`, error.message);
      return { status: "none" };
    }
    if (claimed === "rewarded") outcome = "rewarded";
    else if (claimed === "capped_month" || claimed === "capped_lifetime") {
      outcome = "capped";
      await notifyNoMonth(admin, referral.referrer_id, refereeId, referral.id, claimed);
    } else return { status: "none" }; // claimed elsewhere (a concurrent run)
  }

  const granted = await grantOwedSides(
    admin,
    {
      ...referral,
      status: outcome,
      referrer_reward: outcome === "rewarded" ? null : "none",
      referee_reward: null,
    },
    { ...deps, profiles: { [referral.referrer_id]: referrer, [refereeId]: referee } },
  );
  if (outcome === "blocked") {
    return { status: "blocked", reason: verdict.block as ReferralBlockReason, referee: granted.referee };
  }
  return { status: outcome, referrer: granted.referrer, referee: granted.referee };
}

/** first_card → a final state, only if the row is still first_card (two
 *  runs can't both settle it). True when this call moved it. */
async function settleFirstCard(
  admin: AdminClient,
  id: string,
  patch: Database["public"]["Tables"]["referrals"]["Update"],
): Promise<boolean> {
  const { data } = await admin
    .from("referrals")
    .update(patch)
    .eq("id", id)
    .eq("status", "first_card")
    .select("id");
  return (data?.length ?? 0) > 0;
}

/**
 * Grant each side whose reward is still NULL on a claimed row (rewarded,
 * capped or blocked-for-the-referrer-only). Idempotent: a Plus month is
 * written by the database only while the side is NULL; a balance credit
 * carries Stripe's idempotency key and is recorded only while NULL. A failure
 * leaves the side NULL and counts an attempt — the sweep tries again, and
 * past REFERRAL_GRANT_MAX_ATTEMPTS records "none" (grant_failed).
 */
export async function grantOwedSides(
  admin: AdminClient,
  referral: ReferralRow,
  deps: RewardDeps & { profiles?: Record<string, ReferralRewardProfile | null> } = {},
): Promise<{ referrer: GrantedMonth | null; referee: GrantedMonth | null }> {
  const result: { referrer: GrantedMonth | null; referee: GrantedMonth | null } = { referrer: null, referee: null };
  if (!(deps.billingEnabled ?? isBillingEnabled())) return result;
  let failed = false;
  for (const side of ["referee", "referrer"] as const) {
    const owed = side === "referrer" ? referral.referrer_reward : referral.referee_reward;
    if (owed != null) continue;
    if (side === "referrer" && referral.status !== "rewarded") continue;
    const userId = side === "referrer" ? referral.referrer_id : referral.referee_id;
    const otherId = side === "referrer" ? referral.referee_id : referral.referrer_id;
    if (!userId) {
      await recordSide(admin, referral.id, side, { kind: "none", reason: "account_deleted" });
      result[side] = { kind: "none", reason: "account_deleted" };
      continue;
    }
    const month = await grantSide(admin, referral.id, side, userId, deps);
    if (month === "failed") {
      failed = true;
      continue;
    }
    result[side] = month;
    if (month.kind !== "none") {
      await notify(admin, {
        recipientId: userId,
        actorId: otherId,
        type: "referral_reward",
        payload: { referralId: referral.id, side, ...rewardPayload(month) },
      });
    }
  }
  if (failed) {
    const attempts = (referral.grant_attempts ?? 0) + 1;
    await admin.from("referrals").update({ grant_attempts: attempts }).eq("id", referral.id);
    if (attempts >= REFERRAL_GRANT_MAX_ATTEMPTS) {
      for (const side of ["referee", "referrer"] as const) {
        if (result[side] != null) continue;
        if (side === "referrer" && referral.status !== "rewarded") continue;
        const owed = side === "referrer" ? referral.referrer_reward : referral.referee_reward;
        if (owed != null) continue;
        await recordSide(admin, referral.id, side, { kind: "none", reason: "grant_failed" });
        result[side] = { kind: "none", reason: "grant_failed" };
      }
    }
  }
  return result;
}

/** One side's month. "failed" leaves the side owed for the sweep. */
async function grantSide(
  admin: AdminClient,
  referralId: string,
  side: Side,
  userId: string,
  deps: RewardDeps & { profiles?: Record<string, ReferralRewardProfile | null> },
): Promise<GrantedMonth | "failed"> {
  const stripe = deps.stripe ?? null;
  try {
    let profile = deps.profiles?.[userId] ?? null;
    if (!profile) {
      const { data } = await admin.from("profiles").select(REWARD_PROFILE_COLUMNS).eq("id", userId).maybeSingle();
      profile = (data as ReferralRewardProfile | null) ?? null;
    }
    if (!profile) {
      await recordSide(admin, referralId, side, { kind: "none", reason: "no_profile" });
      return { kind: "none", reason: "no_profile" };
    }
    let plan = planReferralMonth(profile, deps.now ?? new Date());
    // A renewing plan with no Stripe to credit (no key): a Plus month
    // instead — never nothing.
    if (plan.kind === "balance_credit" && !stripe) plan = { kind: "plus_month" };

    if (plan.kind === "none") {
      const month: GrantedMonth = { kind: "none", reason: plan.reason };
      await recordSide(admin, referralId, side, month);
      return month;
    }
    if (plan.kind === "plus_month") {
      // The month AND its one Plus allotment of credits, atomically, under
      // the user's lock, once per referral and side (0164).
      const { data, error } = await admin.rpc("grant_referral_plus_month", {
        p_referral_id: referralId,
        p_side: side,
        p_days: REFERRAL_MONTH_DAYS,
        p_credits: MONTHLY_CREDITS.plus,
      });
      if (error) throw new Error(error.message);
      const detail = (data ?? null) as Record<string, unknown> | null;
      if (!detail) {
        await recordSide(admin, referralId, side, { kind: "none", reason: "account_deleted" });
        return { kind: "none", reason: "account_deleted" };
      }
      if (detail.kind !== "plus_month") return { kind: "none", reason: String(detail.reason ?? "decided") };
      return {
        kind: "plus_month",
        tier: "plus",
        startsAt: String(detail.startsAt),
        expiresAt: String(detail.expiresAt),
        credits: Number(detail.credits ?? 0),
      };
    }
    const sub = await (stripe as Stripe).subscriptions.retrieve(plan.subscriptionId);
    const price = sub.items?.data?.[0]?.price ?? null;
    const amountCents = oneMonthCents(price, plan.tier);
    const currency = price?.currency ?? "usd";
    // main's one balance-credit writer (lib/billing/balance-credit.ts). Its
    // metadata names the referral, never the comp ledger's key, so an admin
    // comp's credit / claw-back never counts it.
    await creditCustomerBalance(stripe as Stripe, {
      customerId: plan.customerId,
      cents: amountCents,
      currency,
      description: "PipGlyph referral — one free month",
      metadata: { referral_id: referralId, side },
      idempotencyKey: `referral:${referralId}:${side}`,
    });
    const month: GrantedMonth = { kind: "balance_credit", amountCents, currency };
    await recordSide(admin, referralId, side, month);
    return month;
  } catch (error) {
    console.error(
      `[referrals] ${side} month for ${userId} (${referralId}) failed:`,
      error instanceof Error ? error.message : error,
    );
    return "failed";
  }
}

/** Write a side's outcome — only while it is still NULL. */
async function recordSide(admin: AdminClient, referralId: string, side: Side, month: GrantedMonth): Promise<void> {
  const patch =
    side === "referrer"
      ? { referrer_reward: month.kind, referrer_reward_detail: month }
      : { referee_reward: month.kind, referee_reward_detail: month };
  await admin
    .from("referrals")
    .update(patch)
    .eq("id", referralId)
    .is(side === "referrer" ? "referrer_reward" : "referee_reward", null);
}

export type ReferralSweepResult =
  | { ok: true; skipped: "billing_off" }
  | { ok: true; claimed: number; waiting: number; retried: number; failed: number }
  | { ok: false; error: string };

/**
 * The cron's sweep (/api/cron/referral-rewards): finish what the first-card
 * step didn't — a row whose emails weren't confirmed yet, a run that died in
 * `after()`, a grant that failed. Idempotent; does nothing while billing is
 * off.
 */
export async function sweepReferralRewards(admin: AdminClient, deps: RewardDeps = {}): Promise<ReferralSweepResult> {
  if (!(deps.billingEnabled ?? isBillingEnabled())) return { ok: true, skipped: "billing_off" };
  let claimed = 0;
  let waiting = 0;
  let retried = 0;
  let failed = 0;

  const { data: pending, error } = await admin
    .from("referrals")
    .select(REFERRAL_ROW_COLUMNS)
    .eq("status", "first_card")
    .order("first_card_at", { ascending: true })
    .limit(REFERRAL_SWEEP_BATCH);
  if (error) return { ok: false, error: error.message };
  for (const row of (pending ?? []) as ReferralRow[]) {
    const result = await rewardReferral(admin, row, { ...deps, billingEnabled: true });
    if (result.status === "waiting") waiting += 1;
    else if (result.status !== "none") claimed += 1;
  }

  const { data: owed, error: owedError } = await admin
    .from("referrals")
    .select(REFERRAL_ROW_COLUMNS)
    .in("status", ["rewarded", "capped", "blocked"])
    .or("referrer_reward.is.null,referee_reward.is.null")
    .order("rewarded_at", { ascending: true })
    .limit(REFERRAL_SWEEP_BATCH);
  if (owedError) return { ok: false, error: owedError.message };
  for (const row of (owed ?? []) as ReferralRow[]) {
    const before = [row.referrer_reward, row.referee_reward];
    const granted = await grantOwedSides(admin, row, { ...deps, billingEnabled: true });
    retried += 1;
    const stillOwed =
      (before[1] == null && granted.referee == null) ||
      (row.status === "rewarded" && before[0] == null && granted.referrer == null);
    if (stillOwed) failed += 1;
  }
  return { ok: true, claimed, waiting, retried, failed };
}

/** Keep a referred account's email fingerprint: the FIRST referral that saw
 *  it keeps it (insert, never overwrite). No key or no email: nothing kept
 *  here — the reward step tries again (and fails closed without a key). */
async function recordEmailFingerprint(
  admin: AdminClient,
  referralId: string,
  email: string | null,
): Promise<void> {
  const key = referralEmailHashKey();
  if (!key) {
    console.error(`[referrals] ${referralId}: REFERRAL_EMAIL_HASH_KEY is not set — no email fingerprint kept.`);
    return;
  }
  const fingerprint = referralEmailFingerprint(email, key);
  if (!fingerprint) return;
  const { error } = await admin
    .from("referral_email_fingerprints")
    .upsert({ fingerprint, referral_id: referralId }, { onConflict: "fingerprint", ignoreDuplicates: true });
  if (error) console.warn(`[referrals] fingerprint for ${referralId} not kept:`, error.message);
}

/**
 * The friend's email has earned (or is) someone else's (owner 2026-11-02):
 * (a) the normalized address of ANY OTHER live account — the referrer's
 *     included — read in the database (referral_email_in_use: the app never
 *     lists addresses);
 * (b) a fingerprint an EARLIER referral signup left (it outlives the account).
 * Records this referral's fingerprint when it is new (the email may have
 * changed since signup). "error" = couldn't tell: the row waits.
 */
async function emailReused(
  admin: AdminClient,
  referralId: string,
  refereeId: string,
  email: string | null,
  key: string,
): Promise<boolean | "error"> {
  const normalized = normalizeReferralEmail(email);
  const fingerprint = referralEmailFingerprint(email, key);
  // No address that normalizes: nothing to hold it to — not eligible.
  if (!normalized || !fingerprint) return true;
  try {
    const { data: inUse, error } = await admin.rpc("referral_email_in_use", {
      p_user_id: refereeId,
      p_normalized: normalized,
    });
    if (error) throw new Error(error.message);
    if (inUse === true) return true;

    const { data: seen, error: seenError } = await admin
      .from("referral_email_fingerprints")
      .select("referral_id")
      .eq("fingerprint", fingerprint)
      .maybeSingle();
    if (seenError) throw new Error(seenError.message);
    if (seen) return seen.referral_id !== referralId;
    await recordEmailFingerprint(admin, referralId, email);
    return false;
  } catch (error) {
    console.warn(`[referrals] email check for ${referralId} failed:`, error instanceof Error ? error.message : error);
    return "error";
  }
}

function rewardPayload(month: GrantedMonth): Record<string, string | number> {
  if (month.kind === "plus_month") {
    return { reward: "plus_month", tier: "plus", until: month.expiresAt, credits: month.credits };
  }
  if (month.kind === "balance_credit") {
    return { reward: "balance_credit", amountCents: month.amountCents, currency: month.currency };
  }
  return { reward: "none" };
}

async function authUserOf(
  admin: AdminClient,
  userId: string,
): Promise<{ email: string | null; confirmed: boolean } | null> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    const user = data?.user;
    if (!user) return null;
    return { email: user.email ?? null, confirmed: Boolean(user.email_confirmed_at) };
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

/** The referrer's ONE word when a friend qualified but earned them no month
 *  (a cap, or not eligible) — the rewarded case is the reward notification. */
async function notifyNoMonth(
  admin: AdminClient,
  referrerId: string,
  refereeId: string,
  referralId: string,
  outcome: "capped_month" | "capped_lifetime" | "not_eligible",
): Promise<void> {
  await notify(admin, {
    recipientId: referrerId,
    actorId: refereeId,
    type: "referral_signup",
    payload: { referralId, outcome },
  });
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
  // 23505: already told (0164's once-per-referral index).
  if (error && error.code !== "23505") {
    console.warn(`[referrals] ${input.type} notification failed:`, error.message);
  }
}
