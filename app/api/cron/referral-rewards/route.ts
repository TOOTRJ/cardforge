import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronRouteGuard } from "@/lib/api/cron-auth";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { sweepReferralRewards } from "@/lib/referrals/server";

// ---------------------------------------------------------------------------
// /api/cron/referral-rewards — the referral program's retry sweep
// (lib/referrals/server.ts sweepReferralRewards). A friend's first card
// rewards both sides at once; this finishes what that step couldn't: a row
// whose emails weren't confirmed yet, a run that died inside `after()`, a
// grant that failed (Stripe or the database). Hourly (vercel.json);
// idempotent — every grant is written once per referral and side — so it is
// safe to run any number of times:
//
//   curl -X GET https://www.pipglyph.com/api/cron/referral-rewards \
//        -H "Authorization: Bearer $CRON_SECRET"
//
// Does nothing while billing is off (NEXT_PUBLIC_BILLING_ENABLED).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = cronRouteGuard(request);
  if (denied) return denied;
  try {
    const result = await sweepReferralRewards(createAdminClient(), {
      stripe: isStripeConfigured() ? getStripe() : null,
      billingEnabled: isBillingEnabled(),
    });
    if (!result.ok) return NextResponse.json(result, { status: 500 });
    // A grant still failing is visible: Vercel marks the run red.
    if ("failed" in result && result.failed > 0) return NextResponse.json(result, { status: 500 });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
