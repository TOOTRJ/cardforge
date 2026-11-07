import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronRouteGuard } from "@/lib/api/cron-auth";
import { unlistPublicExactCopies } from "@/lib/cards/exact-copy-sweep";

// ---------------------------------------------------------------------------
// /api/cron/exact-copies — a public card that is still exactly the real card
// it was imported from goes unlisted, and its owner is told once
// (lib/cards/exact-copy-sweep.ts; owner 2026-11-06: the public gallery shows
// only customised cards). Hourly (vercel.json); idempotent, so it is safe to
// run any number of times:
//
//   curl -X GET https://www.pipglyph.com/api/cron/exact-copies \
//        -H "Authorization: Bearer $CRON_SECRET"
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = cronRouteGuard(request);
  if (denied) return denied;
  try {
    const result = await unlistPublicExactCopies(createAdminClient());
    // A failure is visible (as refill-credits does): Vercel marks the run red.
    if (result.errors > 0) return NextResponse.json({ ok: false, ...result }, { status: 500 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
