import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronRouteGuard } from "@/lib/api/cron-auth";
import { announceDueArticles } from "@/lib/content/article-publish";

// ---------------------------------------------------------------------------
// /api/cron/publish-articles — the scheduled release of composer articles
// (migration 0153). Every 10 minutes (vercel.json). A scheduled article is
// already PUBLIC the moment its publish_at passes (RLS: is_published AND
// publish_at <= now(); the cached reads catch up within 5 minutes); this run
// is what makes it land everywhere at once — the article, the hubs, the
// sitemap, /llms.txt and the RSS feed purged, IndexNow told — and stamps
// `announced_at` so each release is announced once. Idempotent; safe to call
// by hand:
//
//   curl https://www.pipglyph.com/api/cron/publish-articles \
//        -H "Authorization: Bearer $CRON_SECRET"
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = cronRouteGuard(request);
  if (denied) return denied;
  try {
    const result = await announceDueArticles(createAdminClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
