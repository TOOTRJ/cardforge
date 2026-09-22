import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendActivityDigests } from "@/lib/email/digest";
import { cronRouteGuard } from "@/lib/api/cron-auth";

// ---------------------------------------------------------------------------
// /api/cron/email-digest — the weekly activity digest (lib/email/digest.ts).
// Mondays 15:00 UTC in vercel.json; safe to trigger by hand, a repeat run
// the same day finds nothing new to send:
//
//   curl https://www.pipglyph.com/api/cron/email-digest \
//        -H "Authorization: Bearer $CRON_SECRET"
//
// Secured by CRON_SECRET like the other cron routes — and like them it fails
// CLOSED (401) until that env var is set in Vercel.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const denied = cronRouteGuard(request);
  if (denied) return denied;
  try {
    const result = await sendActivityDigests(createAdminClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
