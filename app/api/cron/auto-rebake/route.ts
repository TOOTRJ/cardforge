import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isBillingEnabled } from "@/lib/billing/flags";
import { cronRouteGuard } from "@/lib/api/cron-auth";
import { runAutoRebake } from "@/lib/cards/auto-rebake";

// ---------------------------------------------------------------------------
// /api/cron/auto-rebake — the automatic re-bake (lib/cards/auto-rebake.ts).
// Every 10 minutes on production (vercel.json): re-bakes the published cards
// a "sweep" layout bump (or a null stamp) left on an older render, in
// batches, for up to ~240 s per invocation, then again 10 minutes later
// until nothing is pending. Costs a couple of queries when idle.
//
// Shares ONE lease with the manual drivers (POST /api/admin/rebake +
// scripts/rebake-renders.mjs, POST /api/admin/rebake-marked) — never two
// sweepers at once (lib/cards/sweep-lease.ts). A breaker pauses it and
// alerts the admins when failures look systemic; /admin/renders shows the
// state and resumes it.
//
// Refuses (412) without NEXT_PUBLIC_BILLING_ENABLED — the bake would be
// clean. Secured by CRON_SECRET like every cron route. By hand:
//
//   curl https://www.pipglyph.com/api/cron/auto-rebake \
//        -H "Authorization: Bearer $CRON_SECRET"
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = cronRouteGuard(request);
  if (denied) return denied;
  const result = await runAutoRebake(createAdminClient(), { billingEnabled: isBillingEnabled() });
  if (!result.ok) {
    return NextResponse.json(result, { status: result.outcome === "refused" ? 412 : 500 });
  }
  return NextResponse.json(result);
}
