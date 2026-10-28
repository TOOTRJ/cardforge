import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOWNLOAD_FAILED_MESSAGE,
  DOWNLOAD_OFFLINE_MESSAGE,
  DOWNLOAD_STALLED_MESSAGE,
  DOWNLOAD_TIMED_OUT_MESSAGE,
  LIVE_DOWNLOAD_HEADERS_TIMEOUT_MS,
  LIVE_DOWNLOAD_STALL_TIMEOUT_MS,
  LONG_DOWNLOAD_NOTE,
  LiveDownloadError,
  fetchLiveDownload,
  fetchWithLimits,
  isIosBrowser,
  liveDownloadMessage,
  preparingAnnouncement,
  preparingLabel,
} from "@/lib/cards/live-download";

// ---------------------------------------------------------------------------
// TODO 6.30 — a download that is drawn live says so. The pure half: the
// fetch of the link's own URL under TWO limits (#628's check) — the
// server's own time to START answering, then a stall timer on the body that
// restarts on every chunk, never one clock over the whole file — and the
// reader's message for every way it can fail.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.useRealTimers();
});

/** A fetch that never answers until its signal aborts. */
const hangingFetch = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });

/** A response whose body arrives in `chunks`, `gapMs` apart; with `stallAfter`
 *  it sends that many chunks and then nothing at all. */
function trickle(chunks: number, gapMs: number, stallAfter?: number): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stallAfter !== undefined && sent >= stallAfter) return new Promise<void>(() => {});
      await new Promise((resolve) => setTimeout(resolve, gapMs));
      if (sent >= chunks) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array([sent]));
      sent += 1;
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "image/png" } });
}

describe("the words", () => {
  it("say what is prepared and that a large file can take up to a minute", () => {
    expect(preparingLabel("image")).toBe("Preparing your image…");
    expect(preparingLabel("PDF")).toBe("Preparing your PDF…");
    expect(LONG_DOWNLOAD_NOTE).toMatch(/up to a minute/);
    expect(preparingAnnouncement("image")).toBe(`Preparing your image… ${LONG_DOWNLOAD_NOTE}`);
  });
});

describe("the limits", () => {
  it("the wait for an answer is at least the server's own limit — read from the routes", () => {
    // Vercel's default maxDuration with Fluid compute is 300 s; a route that
    // declares its own must not outlast the browser's wait.
    for (const route of ["app/api/cards/[id]/png/route.ts", "app/api/cards/[id]/pdf/route.ts"]) {
      const source = readFileSync(join(process.cwd(), route), "utf8");
      const declared = /export const maxDuration\s*=\s*(\d+)/.exec(source);
      const serverMs = (declared ? Number(declared[1]) : 300) * 1000;
      expect(LIVE_DOWNLOAD_HEADERS_TIMEOUT_MS, route).toBeGreaterThanOrEqual(serverMs);
    }
  });

  it("the stall limit is a gap between chunks, far shorter than a render", () => {
    expect(LIVE_DOWNLOAD_STALL_TIMEOUT_MS).toBeLessThan(LIVE_DOWNLOAD_HEADERS_TIMEOUT_MS);
    expect(LIVE_DOWNLOAD_STALL_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
  });

  it("a big body on a slow link arrives, however long it takes in all, while bytes keep coming", async () => {
    // 8 chunks, 15 ms apart: ~120 ms in all — four times the 30 ms the
    // headers may take, and longer than any single stall window of 60 ms.
    const result = await fetchWithLimits("/x", {
      fetchImpl: async () => trickle(8, 15),
      headersTimeoutMs: 30,
      stallTimeoutMs: 60,
    });
    expect(result.ok).toBe(true);
    expect(Array.from(result.bytes)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.contentType).toBe("image/png");
  });

  it("a body that stops arriving is stopped and says so", async () => {
    const error = await fetchWithLimits("/x", {
      fetchImpl: async () => trickle(8, 5, 2),
      stallTimeoutMs: 40,
    }).catch((e: unknown) => e);
    expect((error as LiveDownloadError).code).toBe("STALLED");
    expect(liveDownloadMessage(error)).toBe(DOWNLOAD_STALLED_MESSAGE);
  });

  it("a render that never answers is stopped at the headers limit and says it took too long", async () => {
    vi.useFakeTimers();
    const pending = fetchLiveDownload("/x", { fetchImpl: hangingFetch, headersTimeoutMs: 5_000 }).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(5_000);
    const error = await pending;
    expect(liveDownloadMessage(error)).toBe(DOWNLOAD_TIMED_OUT_MESSAGE);
    expect((error as LiveDownloadError).code).toBe("TIMEOUT");
  });
});

describe("fetchLiveDownload", () => {
  it("fetches the link's URL, unchanged, and resolves with its bytes", async () => {
    const fetchImpl = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    const blob = await fetchLiveDownload("/api/cards/c1/png?preset=hd&corners=round", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/cards/c1/png?preset=hd&corners=round");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("a refusal says the route's own words, with its code", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Sheet layouts are a Pro feature.", code: "UPGRADE_REQUIRED" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    );
    const error = await fetchLiveDownload("/api/cards/c1/pdf?layout=sheet", { fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LiveDownloadError);
    expect((error as LiveDownloadError).message).toBe("Sheet layouts are a Pro feature.");
    expect((error as LiveDownloadError).code).toBe("UPGRADE_REQUIRED");
  });

  it("a failure without words says the generic message", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 500 }));
    const error = await fetchLiveDownload("/x", { fetchImpl }).catch((e: unknown) => e);
    expect(liveDownloadMessage(error)).toBe(DOWNLOAD_FAILED_MESSAGE);
  });

  it("a dropped connection says so", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const error = await fetchLiveDownload("/x", { fetchImpl }).catch((e: unknown) => e);
    expect(liveDownloadMessage(error)).toBe(DOWNLOAD_OFFLINE_MESSAGE);
    expect((error as LiveDownloadError).code).toBe("NETWORK");
  });

  it("an abort from the caller is a cancel, not a time-out", async () => {
    const controller = new AbortController();
    const pending = fetchLiveDownload("/x", { fetchImpl: hangingFetch, signal: controller.signal }).catch(
      (e: unknown) => e,
    );
    controller.abort();
    expect(((await pending) as LiveDownloadError).code).toBe("CANCELLED");
  });

  it("anything else thrown reads as the generic message", () => {
    expect(liveDownloadMessage(new Error("boom"))).toBe(DOWNLOAD_FAILED_MESSAGE);
  });
});

describe("isIosBrowser — iOS keeps the native link", () => {
  it.each([
    ["iPhone Safari", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" }, true],
    ["iPhone Chrome", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1" }, true],
    ["iPad asking for the desktop site", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 }, true],
    ["a Mac", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 }, false],
    ["Android Chrome", { userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/130.0 Mobile Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 }, false],
  ] as const)("%s → %s", (_name, env, ios) => {
    expect(isIosBrowser(env)).toBe(ios);
  });
});
