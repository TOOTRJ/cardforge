import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { currentCreditPeriod } from "@/lib/billing/plans";
import { refillActiveSubscribers } from "@/lib/billing/credit-refill";

// ---------------------------------------------------------------------------
// /api/cron/refill-credits — monthly AI-credit refill for active subscribers.
//
// Cron-driven so BOTH monthly and annual plans get a monthly allotment. Runs
// daily (see vercel.json); the per-user-per-month idempotency key means only
// the first successful run each calendar month actually grants — later runs
// (and the same-month grant on subscription.created) are no-ops. That also makes
// the job self-healing: if one day's run fails, the next day catches up — and
// via the shared credit-refill helper it also backfills the mid-month upgrade
// top-up if the webhook missed the tier change. The sweep itself (pagination,
// trialing exclusion, per-user grants) lives in lib/billing/credit-refill.ts.
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

  const result = await refillActiveSubscribers(admin, period);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    period,
    processed: result.processed,
    granted: result.granted,
    failed: result.failed,
  });
}
