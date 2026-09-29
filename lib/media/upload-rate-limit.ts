import "server-only";

import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import type { RateLimitDenied } from "@/lib/api/responses";

// ---------------------------------------------------------------------------
// The per-user UPLOAD rate limit (owner decision 2026-09-29, TODO 3.14b):
// 30 uploads a minute and 300 a rolling day per user; admins exempt.
//
// Every action that writes a user's file into their storage folder
// (lib/media/user-storage.ts) calls checkUploadRateLimit() right after its
// auth check and BEFORE any work on the bytes — card art, the design
// watermark / land icon, a deck cover / set icon, an avatar / banner, a
// custom pip, a Scryfall art import, and the copy a remix save makes of its
// parent's pictures. tests/unit/media/upload-rate-limit-callers.test.ts keeps
// that list closed. Not counted: the save bake and the admin sweep (our own
// renders, card-renders) and AI art (`persistGeneratedArt` — every image is
// paid for in credits, and every AI call, the FREE deck-cover step
// included, first passes checkAiRateLimit: 40 a minute, 500 a day,
// lib/ai/rate-limit.ts; a 100-card deck alone is 100 images, so 300 a day
// would stop a Pro user's third deck). Whether AI persists should also
// count here, in a larger bucket of their own, is an open owner question
// (review 2026-09-29).
//
// The counter is migration 0127's public.upload_hits, written ONLY by
// hit_upload_limit() (service role): one row per counted upload, sliding
// windows (the last 60 seconds, the last 24 hours), a per-user advisory lock
// so two parallel uploads can't both slip under the limit, and the admin
// check done in the database from profiles.is_admin — never from anything
// the caller sends. A refused call is not counted.
//
// Fail-CLOSED, except for one case (review 2026-09-29). The other limiters
// fail open, but an upload flood is exactly what produces timeouts and pool
// exhaustion, so failing open on "any error" would switch this limit off
// under the load it exists for. Only a MISSING function — a deployment live
// before its migration (PostgREST PGRST202, Postgres 42883) — lets the
// upload through; any other error, a throw or an empty answer refuses it
// with the typed UPLOAD_RATE_LIMITED error and a one-minute wait.
// ---------------------------------------------------------------------------

export const UPLOAD_RATE_LIMITS = { perMinute: 30, perDay: 300 } as const;

/** The code every refused upload carries, so a UI can tell it apart. */
export const UPLOAD_RATE_LIMITED = "UPLOAD_RATE_LIMITED" as const;

export const UPLOAD_TOO_FAST_MESSAGE = "You're uploading too fast — try again in a minute.";
export const UPLOAD_DAILY_LIMIT_MESSAGE = "Daily upload limit reached — try again tomorrow.";
/** The limit couldn't be checked (the counter failed): uploads wait a minute. */
export const UPLOAD_LIMIT_UNAVAILABLE_MESSAGE = "Uploads are paused for a moment — try again in a minute.";

export type UploadRateLimitDenied = RateLimitDenied & {
  code: typeof UPLOAD_RATE_LIMITED;
  /** Which window is full — or "unavailable" when the counter couldn't be
   *  read and the upload is refused to be safe. */
  window: "minute" | "day" | "unavailable";
};

/** The two errors that mean "hit_upload_limit isn't deployed yet": PostgREST
 *  can't find the function (PGRST202), or Postgres has none (42883). */
const FUNCTION_MISSING = new Set(["PGRST202", "42883"]);

const unavailable = (): { ok: false } & UploadRateLimitDenied => ({
  ok: false,
  code: UPLOAD_RATE_LIMITED,
  window: "unavailable",
  retryAfterSeconds: 60,
  message: UPLOAD_LIMIT_UNAVAILABLE_MESSAGE,
});

export type UploadRateLimitResult = { ok: true } | ({ ok: false } & UploadRateLimitDenied);

/** What an upload action's `{ ok: false }` may carry besides `error` — set
 *  only when the rate limit refused it. */
export type UploadLimitFields = {
  code?: typeof UPLOAD_RATE_LIMITED;
  retryAfterSeconds?: number;
};

/** The `{ ok: false }` an upload action returns when the limit refuses it:
 *  its usual `error` string plus the typed code and wait. */
export function uploadRateLimitFailure(denied: UploadRateLimitDenied): {
  ok: false;
  error: string;
  code: typeof UPLOAD_RATE_LIMITED;
  retryAfterSeconds: number;
} {
  return {
    ok: false,
    error: denied.message,
    code: denied.code,
    retryAfterSeconds: denied.retryAfterSeconds,
  };
}

/**
 * Count one upload for `userId`, or refuse it. `userId` is the id the action
 * got from its own auth check. Call it once per upload action, before the
 * bytes are processed or written. Without the service role (a checkout with
 * no SUPABASE_SECRET_KEY) it lets the call through: the upload itself then
 * fails with its own "not configured" error.
 */
export async function checkUploadRateLimit(userId: string): Promise<UploadRateLimitResult> {
  if (!userId || !isAdminConfigured()) return { ok: true };
  try {
    const { data, error } = await createAdminClient().rpc("hit_upload_limit", {
      p_user_id: userId,
      p_per_minute: UPLOAD_RATE_LIMITS.perMinute,
      p_per_day: UPLOAD_RATE_LIMITS.perDay,
    });
    if (error) {
      if (FUNCTION_MISSING.has(String(error.code ?? ""))) return { ok: true };
      console.error(`[upload-rate-limit] hit_upload_limit failed for ${userId} — refusing the upload:`, error.message);
      return unavailable();
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || typeof row.allowed !== "boolean") {
      console.error(`[upload-rate-limit] hit_upload_limit gave no answer for ${userId} — refusing the upload.`);
      return unavailable();
    }
    if (row.allowed) return { ok: true };
    const window = row.limited_by === "day" ? "day" : "minute";
    return {
      ok: false,
      code: UPLOAD_RATE_LIMITED,
      window,
      retryAfterSeconds: Math.max(1, Math.ceil(Number(row.retry_after_seconds) || 60)),
      message: window === "day" ? UPLOAD_DAILY_LIMIT_MESSAGE : UPLOAD_TOO_FAST_MESSAGE,
    };
  } catch (err) {
    console.error(
      `[upload-rate-limit] hit_upload_limit threw for ${userId} — refusing the upload:`,
      err instanceof Error ? err.message : err,
    );
    return unavailable();
  }
}
