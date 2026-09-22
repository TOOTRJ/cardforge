import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Response helpers shared by the route handlers under app/api.
// ---------------------------------------------------------------------------

/** The `{ ok: false }` half of every rate-limit check's result
 *  (lib/ai/rate-limit.ts, lib/scryfall/rate-limit.ts). */
export type RateLimitDenied = { message: string; retryAfterSeconds: number };

/** 429 with a Retry-After header for a failed rate-limit check — one shape
 *  for every route, so the client's backoff can rely on the header. */
export function rateLimitedResponse(limit: RateLimitDenied): NextResponse {
  return NextResponse.json(
    { ok: false, error: limit.message },
    { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
  );
}
