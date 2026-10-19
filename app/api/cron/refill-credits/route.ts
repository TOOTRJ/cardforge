import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentCreditPeriod } from "@/lib/billing/plans";
import { refillActiveSubscribers } from "@/lib/billing/credit-refill";
import {
  ALERT_USER_IDS_MAX,
  cronAlertDedupeKey,
  cutError,
  notifyAdminsCreditRefillFailed,
} from "@/lib/billing/credit-alerts";
import { cronRouteGuard } from "@/lib/api/cron-auth";

// ---------------------------------------------------------------------------
// /api/cron/refill-credits — the monthly AI-credit allotment of every paid
// account: an active Plus / Pro subscription, or an unexpired admin comp.
// Free does NOT refill (owner decision 2026-09-24: SIGNUP_CREDITS once).
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
// Failures are LOUD (2026-10-18): each failed grant is logged with its user
// id, every admin gets ONE `credit_refill_failed` notification per UTC day
// while failures persist (lib/billing/credit-alerts.ts), and the response is
// a 500 so the run shows as failed in Vercel's cron logs. A 500 is safe:
// Vercel does not retry a failed cron invocation, and a rerun (manual, or a
// duplicate delivery) grants nothing twice — every grant is keyed
// (credit_ledger's unique idempotency_key, migration 0027).
//
// Secured by CRON_SECRET — Vercel sends it as `Authorization: Bearer <secret>`
// on scheduled invocations.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = cronRouteGuard(request);
  if (denied) return denied;

  const admin = createAdminClient();
  const period = currentCreditPeriod();
  const now = new Date();

  const failures: Array<{ userId: string; error: string }> = [];
  const result = await refillActiveSubscribers(admin, period, {
    onGrantFailed: (userId, error) => failures.push({ userId, error }),
  });

  const failed = result.ok ? result.failed : failures.length;
  if (!result.ok || failed > 0) {
    await notifyAdminsCreditRefillFailed(admin, {
      source: "cron",
      dedupeKey: cronAlertDedupeKey(now),
      period,
      day: now.toISOString().slice(0, 10),
      processed: result.ok ? result.processed : null,
      granted: result.ok ? result.granted : null,
      failed,
      pageError: result.ok ? null : cutError(result.error),
      userIds: failures.slice(0, ALERT_USER_IDS_MAX).map((f) => f.userId),
      error: failures[0] ? cutError(failures[0].error) : null,
    });
  }

  if (!result.ok) {
    return NextResponse.json({ ok: false, period, failed, error: result.error }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: failed === 0,
      period,
      processed: result.processed,
      granted: result.granted,
      failed,
    },
    { status: failed > 0 ? 500 : 200 },
  );
}
