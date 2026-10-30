import "server-only";

import { requireAdminClient } from "./users-queries";

// ---------------------------------------------------------------------------
// The admin Referrals panel's data (beside the Funnel panel on /admin/users):
// 0153's admin_referral_stats() for the last 30 days and all time, parsed
// defensively (it is jsonb) by parseReferralStats — pure, unit-tested.
// ---------------------------------------------------------------------------

export type ReferralTopRow = {
  userId: string;
  username: string | null;
  referrals: number;
  activated: number;
  rewarded: number;
  months: number;
};

export type ReferralStatsWindow = {
  signedUp: number;
  firstCard: number;
  rewarded: number;
  capped: number;
  blocked: number;
  expired: number;
  blockReasons: Record<string, number>;
  monthsGranted: number;
  topReferrers: ReferralTopRow[];
};

export type ReferralStatsSummary = { last30: ReferralStatsWindow; allTime: ReferralStatsWindow };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);

export function parseReferralStats(raw: unknown): ReferralStatsWindow {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const reasons: Record<string, number> = {};
  if (o.blockReasons && typeof o.blockReasons === "object") {
    for (const [k, v] of Object.entries(o.blockReasons as Record<string, unknown>)) reasons[k] = num(v);
  }
  const top = Array.isArray(o.topReferrers) ? o.topReferrers : [];
  return {
    signedUp: num(o.signedUp),
    firstCard: num(o.firstCard),
    rewarded: num(o.rewarded),
    capped: num(o.capped),
    blocked: num(o.blocked),
    expired: num(o.expired),
    blockReasons: reasons,
    monthsGranted: num(o.monthsGranted),
    topReferrers: top
      .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
      .filter((r) => typeof r.userId === "string")
      .map((r) => ({
        userId: r.userId as string,
        username: typeof r.username === "string" ? r.username : null,
        referrals: num(r.referrals),
        activated: num(r.activated),
        rewarded: num(r.rewarded),
        months: num(r.months),
      })),
  };
}

/** Signups that went on to save a first card, as a whole percent (null with
 *  no signups — a rate without its numerator is noise). */
export function activationRate(w: Pick<ReferralStatsWindow, "signedUp" | "firstCard">): number | null {
  return w.signedUp > 0 ? Math.round((w.firstCard / w.signedUp) * 100) : null;
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
