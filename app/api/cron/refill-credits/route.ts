import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { currentCreditPeriod, type PlanTier } from "@/lib/billing/plans";
import { grantMonthlyCreditsForPeriod } from "@/lib/billing/credit-refill";

// ---------------------------------------------------------------------------
// /api/cron/refill-credits — monthly AI-credit refill for active subscribers.
//
// Cron-driven so BOTH monthly and annual plans get a monthly allotment. Runs
// daily (see vercel.json); the per-user-per-month idempotency key means only
// the first successful run each calendar month actually grants — later runs
// (and the same-month grant on subscription.created) are no-ops. That also makes
// the job self-healing: if one day's run fails, the next day catches up — and
// via the shared credit-refill helper it also backfills the mid-month upgrade
// top-up if the webhook missed the tier change.
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

  // ACTIVE only — trialing is deliberately excluded. A trial's single grant
  // lands on subscription.created (see webhook-handlers.ts); refilling
  // trialing here let a no-card 7-day trial spanning a month boundary bank a
  // second never-expiring allotment without ever paying. A trial is ≤7 days,
  // so it never legitimately needs a monthly refill.
  const { data: subscribers, error } = await admin
    .from("profiles")
    .select("id, subscription_tier")
    .eq("subscription_status", "active")
    .in("subscription_tier", ["plus", "pro"]);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let granted = 0;
  let failed = 0;
  for (const profile of subscribers ?? []) {
    const result = await grantMonthlyCreditsForPeriod(
      admin,
      profile.id,
      profile.subscription_tier as PlanTier,
      period,
    );
    if (!result.ok) failed += 1;
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
