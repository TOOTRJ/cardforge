import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getSiteBaseUrl } from "@/lib/site-url";
import { REFERRAL_CLAIM_WINDOW_DAYS, isReferralStatus, referralLink, type ReferralStatus } from "@/lib/referrals/rules";
import { buildReferralSummary, type ReferralRow, type ReferralSummary } from "@/lib/referrals/summary";
import { readReferralSettings } from "@/lib/referrals/settings-server";
import type { ReferralSettings } from "@/lib/referrals/settings";
import { readBank, type Bank } from "@/lib/billing/day-bank";

// ---------------------------------------------------------------------------
// The referral dashboard's one read (/dashboard/referrals) — the viewer's own
// session, through 0177 / 0180's RLS and COLUMN grants: the code (minted on
// first ask), the friends they referred (status, the cards stamp and the
// ladder step — never a fraud reason, a Stripe detail or whether a friend
// went on to subscribe), the referral that
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
  /** "Joined because of a friend?" — open while the account has no referral,
   *  the program is on, the account never started a plan and it is inside
   *  the claim window (owner 2026-11-11: new accounts only). `until` is when
   *  the window closes. The server judges it again, and the code itself. */
  codeEntry: { open: boolean; until: string | null };
  /** The referral that brought the viewer, if they joined through a link —
   *  its stamps, and whether THEIR side was rewarded (their own reward column). */
  joinedThrough: {
    username: string | null;
    status: ReferralStatus;
    cardsSaved: boolean;
    rewarded: boolean | null;
  } | null;
};

/** The columns 0177 + 0180 grant a signed-in user — `select *` is refused. */
const REFERRAL_COLUMNS =
  "id, referrer_id, referee_id, status, signed_up_at, first_card_at, cards_saved_at, ladder_step, rewarded_at, referrer_reward";

export async function getMyReferralDashboard(now: Date = new Date()): Promise<ReferralDashboard | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  const [settings, { data: code }, { data: made }, { data: mine }, bank, { data: billing }] = await Promise.all([
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
      .select("id, referrer_id, status, cards_saved_at, first_card_at, referee_reward")
      .eq("referee_id", user.id)
      .maybeSingle(),
    readBank(supabase, user.id),
    // Whether the viewer ever started a plan — for the code-entry form.
    supabase.rpc("get_my_billing"),
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
      rewardedAt: r.rewarded_at,
      ladderStep: r.ladder_step,
      reward:
        r.referrer_reward === "banked_days" || r.referrer_reward === "free_days" || r.referrer_reward === "credits"
          ? r.referrer_reward
          : null,
    }));

  // The account's own age: the session's user carries when it was made.
  const madeAt = Date.parse(user.created_at ?? "");
  const windowEnds = Number.isFinite(madeAt) ? madeAt + REFERRAL_CLAIM_WINDOW_DAYS * 86_400_000 : null;
  // Never subscribed, as the claim itself asks (recordReferralSignup): a
  // status that could not be read keeps the form shut rather than offer
  // something the server would refuse.
  const billingRow = (Array.isArray(billing) ? billing[0] : billing) as { subscription_status?: string | null } | null | undefined;
  const neverSubscribed = billingRow != null && billingRow.subscription_status == null;
  const codeEntry = {
    open: settings.enabled && !mine && neverSubscribed && windowEnds != null && now.getTime() <= windowEnds,
    until: windowEnds != null ? new Date(windowEnds).toISOString() : null,
  };

  return {
    codeEntry,
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
            rewarded:
              mine.referee_reward == null
                ? null
                : mine.referee_reward === "banked_days" || mine.referee_reward === "free_days" || mine.referee_reward === "credits",
          }
        : null,
  };
}
