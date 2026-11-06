"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { REFERRAL_SETTINGS_KEY, referralSettingsSchema, type ReferralSettings } from "@/lib/referrals/settings";

// The admin's one write of the referral settings (lib/referrals/settings.ts):
// the whole value, validated, upserted on the `referrals` site_settings row
// with who changed it. Rewards already granted are untouched — the settings
// are read at grant time.

export type SaveReferralSettingsResult = { ok: true; settings: ReferralSettings } | { ok: false; error: string };

export async function adminSaveReferralSettingsAction(input: unknown): Promise<SaveReferralSettingsResult> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) return { ok: false, error: "Not authorized." };
  if (!isAdminConfigured()) return { ok: false, error: "Admin client isn't configured." };
  const parsed = referralSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid settings." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("site_settings")
    .upsert(
      { key: REFERRAL_SETTINGS_KEY, value: parsed.data, updated_at: new Date().toISOString(), updated_by: profile.id },
      { onConflict: "key" },
    );
  if (error) {
    console.warn("adminSaveReferralSettingsAction: upsert error", error.message);
    return { ok: false, error: "Couldn't save the referral settings." };
  }
  revalidatePath("/admin/users");
  revalidatePath("/dashboard/referrals");
  return { ok: true, settings: parsed.data };
}
