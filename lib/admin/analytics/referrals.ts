import "server-only";

import { requireAdminClient } from "@/lib/admin/users-queries";
import { selectAllRows } from "@/lib/supabase/select-all-rows";
import { REFERRAL_BLOCK_LABELS } from "@/lib/admin/referral-queries";
import type { AnalyticsPeriod } from "@/lib/admin/analytics/params";
import { countByDay, type DayPoint } from "@/lib/admin/analytics/series";

// ---------------------------------------------------------------------------
// /admin/analytics — the Referrals tab's own data (2026-11).
//
// Two reads beside the panel's (lib/admin/referral-queries.ts):
//   - the PERIOD's numbers: friends referred, saved the cards, rewarded, and
//     started a plan (a fact since 2026-11-11: a referral rewards on the
//     cards alone) — for the period and the one before it, each counted by
//     ITS OWN timestamp on the `referrals` rows (a friend who signed up last
//     month and started a plan this week is this week's "started a plan").
//     admin_referral_stats' per-day list covers 30 days only, so the rows
//     are read directly, every one of them (selectAllRows);
//   - WHO WAS REFERRED (owner 2026-11-10): 0202's admin_referred_friends, a
//     page of referrals with each friend's plan, cards and banked days —
//     and, since 0206 (owner 2026-11-11), what each side was given and the
//     facts that say why a side is still waiting (the words are
//     lib/admin/analytics/referral-rewards.ts).
//
// The page has already checked the viewer is an admin; both reads go through
// the admin client. A read that fails is null (the tab says so) — never an
// empty list standing in for the truth. The shaping is pure and unit-tested.
// Every reader here checks the viewer is an admin ITSELF (requireAdminClient:
// null for anyone else) — the page's gate is not the only thing between a
// service-role read and a caller, so a later import of one of these into a
// route or an action cannot hand the data out.
// ---------------------------------------------------------------------------

/** The Referred friends table's page size (0202 clamps to 200). */
export const REFERRED_FRIENDS_PAGE_SIZE = 50;

export type ReferralStepCounts = {
  /** Friends who signed up through a link. */
  signedUp: number;
  /** Friends who saved the cards the program asks for. */
  cardsSaved: number;
  /** Friends who started a plan with a card on file — what came of the
   *  referral, not a step toward its reward. */
  cardOnFile: number;
  /** Referrals that rewarded both sides. */
  rewarded: number;
};

export type ReferralPeriodStats = {
  current: ReferralStepCounts;
  previous: ReferralStepCounts;
  /** Friends referred per UTC day of the period, oldest first, zero-filled. */
  perDay: DayPoint[];
};

/** The columns the period numbers read (a `referrals` row's timestamps). */
export type ReferralStampRow = {
  status: string;
  signed_up_at: string;
  /** 0177's name for the stamp on a row older than 0180. */
  first_card_at: string | null;
  cards_saved_at: string | null;
  card_on_file_at: string | null;
  rewarded_at: string | null;
};

const within = (at: string | null, from: number, to: number): boolean => {
  if (!at) return false;
  const time = Date.parse(at);
  return Number.isFinite(time) && time >= from && time < to;
};

/** Each step counted by its own timestamp in [from, to). "Rewarded" is a
 *  row whose status is `rewarded`: the claim stamps `rewarded_at` on a
 *  capped or blocked row too (0180), and those rewarded nobody. */
export function countReferralSteps(rows: readonly ReferralStampRow[], from: Date, to: Date): ReferralStepCounts {
  const a = from.getTime();
  const b = to.getTime();
  const counts: ReferralStepCounts = { signedUp: 0, cardsSaved: 0, cardOnFile: 0, rewarded: 0 };
  for (const row of rows) {
    if (within(row.signed_up_at, a, b)) counts.signedUp += 1;
    if (within(row.cards_saved_at ?? row.first_card_at, a, b)) counts.cardsSaved += 1;
    if (within(row.card_on_file_at, a, b)) counts.cardOnFile += 1;
    if (row.status === "rewarded" && within(row.rewarded_at, a, b)) counts.rewarded += 1;
  }
  return counts;
}

/** The period, the period before it, and the signups per day. */
export function buildReferralPeriodStats(rows: readonly ReferralStampRow[], period: AnalyticsPeriod): ReferralPeriodStats {
  const since = period.since.getTime();
  const until = period.until.getTime();
  return {
    current: countReferralSteps(rows, period.since, period.until),
    previous: countReferralSteps(rows, period.previousSince, period.previousUntil),
    perDay: countByDay(
      period.dayKeys,
      rows.filter((row) => within(row.signed_up_at, since, until)).map((row) => row.signed_up_at),
    ),
  };
}

/** One row of the Referred friends table. */
export type ReferredFriend = {
  referralId: string;
  /** Null once the friend's account is gone (the referral row stays). */
  refereeId: string | null;
  refereeUsername: string | null;
  refereeJoinedAt: string | null;
  referrerId: string;
  referrerUsername: string | null;
  signedUpAt: string;
  status: string;
  blockReason: string | null;
  cardsSavedAt: string | null;
  cardOnFileAt: string | null;
  /** When the claim settled the row — the reward's day only where the
   *  status is `rewarded` (see rewardedOn). */
  rewardedAt: string | null;
  ladderStep: number | null;
  /** 'free' | 'plus' | 'pro' — the plan whose perks the friend has now. */
  tier: string | null;
  cards: number;
  publicCards: number;
  lastCardAt: string | null;
  /** Free days this referral banked to the friend (revoked ones left out). */
  bankedDays: number;
  /** What each side was given and why a side may still wait (0206). Null
   *  on a database that has not got 0206 yet: the page then says nothing
   *  about rewards rather than guess. */
  rewards: ReferralRewardFacts | null;
};

/** One side's reward as the reward step recorded it. */
export type RewardSideFacts = {
  /** 'banked_days' | 'credits' | 'none', or null while the side is owed. */
  kind: string | null;
  days: number | null;
  credits: number | null;
  /** The referrer's ladder step. */
  step: number | null;
  /** Why the side got nothing (a 'none' side's detail). */
  reason: string | null;
};

export type ReferralRewardFacts = {
  friend: RewardSideFacts;
  referrer: RewardSideFacts;
  /** How many times a side's grant has failed. */
  grantAttempts: number;
  /** Null = unknown (the account is gone). */
  friendEmailConfirmed: boolean | null;
  referrerEmailConfirmed: boolean | null;
  /** The friend holds a subscription Stripe only gives with a card — a fact
   *  since 2026-11-11, no longer a condition of the reward. */
  friendHasPlan: boolean | null;
  /** The friend's cards WITH ARTWORK: the ones a referral counts (0208).
   *  Null on a database before 0208 — the page then reads every card. */
  friendQualifyingCards: number | null;
};

export type ReferredFriendsPage = {
  rows: ReferredFriend[];
  /** Every referral there is. 0 when this page is past the end. */
  total: number;
  page: number;
  pageSize: number;
};

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0;
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const flag = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const positive = (v: unknown): number | null => (v == null || num(v) <= 0 ? null : num(v));

/** One side of 0206's reward columns: the recorded kind and its detail. */
function sideFacts(kind: unknown, detail: unknown): RewardSideFacts {
  const d = detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : {};
  return {
    kind: text(kind),
    // 0177 recorded a reward in 30-day units; 0180 records the days.
    days: positive(d.days) ?? (positive(d.units) != null ? (positive(d.units) as number) * 30 : null),
    credits: positive(d.credits),
    step: positive(d.step),
    reason: text(d.reason),
  };
}

/** 0206's columns of one row — null when the row has none of them (the
 *  function is still 0202's: the app deployed before the migration). */
function rewardFacts(o: Record<string, unknown>): ReferralRewardFacts | null {
  if (!("referee_reward" in o) || !("referrer_reward" in o)) return null;
  return {
    friend: sideFacts(o.referee_reward, o.referee_reward_detail),
    referrer: sideFacts(o.referrer_reward, o.referrer_reward_detail),
    grantAttempts: num(o.grant_attempts),
    friendEmailConfirmed: flag(o.referee_email_confirmed),
    referrerEmailConfirmed: flag(o.referrer_email_confirmed),
    friendHasPlan: flag(o.referee_has_plan),
    friendQualifyingCards: "referee_art_cards" in o ? num(o.referee_art_cards) : null,
  };
}

/** 0202's rows (widened by 0206), read defensively (a count may arrive as a
 *  string). A row with no id, referrer or signup date is dropped. */
export function parseReferredFriends(raw: unknown): { rows: ReferredFriend[]; total: number } {
  const list = Array.isArray(raw) ? raw : [];
  const rows: ReferredFriend[] = [];
  let total = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const referralId = text(o.referral_id);
    const referrerId = text(o.referrer_id);
    const signedUpAt = text(o.signed_up_at);
    if (!referralId || !referrerId || !signedUpAt) continue;
    total = Math.max(total, num(o.total_count));
    rows.push({
      referralId,
      refereeId: text(o.referee_id),
      refereeUsername: text(o.referee_username),
      refereeJoinedAt: text(o.referee_joined_at),
      referrerId,
      referrerUsername: text(o.referrer_username),
      signedUpAt,
      status: text(o.status) ?? "signed_up",
      blockReason: text(o.block_reason),
      cardsSavedAt: text(o.cards_saved_at),
      cardOnFileAt: text(o.card_on_file_at),
      rewardedAt: text(o.rewarded_at),
      ladderStep: o.ladder_step == null ? null : num(o.ladder_step),
      tier: text(o.referee_tier),
      cards: num(o.referee_cards),
      publicCards: num(o.referee_public_cards),
      lastCardAt: text(o.referee_last_card_at),
      bankedDays: num(o.referee_banked_days),
      rewards: rewardFacts(o),
    });
  }
  return { rows, total };
}

const lowerFirst = (words: string) => words.charAt(0).toLowerCase() + words.slice(1);
const spaced = (code: string) => code.replace(/_/g, " ");

/**
 * "Where they are", in plain words, from a referral's `status` and
 * `block_reason` — every value of 0180's status CHECK and 0177's
 * block_reason CHECK has its own words (a test holds both lists); a value
 * this doesn't know reads as its code with spaces, never as nothing.
 * `cardsRequired` is the program's setting (5).
 */
export function referralStandingText(status: string, blockReason: string | null, cardsRequired = 5): string {
  switch (status) {
    case "signed_up":
      return "Signed up";
    case "cards_saved":
      // Qualified since 2026-11-11 (no plan is waited for): a row still
      // here is waiting for the claim — the Rewards column says on what.
      return `Saved ${cardsRequired} ${cardsRequired === 1 ? "card" : "cards"}`;
    case "first_card":
      // 0177's bar: one card.
      return "Saved their first card";
    case "rewarded":
      return "Rewarded";
    case "capped":
      return "Not rewarded: over the monthly friend limit";
    case "expired":
      return "Expired: ran out of time";
    case "blocked": {
      if (!blockReason) return "Blocked";
      return `Blocked: ${lowerFirst(REFERRAL_BLOCK_LABELS[blockReason] ?? spaced(blockReason))}`;
    }
    default: {
      const words = spaced(status).trim();
      return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
    }
  }
}

/** The day both sides were rewarded — null for a capped, blocked or waiting
 *  row, whatever its `rewarded_at` holds. */
export function rewardedOn(row: Pick<ReferredFriend, "status" | "rewardedAt">): string | null {
  return row.status === "rewarded" ? row.rewardedAt : null;
}

const TIER_NAMES: Record<string, string> = { free: "Free", plus: "Plus", pro: "Pro" };

/** "Free" / "Plus" / "Pro"; null when the account is gone. */
export function tierName(tier: string | null): string | null {
  if (!tier) return null;
  return TIER_NAMES[tier] ?? tier.charAt(0).toUpperCase() + tier.slice(1);
}

/** "Showing 51–100 of 240" — null when there is nothing to show. */
export function pageRangeText(page: Pick<ReferredFriendsPage, "rows" | "total" | "page" | "pageSize">): string | null {
  if (page.rows.length === 0) return null;
  const first = (page.page - 1) * page.pageSize + 1;
  const last = first + page.rows.length - 1;
  return `Showing ${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")} of ${page.total.toLocaleString("en-US")}`;
}

const STAMP_COLUMNS = "id, status, signed_up_at, first_card_at, cards_saved_at, card_on_file_at, rewarded_at";

/** The period's referral numbers and the one before it. Null when the read
 *  fails. */
export async function getReferralPeriodStats(period: AnalyticsPeriod): Promise<ReferralPeriodStats | null> {
  try {
    const admin = await requireAdminClient();
    if (!admin) return null;
    const from = period.previousSince.toISOString();
    // Every row with ANY stamp since the previous period began: a step is
    // counted by its own date, not the signup's.
    const moved = ["signed_up_at", "cards_saved_at", "first_card_at", "card_on_file_at", "rewarded_at"]
      .map((column) => `${column}.gte.${from}`)
      .join(",");
    const { data, error } = await selectAllRows<ReferralStampRow>((start, end) =>
      admin
        .from("referrals")
        .select(STAMP_COLUMNS)
        .or(moved)
        .order("signed_up_at", { ascending: true })
        .order("id", { ascending: true })
        .range(start, end),
    );
    if (error) {
      console.error("getReferralPeriodStats: referrals read failed:", error.message);
      return null;
    }
    return buildReferralPeriodStats(data, period);
  } catch (error) {
    console.error("getReferralPeriodStats:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** One page of the referred friends, newest signup first. Null when the
 *  read fails. */
export async function getReferredFriends(page: number): Promise<ReferredFriendsPage | null> {
  const pageSize = REFERRED_FRIENDS_PAGE_SIZE;
  const safePage = Number.isInteger(page) && page >= 1 ? page : 1;
  try {
    const admin = await requireAdminClient();
    if (!admin) return null;
    const { data, error } = await admin.rpc("admin_referred_friends", {
      p_limit: pageSize,
      p_offset: (safePage - 1) * pageSize,
    });
    if (error) {
      console.error("getReferredFriends: admin_referred_friends failed:", error.message);
      return null;
    }
    return { ...parseReferredFriends(data), page: safePage, pageSize };
  } catch (error) {
    console.error("getReferredFriends:", error instanceof Error ? error.message : error);
    return null;
  }
}
