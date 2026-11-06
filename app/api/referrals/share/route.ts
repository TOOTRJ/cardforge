import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSupabaseAuthCookieName } from "@/lib/supabase/session-cookie";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { readReferralSettings } from "@/lib/referrals/settings-server";
import { rewardPhrase } from "@/lib/referrals/settings";
import { normalizeReferralCode } from "@/lib/referrals/rules";
import { isBillingEnabled } from "@/lib/billing/flags";

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
  /** "30 free days of Plus" — null while the program is off. */
  friendGets: string | null;
  /** The viewer's referral code; null for a visitor or with the program off. */
  code: string | null;
};

const NO_STORE = { "cache-control": "private, no-store" };
const OFF: ReferralShareInfo = { enabled: false, friendGets: null, code: null };

export async function GET() {
  if (!isSupabaseConfigured() || !isBillingEnabled()) {
    return NextResponse.json(OFF, { headers: NO_STORE });
  }
  const settings = await readReferralSettings(createPublicClient());
  if (!settings.enabled) return NextResponse.json(OFF, { headers: NO_STORE });
  const friendGets = rewardPhrase(settings.friend);

  const store = await cookies();
  const hasSessionCookie = store.getAll().some(({ name }) => isSupabaseAuthCookieName(name));
  if (!hasSessionCookie) {
    return NextResponse.json({ enabled: true, friendGets, code: null } satisfies ReferralShareInfo, { headers: NO_STORE });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ enabled: true, friendGets, code: null } satisfies ReferralShareInfo, { headers: NO_STORE });
  }
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_referral_code");
  const code = normalizeReferralCode(data);
  return NextResponse.json({ enabled: true, friendGets, code } satisfies ReferralShareInfo, { headers: NO_STORE });
}
