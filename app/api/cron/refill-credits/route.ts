import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import {
  MONTHLY_CREDITS,
  creditRefillKey,
  currentCreditPeriod,
  type PlanTier,
} from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// /api/cron/refill-credits — monthly AI-credit refill for active subscribers.
//
// Cron-driven so BOTH monthly and annual plans get a monthly allotment. Runs
// daily (see vercel.json); the per-user-per-month idempotency key means only
// the first successful run each calendar month actually grants — later runs
// (and the same-month grant on subscription.created) are no-ops. That also makes
// the job self-healing: if one day's run fails, the next day catches up.
//
// Secured by CRON_SECRET — Vercel sends it as `Authorization: Bearer <secret>`
// on scheduled invocations.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Service role not configured." },
      { status: 503 },
    );
  }

  const admin = createAdminClient();
  const period = currentCreditPeriod();

  const { data: subscribers, error } = await admin
    .from("profiles")
    .select("id, subscription_tier")
    .in("subscription_status", ["active", "trialing"])
    .in("subscription_tier", ["plus", "pro"]);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let granted = 0;
  let failed = 0;
  for (const profile of subscribers ?? []) {
    const amount = MONTHLY_CREDITS[profile.subscription_tier as PlanTier] ?? 0;
    if (amount <= 0) continue;
    const { error: grantError } = await admin.rpc("grant_credits", {
      p_user_id: profile.id,
      p_amount: amount,
      p_reason: "subscription_refill",
      p_idempotency_key: creditRefillKey(profile.id, period),
    });
    if (grantError) failed += 1;
    else granted += 1;
  }

  return NextResponse.json({
    ok: true,
    period,
    processed: subscribers?.length ?? 0,
    granted,
    failed,
  });
}
