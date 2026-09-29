import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// lib/media/upload-rate-limit.ts — the per-user upload limit (owner decision
// 2026-09-29): 30 a minute, 300 a rolling day, admins exempt. The counting
// itself is migration 0127's hit_upload_limit() (its SQL behaviour — the
// 31st refused and not counted, the day cap, the admin exemption — is pinned
// in tests/unit/db/media-url-guards-migration.test.ts and proved on the CI
// stack by tests/e2e/media-url-guards.spec.ts). This checks the app's side:
// the numbers it asks for, the typed refusal the UI shows, and fail-open.
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

  it("fails OPEN: an RPC error, a throw, an empty answer, no service role, no user", async () => {
    state.answer = { data: null, error: { message: "function does not exist" } };
    expect(await checkUploadRateLimit(USER)).toEqual({ ok: true });
    state.answer = { data: [], error: null };
    expect(await checkUploadRateLimit(USER)).toEqual({ ok: true });
    state.throws = true;
    expect(await checkUploadRateLimit(USER)).toEqual({ ok: true });
    state.throws = false;
    state.calls.length = 0;
    state.configured = false;
    expect(await checkUploadRateLimit(USER)).toEqual({ ok: true });
    state.configured = true;
    expect(await checkUploadRateLimit("")).toEqual({ ok: true });
    expect(state.calls).toEqual([]);
  });
});
