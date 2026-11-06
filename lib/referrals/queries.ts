import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getSiteBaseUrl } from "@/lib/site-url";
import { isReferralStatus, referralLink, type ReferralStatus } from "@/lib/referrals/rules";
import { buildReferralSummary, type ReferralRow, type ReferralSummary } from "@/lib/referrals/summary";
import { readReferralSettings } from "@/lib/referrals/settings-server";
import type { ReferralSettings } from "@/lib/referrals/settings";
import { readBank, type Bank } from "@/lib/billing/day-bank";

// ---------------------------------------------------------------------------
// The referral dashboard's one read (/dashboard/referrals) — the viewer's own
// session, through 0177 / 0180's RLS and COLUMN grants: the code (minted on
// first ask), the friends they referred (status, the two stamps and the
// ladder step — never a fraud reason or a Stripe detail), the referral that
// brought THEM, if any, and their days bank. Usernames come from the public
// profile columns.
// ---------------------------------------------------------------------------

export type ReferralDashboard = {
  code: string | null;
  link: string | null;
  rows: ReferralRow[];
  summary: ReferralSummary;
  /** The program's settings (the switch, the bar, the ladder, the cap). */
  settings: ReferralSettings;
  /** The viewer's days bank (banked / reserved / entries). */
  bank: Bank;
  /** The referral that brought the viewer, if they joined through a link —
   *  its stamps, and whether THEIR side was rewarded (their own reward column). */
  joinedThrough: {
    username: string | null;
    status: ReferralStatus;
    cardsSaved: boolean;
    cardOnFile: boolean;
    rewarded: boolean | null;
  } | null;
};

/** The columns 0177 + 0180 grant a signed-in user — `select *` is refused. */
const REFERRAL_COLUMNS =
  "id, referrer_id, referee_id, status, signed_up_at, first_card_at, cards_saved_at, card_on_file_at, ladder_step, rewarded_at, referrer_reward";

export async function getMyReferralDashboard(now: Date = new Date()): Promise<ReferralDashboard | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  const [settings, { data: code }, { data: made }, { data: mine }, bank] = await Promise.all([
    readReferralSettings(supabase),
    supabase.rpc("my_referral_code"),
    supabase
      .from("referrals")
      .select(REFERRAL_COLUMNS)
      .eq("referrer_id", user.id)
      .order("signed_up_at", { ascending: false })
      .limit(200),
    // The friend's own row: their side only — never the referrer's reward.
    supabase
      .from("referrals")
      .select("id, referrer_id, status, cards_saved_at, first_card_at, card_on_file_at, referee_reward")
      .eq("referee_id", user.id)
      .maybeSingle(),
    readBank(supabase, user.id),
  ]);

  // A friend whose account was deleted keeps the row (referee_id NULL, 0177).
  const ids = [
    ...new Set(
      [...(made ?? []).map((r) => r.referee_id), ...(mine ? [mine.referrer_id] : [])].filter(
        (id): id is string => typeof id === "string",
      ),
    ),
  ];
  const names = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, username").in("id", ids);
    for (const p of profiles ?? []) names.set(p.id, p.username ?? null);
  }

  const rows: ReferralRow[] = (made ?? [])
    .filter((r) => isReferralStatus(r.status))
    .map((r) => ({
      id: r.id,
      username: r.referee_id ? (names.get(r.referee_id) ?? null) : null,
      accountDeleted: r.referee_id == null,
      status: r.status as ReferralStatus,
      signedUpAt: r.signed_up_at,
      cardsSavedAt: r.cards_saved_at ?? r.first_card_at,
      cardOnFileAt: r.card_on_file_at,
      rewardedAt: r.rewarded_at,
      ladderStep: r.ladder_step,
      reward:
        r.referrer_reward === "banked_days" || r.referrer_reward === "free_days" || r.referrer_reward === "credits"
          ? r.referrer_reward
          : null,
    }));

  return {
    code: typeof code === "string" ? code : null,
    link: typeof code === "string" ? referralLink(getSiteBaseUrl(), code) : null,
    rows,
    summary: buildReferralSummary(rows, settings, now),
    settings,
    bank,
    joinedThrough:
      mine && isReferralStatus(mine.status)
        ? {
            username: names.get(mine.referrer_id) ?? null,
            status: mine.status,
            cardsSaved: (mine.cards_saved_at ?? mine.first_card_at) != null,
            cardOnFile: mine.card_on_file_at != null,
            rewarded:
              mine.referee_reward == null
                ? null
                : mine.referee_reward === "banked_days" || mine.referee_reward === "free_days" || mine.referee_reward === "credits",
          }
        : null,
  };
}
