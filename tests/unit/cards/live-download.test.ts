import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOWNLOAD_FAILED_MESSAGE,
  DOWNLOAD_OFFLINE_MESSAGE,
  DOWNLOAD_TIMED_OUT_MESSAGE,
  LIVE_DOWNLOAD_TIMEOUT_MS,
  LONG_DOWNLOAD_NOTE,
  LiveDownloadError,
  fetchLiveDownload,
  liveDownloadMessage,
  preparingAnnouncement,
  preparingLabel,
  timeoutSignal,
} from "@/lib/cards/live-download";

// ---------------------------------------------------------------------------
// TODO 6.30 — a download that is drawn live says so. The pure half: the
// fetch of the link's own URL, within a time limit, and the reader's
// message for every way it can fail.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.useRealTimers();
});

/** A fetch that never answers until its signal aborts. */
const hangingFetch = vi.fn(
  (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
);

describe("the words", () => {
  it("say what is prepared and that a large file can take up to a minute", () => {
    expect(preparingLabel("image")).toBe("Preparing your image…");
    expect(preparingLabel("PDF")).toBe("Preparing your PDF…");
    expect(LONG_DOWNLOAD_NOTE).toMatch(/up to a minute/);
    expect(preparingAnnouncement("image")).toBe(`Preparing your image… ${LONG_DOWNLOAD_NOTE}`);
  });

  it("the time limit leaves room past the minute the copy promises", () => {
    expect(LIVE_DOWNLOAD_TIMEOUT_MS).toBeGreaterThan(60_000);
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

  it("a render past the time limit is stopped and says it took too long — never an endless wait", async () => {
    vi.useFakeTimers();
    const pending = fetchLiveDownload("/x", { fetchImpl: hangingFetch, timeoutMs: 5_000 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    const error = await pending;
    expect(liveDownloadMessage(error)).toBe(DOWNLOAD_TIMED_OUT_MESSAGE);
    expect((error as LiveDownloadError).code).toBe("TIMEOUT");
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

describe("timeoutSignal", () => {
  it("aborts after its time, and says it timed out", async () => {
    vi.useFakeTimers();
    const limit = timeoutSignal(1_000);
    expect(limit.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(limit.signal.aborted).toBe(true);
    expect(limit.timedOut()).toBe(true);
  });

  it("follows its parent, and a cleared one never fires", async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const limit = timeoutSignal(1_000, parent.signal);
    parent.abort();
    expect(limit.signal.aborted).toBe(true);
    expect(limit.timedOut()).toBe(false);

    const cleared = timeoutSignal(1_000);
    cleared.clear();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cleared.signal.aborted).toBe(false);
  });
});
