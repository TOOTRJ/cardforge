import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { DEFAULT_REFERRAL_SETTINGS, REFERRAL_SETTINGS_KEY, parseReferralSettings, type ReferralSettings } from "@/lib/referrals/settings";

/** The program's settings from `site_settings` (any client: the row is
 *  readable by everyone). A missing row or a failed read is the DEFAULT —
 *  the program is on unless an admin turned it off. */
export async function readReferralSettings(
  client: Pick<SupabaseClient<Database>, "from">,
): Promise<ReferralSettings> {
  try {
    const { data, error } = await client.from("site_settings").select("value").eq("key", REFERRAL_SETTINGS_KEY).maybeSingle();
    if (error || !data) return DEFAULT_REFERRAL_SETTINGS;
    return parseReferralSettings((data as { value: unknown }).value);
  } catch {
    return DEFAULT_REFERRAL_SETTINGS;
  }
}
