import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileOrphanedSpends } from "@/lib/billing/credit-reconcile";
import { cronRouteGuard } from "@/lib/api/cron-auth";

// ---------------------------------------------------------------------------
// /api/cron/reconcile-credits — daily sweep refunding credit charges
// orphaned by a platform kill (charge committed mid-step, refund never ran).
// The rule (aged + unsettled = refund), the ref format, and the exactly-once
// refund keying live in lib/billing/credit-reconcile.ts (migration 0068 made
// spends traceable; 0106 moved the settlement proof onto the ledger row).
//
// Cadence is DAILY (see vercel.json) because the Hobby plan rejects any
// schedule more frequent than once per day — the whole deployment fails at
// creation, no build logs (learned 2026-07-28). An eaten credit comes back
// within a day (vs. never, before this sweep existed); on Pro this can
// tighten to hourly by editing the schedule alone — every pass is
// idempotent, so cadence is purely a latency knob. NOTE: Hobby also caps
// crons at 2 total, and refill + reconcile now use both slots.
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
