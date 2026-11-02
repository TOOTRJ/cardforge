import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronRouteGuard } from "@/lib/api/cron-auth";
import { sendCompEndingReminders } from "@/lib/billing/comp-ending-run";

// ---------------------------------------------------------------------------
// /api/cron/comp-ending — "your complimentary plan ends soon", 7 days and
// 1 day before an admin comp ends (lib/billing/comp-ending.ts). Daily
// (vercel.json); idempotent per comp per window (migration 0161's unique
// index), so it is safe to run any number of times:
//
//   curl -X GET https://www.pipglyph.com/api/cron/comp-ending \
//        -H "Authorization: Bearer $CRON_SECRET"
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = cronRouteGuard(request);
  if (denied) return denied;
  try {
    const result = await sendCompEndingReminders(createAdminClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
