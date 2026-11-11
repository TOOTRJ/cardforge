import "server-only";

import { requireAdminClient } from "./users-queries";

// ---------------------------------------------------------------------------
// The admin Referrals panel's data (the Referrals tab of /admin/analytics):
// 0180's admin_referral_stats() for the last 30 days and all time, parsed
// defensively (it is jsonb) by parseReferralStats — pure, unit-tested. The
// v2 shape adds the second bar (card on file), the per-day chain, the
// ladder's distribution and credits, and the days bank (owner 2026-11-06:
// "good detailed stats and analytics for the admin on the referrals and
// days banked").
// ---------------------------------------------------------------------------

export type ReferralTopRow = {
  userId: string;
  username: string | null;
  referrals: number;
  /** Friends who saved the cards. */
  activated: number;
  /** Friends who also started a plan (card on file). */
  cardOnFile: number;
  rewarded: number;
  /** Rewards the referrer earned (days or credits). */
  rewards: number;
  /** The highest ladder step reached. */
  step: number | null;
};

export type ReferralDayRow = {
  /** YYYY-MM-DD (UTC). */
  day: string;
  signedUp: number;
  cardsSaved: number;
  cardOnFile: number;
  rewarded: number;
};

export type ReferralBankStats = {
  bankedDays: number;
  reservedDays: number;
  appliedDays: number;
  revokedDays: number;
  appliedCheckouts: number;
  appliedCheckoutDays: number;
  appliedHolds: number;
  appliedHoldDays: number;
  usersWithBank: number;
  signupEntries: number;
  signupApplied: number;
  signupRevoked: number;
  signupBanked: number;
  bySource: Record<string, { days: number; entries: number }>;
};

export type ReferralStatsWindow = {
  signedUp: number;
  /** Friends who saved the cards (0177's first card counts). */
  cardsSaved: number;
  /** Friends who also started a plan with a card on file. */
  cardOnFile: number;
  rewarded: number;
  capped: number;
  blocked: number;
  expired: number;
  /** Cards saved, not yet claimed: waiting for the card on file, a confirmed
   *  email, or the program. */
  waiting: number;
  /** Claimed with a side still owed — a grant the hourly sweep retries.
   *  Counted over ALL rows, whatever the window. */
  grantsOwed: number;
  blockReasons: Record<string, number>;
  /** Rewards granted on both sides (days or credits). */
  rewardsGranted: number;
  topReferrers: ReferralTopRow[];
  /** The last 30 days, oldest first (whatever the window). */
  perDay: ReferralDayRow[];
  /** Referrers by rewarded-referral count ("1" … "9", "10+"), all time. */
  ladderSteps: Record<string, number>;
  /** AI credits granted through the ladder in the window. */
  ladderCredits: number;
  /** The days bank: entries made in the window. */
  bank: ReferralBankStats;
};

export type ReferralStatsSummary = { last30: ReferralStatsWindow; allTime: ReferralStatsWindow };

/** Why a referral was blocked, in an admin's words — ONE list for the
 *  panel's "Blocked, all time" line and the Referred friends table
 *  (lib/admin/analytics/referrals.ts). The keys are 0177's block_reason
 *  CHECK; a user never reads these (their page says "Not eligible"). */
export const REFERRAL_BLOCK_LABELS: Record<string, string> = {
  same_email: "Same inbox",
  same_card: "Same card",
  same_domain: "Same company domain (friend rewarded)",
  disposable_email: "Throwaway email",
  not_new: "Not a new account",
  email_reused: "Email already used",
  account_deleted: "Friend's account deleted",
};

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0;

function numMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = num(v);
  }
  return out;
}

function parseBank(raw: unknown): ReferralBankStats {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const bySource: ReferralBankStats["bySource"] = {};
  if (o.bySource && typeof o.bySource === "object" && !Array.isArray(o.bySource)) {
    for (const [k, v] of Object.entries(o.bySource as Record<string, unknown>)) {
      const e = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
      bySource[k] = { days: num(e.days), entries: num(e.entries) };
    }
  }
  return {
    bankedDays: num(o.bankedDays),
    reservedDays: num(o.reservedDays),
    appliedDays: num(o.appliedDays),
    revokedDays: num(o.revokedDays),
    appliedCheckouts: num(o.appliedCheckouts),
    appliedCheckoutDays: num(o.appliedCheckoutDays),
    appliedHolds: num(o.appliedHolds),
    appliedHoldDays: num(o.appliedHoldDays),
    usersWithBank: num(o.usersWithBank),
    signupEntries: num(o.signupEntries),
    signupApplied: num(o.signupApplied),
    signupRevoked: num(o.signupRevoked),
    signupBanked: num(o.signupBanked),
    bySource,
  };
}

export function parseReferralStats(raw: unknown): ReferralStatsWindow {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const top = Array.isArray(o.topReferrers) ? o.topReferrers : [];
  const days = Array.isArray(o.perDay) ? o.perDay : [];
  return {
    signedUp: num(o.signedUp),
    // 0177's name is kept by the function for a window read by older code.
    cardsSaved: num(o.cardsSaved ?? o.firstCard),
    cardOnFile: num(o.cardOnFile),
    rewarded: num(o.rewarded),
    capped: num(o.capped),
    blocked: num(o.blocked),
    expired: num(o.expired),
    waiting: num(o.waiting),
    grantsOwed: num(o.grantsOwed),
    blockReasons: numMap(o.blockReasons),
    rewardsGranted: num(o.rewardsGranted),
    topReferrers: top
      .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
      .filter((r) => typeof r.userId === "string")
      .map((r) => ({
        userId: r.userId as string,
        username: typeof r.username === "string" ? r.username : null,
        referrals: num(r.referrals),
        activated: num(r.activated),
        cardOnFile: num(r.cardOnFile),
        rewarded: num(r.rewarded),
        rewards: num(r.rewards),
        step: r.step == null ? null : num(r.step),
      })),
    perDay: days
      .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === "object")
      .filter((d) => typeof d.day === "string")
      .map((d) => ({
        day: d.day as string,
        signedUp: num(d.signedUp),
        cardsSaved: num(d.cardsSaved),
        cardOnFile: num(d.cardOnFile),
        rewarded: num(d.rewarded),
      })),
    ladderSteps: numMap(o.ladderSteps),
    ladderCredits: num(o.ladderCredits),
    bank: parseBank(o.bank),
  };
}

/** Signups that went on to save the cards, as a whole percent (null with
 *  no signups — a rate without its numerator is noise). */
export function activationRate(w: Pick<ReferralStatsWindow, "signedUp" | "cardsSaved">): number | null {
  return w.signedUp > 0 ? Math.round((w.cardsSaved / w.signedUp) * 100) : null;
}

/** Signups that went on to qualify (cards + a card on file), as a whole percent. */
export function qualificationRate(w: Pick<ReferralStatsWindow, "signedUp" | "cardOnFile">): number | null {
  return w.signedUp > 0 ? Math.round((w.cardOnFile / w.signedUp) * 100) : null;
}

/** Null for non-admins or when the read fails (the panel is left out). */
export async function getReferralStats(now: Date = new Date()): Promise<ReferralStatsSummary | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [last30, allTime] = await Promise.all([
    admin.rpc("admin_referral_stats", { p_since: since30 }),
    admin.rpc("admin_referral_stats", { p_since: "1970-01-01T00:00:00Z" }),
  ]);
  if (last30.error || allTime.error) {
    console.warn("getReferralStats:", last30.error?.message ?? allTime.error?.message);
    return null;
  }
  return { last30: parseReferralStats(last30.data), allTime: parseReferralStats(allTime.data) };
}
