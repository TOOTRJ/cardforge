import { afterEach, describe, expect, it, vi } from "vitest";
import { mapLimit, objectExists } from "@/scripts/lib/frame-objects.mjs";

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

  it("calls a 400 on every try missing", async () => {
    const fetch = vi.fn().mockImplementation(async () => head(400));
    vi.stubGlobal("fetch", fetch);
    expect(await objectExists("https://b/x", 10, { baseDelayMs: 0 })).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(4);
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
