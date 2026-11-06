import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentCreditPeriod } from "@/lib/billing/plans";
import { grantFreeDaysCredits } from "@/lib/billing/free-days-credits";
import { releaseStaleReservations } from "@/lib/billing/day-bank";
import {
  ALERT_USER_IDS_MAX,
  cronAlertDedupeKey,
  cutError,
  notifyAdminsCreditRefillFailed,
} from "@/lib/billing/credit-alerts";
import { cronRouteGuard } from "@/lib/api/cron-auth";

// ---------------------------------------------------------------------------
// /api/cron/refill-credits — since owner 2026-11-06 PLAN CREDITS ARE
// ONE-TIME (lib/billing/credit-refill.ts: the paid invoice grants them, the
// bank's first application the free-period credits), so no subscriber is
// refilled here any more. What the daily run still does: the allotments of
// the DATED free-days grants given before that date (comps as overlays,
// lib/billing/free-days-credits.ts — they run out on their own dates), and
// the days bank's stale reservations.
//
// Runs daily (see vercel.json); every grant is keyed, so a rerun grants
// nothing twice and a missed day is caught up the next.
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
  // The old dated free-days grants' allotments, until they run out.
  const grants = await grantFreeDaysCredits(admin, {
    now,
    onGrantFailed: (userId, error) => failures.push({ userId, error }),
  });
  // The days bank (0179): a Checkout reservation nothing settled in a day
  // goes back to the bank (the hourly referral sweep does the same).
  const bankReleased = await releaseStaleReservations(admin, now);

  const failed = grants.ok ? grants.failed : failures.length;
  const pageError = !grants.ok ? `plan_grants: ${grants.error}` : null;
  if (!grants.ok || failed > 0) {
    await notifyAdminsCreditRefillFailed(admin, {
      source: "cron",
      dedupeKey: cronAlertDedupeKey(now),
      period,
      day: now.toISOString().slice(0, 10),
      processed: grants.ok ? grants.processed : null,
      granted: grants.ok ? grants.granted : null,
      failed,
      pageError: pageError ? cutError(pageError) : null,
      userIds: failures.slice(0, ALERT_USER_IDS_MAX).map((f) => f.userId),
      error: failures[0] ? cutError(failures[0].error) : null,
    });
  }

  if (!grants.ok) {
    return NextResponse.json({ ok: false, period, failed, error: pageError }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: failed === 0,
      period,
      // No subscriber sweep since 2026-11-06 (plan credits are one-time).
      processed: 0,
      granted: 0,
      failed,
      grants: { processed: grants.processed, granted: grants.granted, failed: grants.failed },
      bankReleased,
    },
    { status: failed > 0 ? 500 : 200 },
  );
}
