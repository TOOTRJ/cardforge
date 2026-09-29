import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  __resetScoreBatchForTests,
  cancelScoreBatch,
  getScoreBatchState,
  scoreBatchCounts,
  startScoreBatch,
} from "@/components/admin/score-batch-store";
import { encodeScoreBatchEvent, type ScoreBatchCombo, type ScoreBatchEvent } from "@/lib/frames/score-batch";

// ---------------------------------------------------------------------------
// The tab's scoring job (TODO 4.12): one POST per round read as a stream;
// a round the server stopped at its time budget is followed by one with
// exactly the combos it didn't start; a stream cut without "done" carries on
// with what wasn't scored (once it got somewhere); an HTTP error or a
// cancel ends the job with what was scored kept; a second start while one
// runs is a no-op.
// ---------------------------------------------------------------------------

const combo = (colorKey: string): ScoreBatchCombo => ({ template: "saga", colorKey: colorKey as "w" });

const result = (colorKey: string, overall = 5): ScoreBatchEvent => ({
  type: "result",
  template: "saga",
  colorKey: colorKey as "w",
  ok: true,
  overall,
  global: { dxPct: 0, dyPct: 0, confidence: 0.9 },
  slots: {},
  referenceId: `ref-${colorKey}`,
  recorded: true,
});

function streamOf(events: ScoreBatchEvent[], chunk = 11) {
  const text = events.map(encodeScoreBatchEvent).join("");
  const bytes = new TextEncoder().encode(text);
  return new NodeReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
      controller.close();
    },
  });
}

function streamResponse(events: ScoreBatchEvent[]) {
  return { ok: true, status: 200, body: streamOf(events), json: async () => null } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  __resetScoreBatchForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string) as { combos: ScoreBatchCombo[] };

describe("startScoreBatch", () => {
  it("runs one round, fills progress and results, skips what the server skipped", async () => {
    fetchMock.mockResolvedValueOnce(
      streamResponse([
        { type: "start", combos: [combo("w"), combo("u")], skipped: [{ ...combo("c"), reason: "No real printing" }] },
        { type: "scoring", ...combo("w") },
        result("w", 4.2),
        { type: "scoring", ...combo("u") },
        { type: "result", ...combo("u"), ok: false, error: "Could not download the scan." },
        { type: "done", scored: 1, failed: 1, remaining: [], stopped: null },
      ]),
    );
    const final = await startScoreBatch({
      scopeKey: "template:saga",
      label: "saga — all colours",
      combos: [combo("w"), combo("u"), combo("c")],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/frame-score-batch");
    expect(bodyOf(0).combos).toEqual([combo("w"), combo("u"), combo("c")]);
    expect(final.status).toBe("done");
    expect(final.progress["saga/w"]).toEqual({ status: "done", overall: 4.2 });
    expect(final.progress["saga/u"]).toMatchObject({ status: "failed", error: "Could not download the scan." });
    expect(final.progress["saga/c"]).toMatchObject({ status: "skipped" });
    expect(final.results["saga/w"]).toMatchObject({ overall: 4.2, referenceId: "ref-w", recorded: true });
    expect(scoreBatchCounts(final)).toMatchObject({ total: 3, done: 1, failed: 1, skipped: 1, finished: 3 });
  });

  it("a round stopped at the time budget is followed by one with exactly the combos it didn't start", async () => {
    fetchMock
      .mockResolvedValueOnce(
        streamResponse([
          { type: "start", combos: [combo("w"), combo("u"), combo("b")], skipped: [] },
          result("w"),
          { type: "done", scored: 1, failed: 0, remaining: [combo("u"), combo("b")], stopped: "budget" },
        ]),
      )
      .mockResolvedValueOnce(
        streamResponse([
          { type: "start", combos: [combo("u"), combo("b")], skipped: [] },
          result("u"),
          result("b"),
          { type: "done", scored: 2, failed: 0, remaining: [], stopped: null },
        ]),
      );
    const final = await startScoreBatch({
      scopeKey: "template:saga",
      label: "saga",
      combos: [combo("w"), combo("u"), combo("b")],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyOf(1).combos).toEqual([combo("u"), combo("b")]);
    expect(final.status).toBe("done");
    expect(final.rounds).toBe(2);
    expect(scoreBatchCounts(final).done).toBe(3);
  });

  it("a stream cut without 'done' carries on with what wasn't scored, once it got somewhere", async () => {
    fetchMock
      .mockResolvedValueOnce(
        streamResponse([
          { type: "start", combos: [combo("w"), combo("u")], skipped: [] },
          { type: "scoring", ...combo("w") },
          result("w"),
          { type: "scoring", ...combo("u") },
        ]),
      )
      .mockResolvedValueOnce(
        streamResponse([
          { type: "start", combos: [combo("u")], skipped: [] },
          result("u"),
          { type: "done", scored: 1, failed: 0, remaining: [], stopped: null },
        ]),
      );
    const final = await startScoreBatch({ scopeKey: "s", label: "saga", combos: [combo("w"), combo("u")] });
    expect(bodyOf(1).combos).toEqual([combo("u")]);
    expect(final.status).toBe("done");
  });

  it("a cut stream that scored nothing stops with an error instead of looping", async () => {
    fetchMock.mockResolvedValue(
      streamResponse([{ type: "start", combos: [combo("w")], skipped: [] }, { type: "scoring", ...combo("w") }]),
    );
    const final = await startScoreBatch({ scopeKey: "s", label: "saga", combos: [combo("w")] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(final.status).toBe("error");
    expect(final.error).toMatch(/stopped before it finished/);
  });

  it("an HTTP refusal ends the job with the server's message", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      body: null,
      json: async () => ({ ok: false, error: "Not authorized." }),
    } as unknown as Response);
    const final = await startScoreBatch({ scopeKey: "s", label: "saga", combos: [combo("w")] });
    expect(final.status).toBe("error");
    expect(final.error).toBe("Not authorized.");
  });

  it("a second start while one runs is a no-op; cancel ends it as cancelled", async () => {
    let abortSignal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      abortSignal = init.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const running = startScoreBatch({ scopeKey: "s", label: "saga", combos: [combo("w"), combo("u")] });
    expect(getScoreBatchState().status).toBe("running");
    const second = await startScoreBatch({ scopeKey: "other", label: "other", combos: [combo("b")] });
    expect(second.scopeKey).toBe("s");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    cancelScoreBatch();
    const final = await running;
    expect(abortSignal?.aborted).toBe(true);
    expect(final.status).toBe("cancelled");
  });
});
