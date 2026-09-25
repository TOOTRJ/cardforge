import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CARD_LAYOUT_VERSION, latestOptInVersion } from "@/lib/cards/layout-version";
import { notifyOwnersOfRenderUpdates } from "@/lib/cards/render-update-notify";
import { cronRouteGuard } from "@/lib/api/cron-auth";

// ---------------------------------------------------------------------------
// /api/cron/notify-render-updates — tell owners their cards have a newer
// look. Daily (vercel.json); idempotent per owner per newest OPT-IN version
// (latestOptInVersion — a sweep bump is platform work and never notifies),
// so it is safe to run any number of times and can be triggered by hand
// right after a deploy that adds an opt-in bump:
//
//   curl -X GET https://www.pipglyph.com/api/cron/notify-render-updates \
//        -H "Authorization: Bearer $CRON_SECRET"
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
  try {
    const result = await notifyOwnersOfRenderUpdates(createAdminClient());
    return NextResponse.json({
      ok: true,
      layoutVersion: CARD_LAYOUT_VERSION,
      notifiedVersion: latestOptInVersion(),
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
