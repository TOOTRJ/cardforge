import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getSiteBaseUrl } from "@/lib/site-url";
import { isReferralStatus, referralLink, type ReferralStatus } from "@/lib/referrals/rules";
import { buildReferralSummary, type ReferralRow, type ReferralSummary } from "@/lib/referrals/summary";

// ---------------------------------------------------------------------------
// The referral dashboard's one read (/dashboard/referrals) — the viewer's own
// session, through 0153's RLS and COLUMN grant: the code (minted on first
// ask), the friends they referred (status and dates only — never a fraud
// reason or a Stripe detail), and the referral that brought THEM, if any.
// Usernames come from the public profile columns.
// ---------------------------------------------------------------------------

export type ReferralDashboard = {
  code: string | null;
  link: string | null;
  rows: ReferralRow[];
  summary: ReferralSummary;
  /** The referral that brought the viewer, if they joined through a link. */
  joinedThrough: { username: string | null; status: ReferralStatus } | null;
};

/** The columns 0153 grants a signed-in user — `select *` is refused. */
const REFERRAL_COLUMNS = "id, referrer_id, referee_id, status, signed_up_at, first_card_at, rewarded_at, referrer_reward";

export async function getMyReferralDashboard(now: Date = new Date()): Promise<ReferralDashboard | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  const [{ data: code }, { data: made }, { data: mine }] = await Promise.all([
    supabase.rpc("my_referral_code"),
    supabase
      .from("referrals")
      .select(REFERRAL_COLUMNS)
      .eq("referrer_id", user.id)
      .order("signed_up_at", { ascending: false })
      .limit(200),
    supabase.from("referrals").select(REFERRAL_COLUMNS).eq("referee_id", user.id).maybeSingle(),
  ]);

  const ids = [...new Set([...(made ?? []).map((r) => r.referee_id), ...(mine ? [mine.referrer_id] : [])])];
  const names = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, username").in("id", ids);
    for (const p of profiles ?? []) names.set(p.id, p.username ?? null);
  }

  const rows: ReferralRow[] = (made ?? [])
    .filter((r) => isReferralStatus(r.status))
    .map((r) => ({
      id: r.id,
      username: names.get(r.referee_id) ?? null,
      status: r.status as ReferralStatus,
      signedUpAt: r.signed_up_at,
      firstCardAt: r.first_card_at,
      rewardedAt: r.rewarded_at,
      reward: r.referrer_reward === "comp_month" || r.referrer_reward === "balance_credit" ? r.referrer_reward : null,
    }));

  return {
    code: typeof code === "string" ? code : null,
    link: typeof code === "string" ? referralLink(getSiteBaseUrl(), code) : null,
    rows,
    summary: buildReferralSummary(rows, now),
    joinedThrough:
      mine && isReferralStatus(mine.status)
        ? { username: names.get(mine.referrer_id) ?? null, status: mine.status }
        : null,
  };
}
