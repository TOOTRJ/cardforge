import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/supabase";
import {
  REFERRAL_ACTIVATION_WINDOW_DAYS,
  REFERRAL_CLAIM_WINDOW_DAYS,
  REFERRAL_CONFIRM_WINDOW_DAYS,
  REFERRAL_GRANT_MAX_ATTEMPTS,
  REFERRAL_SWEEP_BATCH,
  normalizeReferralCode,
} from "@/lib/referrals/rules";
import { normalizeReferralEmail, referralFraudVerdict, type ReferralBlockReason } from "@/lib/referrals/fraud";
import { referralEmailFingerprint, referralEmailHashKey } from "@/lib/referrals/email-fingerprint";
import { referralRewardFor, type ReferralRewardProfile } from "@/lib/referrals/reward";
import { readReferralSettings } from "@/lib/referrals/settings-server";
import type { ReferralSettings } from "@/lib/referrals/settings";
import { grantFreeDays } from "@/lib/billing/free-days-apply";
import { FREE_DAYS_UNIT_DAYS } from "@/lib/billing/free-days";
import { isBillingEnabled } from "@/lib/billing/flags";

// ---------------------------------------------------------------------------
// The referral program's server side — the service role only (0177: users
// read their rows, nobody but the server writes them). Entry points:
//
//   recordReferralSignup  a NEW account arrived through a link — claimed at
//                         ONBOARDING, the first step with a CONFIRMED email
//                         (never at signup: GoTrue hands an unconfirmed
//                         address the same user id, so a row written then
//                         let anyone claim a referral on an inbox they don't
//                         own): one `referrals` row (unique per referee —
//                         the first claim wins). Nobody is told yet: nothing
//                         is earned until the friend qualifies. Nothing is
//                         recorded while the program is OFF (the settings).
//   qualifyReferral       the account saved its FIRST card (createCardAction,
//                         on the first_card_saved milestone): signed_up →
//                         first_card (one-shot), the activation window, then
//                         the reward step at once (owner 2026-11-02: no hold).
//   rewardReferral        a first_card row: the program ON (else the row
//                         WAITS — a pause, not a kill), both emails
//                         CONFIRMED (else it waits — the sweep looks
//                         again), the fraud rules, the caps
//                         (claim_referral_reward, atomic; the settings'
//                         numbers), then each side's reward (grantOwedSides).
//   sweepReferralRewards  the cron's retry (/api/cron/referral-rewards):
//                         signed_up rows whose first card the `after()` lost,
//                         first_card rows not claimed yet, and claimed rows
//                         with a side still owed.
//
// WHAT a side gets is the settings' reward spec (lib/referrals/settings.ts,
// read at grant time) made concrete by lib/referrals/reward.ts: free days
// through lib/billing/free-days-apply.ts `grantFreeDays` — the ONE
// mechanism comps use (0176: added to a paying plan's time, the perks
// overlay otherwise, nothing below the plan paid for; the grant's own
// credits) under the reference `referral:<id>:<side>` (unique: a retry
// finds the grant it made) — or AI credits through grant_credits under the
// same key, or nothing. No money moves. Nothing here runs while billing is
// off (NEXT_PUBLIC_BILLING_ENABLED): the rows wait. Every step is best
// effort for the CALLER: a referral never fails a signup or a save. A side's
// reward column is written once, so the sweep can retry anything.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

const DAY_MS = 86_400_000;
/** A signed_up row this old whose friend has a card missed its first-card step. */
const STRANDED_AFTER_MS = 10 * 60_000;

const REWARD_PROFILE_COLUMNS = "is_admin, subscription_tier, subscription_status, stripe_customer_id";

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

export type RewardDeps = {
  stripe?: Stripe | null;
  now?: Date;
  billingEnabled?: boolean;
  /** The program's settings (read from site_settings when absent). */
  settings?: ReferralSettings;
};

export type RecordReferralSignupResult =
  | { ok: true; referralId: string }
  | { ok: false; reason: "bad_code" | "unknown_code" | "self" | "not_new" | "exists" | "error" | "program_off" };

export async function recordReferralSignup(
  admin: AdminClient,
  input: { refereeId: string; code: unknown; now?: Date; settings?: ReferralSettings },
): Promise<RecordReferralSignupResult> {
  const code = normalizeReferralCode(input.code);
  if (!code) return { ok: false, reason: "bad_code" };
  const now = input.now ?? new Date();
  try {
    const settings = input.settings ?? (await readReferralSettings(admin));
    if (!settings.enabled) return { ok: false, reason: "program_off" };
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

export type GrantedReward =
  | {
      kind: "free_days";
      tier: "plus" | "pro";
      days: number;
      /** The free days' end (ISO; an overlay from now, a hold from the paid period's end). */
      endsAt: string | null;
      /** A hold: the moved charge / trial end. */
      holdEndsAt: string | null;
      /** How lib/billing/free-days.ts applied them. */
      appliedAs: "overlay" | "subscription_hold" | "below_plan";
      grantId: string | null;
    }
  | { kind: "credits"; credits: number }
  | { kind: "none"; reason: string };

export type RewardReferralResult =
  | { status: "none" }
  | { status: "expired" }
  | { status: "waiting"; reason: "billing_off" | "program_off" | "email_unconfirmed" | "hash_key_missing" | "check_failed" }
  | { status: "blocked"; reason: ReferralBlockReason; referee: GrantedReward | null }
  | { status: "rewarded" | "capped"; referrer: GrantedReward | null; referee: GrantedReward | null };

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
  const settings = deps.settings ?? (await readReferralSettings(admin));
  // The program is PAUSED (an admin's switch): the row waits — the sweep
  // rewards it once the program is on again, or the confirm window below
  // expires it. Nothing is granted, nobody told, while it is off.
  if (!settings.enabled) return { status: "waiting", reason: "program_off" };

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

  // The claim (atomic, the settings' caps): a referrer-only block
  // (same_domain — the friend keeps theirs, the referrer gets none) goes
  // through it too, so those friends count toward the friends cap.
  let outcome: "rewarded" | "capped" | "blocked";
  const { data: claimed, error } = await admin.rpc("claim_referral_reward", {
    p_referral_id: referral.id,
    p_monthly_cap: settings.caps.perMonth,
    p_lifetime_cap: settings.caps.lifetime,
    p_friends_cap: settings.caps.friendsPerMonth,
    ...(verdict.block ? { p_block_reason: verdict.block } : {}),
  });
  if (error) {
    console.warn(`[referrals] claim ${referral.id} failed:`, error.message);
    return { status: "none" };
  }
  if (claimed === "rewarded") outcome = "rewarded";
  else if (claimed === "blocked") {
    outcome = "blocked";
    await notifyNoMonth(admin, referral.referrer_id, refereeId, referral.id, "not_eligible");
  } else if (claimed === "capped_month" || claimed === "capped_lifetime" || claimed === "capped_friends") {
    outcome = "capped";
    await notifyNoMonth(admin, referral.referrer_id, refereeId, referral.id, claimed);
    // The friends cap: the friend's side is 'none' too (the database wrote it).
    if (claimed === "capped_friends") return { status: "capped", referrer: null, referee: null };
  } else return { status: "none" }; // claimed elsewhere (a concurrent run)

  const granted = await grantOwedSides(
    admin,
    {
      ...referral,
      status: outcome,
      referrer_reward: outcome === "rewarded" ? null : "none",
      referee_reward: null,
    },
    { ...deps, settings, profiles: { [referral.referrer_id]: referrer, [refereeId]: referee } },
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
 * capped or blocked-for-the-referrer-only). Idempotent: a free-days grant
 * carries the reference `referral:<id>:<side>` (unique — a retry finds it),
 * credits the same ledger key, and a side is recorded only while NULL. A
 * failure leaves the side NULL and counts an attempt — the sweep tries
 * again, and past REFERRAL_GRANT_MAX_ATTEMPTS records "none" (grant_failed).
 */
export async function grantOwedSides(
  admin: AdminClient,
  referral: ReferralRow,
  deps: RewardDeps & { profiles?: Record<string, ReferralRewardProfile | null> } = {},
): Promise<{ referrer: GrantedReward | null; referee: GrantedReward | null }> {
  const result: { referrer: GrantedReward | null; referee: GrantedReward | null } = { referrer: null, referee: null };
  if (!(deps.billingEnabled ?? isBillingEnabled())) return result;
  const settings = deps.settings ?? (await readReferralSettings(admin));
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
    const reward = await grantSide(admin, referral.id, side, userId, { ...deps, settings });
    if (reward === "deferred") continue;
    if (reward === "failed") {
      failed = true;
      continue;
    }
    result[side] = reward;
    if (reward.kind !== "none") {
      await notify(admin, {
        recipientId: userId,
        actorId: otherId,
        type: "referral_reward",
        payload: { referralId: referral.id, side, ...rewardPayload(reward) },
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

/** The ledger key / grant reference of one side: once per referral and side. */
export function referralRewardKey(referralId: string, side: Side): string {
  return `referral:${referralId}:${side}`;
}

/** One side's reward. "failed" leaves the side owed for the sweep (an
 *  attempt counted); "deferred" leaves it owed with NO attempt counted (a
 *  plan under a scheduled change — the sweep tries again until it lands). */
async function grantSide(
  admin: AdminClient,
  referralId: string,
  side: Side,
  userId: string,
  deps: RewardDeps & { settings: ReferralSettings; profiles?: Record<string, ReferralRewardProfile | null> },
): Promise<GrantedReward | "failed" | "deferred"> {
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
    const spec = side === "referee" ? deps.settings.friend : deps.settings.referrer;
    const plan = referralRewardFor(spec, profile);
    const reference = referralRewardKey(referralId, side);

    if (plan.kind === "none") {
      const reward: GrantedReward = { kind: "none", reason: plan.reason };
      await recordSide(admin, referralId, side, reward);
      return reward;
    }
    if (plan.kind === "credits") {
      const { error } = await admin.rpc("grant_credits", {
        p_user_id: userId,
        p_amount: plan.amount,
        p_reason: "referral_credits",
        p_idempotency_key: reference,
      });
      if (error) throw new Error(error.message);
      const reward: GrantedReward = { kind: "credits", credits: plan.amount };
      await recordSide(admin, referralId, side, reward);
      return reward;
    }
    // Free days: the one mechanism (lib/billing/free-days.ts). The reference
    // makes a retried call find the grant it already made.
    const granted = await grantFreeDays(
      admin,
      {
        userId,
        tier: plan.tier,
        units: plan.units,
        source: side === "referee" ? "referral_friend" : "referral_referrer",
        grantedBy: null,
        note: null,
        reference,
      },
      { now: deps.now, ...(deps.stripe ? { stripe: deps.stripe } : {}) },
    );
    let reward: GrantedReward;
    if (granted.ok) {
      reward = {
        kind: "free_days",
        tier: plan.tier,
        days: plan.units * FREE_DAYS_UNIT_DAYS,
        endsAt: granted.endsAt,
        holdEndsAt: granted.holdEndsAt,
        appliedAs:
          granted.plan.kind === "hold" ? "subscription_hold" : granted.plan.kind === "below_plan" ? "below_plan" : "overlay",
        grantId: granted.grantId,
      };
    } else if (granted.code === "duplicate_reference") {
      // Granted by an earlier run whose record write was lost: read it back.
      const { data } = await admin
        .from("plan_grants")
        .select("id, tier, units, ends_at, applied_as, status")
        .eq("reference", reference)
        .maybeSingle();
      const row = data as { id: string; tier: "plus" | "pro"; units: number | null; ends_at: string | null; applied_as: string; status: string } | null;
      // Only a grant that APPLIED (or was revoked since) is a reward made:
      // a pending one is still in flight (the sweep looks again), a failed
      // one that kept its reference never finished (an admin's to look at).
      if (!row || row.status === "pending" || row.status === "failed") throw new Error(granted.error);
      const appliedAs = row.applied_as as "overlay" | "subscription_hold" | "below_plan";
      reward = {
        kind: "free_days",
        tier: row.tier,
        days: (row.units ?? 0) * FREE_DAYS_UNIT_DAYS,
        endsAt: row.ends_at,
        // A hold's end IS the moved charge / trial end.
        holdEndsAt: appliedAs === "subscription_hold" ? row.ends_at : null,
        appliedAs,
        grantId: row.id,
      };
    } else if (granted.code === "in_flight") {
      // Another grant for this user is being applied: the sweep retries.
      throw new Error(granted.error);
    } else {
      // The decision refused. An admin: NONE for good. A plan under a
      // scheduled change (a pending downgrade): DEFERRED — the sweep tries
      // again each hour, no attempt counted, until the change lands and the
      // days can be added. Anything else that can clear (a renewal in
      // flight, Stripe unreadable): a counted retry.
      if (/admin/i.test(granted.error)) {
        const reward0: GrantedReward = { kind: "none", reason: "admin" };
        await recordSide(admin, referralId, side, reward0);
        return reward0;
      }
      console.warn(`[referrals] ${side} free days for ${userId} (${referralId}) refused: ${granted.error}`);
      if (/scheduled change/i.test(granted.error)) return "deferred";
      throw new Error(granted.error);
    }
    await recordSide(admin, referralId, side, reward);
    return reward;
  } catch (error) {
    console.error(
      `[referrals] ${side} reward for ${userId} (${referralId}) failed:`,
      error instanceof Error ? error.message : error,
    );
    return "failed";
  }
}

/** Write a side's outcome — only while it is still NULL. */
async function recordSide(admin: AdminClient, referralId: string, side: Side, reward: GrantedReward): Promise<void> {
  const patch =
    side === "referrer"
      ? { referrer_reward: reward.kind, referrer_reward_detail: reward }
      : { referee_reward: reward.kind, referee_reward_detail: reward };
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
export async function sweepReferralRewards(admin: AdminClient, deps0: RewardDeps = {}): Promise<ReferralSweepResult> {
  if (!(deps0.billingEnabled ?? isBillingEnabled())) return { ok: true, skipped: "billing_off" };
  const deps: RewardDeps = { ...deps0, settings: deps0.settings ?? (await readReferralSettings(admin)) };
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

  // A signup whose friend never saved a card inside the activation window
  // is over (the dashboard's "waiting for their first card" ends; the
  // stranded read below never fills with them).
  const now = deps.now ?? new Date();
  await admin
    .from("referrals")
    .update({ status: "expired", referrer_reward: "none", referee_reward: "none" })
    .eq("status", "signed_up")
    .lt("signed_up_at", new Date(now.getTime() - REFERRAL_ACTIVATION_WINDOW_DAYS * DAY_MS).toISOString());

  // A first card whose `after()` was lost (the response went out, the step
  // never ran): a signed_up row older than a few minutes — and inside the
  // activation window — whose friend has a card is qualified here (the
  // independent check's "stranded row").
  const { data: stranded, error: strandedError } = await admin
    .from("referrals")
    .select("id, referee_id")
    .eq("status", "signed_up")
    .lt("signed_up_at", new Date(now.getTime() - STRANDED_AFTER_MS).toISOString())
    .gte("signed_up_at", new Date(now.getTime() - REFERRAL_ACTIVATION_WINDOW_DAYS * DAY_MS).toISOString())
    .order("signed_up_at", { ascending: true })
    .limit(REFERRAL_SWEEP_BATCH);
  if (strandedError) return { ok: false, error: strandedError.message };
  for (const row of (stranded ?? []) as Array<{ id: string; referee_id: string | null }>) {
    if (!row.referee_id) continue;
    const { count } = await admin.from("cards").select("id", { count: "exact", head: true }).eq("owner_id", row.referee_id);
    if ((count ?? 0) === 0) continue;
    const result = await qualifyReferral(admin, row.referee_id, { ...deps, billingEnabled: true });
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

function rewardPayload(reward: GrantedReward): Record<string, string | number> {
  if (reward.kind === "free_days") {
    return {
      reward: "free_days",
      tier: reward.tier,
      days: reward.days,
      appliedAs: reward.appliedAs,
      ...(reward.endsAt ? { until: reward.endsAt } : {}),
      ...(reward.holdEndsAt ? { holdEndsAt: reward.holdEndsAt } : {}),
    };
  }
  if (reward.kind === "credits") return { reward: "credits", credits: reward.credits };
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

/** The referrer's ONE word when a friend qualified but earned them no reward
 *  (a cap, or not eligible) — the rewarded case is the reward notification. */
async function notifyNoMonth(
  admin: AdminClient,
  referrerId: string,
  refereeId: string,
  referralId: string,
  outcome: "capped_month" | "capped_lifetime" | "capped_friends" | "not_eligible",
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
  // 23505: already told (0177's once-per-referral index).
  if (error && error.code !== "23505") {
    console.warn(`[referrals] ${input.type} notification failed:`, error.message);
  }
}
