import "server-only";

import { createHmac } from "node:crypto";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import type { RateLimitDenied } from "@/lib/api/responses";

// ---------------------------------------------------------------------------
// A per-subject limit on an expensive route, with no table of its own.
//
// Migration 0125's counter (`hit_anon_render_limit`, service role only) was
// built for anonymous live renders and has had no caller since downloads
// became signed-in only. It is a plain keyed counter — minute windows, an
// advisory lock per key, a count over the last hour — and that is all an
// expensive signed-in route needs. `hitKeyedLimit` counts one call for a
// subject under a context, or refuses it:
//
//   - the stored key is an HMAC of (context, subject) under the server's
//     secret: 32 hex digits, never the user id, and two contexts never share
//     a counter;
//   - fail-OPEN like every per-user limiter here (lib/ai/rate-limit.ts): a
//     database hiccup must not turn a download into an error;
//   - a refused call is not counted.
//
// A new caller picks its own context string and limits; it needs no
// migration.
// ---------------------------------------------------------------------------

export type KeyedLimitResult = { ok: true } | ({ ok: false } & RateLimitDenied);

/** The counter's key for `subject` under `context`: 32 hex digits. */
export function keyedLimitKey(context: string, subject: string, secret: string): string {
  return createHmac("sha256", secret).update(`pipglyph:keyed-limit:v1\n${context}\n${subject}`).digest("hex").slice(0, 32);
}

/** Count one call, or refuse it with how long to wait. */
export async function hitKeyedLimit(input: {
  /** What is being limited: its own counter ("token-kit-render"). */
  context: string;
  /** Who: a user id. */
  subject: string;
  perMinute: number;
  perHour: number;
  /** What the refused caller reads. */
  message: string;
}): Promise<KeyedLimitResult> {
  const secret = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!secret || !isAdminConfigured()) return { ok: true };
  try {
    const { data, error } = await createAdminClient().rpc("hit_anon_render_limit", {
      p_key_hash: keyedLimitKey(input.context, input.subject, secret),
      p_per_minute: input.perMinute,
      p_per_hour: input.perHour,
    });
    const row = Array.isArray(data) ? data[0] : null;
    // Fail-open — but said: a counter that is broken is a limit that is off.
    if (error) console.warn(`[limit] ${input.context}: the counter did not answer (${error.message}) — the call is let through.`);
    if (!error && !row) console.warn(`[limit] ${input.context}: the counter answered nothing — the call is let through.`);
    if (error || !row || row.allowed !== false) return { ok: true };
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil(Number(row.retry_after_seconds) || 60)),
      message: input.message,
    };
  } catch (error) {
    console.warn(`[limit] ${input.context}: the counter did not answer (${error instanceof Error ? error.message : error}) — the call is let through.`);
    return { ok: true };
  }
}
