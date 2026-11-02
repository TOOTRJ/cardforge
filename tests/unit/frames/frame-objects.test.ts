import { afterEach, describe, expect, it, vi } from "vitest";
import { DEADLINE, FramesCheckDeadline, findMissing, mapLimit, objectExists, objectStatus } from "@/scripts/lib/frame-objects.mjs";

// The Frames published gate (scripts/frames-check.mjs) and the promote /
// publish scripts decide "is this object in the bucket?" with objectExists.
// Supabase answers a missing public object with 400 — and transient overload
// with 400 too — so only a 404, or a 400 on EVERY try, may mean "missing".

const head = (status: number, bytes?: number) =>
  new Response(null, { status, headers: bytes === undefined ? {} : { "content-length": String(bytes) } });

afterEach(() => vi.unstubAllGlobals());

describe("objectExists", () => {
  it("retries a transient 400 and finds the object", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(head(400)).mockResolvedValueOnce(head(400)).mockResolvedValueOnce(head(200, 10));
    vi.stubGlobal("fetch", fetch);
    expect(await objectExists("https://b/x", 10, { baseDelayMs: 0 })).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("calls a 400 on every try missing (a short budget: 3 tries)", async () => {
    const fetch = vi.fn().mockImplementation(async () => head(400));
    vi.stubGlobal("fetch", fetch);
    expect(await objectExists("https://b/x", 10, { baseDelayMs: 0 })).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("takes a 404 as final", async () => {
    const fetch = vi.fn().mockImplementation(async () => head(404));
    vi.stubGlobal("fetch", fetch);
    expect(await objectExists("https://b/x", 10, { baseDelayMs: 0 })).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a size mismatch and survives network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(head(200, 9)));
    expect(await objectExists("https://b/x", 10, { baseDelayMs: 0 })).toBe(false);
    const flaky = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(head(200, 10));
    vi.stubGlobal("fetch", flaky);
    expect(await objectExists("https://b/x", 10, { baseDelayMs: 0 })).toBe(true);
  });
});

describe("objectExists — hung requests", () => {
  it("times out a request that never answers and retries it", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        calls += 1;
        if (calls === 1) {
          // Never resolves on its own — only the abort signal ends it.
          return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
        }
        return Promise.resolve(head(200, 10));
      }),
    );
    expect(await objectExists("https://b/x", 10, { baseDelayMs: 0, timeoutMs: 20 })).toBe(true);
    expect(calls).toBe(2);
  });
});

describe("mapLimit", () => {
  it("never runs more than `limit` at once and keeps result order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit(Array.from({ length: 30 }, (_, i) => i), 8, async (n: number) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n * 2;
    });
    expect(peak).toBe(8);
    expect(out).toEqual(Array.from({ length: 30 }, (_, i) => i * 2));
  });
});

describe("objectStatus", () => {
  it("asks for the first byte (CDN-cacheable) and reads the size from content-range", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("x", { status: 206, headers: { "content-range": "bytes 0-0/1524481" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await objectStatus("https://b/x", 1524481, { baseDelayMs: 0 })).toEqual({ ok: true, status: "206" });
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.method ?? "GET").toBe("GET");
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-0");
    expect(await objectStatus("https://b/x", 99, { baseDelayMs: 0 })).toEqual({ ok: false, status: "size 1524481" });
  });

  it("retries a 429", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(head(429)).mockResolvedValueOnce(head(200, 10));
    vi.stubGlobal("fetch", fetch);
    expect(await objectStatus("https://b/x", 10, { baseDelayMs: 0 })).toEqual({ ok: true, status: "200" });
  });

  it("reports the last answer for a miss: status, size or timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(head(400)));
    expect(await objectStatus("https://b/x", 10, { tries: 2, baseDelayMs: 0 })).toEqual({ ok: false, status: "400" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(head(200, 9)));
    expect(await objectStatus("https://b/x", 10, { baseDelayMs: 0 })).toEqual({ ok: false, status: "size 9" });
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))),
    );
    expect(await objectStatus("https://b/x", 10, { tries: 1, timeoutMs: 10 })).toEqual({ ok: false, status: "timeout" });
  });
});

describe("findMissing — the gate's two passes", () => {
  it("clears a transient miss in the confirm pass and reports a real one with its status", async () => {
    const seen: Record<string, number> = {};
    const check = async (key: string, thorough: boolean) => {
      seen[key] = (seen[key] ?? 0) + 1;
      if (key === "real") return { ok: false, status: "400" };
      if (key === "blip") return { ok: thorough, status: thorough ? "200" : "400" };
      return { ok: true, status: "200" };
    };
    const missing = await findMissing(["a", "blip", "real", "b"], check, { confirmDelayMs: 0 });
    expect(missing).toEqual([{ item: "real", status: "400" }]);
    expect(seen).toEqual({ a: 1, blip: 2, real: 2, b: 1 });
  });

  it("skips the slow confirm pass when too many are missing (an unpromoted manifest)", async () => {
    const check = vi.fn(async () => ({ ok: false, status: "400" }));
    const items = Array.from({ length: 30 }, (_, i) => `k${i}`);
    const missing = await findMissing(items, check, { confirmDelayMs: 0, maxConfirm: 25 });
    expect(missing).toHaveLength(30);
    expect(check).toHaveBeenCalledTimes(30);
  });
});

describe("the whole check's budget (frames-check --budget-seconds; 2026-11-02: the gate hung to the job's timeout)", () => {
  /** A fetch that never answers on its own — only an abort ends it. */
  const hung = () =>
    vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))));

  it("objectStatus ends a request in flight the moment the budget fires — 'deadline', never ok", async () => {
    vi.stubGlobal("fetch", hung());
    const budget = new AbortController();
    const t0 = Date.now();
    const pending = objectStatus("https://b/x", 10, { tries: 5, timeoutMs: 60_000, signal: budget.signal });
    setTimeout(() => budget.abort(), 20);
    expect(await pending).toEqual({ ok: false, status: DEADLINE });
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("objectStatus ends its backoff too, and starts nothing once the budget is spent", async () => {
    const fetch = vi.fn().mockImplementation(async () => head(429));
    vi.stubGlobal("fetch", fetch);
    const budget = new AbortController();
    const pending = objectStatus("https://b/x", 10, { tries: 5, baseDelayMs: 60_000, signal: budget.signal });
    setTimeout(() => budget.abort(), 20);
    expect(await pending).toEqual({ ok: false, status: DEADLINE });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await objectStatus("https://b/x", 10, { signal: budget.signal })).toEqual({ ok: false, status: DEADLINE });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("a budget that never fires changes nothing (and leaves no listener behind on its signal)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(head(429)).mockResolvedValue(head(200, 10)));
    const budget = new AbortController();
    const warnings: string[] = [];
    const onWarning = (w: Error) => warnings.push(w.name);
    process.on("warning", onWarning);
    try {
      for (let i = 0; i < 30; i += 1) {
        expect(await objectStatus("https://b/x", 10, { baseDelayMs: 0, signal: budget.signal })).toEqual({ ok: true, status: "200" });
      }
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      process.off("warning", onWarning);
    }
    expect(warnings).not.toContain("MaxListenersExceededWarning");
  });

  it("findMissing throws FramesCheckDeadline when the budget fires in the first pass — never a pass, never misses it did not see", async () => {
    const budget = new AbortController();
    const progress: number[] = [];
    let calls = 0;
    const check = async (key: string) => {
      calls += 1;
      if (calls === 6) budget.abort();
      if (budget.signal.aborted) return { ok: false, status: DEADLINE };
      return key === "k1" ? { ok: false, status: "429" } : { ok: true, status: "206" };
    };
    const items = Array.from({ length: 100 }, (_, i) => `k${i}`);
    const err = await findMissing(items, check, { limit: 2, confirmDelayMs: 0, signal: budget.signal, onProgress: (p) => progress.push(p.done) }).catch((e) => e);
    expect(err).toBeInstanceOf(FramesCheckDeadline);
    expect(err).toMatchObject({ total: 100, suspects: 1, statuses: { "429": 1 } });
    expect(err.checked).toBeLessThan(10);
    expect(calls).toBeLessThan(10);
    expect(progress.at(-1)).toBe(err.checked);
  });

  it("findMissing throws FramesCheckDeadline when the budget fires in the confirm pass", async () => {
    const budget = new AbortController();
    const check = async (key: string, thorough: boolean) => {
      if (thorough) {
        budget.abort();
        return { ok: false, status: DEADLINE };
      }
      return key.startsWith("miss") ? { ok: false, status: "400" } : { ok: true, status: "206" };
    };
    const err = await findMissing(["a", "miss1", "miss2", "b"], check, { confirmDelayMs: 0, signal: budget.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(FramesCheckDeadline);
    expect(err).toMatchObject({ checked: 4, total: 4, suspects: 2, statuses: { "400": 2 } });
  });

  it("with time to spare it answers as before: every object found is a pass, a real miss is reported", async () => {
    const budget = new AbortController();
    const check = async (key: string) => (key === "real" ? { ok: false, status: "400" } : { ok: true, status: "206" });
    expect(await findMissing(["a", "b"], check, { confirmDelayMs: 0, signal: budget.signal })).toEqual([]);
    expect(await findMissing(["a", "real"], check, { confirmDelayMs: 0, signal: budget.signal })).toEqual([{ item: "real", status: "400" }]);
  });
});
