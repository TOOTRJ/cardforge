import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The frame layout overrides READ (lib/cards/frame-profile-overrides.ts,
// admin audit 2026-10-16 L2). Contract:
//   * a failed read is NEVER cached as "no overrides": the loader retries
//     once, then throws — and unstable_cache keeps only what a loader
//     RETURNS, so the next request reads the table again;
//   * display (getFrameProfileOverrides) answers {} for that request and
//     logs it — a live preview keeps working on the code profiles;
//   * a stored bake reads uncached (readFrameProfileOverrides) and gets the throw;
//   * a row whose jsonb does not parse is skipped, not a failed read.
//
// unstable_cache is stood in for by a store with Next's rule: a resolved
// value is kept for the key, a rejection is not.
// ---------------------------------------------------------------------------

type Answer = { data?: unknown; error?: { message: string } | null; throws?: string };

const state = vi.hoisted(() => ({
  answers: [] as Answer[],
  reads: 0,
  store: new Map<string, unknown>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("next/cache", () => ({
  unstable_cache:
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>, keyParts: string[]) =>
    async (...args: A): Promise<R> => {
      const key = keyParts.join("/");
      if (state.store.has(key)) return state.store.get(key) as R;
      const value = await fn(...args); // a throw stores nothing
      state.store.set(key, value);
      return value;
    },
}));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () => ({
    from: () => ({
      select: async () => {
        const answer = state.answers[Math.min(state.reads, state.answers.length - 1)];
        state.reads += 1;
        if (answer.throws) throw new Error(answer.throws);
        return { data: answer.data ?? null, error: answer.error ?? null };
      },
    }),
  }),
}));

import {
  getFrameProfileOverrides,
  readFrameProfileOverrides,
} from "@/lib/cards/frame-profile-overrides";

const ROW = { template: "saga", overrides: { title: { rect: { topPct: 5 } } } };
const MAP = { saga: { title: { rect: { topPct: 5 } } } };

beforeEach(() => {
  state.answers = [];
  state.reads = 0;
  state.store.clear();
});

describe("frame layout overrides read (L2)", () => {
  it("reads and caches the map", async () => {
    state.answers = [{ data: [ROW] }];
    expect(await getFrameProfileOverrides()).toEqual(MAP);
    expect(await getFrameProfileOverrides()).toEqual(MAP);
    expect(state.reads).toBe(1);
    // The bakes' read is UNCACHED: it reads the table every time.
    expect(await readFrameProfileOverrides()).toEqual(MAP);
    expect(state.reads).toBe(2);
  });

  it("retries once: a transient error then a good read is the map", async () => {
    state.answers = [{ error: { message: "upstream timeout" } }, { data: [ROW] }];
    expect(await readFrameProfileOverrides()).toEqual(MAP);
    expect(state.reads).toBe(2);
  });

  it("a failed read is not cached as empty: display gets {} for this request (logged), the next request reads again", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      state.answers = [{ throws: "fetch failed" }, { error: { message: "503" } }, { data: [ROW] }];
      expect(await getFrameProfileOverrides()).toEqual({});
      expect(state.reads).toBe(2);
      expect(error).toHaveBeenCalledWith(expect.stringMatching(/could not be read: 503.*not cached/));
      expect(state.store.size).toBe(0);
      // The database is back: the overrides apply again at once — not 5
      // minutes of the code profiles.
      expect(await getFrameProfileOverrides()).toEqual(MAP);
      expect(state.reads).toBe(3);
    } finally {
      error.mockRestore();
    }
  });

  it("a stored bake gets the failure, never a silent {}", async () => {
    state.answers = [{ error: { message: "connection refused" } }];
    await expect(readFrameProfileOverrides()).rejects.toThrow(
      "Frame layout overrides could not be read: connection refused",
    );
    expect(state.store.size).toBe(0);
  });

  it("a row that does not parse is skipped — a broken row, not a failed read", async () => {
    state.answers = [{ data: [ROW, { template: "m15", overrides: { title: { colorHex: "#fff" } } }] }];
    expect(await readFrameProfileOverrides()).toEqual(MAP);
  });

  it("an empty table is no overrides (and is cached)", async () => {
    state.answers = [{ data: [] }];
    expect(await getFrameProfileOverrides()).toEqual({});
    expect(await getFrameProfileOverrides()).toEqual({});
    expect(state.reads).toBe(1);
    expect(await readFrameProfileOverrides()).toEqual({});
  });
});
