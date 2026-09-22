import { NextResponse } from "next/server";
import { isAdminConfigured } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// The two guards every cron route (and the admin re-bake sweep) opens with.
// Vercel sends `Authorization: Bearer <CRON_SECRET>` on scheduled
// invocations; scripts/rebake-renders.mjs and a manual curl pass the same
// header. The check fails CLOSED — no secret configured means nobody is
// authorized — and the routes need the service role to do their work.
// ---------------------------------------------------------------------------

export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Returns the response to send when the request may NOT proceed (401 for a
 * missing/wrong bearer, 503 when the service-role key isn't configured), or
 * null when it may. `authorized` lets a route substitute its own bearer
 * decision (the re-bake route's local dev bypass).
 */
export function cronRouteGuard(
  request: Request,
  options: { authorized?: boolean } = {},
): NextResponse | null {
  if (!(options.authorized ?? isCronAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Service role not configured (SUPABASE_SECRET_KEY)." },
      { status: 503 },
    );
  }
  return null;
}
