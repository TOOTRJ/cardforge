import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileOrphanedSpends } from "@/lib/billing/credit-reconcile";
import { cronRouteGuard } from "@/lib/api/cron-auth";

// ---------------------------------------------------------------------------
// /api/cron/reconcile-credits — hourly sweep refunding credit charges
// orphaned by a platform kill (charge committed mid-step, refund never ran).
// The rule (aged + unsettled = refund), the ref format, and the exactly-once
// refund keying live in lib/billing/credit-reconcile.ts (migration 0068 made
// spends traceable; 0106 moved the settlement proof onto the ledger row).
//
// Cadence is HOURLY (vercel.json, 2026-10-28): it was daily while the
// project was on Hobby, which rejects any schedule more frequent than once
// per day (learned 2026-07-28); the five-minute auto-rebake cron proves the
// plan no longer is. Every pass is idempotent, so cadence is purely a
// latency knob: an eaten credit now comes back within the hour — or at the
// user's next AI action, where the jobs and ideas routes run the same sweep
// for that user first (reconcileUserSpends).
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

  const result = await reconcileOrphanedSpends(createAdminClient());
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    scanned: result.scanned,
    settled: result.settled,
    refunded: result.refunded,
    failed: result.failed,
  });
}
