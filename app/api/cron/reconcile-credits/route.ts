import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { reconcileOrphanedSpends } from "@/lib/billing/credit-reconcile";

// ---------------------------------------------------------------------------
// /api/cron/reconcile-credits — hourly sweep refunding credit charges
// orphaned by a platform kill (charge committed mid-step, refund never ran).
// The rule, the ref format, and the exactly-once refund keying live in
// lib/billing/credit-reconcile.ts (migration 0068 made spends traceable).
// Runs hourly (see vercel.json) so an eaten credit comes back within the
// hour; every pass is idempotent, so overlap and re-runs are free.
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

  const result = await reconcileOrphanedSpends(createAdminClient());
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    scanned: result.scanned,
    legitimate: result.legitimate,
    refunded: result.refunded,
    failed: result.failed,
  });
}
