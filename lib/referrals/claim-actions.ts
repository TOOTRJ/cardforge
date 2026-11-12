"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isBillingEnabled } from "@/lib/billing/flags";
import { hitKeyedLimit } from "@/lib/api/keyed-limit";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { extractReferralCode } from "@/lib/referrals/rules";
import { advanceReferral, recordReferralSignup } from "@/lib/referrals/server";
import {
  REFERRAL_CODE_TOO_MANY_TRIES,
  REFERRAL_CODE_UNREADABLE,
  referralClaimError,
  type ClaimReferralResult,
} from "@/lib/referrals/claim-messages";

// ---------------------------------------------------------------------------
// "Have a referral code?" on the Refer a friend page (owner 2026-11-11): a
// NEW account whose browser lost its friend's link types the code, or pastes
// the link, and the referral is recorded as the link would have recorded it
// — by the same function, under the same rules (recordReferralSignup: the
// account young and never subscribed, one referral per account ever, not
// its own code, not a friend it referred itself). Nothing here is a second
// way in.
//
// A few tries a minute: a code is 8 characters, and a wrong one says so.
// The friend has often made their cards already, so the reward step runs
// right after the claim — after the response, never holding it up.
// ---------------------------------------------------------------------------

export async function claimReferralCodeAction(input: unknown): Promise<ClaimReferralResult> {
  if (!isBillingEnabled() || !isAdminConfigured()) return { ok: false, error: referralClaimError("program_off") };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to add a referral code." };

  const limit = await hitKeyedLimit({
    context: "referral-code-entry",
    subject: user.id,
    perMinute: 5,
    perHour: 20,
    message: REFERRAL_CODE_TOO_MANY_TRIES,
  });
  if (!limit.ok) return { ok: false, error: limit.message };

  const code = extractReferralCode((input as { code?: unknown } | null)?.code);
  if (!code) return { ok: false, error: REFERRAL_CODE_UNREADABLE };

  const admin = createAdminClient();
  const claim = await recordReferralSignup(admin, { refereeId: user.id, code });
  if (!claim.ok) return { ok: false, error: referralClaimError(claim.reason) };

  const refereeId = user.id;
  after(async () => {
    try {
      await advanceReferral(admin, refereeId, { stripe: isStripeConfigured() ? getStripe() : null });
    } catch (error) {
      console.error(`[referrals] advance after a typed code failed for ${refereeId}:`, error);
    }
  });
  revalidatePath("/dashboard/referrals");
  return { ok: true };
}
