import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, payloadOf, type ChainCall } from "@/tests/stubs/supabase-chain";
import { FRAME_REFERENCES } from "@/lib/cards/frame-reference-registry";
import { overrideHash } from "@/lib/cards/frame-verification-state";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { createScoreBatchDecoder, type ScoreBatchEvent } from "@/lib/frames/score-batch";

// ---------------------------------------------------------------------------
// POST /api/admin/frame-score-batch — the whole-template / treatment scoring
// job (TODO 4.12). Contract: same-origin + admin session (404 otherwise)
// before anything is read or scored; every combo is scored against the
// reference planned from ONE review read (never a client value), with ONE
// override map for both the render and the recorded hash; each score is
// recorded as a "score" event; a combo with no printing is skipped; the
// answer is an NDJSON stream of start / scoring / result / done. And the
// job NEVER ticks: nothing is written to frame_reviews.
// ---------------------------------------------------------------------------

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const state = vi.hoisted(() => ({
  profile: null as null | { id: string; is_admin: boolean },
  configured: true,
  client: null as unknown,
  reviews: new Map<string, unknown>(),
  overrides: {} as Record<string, unknown>,
  score: vi.fn(),
  reviewReads: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => state.profile }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.client,
  isAdminConfigured: () => state.configured,
}));
vi.mock("@/lib/cards/frame-reviews", () => ({
  getFrameReviews: async () => {
    state.reviewReads += 1;
    return state.reviews;
  },
}));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({
  getFrameProfileOverrides: async () => state.overrides,
}));
vi.mock("@/lib/frames/score-combo", () => ({ scoreFrameCombo: state.score }));

import { POST } from "@/app/api/admin/frame-score-batch/route";

const ORIGIN = "https://www.pipglyph.com";

function post(body: unknown, origin: string | null = ORIGIN) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return POST(
    new Request(`${ORIGIN}/api/admin/frame-score-batch`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

async function readEvents(response: Response): Promise<ScoreBatchEvent[]> {
  const decoder = createScoreBatchDecoder();
  const text = await response.text();
  return [...decoder.push(text), ...decoder.flush()];
}

let stub: ReturnType<typeof chainClient>;

beforeEach(() => {
  state.profile = { id: ADMIN, is_admin: true };
  state.configured = true;
  state.reviews = new Map();
  state.overrides = { saga: { title: { rect: { topPct: 5 } } } };
  state.reviewReads = 0;
  state.score.mockReset();
  state.score.mockImplementation(async (input: { template: string; color: string; referenceId: string }) => ({
    ok: true,
    overall: 6.5,
    perSlot: {},
    global: { dxPct: 0.1, dyPct: 0, confidence: 0.8 },
    slots: { title: { score: 9, best: 6, dxPct: 0, dyPct: 0.2 } },
    referenceId: input.referenceId,
  }));
  stub = chainClient(() => ({ error: null, data: [] }));
  state.client = stub.client;
});

const inserts = () =>
  stub.log.map((e) => ({ table: e.table, payload: payloadOf(e.calls as ChainCall[], "insert") as Record<string, unknown> }));

describe("POST /api/admin/frame-score-batch", () => {
  it("refuses a cross-origin or origin-less request before anything else", async () => {
    expect((await post({ combos: [{ template: "saga", colorKey: "w" }] }, "https://evil.example")).status).toBe(403);
    expect((await post({ combos: [{ template: "saga", colorKey: "w" }] }, null)).status).toBe(403);
    expect(state.score).not.toHaveBeenCalled();
  });

  it("answers 404 to a non-admin or a guest, scoring nothing", async () => {
    state.profile = { id: "u", is_admin: false };
    expect((await post({ combos: [{ template: "saga", colorKey: "w" }] })).status).toBe(404);
    state.profile = null;
    expect((await post({ combos: [{ template: "saga", colorKey: "w" }] })).status).toBe(404);
    expect(state.score).not.toHaveBeenCalled();
    expect(state.reviewReads).toBe(0);
    expect(stub.log).toHaveLength(0);
  });

  it("503s without the admin key (a score it can't record can't count)", async () => {
    state.configured = false;
    expect((await post({ combos: [{ template: "saga", colorKey: "w" }] })).status).toBe(503);
    expect(state.score).not.toHaveBeenCalled();
  });

  it("rejects an unknown combo, an empty list and an oversized one", async () => {
    expect((await post({ combos: [{ template: "nope", colorKey: "w" }] })).status).toBe(400);
    expect((await post({ combos: [{ template: "saga", colorKey: "x" }] })).status).toBe(400);
    expect((await post({ combos: [] })).status).toBe(400);
    const many = Array.from({ length: 321 }, () => ({ template: "saga", colorKey: "w" }));
    expect((await post({ combos: many })).status).toBe(400);
    expect(state.score).not.toHaveBeenCalled();
  });

  it("streams start → scoring → result → done and records each score as a 'score' event", async () => {
    const response = await post({
      combos: [
        { template: "saga", colorKey: "w" },
        { template: "saga", colorKey: "u" },
      ],
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/x-ndjson/);
    const events = await readEvents(response);

    expect(events[0]).toEqual({
      type: "start",
      combos: [
        { template: "saga", colorKey: "w" },
        { template: "saga", colorKey: "u" },
      ],
      skipped: [],
    });
    expect(events.filter((e) => e.type === "scoring")).toHaveLength(2);
    const results = events.filter((e) => e.type === "result");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      ok: true,
      overall: 6.5,
      recorded: true,
      slots: { title: { score: 9, best: 6, dxPct: 0, dyPct: 0.2 } },
    });
    expect(events.at(-1)).toEqual({ type: "done", scored: 2, failed: 0, remaining: [], stopped: null });

    const written = inserts();
    expect(written.every((w) => w.table === "frame_review_events")).toBe(true);
    expect(written).toHaveLength(2);
    expect(written[0].payload).toMatchObject({
      template: "saga",
      action: "score",
      actor: ADMIN,
      layout_version: CARD_LAYOUT_VERSION,
      override_hash: overrideHash(state.overrides.saga),
      score_json: { overall: 6.5, global: { dxPct: 0.1, dyPct: 0, confidence: 0.8 } },
    });
  });

  it("never ticks: no frame_reviews write, whatever the scores", async () => {
    await readEvents(await post({ combos: [{ template: "saga", colorKey: "w" }] }));
    expect(stub.forTable("frame_reviews")).toHaveLength(0);
    for (const entry of stub.log) {
      expect(entry.calls.some((c) => c.method === "upsert" || c.method === "update")).toBe(false);
    }
  });

  it("plans every reference from ONE review read and hands the scorer the planned id and the one override map", async () => {
    const pinned = "11111111-2222-4333-8444-555555555555";
    state.reviews = new Map([
      ["saga/u", { referenceScryfallId: pinned, referenceName: "Pinned", referenceSet: "tst" }],
    ]);
    await readEvents(
      await post({
        combos: [
          { template: "saga", colorKey: "w" },
          { template: "saga", colorKey: "u" },
        ],
      }),
    );
    expect(state.reviewReads).toBe(1);
    const calls = state.score.mock.calls.map((c) => c[0]);
    expect(calls.find((c) => c.color === "w")).toMatchObject({
      template: "saga",
      referenceId: FRAME_REFERENCES.saga.w!.scryfallId,
      overrides: state.overrides,
    });
    expect(calls.find((c) => c.color === "u")?.referenceId).toBe(pinned);
  });

  it("skips a colour with no real printing and says why", async () => {
    const events = await readEvents(
      await post({
        combos: [
          { template: "split", colorKey: "w" },
          { template: "saga", colorKey: "w" },
        ],
      }),
    );
    expect(events[0]).toMatchObject({
      type: "start",
      combos: [{ template: "saga", colorKey: "w" }],
      skipped: [{ template: "split", colorKey: "w", reason: expect.stringMatching(/No real printing/) }],
    });
    expect(state.score).toHaveBeenCalledTimes(1);
  });

  it("a failed score is reported and not recorded; the job carries on", async () => {
    state.score.mockImplementationOnce(async () => ({ ok: false, error: "Could not download the scan.", status: 502 }));
    const events = await readEvents(
      await post({
        combos: [
          { template: "saga", colorKey: "w" },
          { template: "saga", colorKey: "u" },
        ],
      }),
    );
    const results = events.filter((e) => e.type === "result");
    expect(results.find((r) => !(r as { ok: boolean }).ok)).toMatchObject({ error: "Could not download the scan." });
    expect(events.at(-1)).toMatchObject({ type: "done", scored: 1, failed: 1 });
    expect(inserts()).toHaveLength(1);
  });

  it("a score whose event couldn't be written is a failure the view can show", async () => {
    stub = chainClient(() => ({ error: { message: "insert failed" } }));
    state.client = stub.client;
    const events = await readEvents(await post({ combos: [{ template: "saga", colorKey: "w" }] }));
    expect(events.find((e) => e.type === "result")).toMatchObject({ ok: true, recorded: false });
    expect(events.at(-1)).toMatchObject({ type: "done", scored: 0, failed: 1 });
  });
});
