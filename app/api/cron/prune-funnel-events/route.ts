import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronRouteGuard } from "@/lib/api/cron-auth";
import { PERMANENT_FUNNEL_EVENTS } from "@/lib/analytics/funnel-events";

// ---------------------------------------------------------------------------
// /api/cron/prune-funnel-events — weekly: drop funnel rows older than the
// retention window (180 days), except the once-per-user milestones (signup,
// first_*), which are the activation record and stay. The Funnel panel looks
// at 7/30-day windows; anything older is history the revenue log and Stripe
// already keep better. Secured by CRON_SECRET like every cron route.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const FUNNEL_RETENTION_DAYS = 180;

export async function GET(request: Request) {
  const denied = cronRouteGuard(request);
  if (denied) return denied;

  const cutoff = new Date(Date.now() - FUNNEL_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await createAdminClient()
    .from("funnel_events")
    .delete({ count: "exact" })
    .lt("created_at", cutoff)
    .not("event", "in", `(${PERMANENT_FUNNEL_EVENTS.join(",")})`);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted: count ?? 0, cutoff });
}
