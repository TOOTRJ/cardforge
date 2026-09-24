import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSupabaseAuthCookieName } from "@/lib/supabase/session-cookie";
import { getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isClientFunnelEvent, sanitizeFunnelProps } from "@/lib/analytics/funnel-events";
import { recordFunnelEvent } from "@/lib/analytics/funnel-server";

// ---------------------------------------------------------------------------
// POST /api/events — the browser's funnel steps (pricing_view, cta_click,
// upgrade_modal_open). Allow-listed event names, allow-listed scalar props,
// a 2 KB body cap, and only same-site callers (a cross-site fetch can't
// pollute the funnel). Signed-out visitors are recorded with NO identifier;
// a signed-in visitor's row carries their user id. Always 204: this must
// never make the page care.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2048;
const NO_STORE = { "cache-control": "private, no-store" };

export async function POST(request: Request): Promise<Response> {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "same-site") {
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  }
  if (!isAdminConfigured()) return new NextResponse(null, { status: 204, headers: NO_STORE });

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  }
  if (!raw || raw.length > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  }
  let body: { event?: unknown; props?: unknown };
  try {
    body = JSON.parse(raw) as { event?: unknown; props?: unknown };
  } catch {
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  }
  if (!isClientFunnelEvent(body.event)) {
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  }

  // Attribution only when a session cookie is present — the anonymous hot
  // path never touches auth.
  let userId: string | null = null;
  try {
    const store = await cookies();
    if (store.getAll().some(({ name }) => isSupabaseAuthCookieName(name))) {
      userId = (await getCurrentUser())?.id ?? null;
    }
  } catch {
    userId = null;
  }

  await recordFunnelEvent(createAdminClient(), {
    event: body.event,
    userId,
    props: { ...sanitizeFunnelProps(body.props), signedIn: userId != null },
    source: "client",
  });
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
