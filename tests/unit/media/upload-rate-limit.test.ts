import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// lib/media/upload-rate-limit.ts — the per-user upload limit (owner decision
// 2026-09-29): 30 a minute, 300 a rolling day, admins exempt. The counting
// itself is migration 0127's hit_upload_limit() (its SQL behaviour — the
// 31st refused and not counted, the day cap, the admin exemption — is pinned
// in tests/unit/db/media-url-guards-migration.test.ts and proved on the CI
// stack by tests/e2e/media-url-guards.spec.ts). This checks the app's side:
// the numbers it asks for, the typed refusal the UI shows, and that it fails
// CLOSED — open only while the function isn't deployed yet (review
// 2026-09-29: a flood of uploads is what makes the counter time out).
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  configured: true,
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  answer: { data: [{ allowed: true, retry_after_seconds: 0, limited_by: null }], error: null } as {
    data: unknown;
    error: unknown;
  },
  throws: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => state.configured,
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      if (state.throws) throw new Error("network");
      return state.answer;
    },
  }),
}));

import {
  checkUploadRateLimit,
  UPLOAD_DAILY_LIMIT_MESSAGE,
  UPLOAD_LIMIT_UNAVAILABLE_MESSAGE,
  UPLOAD_RATE_LIMITS,
  UPLOAD_TOO_FAST_MESSAGE,
  uploadRateLimitFailure,
} from "@/lib/media/upload-rate-limit";

const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  state.configured = true;
  state.calls.length = 0;
  state.throws = false;
  state.answer = { data: [{ allowed: true, retry_after_seconds: 0, limited_by: null }], error: null };
});

describe("checkUploadRateLimit", () => {
  it("asks the database for 30 a minute and 300 a day, for the authenticated user", async () => {
    expect(UPLOAD_RATE_LIMITS).toEqual({ perMinute: 30, perDay: 300 });
    expect(await checkUploadRateLimit(USER)).toEqual({ ok: true });
    expect(state.calls).toEqual([
      { fn: "hit_upload_limit", args: { p_user_id: USER, p_per_minute: 30, p_per_day: 300 } },
    ]);
  });

  it("a full minute → the typed 'too fast' refusal with the database's wait", async () => {
    state.answer = { data: [{ allowed: false, retry_after_seconds: 23, limited_by: "minute" }], error: null };
    const result = await checkUploadRateLimit(USER);
    expect(result).toEqual({
      ok: false,
      code: "UPLOAD_RATE_LIMITED",
      window: "minute",
      retryAfterSeconds: 23,
      message: UPLOAD_TOO_FAST_MESSAGE,
    });
    expect(UPLOAD_TOO_FAST_MESSAGE).toBe("You're uploading too fast — try again in a minute.");
  });

  it("a full day → the daily-limit refusal", async () => {
    state.answer = { data: [{ allowed: false, retry_after_seconds: 50_000, limited_by: "day" }], error: null };
    const result = await checkUploadRateLimit(USER);
    expect(result).toMatchObject({ ok: false, window: "day", retryAfterSeconds: 50_000, message: UPLOAD_DAILY_LIMIT_MESSAGE });
    expect(UPLOAD_DAILY_LIMIT_MESSAGE).toMatch(/^Daily upload limit reached/);
  });

  it("an upload action answers with its usual error string plus the code and the wait", () => {
    expect(
      uploadRateLimitFailure({ code: "UPLOAD_RATE_LIMITED", window: "minute", retryAfterSeconds: 9, message: UPLOAD_TOO_FAST_MESSAGE }),
    ).toEqual({ ok: false, error: UPLOAD_TOO_FAST_MESSAGE, code: "UPLOAD_RATE_LIMITED", retryAfterSeconds: 9 });
  });

  const REFUSED = {
    ok: false,
    code: "UPLOAD_RATE_LIMITED",
    window: "unavailable",
    retryAfterSeconds: 60,
    message: UPLOAD_LIMIT_UNAVAILABLE_MESSAGE,
  };

  it("fails CLOSED on a database error, a timeout, a throw or an empty answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const error of [
      { code: "57014", message: "canceling statement due to statement timeout" },
      { code: "53300", message: "sorry, too many clients already" },
      { code: "PGRST003", message: "Timed out acquiring connection from connection pool." },
      { code: "", message: "TypeError: fetch failed" },
    ]) {
      state.answer = { data: null, error };
      expect(await checkUploadRateLimit(USER), error.message).toEqual(REFUSED);
    }
    for (const data of [[], null, [{}], [{ allowed: "yes" }]]) {
      state.answer = { data, error: null };
      expect(await checkUploadRateLimit(USER), JSON.stringify(data)).toEqual(REFUSED);
    }
    state.throws = true;
    expect(await checkUploadRateLimit(USER)).toEqual(REFUSED);
    expect(UPLOAD_LIMIT_UNAVAILABLE_MESSAGE).toMatch(/try again in a minute/);
  });

  it("fails OPEN only while the function isn't deployed (PGRST202 / 42883), with no service role, or no user", async () => {
    state.answer = { data: null, error: { code: "PGRST202", message: "Could not find the function public.hit_upload_limit" } };
    expect(await checkUploadRateLimit(USER)).toEqual({ ok: true });
    state.answer = { data: null, error: { code: "42883", message: "function public.hit_upload_limit does not exist" } };
    expect(await checkUploadRateLimit(USER)).toEqual({ ok: true });
    state.calls.length = 0;
    state.configured = false;
    expect(await checkUploadRateLimit(USER)).toEqual({ ok: true });
    state.configured = true;
    expect(await checkUploadRateLimit("")).toEqual({ ok: true });
    expect(state.calls).toEqual([]);
  });

  it("a refusal for being unavailable reaches the upload action like any other", () => {
    expect(uploadRateLimitFailure(REFUSED as never)).toEqual({
      ok: false,
      error: UPLOAD_LIMIT_UNAVAILABLE_MESSAGE,
      code: "UPLOAD_RATE_LIMITED",
      retryAfterSeconds: 60,
    });
  });
});
