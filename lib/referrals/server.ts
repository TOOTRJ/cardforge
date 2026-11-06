import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/supabase";
import {
  REFERRAL_CLAIM_WINDOW_DAYS,
  REFERRAL_CONFIRM_WINDOW_DAYS,
  REFERRAL_GRANT_MAX_ATTEMPTS,
  REFERRAL_SWEEP_BATCH,
  normalizeReferralCode,
} from "@/lib/referrals/rules";
import { normalizeReferralEmail, referralFraudVerdict, type ReferralBlockReason } from "@/lib/referrals/fraud";
import { referralEmailFingerprint, referralEmailHashKey } from "@/lib/referrals/email-fingerprint";
import { friendRewardFor, referrerRewardFor, type ReferralRewardProfile } from "@/lib/referrals/reward";
import { readReferralSettings } from "@/lib/referrals/settings-server";
import type { ReferralSettings } from "@/lib/referrals/settings";
import { bankDays, releaseStaleReservations } from "@/lib/billing/day-bank";
import { isBillingEnabled } from "@/lib/billing/flags";

// ---------------------------------------------------------------------------
// The referral program's server side, v2 (owner 2026-11-06; migration 0180)
// — the service role only (0177: users read their rows, nobody but the
// server writes them). Entry points:
//
//   recordReferralSignup  a NEW account arrived through a link — claimed at
//                         ONBOARDING, the first step with a CONFIRMED email
//                         (never at signup: GoTrue hands an unconfirmed
//                         address the same user id): one `referrals` row
//                         (unique per referee — the first claim wins).
//                         Nobody is told yet. Nothing is recorded while the
//                         program is OFF (the settings).
//   advanceReferral       the friend did something: saved a card
//                         (createCardAction, every save) or started a plan
//                         with a card on file (the webhook, the
//                         subscription's creation). The row QUALIFIES when
//                         both stand — `cards_saved_at` (the settings'
//                         `activation.cardsRequired` cards within
//                         `activation.windowDays` of signing up) and
//                         `card_on_file_at` — and the reward step runs at
//                         once. `qualifyReferral` is the card-save hook's
//                         name for it.
//   preBankFriendDays     the friend's checkout (lib/stripe/actions.ts): a
//                         friend who has the cards and is about to put a card
//                         on file gets their days BANKED before the checkout
//                         reserves the bank — so the qualifying checkout is
//                         the one that applies them (owner 2026-11-06).
//   rewardReferral        a qualified row: the program ON (else it WAITS),
//                         both emails CONFIRMED (else it waits), the fraud
//                         rules, the claim (claim_referral_reward_v2: the
//                         friends cap, the referrer's LADDER STEP under
//                         their lock), then each side's reward
//                         (grantOwedSides).
//   sweepReferralRewards  the cron's retry (/api/cron/referral-rewards):
//                         rows a lost `after()` or webhook left behind,
//                         qualified rows not claimed yet, claimed rows with
//                         a side still owed, expiries — and the bank's
//                         stale reservations.
//
// WHAT a side gets is the settings' (lib/referrals/settings.ts, read at
// grant time) made concrete by lib/referrals/reward.ts: DAYS into the days
// bank (lib/billing/day-bank.ts — a free period the user applies with a
// card on file; the bank is tier-less) under the reference
// `referral:<id>:referee` / `referral-step:<referrer>:<step>` (unique: a
// retry finds the entry it made), or AI credits through grant_credits under
// the same key, or nothing. No money moves. Nothing here runs while billing
// is off: the rows wait. Every step is best effort for the CALLER: a
// referral never fails a signup, a save or a webhook. A side's reward
// column is written once, so the sweep can retry anything.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

const DAY_MS = 86_400_000;
/** A signed_up row this old whose friend has the cards missed its step. */
const STRANDED_AFTER_MS = 10 * 60_000;
/** A card on file: a Stripe subscription the profile points at, in a state
 *  Stripe only gives a subscription with a payment method. */
const CARD_ON_FILE_STATUSES = new Set(["trialing", "active", "past_due", "unpaid"]);

const REWARD_PROFILE_COLUMNS = "is_admin, subscription_tier, subscription_status, stripe_customer_id, stripe_subscription_id";

const REFERRAL_ROW_COLUMNS =
  "id, referrer_id, referee_id, status, block_reason, first_card_at, cards_saved_at, card_on_file_at, ladder_step, referrer_reward, referee_reward, grant_attempts, signed_up_at";

export type ReferralRow = {
  id: string;
  referrer_id: string;
  referee_id: string | null;
  status: string;
  block_reason?: string | null;
  first_card_at: string | null;
  cards_saved_at: string | null;
  card_on_file_at: string | null;
  ladder_step: number | null;
  referrer_reward: string | null;
  referee_reward: string | null;
  grant_attempts?: number | null;
  signed_up_at: string;
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
    // Under the bar's cards (a guest draft saved before onboarding is no
    // reason to refuse); at or past it the account isn't new to the program.
    const { count } = await admin
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", input.refereeId);
    if ((count ?? 0) >= settings.activation.cardsRequired) return { ok: false, reason: "not_new" };

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
  | { kind: "banked_days"; days: number; entryId: string | null; step?: number }
  | { kind: "credits"; credits: number; step?: number }
  | { kind: "none"; reason: string };

export type RewardReferralResult =
  | { status: "none" }
  | { status: "expired" }
  | { status: "waiting"; reason: "billing_off" | "program_off" | "email_unconfirmed" | "hash_key_missing" | "check_failed" | "not_qualified" }
  | { status: "blocked"; reason: ReferralBlockReason; referee: GrantedReward | null }
  | { status: "rewarded" | "capped"; referrer: GrantedReward | null; referee: GrantedReward | null; step?: number | null };

export type QualifyReferralResult = RewardReferralResult;

/** The friend's own row, in a state that can still move. */
async function openRowOf(admin: AdminClient, refereeId: string): Promise<ReferralRow | null> {
  const { data } = await admin
    .from("referrals")
    .select(REFERRAL_ROW_COLUMNS)
    .eq("referee_id", refereeId)
    .in("status", ["signed_up", "first_card", "cards_saved"])
    .maybeSingle();
  return (data as ReferralRow | null) ?? null;
}

function qualifiedAt(row: ReferralRow): string | null {
  return row.cards_saved_at ?? row.first_card_at;
}

/**
 * The friend did something that may qualify the referral: a saved card or a
 * card on file. Reads the row, judges both conditions, stamps what is new
 * (the cards stamp moves the status to `cards_saved`; a row past the window
 * expires), and runs the reward step once both stand.
 */
export async function advanceReferral(
  admin: AdminClient,
  refereeId: string,
  deps: RewardDeps = {},
): Promise<QualifyReferralResult> {
  const now = deps.now ?? new Date();
  const row = await openRowOf(admin, refereeId);
  if (!row) return { status: "none" };
  const settings = deps.settings ?? (await readReferralSettings(admin));
  const windowMs = settings.activation.windowDays * DAY_MS;

  let cardsAt = qualifiedAt(row);
  if (!cardsAt) {
    const { count } = await admin.from("cards").select("id", { count: "exact", head: true }).eq("owner_id", refereeId);
    if ((count ?? 0) >= settings.activation.cardsRequired) {
      if (now.getTime() - Date.parse(row.signed_up_at) > windowMs) {
        await admin
          .from("referrals")
          .update({ status: "expired", referrer_reward: "none", referee_reward: "none" })
          .eq("id", row.id)
          .in("status", ["signed_up", "first_card", "cards_saved"]);
        return { status: "expired" };
      }
      // signed_up → cards_saved, once: a later save (or a retry) finds the stamp.
      const { data: moved } = await admin
        .from("referrals")
        .update({ status: "cards_saved", cards_saved_at: now.toISOString(), first_card_at: now.toISOString() })
        .eq("id", row.id)
        .eq("status", "signed_up")
        .select("id");
      if ((moved?.length ?? 0) > 0 || row.status !== "signed_up") cardsAt = now.toISOString();
    }
  }

  let cardAt = row.card_on_file_at;
  if (!cardAt) {
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_subscription_id, subscription_status")
      .eq("id", refereeId)
      .maybeSingle();
    const p = profile as { stripe_subscription_id: string | null; subscription_status: string | null } | null;
    if (p?.stripe_subscription_id && CARD_ON_FILE_STATUSES.has(p.subscription_status ?? "")) {
      const { data: stamped } = await admin
        .from("referrals")
        .update({ card_on_file_at: now.toISOString() })
        .eq("id", row.id)
        .is("card_on_file_at", null)
        .select("id");
      if ((stamped?.length ?? 0) > 0) cardAt = now.toISOString();
    }
  }

  if (!cardsAt || !cardAt) return { status: "waiting", reason: "not_qualified" };
  return rewardReferral(
    admin,
    { ...row, status: row.status === "signed_up" ? "cards_saved" : row.status, cards_saved_at: cardsAt, card_on_file_at: cardAt },
    { ...deps, settings },
  );
}

/** The card-save hook's name (lib/cards/actions.ts): every save of a friend's
 *  account looks at the row; one read when there is none to move. */
export async function qualifyReferral(admin: AdminClient, refereeId: string, deps: RewardDeps = {}): Promise<QualifyReferralResult> {
  return advanceReferral(admin, refereeId, deps);
}

/**
 * The friend's checkout (lib/stripe/actions.ts), before the bank is
 * reserved: a friend who has the cards and no card on file yet is about to
 * qualify with THIS checkout — their days are banked now, so the checkout
 * that qualifies them is the one that applies them. The reward step later
 * finds the entry under its reference and records the side. Best effort.
 */
export async function preBankFriendDays(admin: AdminClient, refereeId: string, deps: RewardDeps = {}): Promise<boolean> {
  try {
    if (!(deps.billingEnabled ?? isBillingEnabled())) return false;
    const row = await openRowOf(admin, refereeId);
    if (!row || !qualifiedAt(row) || row.card_on_file_at || row.referee_reward != null) return false;
    const settings = deps.settings ?? (await readReferralSettings(admin));
    if (!settings.enabled || settings.friend.days < 1) return false;
    // The reward step's gate, judged NOW (independent check P1): the
    // checkout spends these days as the free period, so nothing may be
    // banked that the step would refuse — both emails confirmed, the key
    // present, the fraud rules (all but the shared card, which exists only
    // after this checkout; `reclaimFriendDays` takes that case back), one
    // email one reward, the friends cap, an admin friend.
    const [referrerUser, refereeUser, profiles] = await Promise.all([
      authUserOf(admin, row.referrer_id),
      authUserOf(admin, refereeId),
      admin.from("profiles").select(`id, ${REWARD_PROFILE_COLUMNS}`).in("id", [row.referrer_id, refereeId]),
    ]);
    if (!refereeUser?.confirmed || !referrerUser?.confirmed) return false;
    const hashKey = referralEmailHashKey();
    if (!hashKey) return false;
    const rows = (profiles.data ?? []) as Array<ReferralRewardProfile & { id: string }>;
    const referee = rows.find((r) => r.id === refereeId) ?? null;
    if (!referee || referee.is_admin) return false;
    const verdict = referralFraudVerdict({ referrerEmail: referrerUser.email, refereeEmail: refereeUser.email, sameCard: false });
    if (verdict.block && !verdict.refereeRewarded) return false;
    const reused = await emailReused(admin, row.id, refereeId, refereeUser.email, hashKey);
    if (reused !== false) return false;
    if (await friendsCapReached(admin, row.referrer_id, settings.caps.friendsPerMonth, deps.now ?? new Date())) return false;
    const banked = await bankDays(admin, {
      userId: refereeId,
      days: settings.friend.days,
      source: "referral_friend",
      reference: referralRewardKey(row.id, "referee"),
    });
    return banked.ok;
  } catch (error) {
    console.warn(`[referrals] pre-bank for ${refereeId} failed:`, error instanceof Error ? error.message : error);
    return false;
  }
}

/** The friends cap as the claim counts it (rewarded, capped and
 *  referrer-blocked rows this UTC month whose friend was rewarded) — a
 *  best-effort read; the claim is the judge. */
async function friendsCapReached(admin: AdminClient, referrerId: string, cap: number, now: Date): Promise<boolean> {
  if (cap <= 0) return true;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count } = await admin
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", referrerId)
    .in("status", ["rewarded", "capped", "blocked"])
    .neq("referee_reward", "none")
    .gte("rewarded_at", monthStart);
  return (count ?? 0) >= cap;
}

/**
 * The friend's pre-banked days when the row ends with NO reward for them
 * (blocked, capped, expired, the account gone): an entry still BANKED is
 * revoked; one already reserved or applied — the checkout spent it — is
 * named in the side's detail so the admin sees it (`spent`).
 */
async function reclaimFriendDays(
  admin: AdminClient,
  referralId: string,
  reason: string,
  now: Date,
): Promise<{ revoked: boolean; spentEntryId: string | null }> {
  const reference = referralRewardKey(referralId, "referee");
  try {
    const { data: revoked } = await admin
      .from("day_bank_entries")
      .update({ status: "revoked", revoked_at: now.toISOString(), revoke_reason: `referral ${reason}`.slice(0, 200) })
      .eq("reference", reference)
      .eq("status", "banked")
      .select("id");
    if ((revoked?.length ?? 0) > 0) return { revoked: true, spentEntryId: null };
    const { data: entry } = await admin.from("day_bank_entries").select("id, status").eq("reference", reference).maybeSingle();
    const e = entry as { id: string; status: string } | null;
    if (e && (e.status === "reserved" || e.status === "applied")) {
      console.warn(`[referrals] ${referralId}: the friend's pre-banked days were already ${e.status} (${reason})`);
      return { revoked: false, spentEntryId: e.id };
    }
    return { revoked: false, spentEntryId: null };
  } catch (error) {
    console.warn(`[referrals] ${referralId}: reclaim failed:`, error instanceof Error ? error.message : error);
    return { revoked: false, spentEntryId: null };
  }
}

/** The friend's side ends with nothing: the detail names why — and the
 *  pre-banked entry the checkout already spent, if any. */
function noneDetail(reason: string, spentEntryId: string | null): Record<string, unknown> {
  return spentEntryId ? { kind: "none", reason, preBankedEntryId: spentEntryId, spent: true } : { kind: "none", reason };
}

/** The reward step for one qualified row. Safe to run again (the sweep):
 *  only a qualified row is claimed, once. */
export async function rewardReferral(
  admin: AdminClient,
  referral: ReferralRow,
  deps: RewardDeps = {},
): Promise<RewardReferralResult> {
  const now = deps.now ?? new Date();
  const stripe = deps.stripe ?? null;
  if (!(deps.billingEnabled ?? isBillingEnabled())) return { status: "waiting", reason: "billing_off" };
  if (referral.status !== "cards_saved" && referral.status !== "first_card") return { status: "none" };
  if (!qualifiedAt(referral) || !referral.card_on_file_at) return { status: "waiting", reason: "not_qualified" };
  const settings = deps.settings ?? (await readReferralSettings(admin));
  // The program is PAUSED (an admin's switch): the row waits — the sweep
  // rewards it once the program is on again, or the confirm window below
  // expires it. Nothing is granted, nobody told, while it is off.
  if (!settings.enabled) return { status: "waiting", reason: "program_off" };

  // The friend's account is gone: nobody is rewarded (the row stays — it is
  // evidence, never cascaded).
  if (!referral.referee_id) {
    const reclaimed = await reclaimFriendDays(admin, referral.id, "account_deleted", now);
    const moved = await settleQualified(admin, referral.id, {
      status: "blocked",
      block_reason: "account_deleted",
      referrer_reward: "none",
      referee_reward: "none",
      referee_reward_detail: noneDetail("account_deleted", reclaimed.spentEntryId) as Json,
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
  if (!refereeUser?.confirmed || !referrerUser?.confirmed) {
    const since = Date.parse(qualifiedAt(referral) ?? "") || now.getTime();
    if (now.getTime() - since > REFERRAL_CONFIRM_WINDOW_DAYS * DAY_MS) {
      const reclaimed = await reclaimFriendDays(admin, referral.id, "expired", now);
      const moved = await settleQualified(admin, referral.id, {
        status: "expired",
        referrer_reward: "none",
        referee_reward: "none",
        referee_reward_detail: noneDetail("expired", reclaimed.spentEntryId) as Json,
      });
      return moved ? { status: "expired" } : { status: "none" };
    }
    return { status: "waiting", reason: "email_unconfirmed" };
  }

  // One email, one referral ever — judged on a keyed hash, so no key, no
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
    const reclaimed = await reclaimFriendDays(admin, referral.id, fullBlock, now);
    const moved = await settleQualified(admin, referral.id, {
      status: "blocked",
      block_reason: fullBlock,
      referrer_reward: "none",
      referee_reward: "none",
      referee_reward_detail: noneDetail(fullBlock, reclaimed.spentEntryId) as Json,
    });
    if (!moved) return { status: "none" };
    // The friend is never told why (anti-enumeration); the referrer reads
    // "not eligible", never a reason.
    await notifyNoReward(admin, referral.referrer_id, refereeId, referral.id, "not_eligible");
    return { status: "blocked", reason: fullBlock, referee: null };
  }

  // The claim (atomic): the friends cap, a referrer-only block (same_domain —
  // the friend keeps theirs, the referrer gets none), and the referrer's
  // LADDER STEP under their lock.
  const { data: claimed, error } = await admin.rpc("claim_referral_reward_v2", {
    p_referral_id: referral.id,
    p_friends_cap: settings.caps.friendsPerMonth,
    ...(verdict.block ? { p_block_reason: verdict.block } : {}),
  });
  if (error) {
    console.warn(`[referrals] claim ${referral.id} failed:`, error.message);
    return { status: "none" };
  }
  const claim = (Array.isArray(claimed) ? claimed[0] : claimed) as { outcome: string; step: number | null } | null | undefined;
  if (!claim?.outcome) return { status: "none" }; // claimed elsewhere (a concurrent run)
  let outcome: "rewarded" | "capped" | "blocked";
  if (claim.outcome === "rewarded") outcome = "rewarded";
  else if (claim.outcome === "blocked") {
    outcome = "blocked";
    await notifyNoReward(admin, referral.referrer_id, refereeId, referral.id, "not_eligible");
  } else if (claim.outcome === "capped_friends") {
    await notifyNoReward(admin, referral.referrer_id, refereeId, referral.id, "capped_friends");
    // The friends cap: the friend's side is 'none' too (the database wrote
    // it) — their pre-banked days come back, or are named as spent.
    const reclaimed = await reclaimFriendDays(admin, referral.id, "capped_friends", now);
    if (reclaimed.spentEntryId) {
      await admin
        .from("referrals")
        .update({ referee_reward_detail: noneDetail("capped_friends", reclaimed.spentEntryId) as Json })
        .eq("id", referral.id);
    }
    return { status: "capped", referrer: null, referee: null };
  } else return { status: "none" };

  const granted = await grantOwedSides(
    admin,
    {
      ...referral,
      status: outcome,
      ladder_step: claim.step ?? null,
      referrer_reward: outcome === "rewarded" ? null : "none",
      referee_reward: null,
    },
    { ...deps, settings, profiles: { [referral.referrer_id]: referrer, [refereeId]: referee } },
  );
  if (outcome === "blocked") {
    return { status: "blocked", reason: verdict.block as ReferralBlockReason, referee: granted.referee };
  }
  return { status: outcome, referrer: granted.referrer, referee: granted.referee, step: claim.step ?? null };
}

/** qualified → a final state, only if the row is still qualified (two runs
 *  can't both settle it). True when this call moved it. */
async function settleQualified(
  admin: AdminClient,
  id: string,
  patch: Database["public"]["Tables"]["referrals"]["Update"],
): Promise<boolean> {
  const { data } = await admin
    .from("referrals")
    .update(patch)
    .eq("id", id)
    .in("status", ["cards_saved", "first_card"])
    .select("id");
  return (data?.length ?? 0) > 0;
}

/**
 * Grant each side whose reward is still NULL on a claimed row (rewarded,
 * capped or blocked-for-the-referrer-only). Idempotent: banked days carry
 * a unique reference (a retry finds the entry), credits the same ledger
 * key, and a side is recorded only while NULL. A failure leaves the side
 * NULL and counts an attempt — the sweep tries again, and past
 * REFERRAL_GRANT_MAX_ATTEMPTS records "none" (grant_failed).
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
    const reward = await grantSide(admin, referral, side, userId, { ...deps, settings });
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

/** The friend's reference: once per referral. */
export function referralRewardKey(referralId: string, side: Side): string {
  return `referral:${referralId}:${side}`;
}

/** The referrer's reference: once per referrer and ladder step. */
export function referralStepKey(referrerId: string, step: number): string {
  return `referral-step:${referrerId}:${step}`;
}

/** One side's reward. "failed" leaves the side owed for the sweep (an
 *  attempt counted). */
async function grantSide(
  admin: AdminClient,
  referral: ReferralRow,
  side: Side,
  userId: string,
  deps: RewardDeps & { settings: ReferralSettings; profiles?: Record<string, ReferralRewardProfile | null> },
): Promise<GrantedReward | "failed"> {
  try {
    let profile = deps.profiles?.[userId] ?? null;
    if (!profile) {
      const { data } = await admin.from("profiles").select(REWARD_PROFILE_COLUMNS).eq("id", userId).maybeSingle();
      profile = (data as ReferralRewardProfile | null) ?? null;
    }
    if (!profile) {
      await recordSide(admin, referral.id, side, { kind: "none", reason: "no_profile" });
      return { kind: "none", reason: "no_profile" };
    }
    const step = side === "referrer" ? (referral.ladder_step ?? null) : null;
    if (side === "referrer" && step == null) {
      // A rewarded row with no step: an older row (0177) or a lost claim —
      // the first rung, never nothing.
      console.warn(`[referrals] ${referral.id}: rewarded with no ladder step — granting step 1`);
    }
    const plan = side === "referee" ? friendRewardFor(deps.settings, profile) : referrerRewardFor(deps.settings, step ?? 1, profile);
    const reference = side === "referee" ? referralRewardKey(referral.id, "referee") : referralStepKey(referral.referrer_id, step ?? 1);

    if (plan.kind === "none") {
      const reward: GrantedReward = { kind: "none", reason: plan.reason };
      await recordSide(admin, referral.id, side, reward);
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
      const reward: GrantedReward = { kind: "credits", credits: plan.amount, ...(step != null ? { step } : {}) };
      await recordSide(admin, referral.id, side, reward);
      return reward;
    }
    // Days into the bank (lib/billing/day-bank.ts). The reference makes a
    // retried call find the entry it already made.
    const banked = await bankDays(admin, {
      userId,
      days: plan.days,
      source: side === "referee" ? "referral_friend" : "referral_step",
      reference,
    });
    if (!banked.ok) throw new Error(banked.error);
    const reward: GrantedReward = { kind: "banked_days", days: plan.days, entryId: banked.entryId, ...(step != null ? { step } : {}) };
    await recordSide(admin, referral.id, side, reward);
    return reward;
  } catch (error) {
    console.error(
      `[referrals] ${side} reward for ${userId} (${referral.id}) failed:`,
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
  | { ok: true; claimed: number; waiting: number; retried: number; failed: number; released: number }
  | { ok: false; error: string };

/**
 * The cron's sweep (/api/cron/referral-rewards): finish what the live steps
 * didn't — a qualified row whose emails weren't confirmed yet or whose card
 * arrived while the program was off, a row a lost `after()` or webhook left
 * short of its stamps, a grant that failed — plus the expiries and the days
 * bank's stale reservations. Idempotent; does nothing while billing is off.
 */
export async function sweepReferralRewards(admin: AdminClient, deps0: RewardDeps = {}): Promise<ReferralSweepResult> {
  if (!(deps0.billingEnabled ?? isBillingEnabled())) return { ok: true, skipped: "billing_off" };
  const settings = deps0.settings ?? (await readReferralSettings(admin));
  const deps: RewardDeps = { ...deps0, settings, billingEnabled: true };
  const now = deps.now ?? new Date();
  let claimed = 0;
  let waiting = 0;
  let retried = 0;
  let failed = 0;

  // Qualified-not-claimed rows that CAN move (independent check P2: a
  // friend with the cards and no plan has no deadline, so those rows
  // accumulate and a plain oldest-first batch would starve): the rows with
  // BOTH stamps (an email got confirmed, the program came back on), and the
  // rows whose friend now holds a subscription (a lost webhook) — the
  // latter joined in the database (referrals_awaiting_plan).
  const { data: stamped, error } = await admin
    .from("referrals")
    .select(REFERRAL_ROW_COLUMNS)
    .in("status", ["cards_saved", "first_card"])
    .not("card_on_file_at", "is", null)
    .order("cards_saved_at", { ascending: true, nullsFirst: true })
    .limit(REFERRAL_SWEEP_BATCH);
  if (error) return { ok: false, error: error.message };
  const { data: awaiting, error: awaitingError } = await admin.rpc("referrals_awaiting_plan", { p_limit: REFERRAL_SWEEP_BATCH });
  if (awaitingError) return { ok: false, error: awaitingError.message };
  const seen = new Set<string>();
  const pending = [...((stamped ?? []) as ReferralRow[]), ...((awaiting ?? []) as ReferralRow[])].filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  for (const row of pending) {
    if (!row.referee_id) {
      const result = await rewardReferral(admin, row, deps);
      if (result.status !== "none") claimed += 1;
      continue;
    }
    const result = await advanceReferral(admin, row.referee_id, deps);
    if (result.status === "waiting") waiting += 1;
    else if (result.status !== "none") claimed += 1;
  }

  // A signup whose friend never saved the cards inside the window is over.
  const windowMs = settings.activation.windowDays * DAY_MS;
  await admin
    .from("referrals")
    .update({ status: "expired", referrer_reward: "none", referee_reward: "none" })
    .eq("status", "signed_up")
    .lt("signed_up_at", new Date(now.getTime() - windowMs).toISOString());

  // A save whose `after()` was lost: a signed_up row older than a few
  // minutes — and inside the window — whose friend has the bar's cards is
  // advanced here (the card count judged in the database).
  const { data: stranded, error: strandedError } = await admin.rpc("referrals_stranded_signups", {
    p_cards: settings.activation.cardsRequired,
    p_since: new Date(now.getTime() - windowMs).toISOString(),
    p_until: new Date(now.getTime() - STRANDED_AFTER_MS).toISOString(),
    p_limit: REFERRAL_SWEEP_BATCH,
  });
  if (strandedError) return { ok: false, error: strandedError.message };
  for (const row of (stranded ?? []) as Array<{ id: string; referee_id: string | null }>) {
    if (!row.referee_id) continue;
    const result = await advanceReferral(admin, row.referee_id, deps);
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
    const granted = await grantOwedSides(admin, row, deps);
    retried += 1;
    const stillOwed =
      (before[1] == null && granted.referee == null) ||
      (row.status === "rewarded" && before[0] == null && granted.referrer == null);
    if (stillOwed) failed += 1;
  }

  // The days bank: a Checkout reservation nothing settled goes back.
  const released = await releaseStaleReservations(admin, now);
  return { ok: true, claimed, waiting, retried, failed, released };
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
  if (reward.kind === "banked_days") {
    return { reward: "banked_days", days: reward.days, ...(reward.step != null ? { step: reward.step } : {}) };
  }
  if (reward.kind === "credits") return { reward: "credits", credits: reward.credits, ...(reward.step != null ? { step: reward.step } : {}) };
  return { reward: "none" };
}

/** The referrer is told a friend qualified but earned them nothing — once;
 *  never a fraud reason. */
async function notifyNoReward(
  admin: AdminClient,
  referrerId: string,
  refereeId: string,
  referralId: string,
  outcome: "capped_friends" | "not_eligible",
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
  input: { recipientId: string; actorId: string | null; type: "referral_signup" | "referral_reward"; payload: Record<string, unknown> },
): Promise<void> {
  const { error } = await admin.from("notifications").insert({
    recipient_id: input.recipientId,
    actor_id: input.actorId,
    type: input.type,
    payload: input.payload as Json,
  });
  if (error) console.warn(`[referrals] ${input.type} notification for ${input.recipientId} failed:`, error.message);
}

async function authUserOf(admin: AdminClient, userId: string): Promise<{ email: string | null; confirmed: boolean } | null> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    const user = data?.user;
    if (!user) return null;
    return { email: user.email ?? null, confirmed: Boolean(user.email_confirmed_at) };
  } catch {
    return null;
  }
}

/** Both Stripe customers carry the same card fingerprint (owner 2026-11-02:
 *  a shared card is a shared person). Unknown or no Stripe: false. */
async function sharesCard(stripe: Stripe | null, a: string | null | undefined, b: string | null | undefined): Promise<boolean> {
  if (!stripe || !a || !b || a === b) return a != null && a === b;
  try {
    const [pa, pb] = await Promise.all([
      stripe.paymentMethods.list({ customer: a, type: "card", limit: 10 }),
      stripe.paymentMethods.list({ customer: b, type: "card", limit: 10 }),
    ]);
    const fa = new Set(pa.data.map((m) => m.card?.fingerprint).filter(Boolean));
    return pb.data.some((m) => m.card?.fingerprint && fa.has(m.card.fingerprint));
  } catch {
    return false;
  }
}
