import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSupabaseAuthCookieName } from "@/lib/supabase/session-cookie";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { readReferralSettings } from "@/lib/referrals/settings-server";
import { friendRewardPhrase } from "@/lib/referrals/settings";
import { normalizeReferralCode } from "@/lib/referrals/rules";
import { isBillingEnabled } from "@/lib/billing/flags";
import { SIGNUP_BANK_DAYS } from "@/lib/billing/day-bank";
import { buildReferralSummary, type ReferralRow } from "@/lib/referrals/summary";
import { isReferralStatus } from "@/lib/referrals/rules";
import { ladderProgressOf, type LadderProgress } from "@/lib/referrals/ladder-progress";

// ---------------------------------------------------------------------------
// GET /api/referrals/share — what a share surface needs to carry the viewer's
// referral link (TODO SG1): whether the program is on, what the FRIEND gets
// (the settings' words), and the viewer's code — null for a visitor, so the
// same answer tells the card page's landing note whether to show.
//
// Read on demand (a share dialog opening, a `?ref` landing), never on every
// page view. Per-visitor: `private, no-store`. A visitor without a session
// cookie never touches Supabase auth.
// ---------------------------------------------------------------------------

export type ReferralShareInfo = {
  enabled: boolean;
  /** "7 free days" — null while the program is off. */
  friendGets: string | null;
  /** The activation bar (0180): cards to save, within how many days of signing up. */
  cardsRequired: number | null;
  windowDays: number | null;
  /** The days every new account banks at signup (0179) — the sign-up note's number. */
  signupDays: number | null;
  /** The viewer's referral code; null for a visitor or with the program off. */
  code: string | null;
  /** The viewer's place on the ladder (TODO SG4: the share dialog's line);
   *  null for a visitor, with the program off, or when their rows can't be read. */
  ladder: LadderProgress | null;
};

const NO_STORE = { "cache-control": "private, no-store" };
const OFF: ReferralShareInfo = { enabled: false, friendGets: null, cardsRequired: null, windowDays: null, signupDays: null, code: null, ladder: null };

export async function GET() {
  if (!isSupabaseConfigured() || !isBillingEnabled()) {
    return NextResponse.json(OFF, { headers: NO_STORE });
  }
  const settings = await readReferralSettings(createPublicClient());
  if (!settings.enabled) return NextResponse.json(OFF, { headers: NO_STORE });
  const on = {
    enabled: true,
    friendGets: friendRewardPhrase(settings),
    cardsRequired: settings.activation.cardsRequired,
    windowDays: settings.activation.windowDays,
    signupDays: SIGNUP_BANK_DAYS,
  };

  const store = await cookies();
  const hasSessionCookie = store.getAll().some(({ name }) => isSupabaseAuthCookieName(name));
  if (!hasSessionCookie) {
    return NextResponse.json({ ...on, code: null, ladder: null } satisfies ReferralShareInfo, { headers: NO_STORE });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ...on, code: null, ladder: null } satisfies ReferralShareInfo, { headers: NO_STORE });
  }
  const supabase = await createClient();
  const [{ data }, { data: made }] = await Promise.all([
    supabase.rpc("my_referral_code"),
    // The viewer's own rows (RLS + 0177's column grant): their status is
    // all the ladder needs. A failed read is "no ladder", never an error.
    supabase.from("referrals").select("id, status").eq("referrer_id", user.id).limit(500),
  ]);
  const code = normalizeReferralCode(data);
  const rows: ReferralRow[] = (made ?? [])
    .filter((r): r is { id: string; status: string } => typeof r?.status === "string" && isReferralStatus(r.status))
    .map((r) => ({
      id: r.id,
      username: null,
      status: r.status as ReferralRow["status"],
      signedUpAt: "",
      cardsSavedAt: null,
      cardOnFileAt: null,
      rewardedAt: null,
      ladderStep: null,
      reward: null,
    }));
  const ladder = made ? ladderProgressOf(buildReferralSummary(rows, settings)) : null;
  return NextResponse.json({ ...on, code, ladder } satisfies ReferralShareInfo, { headers: NO_STORE });
}
