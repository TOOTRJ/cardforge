import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// Plain .mjs shared with the Node scripts (allowJs types it loosely).
import * as mod from "../../../scripts/lib/rebake-request.mjs";

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<unknown>;
type Opts = {
  headers?: Record<string, string>;
  retries?: number;
  serverMaxMs?: number;
  backoffMs?: number[];
  fetchImpl?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
};
const { postWithRetry, RebakeRequestError, REBAKE_SERVER_MAX_MS } = mod as unknown as {
  postWithRetry: (url: string, opts?: Opts) => Promise<{ ok: true; [k: string]: unknown }>;
  RebakeRequestError: new (message: string) => Error;
  REBAKE_SERVER_MAX_MS: number;
};

// scripts/rebake-renders.mjs drives production sweeps from a laptop; the v32
// sweep died twice on a dropped connection (2026-09-28). These pin when a
// request is retried, how long it waits, and when it gives up.

function answer(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function lostBody(status = 200) {
  return { ok: true, status, json: async () => { throw new Error("socket hang up"); } };
}
function networkError(code = "ETIMEDOUT") {
  return Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`read ${code}`), { code }) });
}

/** A fake clock: `sleep` advances it; each fetch can also take time. */
function harness(steps: Array<{ takes?: number; result: unknown }>) {
  let t = 0;
  const waits: number[] = [];
  const logs: string[] = [];
  let calls = 0;
  const fetchImpl: Fetch = async () => {
    const step = steps[calls];
    calls += 1;
    if (!step) throw new Error("unexpected extra call");
    t += step.takes ?? 0;
    if (step.result instanceof Error) throw step.result;
    return step.result;
  };
  return {
    opts: {
      fetchImpl,
      now: () => t,
      sleep: async (ms: number) => {
        waits.push(ms);
        t += ms;
      },
      log: (line: string) => logs.push(line),
    } satisfies Opts,
    waits,
    logs,
    calls: () => calls,
  };
}

describe("postWithRetry", () => {
  it("returns the body of a good answer without waiting", async () => {
    const h = harness([{ result: answer(200, { ok: true, remaining: 3 }) }]);
    await expect(postWithRetry("https://x/api", h.opts)).resolves.toMatchObject({ remaining: 3 });
    expect(h.waits).toEqual([]);
  });

  it("retries a dropped connection only after the in-flight batch must have ended on the server", async () => {
    const h = harness([
      { takes: 40_000, result: networkError("ETIMEDOUT") },
      { result: answer(200, { ok: true }) },
    ]);
    await expect(postWithRetry("https://x/api", h.opts)).resolves.toMatchObject({ ok: true });
    // 40 s into a request the function may run until 300 s: wait the rest + 10 s.
    expect(h.waits).toEqual([REBAKE_SERVER_MAX_MS + 10_000 - 40_000]);
    expect(h.logs[0]).toMatch(/network error \(ETIMEDOUT\) — retrying in 270 s \(1\/5\)/);
  });

  it("treats a 200 whose body was lost as in flight", async () => {
    const h = harness([
      { takes: 100_000, result: lostBody() },
      { result: answer(200, { ok: true }) },
    ]);
    await postWithRetry("https://x/api", h.opts);
    expect(h.waits).toEqual([REBAKE_SERVER_MAX_MS + 10_000 - 100_000]);
    expect(h.logs[0]).toMatch(/response body lost/);
  });

  it("backs off (no in-flight wait) on an answered 503 / 429 / 504", async () => {
    const h = harness([
      { takes: 5_000, result: answer(503, { error: "busy" }) },
      { takes: 5_000, result: answer(429, null) },
      { takes: 5_000, result: answer(504, null) },
      { result: answer(200, { ok: true }) },
    ]);
    await postWithRetry("https://x/api", h.opts);
    expect(h.waits).toEqual([15_000, 30_000, 60_000]);
    expect(h.logs[0]).toMatch(/HTTP 503: busy/);
  });

  it("never waits less than the backoff, even for a request that failed late", async () => {
    const h = harness([
      { takes: 330_000, result: networkError("ECONNRESET") },
      { result: answer(200, { ok: true }) },
    ]);
    await postWithRetry("https://x/api", h.opts);
    expect(h.waits).toEqual([15_000]);
  });

  it("stops at once on an answer that repeating would only repeat (401, 400, ok:false)", async () => {
    for (const result of [answer(401, { error: "unauthorized" }), answer(400, { error: "bad scope" }), answer(200, { ok: false, error: "nope" })]) {
      const h = harness([{ result }]);
      await expect(postWithRetry("https://x/api", h.opts)).rejects.toBeInstanceOf(RebakeRequestError);
      expect(h.waits).toEqual([]);
      expect(h.calls()).toBe(1);
    }
  });

  it("gives up after `retries` retries with the last failure in the message", async () => {
    const h = harness(Array.from({ length: 3 }, () => ({ result: answer(502, null) })));
    await expect(postWithRetry("https://x/api", { ...h.opts, retries: 2 })).rejects.toThrow(/HTTP 502 — gave up after 2 retries/);
    expect(h.calls()).toBe(3);
  });

  it("retries 0 means the first failure ends the run", async () => {
    const h = harness([{ result: networkError() }]);
    await expect(postWithRetry("https://x/api", { ...h.opts, retries: 0 })).rejects.toThrow(/gave up after 0 retries/);
    expect(h.waits).toEqual([]);
  });

  it("sends a POST with the caller's headers and a timeout past the route's maxDuration", async () => {
    let seen: { method: string; headers: Record<string, string>; signal: AbortSignal } | null = null;
    const h = harness([{ result: answer(200, { ok: true }) }]);
    await postWithRetry("https://x/api", {
      ...h.opts,
      headers: { Authorization: "Bearer t" },
      fetchImpl: async (url, init) => {
        seen = init;
        return h.opts.fetchImpl(url, init);
      },
    });
    expect(seen!.method).toBe("POST");
    expect(seen!.headers).toEqual({ Authorization: "Bearer t" });
    expect(seen!.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("the retry budget matches the route", () => {
  it("REBAKE_SERVER_MAX_MS equals app/api/admin/rebake's maxDuration", () => {
    const route = readFileSync(join(process.cwd(), "app/api/admin/rebake/route.ts"), "utf8");
    const seconds = Number(/export const maxDuration = (\d+);/.exec(route)?.[1]);
    expect(seconds * 1000).toBe(REBAKE_SERVER_MAX_MS);
  });

  it("rebake-renders.mjs sends every call through postWithRetry", () => {
    const script = readFileSync(join(process.cwd(), "scripts/rebake-renders.mjs"), "utf8");
    expect(script).toMatch(/import \{ postWithRetry, RebakeRequestError \} from "\.\/lib\/rebake-request\.mjs"/);
    expect(script).not.toMatch(/await fetch\(`\$\{URL_\}/);
  });
});
