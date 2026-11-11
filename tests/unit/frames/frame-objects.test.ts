import { afterEach, describe, expect, it, vi } from "vitest";
import { DEADLINE, checkObjects, createLookupPacer, isNoAnswer, mapLimit, objectExists, objectStatus } from "@/scripts/lib/frame-objects.mjs";

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

describe("checkObjects — the gate's two passes", () => {
  it("clears a transient miss in the confirm pass and reports a real one with its status", async () => {
    const seen: Record<string, number> = {};
    const check = async (key: string, thorough: boolean) => {
      seen[key] = (seen[key] ?? 0) + 1;
      if (key === "real") return { ok: false, status: "400" };
      if (key === "blip") return { ok: thorough, status: thorough ? "200" : "400" };
      return { ok: true, status: "200" };
    };
    const result = await checkObjects(["a", "blip", "real", "b"], check, { confirmDelayMs: 0 });
    expect(result.missing).toEqual([{ item: "real", status: "400" }]);
    expect(result).toMatchObject({ unverified: [], unchecked: [], stopped: null });
    expect(seen).toEqual({ a: 1, blip: 2, real: 2, b: 1 });
  });

  it("skips the slow confirm pass when too many are missing (an unpromoted manifest)", async () => {
    const check = vi.fn(async () => ({ ok: false, status: "400" }));
    const items = Array.from({ length: 30 }, (_, i) => `k${i}`);
    const result = await checkObjects(items, check, { confirmDelayMs: 0, maxConfirm: 25 });
    expect(result.missing).toHaveLength(30);
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

  it("the budget firing in the first pass is 'deadline' with objects UNCHECKED — never a pass, never misses it did not see", async () => {
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
    const result = await checkObjects(items, check, { limit: 2, confirmDelayMs: 0, signal: budget.signal, onProgress: (p) => progress.push(p.done) });
    expect(result).toMatchObject({ stopped: "deadline", total: 100, missing: [], suspects: [{ item: "k1", status: "429" }] });
    // What it saw and could not settle is kept apart from what it never looked at.
    expect(result.unverified).toEqual([{ item: "k1", status: "429" }]);
    expect(result.checked).toBeLessThan(10);
    expect(result.unchecked).toHaveLength(100 - result.checked);
    expect(calls).toBeLessThan(10);
    expect(progress.at(-1)).toBe(result.checked);
  });

  it("the budget firing in the confirm pass leaves the suspects UNVERIFIED with what they first answered — never missing, never cleared", async () => {
    const budget = new AbortController();
    const check = async (key: string, thorough: boolean) => {
      if (thorough) {
        budget.abort();
        return { ok: false, status: DEADLINE };
      }
      return key.startsWith("miss") ? { ok: false, status: "400" } : { ok: true, status: "206" };
    };
    const result = await checkObjects(["a", "miss1", "miss2", "b"], check, { confirmDelayMs: 0, signal: budget.signal });
    expect(result).toMatchObject({ checked: 4, total: 4, stopped: "deadline", missing: [], unchecked: [] });
    expect(result.unverified).toEqual([
      { item: "miss1", status: "400" },
      { item: "miss2", status: "400" },
    ]);
  });

  it("with time to spare it answers as before: every object found is a pass, a real miss is reported", async () => {
    const budget = new AbortController();
    const check = async (key: string) => (key === "real" ? { ok: false, status: "400" } : { ok: true, status: "206" });
    expect(await checkObjects(["a", "b"], check, { confirmDelayMs: 0, signal: budget.signal })).toMatchObject({ missing: [], unverified: [], unchecked: [], stopped: null });
    expect((await checkObjects(["a", "real"], check, { confirmDelayMs: 0, signal: budget.signal })).missing).toEqual([{ item: "real", status: "400" }]);
  });
});

// 2026-11-10: ~30 full walks of production's frames bucket a day; two of
// them found the CDN cold, every lookup reached Supabase's storage API, its
// connection pooler ran out (`max_client_conn`) and the SITE's thumbnails
// (/render-cdn 502s), art uploads and bakes were refused for 45 minutes.
// The check now paces itself by what the CDN says about each answer.
describe("the pace of lookups against production storage (createLookupPacer)", () => {
  const answer = (status: number, cache?: string) =>
    new Response(null, { status, headers: { "content-range": "bytes 0-0/10", ...(cache ? { "cf-cache-status": cache } : {}) } });

  it("objectStatus tells its caller whether the CDN answered from its cache — and that a timeout was no answer", async () => {
    const heard: Array<{ status: number; cached: boolean }> = [];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(answer(206, "HIT"))
        .mockResolvedValueOnce(answer(206, "MISS"))
        .mockResolvedValueOnce(answer(206))
        .mockResolvedValueOnce(answer(429, "BYPASS"))
        .mockRejectedValueOnce(new Error("ECONNRESET")),
    );
    for (let i = 0; i < 5; i += 1) await objectStatus("https://b/x", 10, { tries: 1, onAnswer: (a) => heard.push(a) });
    expect(heard).toEqual([
      { status: 206, cached: true },
      { status: 206, cached: false },
      { status: 206, cached: false },
      { status: 429, cached: false },
      { status: 0, cached: false },
    ]);
  });

  /** A pacer on a clock the test moves: `sleep` advances it and records the wait. */
  const clocked = (options: Parameters<typeof createLookupPacer>[0] = {}) => {
    let t = 0;
    const waits: number[] = [];
    const pacer = createLookupPacer({
      ...options,
      now: () => t,
      sleep: async (ms: number) => {
        waits.push(ms);
        t += ms;
      },
    });
    return { pacer, waits, tick: (ms: number) => (t += ms) };
  };

  it("runs `limit` at a time while every answer is cached, and never waits", async () => {
    const { pacer, waits } = clocked({ limit: 4 });
    let inFlight = 0;
    let most = 0;
    await Promise.all(
      Array.from({ length: 20 }, async () => {
        expect(await pacer.acquire()).toBe(true);
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        pacer.note({ status: 206, cached: true });
        inFlight -= 1;
        pacer.release();
      }),
    );
    expect(most).toBe(4);
    expect(waits).toEqual([]);
    expect(pacer.stats()).toMatchObject({ uncached: 0, slow: false, stopped: null });
  });

  it("goes ONE at a time from the first uncached answer, with the gap after each — and fast again after a run of cached ones", async () => {
    const { pacer, waits } = clocked({ limit: 4, slowGapMs: 2000, recoverAfter: 3 });
    let inFlight = 0;
    let most = 0;
    const lookup = async (cached: boolean) => {
      expect(await pacer.acquire()).toBe(true);
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      pacer.note({ status: 206, cached });
      inFlight -= 1;
      pacer.release();
    };
    await lookup(false);
    expect(pacer.stats().slow).toBe(true);
    most = 0;
    // Four want to start at once: they go one by one, each after its gap.
    await Promise.all([lookup(false), lookup(false), lookup(false), lookup(false)]);
    expect(most).toBe(1);
    expect(waits).toEqual([2000, 2000, 2000, 2000]);
    expect(pacer.stats().uncached).toBe(5);
    // Three cached answers in a row: fast again (after the last gap).
    await lookup(true);
    await lookup(true);
    await lookup(true);
    expect(pacer.stats().slow).toBe(false);
    most = 0;
    await Promise.all([lookup(true), lookup(true), lookup(true), lookup(true)]);
    expect(most).toBe(4);
  });

  it("a 429 stops everything for the pause — once for a burst of them — and the check ends after the last pause", async () => {
    const { pacer, waits } = clocked({ limit: 4, busyPauseMs: 60_000, maxBusyPauses: 2 });
    for (let i = 0; i < 4; i += 1) expect(await pacer.acquire()).toBe(true);
    // The four in flight all come back 429: ONE pause.
    for (let i = 0; i < 4; i += 1) {
      pacer.note({ status: 429, cached: false });
      pacer.release();
    }
    expect(pacer.stats()).toMatchObject({ busyPauses: 1, slow: true, stopped: null });
    expect(await pacer.acquire()).toBe(true);
    expect(waits).toEqual([60_000]);
    pacer.note({ status: 429, cached: false });
    pacer.release();
    expect(pacer.stats().busyPauses).toBe(2);
    expect(await pacer.acquire()).toBe(true);
    expect(waits).toEqual([60_000, 60_000]);
    // Still saturated after the last pause it is allowed: stop, never knock again.
    pacer.note({ status: 429, cached: false });
    pacer.release();
    expect(pacer.stopped).toBe("busy");
    expect(await pacer.acquire()).toBe(false);
    expect(waits).toHaveLength(2);
  });

  it("a lookup QUEUED behind the one in flight gives up once that one comes back after the budget fired", async () => {
    const pacer = createLookupPacer({ limit: 1 });
    const budget = new AbortController();
    expect(await pacer.acquire(budget.signal)).toBe(true);
    const queued = pacer.acquire(budget.signal);
    budget.abort();
    // The lookup in flight ends at once on the same signal (objectStatus) and gives its turn back.
    pacer.release();
    expect(await queued).toBe(false);
  });

  it("the default slow pace is about one uncached lookup a second: a 400-frame pull request finishes in minutes", () => {
    let t = 0;
    const waits: number[] = [];
    const pacer = createLookupPacer({ now: () => t, sleep: async (ms: number) => void (waits.push(ms), (t += ms)) });
    pacer.note({ status: 206, cached: false });
    return pacer.acquire().then((ok) => {
      expect(ok).toBe(true);
      expect(waits).toEqual([500]);
    });
  });

  it("a waiting lookup gives up the moment the budget fires", async () => {
    const pacer = createLookupPacer({ slowGapMs: 60_000 });
    pacer.note({ status: 206, cached: false });
    const budget = new AbortController();
    const t0 = Date.now();
    const turn = pacer.acquire(budget.signal);
    setTimeout(() => budget.abort(), 20);
    expect(await turn).toBe(false);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});

describe("checkObjects — what a paced check learned, without a verdict", () => {
  it("isNoAnswer: a 429, a 5xx, a timeout or a dropped connection say nothing; a 400 or a wrong size do", () => {
    expect(["429", "500", "503", "timeout", "network"].map(isNoAnswer)).toEqual([true, true, true, true, true]);
    expect(["400", "404", "size 9", "206"].map(isNoAnswer)).toEqual([false, false, false, false]);
  });

  it("settles a real miss, clears a blip, and keeps an object storage never answered for apart from both", async () => {
    const tries: Record<string, number> = {};
    const lookup = async (key: string, thorough: boolean) => {
      tries[key] = (tries[key] ?? 0) + 1;
      if (key === "gone") return { ok: false, status: "400" };
      if (key === "blip") return thorough ? { ok: true, status: "206" } : { ok: false, status: "400" };
      if (key === "silent") return { ok: false, status: "timeout" };
      return { ok: true, status: "206" };
    };
    const result = await checkObjects(["a", "gone", "blip", "silent", "b"], lookup, { confirmDelayMs: 0, confirmTries: 3 });
    expect(result.missing).toEqual([{ item: "gone", status: "400" }]);
    expect(result.unverified).toEqual([{ item: "silent", status: "timeout" }]);
    expect(result).toMatchObject({ unchecked: [], checked: 5, total: 5, stopped: null });
    // The confirm pass: up to confirmTries looks at a suspect, one at the first that finds it.
    expect(tries).toEqual({ a: 1, gone: 4, blip: 2, silent: 4, b: 1 });
  });

  it("a 404 is final in the confirm pass too", async () => {
    const lookup = vi.fn(async () => ({ ok: false, status: "404" }));
    const result = await checkObjects(["x"], lookup, { confirmDelayMs: 0, confirmTries: 4 });
    expect(result.missing).toEqual([{ item: "x", status: "404" }]);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("a transient storm is re-checked however large; only answers that SAY missing skip the confirm pass", async () => {
    const storm = Array.from({ length: 40 }, (_, i) => `k${i}`);
    const lookup = vi.fn(async (_key: string, thorough: boolean) => (thorough ? { ok: true, status: "206" } : { ok: false, status: "429" }));
    const result = await checkObjects(storm, lookup, { confirmDelayMs: 0, maxConfirm: 25 });
    expect(result).toMatchObject({ missing: [], unverified: [], stopped: null });
    expect(lookup).toHaveBeenCalledTimes(80);
  });

  it("the first pass's budget leaves objects UNCHECKED — and what it saw is still confirmed (a sweep)", async () => {
    const firstPass = new AbortController();
    let calls = 0;
    const lookup = async (key: string, thorough: boolean) => {
      if (!thorough) {
        calls += 1;
        if (calls === 3) firstPass.abort();
      }
      return key === "k1" ? { ok: false, status: "400" } : { ok: true, status: "206" };
    };
    const items = Array.from({ length: 50 }, (_, i) => `k${i}`);
    const result = await checkObjects(items, lookup, { limit: 1, confirmDelayMs: 0, signal: firstPass.signal, confirmSignal: new AbortController().signal });
    expect(result.checked).toBe(3);
    expect(result.unchecked).toHaveLength(47);
    expect(result.stopped).toBe("deadline");
    // The miss inside the part it looked at is a real finding.
    expect(result.missing).toEqual([{ item: "k1", status: "400" }]);
  });

  it("a pacer that stops (storage saturated) ends the check as 'busy', with nothing called missing", async () => {
    const pacer = createLookupPacer({ limit: 2, busyPauseMs: 0, maxBusyPauses: 1, slowGapMs: 0 });
    const lookup = async (_key: string, _thorough: boolean, onAnswer?: (a: { status: number; cached: boolean }) => void) => {
      onAnswer?.({ status: 429, cached: false });
      return { ok: false, status: "429" };
    };
    const items = Array.from({ length: 30 }, (_, i) => `k${i}`);
    const result = await checkObjects(items, lookup, { pacer, confirmDelayMs: 0, confirmTries: 4 });
    expect(result.stopped).toBe("busy");
    expect(result.missing).toEqual([]);
    expect(result.checked).toBeLessThan(6);
    expect(result.unchecked.length + result.unverified.length).toBe(30);
  });

  it("settles what SAID missing before what storage was silent about — a few timeouts must not hide a real miss", async () => {
    // Manifest order: three objects storage never answers for, then the one that is gone.
    const reserve = new AbortController();
    const order: string[] = [];
    const lookup = async (key: string, thorough: boolean) => {
      if (thorough) {
        order.push(key);
        // The confirm pass's time runs out after its first two looks.
        if (order.length === 2) reserve.abort();
      }
      return key === "gone" ? { ok: false, status: "400" } : { ok: false, status: "timeout" };
    };
    const result = await checkObjects(["s1", "s2", "s3", "gone"], lookup, { confirmDelayMs: 0, confirmTries: 2, confirmSignal: reserve.signal });
    expect(order.slice(0, 2)).toEqual(["gone", "gone"]);
    expect(result.missing).toEqual([{ item: "gone", status: "400" }]);
    expect(result.unverified.map((u) => u.item)).toEqual(["s1", "s2", "s3"]);
  });

  // The re-check's sequences (2026-11-10): the object says "missing" only in
  // the CONFIRM pass, and the last word on it is silence or a cut.
  it.each([
    ["silent first, then 400 ×3, then a 429", "timeout", ["400", "400", "400", "429"], "400"],
    ["a 503 first, then a wrong size twice, then 502s", "503", ["size 3", "size 3", "502", "502"], "size 3"],
    ["a 400 first, then only silence", "400", ["timeout", "timeout", "timeout", "timeout"], "400"],
    ["only ever silent", "timeout", ["429", "503", "timeout", "network"], "network"],
  ])("an object never found keeps the latest answer that SAID missing (%s)", async (_label, first, confirms, expected) => {
    let attempt = 0;
    const lookup = async (_key: string, thorough: boolean) => ({ ok: false, status: thorough ? confirms[attempt++] : first });
    const result = await checkObjects(["x"], lookup, { confirmDelayMs: 0, confirmTries: 4 });
    expect(result.missing).toEqual([]);
    expect(result.unverified).toEqual([{ item: "x", status: expected }]);
  });

  it("a 'missing' said in the confirm pass survives the budget ending right after it", async () => {
    const budget = new AbortController();
    const lookup = async (_key: string, thorough: boolean) => {
      if (!thorough) return { ok: false, status: "503" };
      if (budget.signal.aborted) return { ok: false, status: DEADLINE };
      budget.abort();
      return { ok: false, status: "400" };
    };
    const result = await checkObjects(["x"], lookup, { confirmDelayMs: 0, confirmTries: 4, confirmSignal: budget.signal });
    expect(result.unverified).toEqual([{ item: "x", status: "400" }]);
    expect(result).toMatchObject({ missing: [], stopped: "deadline" });
  });

  it("finding the object takes every earlier 'missing' back", async () => {
    const answers = ["400", "400", "206"];
    let attempt = 0;
    const lookup = async (_key: string, thorough: boolean) => (thorough ? { ok: answers[attempt] === "206", status: answers[attempt++] } : { ok: false, status: "400" });
    const result = await checkObjects(["x"], lookup, { confirmDelayMs: 0, confirmTries: 4 });
    expect(result).toMatchObject({ missing: [], unverified: [], stopped: null });
  });

  it("an already spent budget looks at nothing", async () => {
    const budget = new AbortController();
    budget.abort();
    const lookup = vi.fn(async () => ({ ok: true, status: "206" }));
    const result = await checkObjects(["a", "b"], lookup, { confirmDelayMs: 0, signal: budget.signal });
    expect(result).toMatchObject({ checked: 0, total: 2, unchecked: ["a", "b"], stopped: "deadline" });
    expect(lookup).not.toHaveBeenCalled();
  });
});
