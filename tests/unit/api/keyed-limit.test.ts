import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// hitKeyedLimit: a per-user limit for an expensive signed-in route, on
// migration 0125's keyed counter (which has had no caller since downloads
// became signed-in only). First use: the Token Kit's print render route,
// which the tools audit found callable in a loop with nothing in the way.
// ---------------------------------------------------------------------------

const db = vi.hoisted(() => ({
  configured: true,
  answer: { data: [{ allowed: true, retry_after_seconds: 0 }] as unknown, error: null as null | { message: string } },
  calls: [] as Array<[string, Record<string, unknown>]>,
  throws: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => db.configured,
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (db.throws) throw new Error("network");
      db.calls.push([name, args]);
      return db.answer;
    },
  }),
}));

import { hitKeyedLimit, keyedLimitKey } from "@/lib/api/keyed-limit";

const input = { context: "token-kit-render", subject: "user-1", perMinute: 200, perHour: 900, message: "Too many at once." };

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  db.configured = true;
  db.answer = { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
  db.calls = [];
  db.throws = false;
});
afterEach(() => vi.unstubAllEnvs());

describe("hitKeyedLimit", () => {
  it("counts the call on 0125's counter under a key that is never the user id", async () => {
    expect(await hitKeyedLimit(input)).toEqual({ ok: true });
    expect(db.calls).toHaveLength(1);
    const [name, args] = db.calls[0];
    expect(name).toBe("hit_anon_render_limit");
    expect(args).toMatchObject({ p_per_minute: 200, p_per_hour: 900 });
    expect(args.p_key_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(String(args.p_key_hash)).not.toContain("user-1");
  });

  it("the key is stable for a subject, and differs by subject, by context and by secret", () => {
    const key = keyedLimitKey("token-kit-render", "user-1", "s1");
    expect(keyedLimitKey("token-kit-render", "user-1", "s1")).toBe(key);
    expect(keyedLimitKey("token-kit-render", "user-2", "s1")).not.toBe(key);
    expect(keyedLimitKey("another-route", "user-1", "s1")).not.toBe(key);
    expect(keyedLimitKey("token-kit-render", "user-1", "s2")).not.toBe(key);
  });

  it("over the limit → refused, with how long to wait and the caller's own words", async () => {
    db.answer = { data: [{ allowed: false, retry_after_seconds: 41.2 }], error: null };
    expect(await hitKeyedLimit(input)).toEqual({ ok: false, retryAfterSeconds: 42, message: "Too many at once." });
    db.answer = { data: [{ allowed: false, retry_after_seconds: null }], error: null };
    expect(await hitKeyedLimit(input)).toMatchObject({ ok: false, retryAfterSeconds: 60 });
  });

  it("says so when the counter does not answer — a broken counter is a limit that is off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.answer = { data: null, error: { message: "timeout" } };
    expect((await hitKeyedLimit({ context: "token-kit-render", subject: "u1", perMinute: 5, perHour: 50, message: "Slow down." })).ok).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/token-kit-render.*timeout/);
    warn.mockRestore();
  });

  it("fails OPEN: a database error, an empty answer, a thrown call, no secret, no service role", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db.answer = { data: null, error: { message: "timeout" } };
    expect(await hitKeyedLimit(input)).toEqual({ ok: true });
    db.answer = { data: [], error: null };
    expect(await hitKeyedLimit(input)).toEqual({ ok: true });
    db.throws = true;
    expect(await hitKeyedLimit(input)).toEqual({ ok: true });
    db.throws = false;
    db.calls = [];
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(await hitKeyedLimit(input)).toEqual({ ok: true });
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    db.configured = false;
    expect(await hitKeyedLimit(input)).toEqual({ ok: true });
    expect(db.calls).toEqual([]);
  });
});
