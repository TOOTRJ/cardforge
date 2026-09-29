import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// latestScoreEvents (TODO 2.4) — the auto-score the template sign-off shows
// and publishes per colour: the newest "score" event OR scored "verify"
// event (every per-colour tick scores the combo), skipping a tick whose
// score failed, so a colour ticked on today's renderer isn't shown as
// "Not scored yet" and needn't be scored twice.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));

import { latestScoreEvents, latestScoreEventsForTemplates } from "@/lib/cards/frame-review-events";

const row = (colorKey: string, action: string, createdAt: string, scoreJson: unknown) => ({
  id: `${colorKey}-${action}-${createdAt}`,
  template: "saga",
  color_key: colorKey,
  action,
  actor: null,
  layout_version: 32,
  override_hash: "none",
  reference_scryfall_id: "ref",
  score_json: scoreJson,
  created_at: createdAt,
});

let rows: unknown[] = [];
beforeEach(() => {
  rows = [];
});

function db() {
  const stub = chainClient((): ChainAnswer => ({ data: rows, error: null }));
  state.client = stub.client;
  return stub;
}

describe("latestScoreEvents", () => {
  it("reads score and verify events of the template, newest first", async () => {
    const stub = db();
    await latestScoreEvents("saga");
    const [read] = stub.forTable("frame_review_events");
    expect(called(read.calls, "eq", "template")).toBe(true);
    const inCall = read.calls.find((c) => c.method === "in");
    expect(inCall?.args).toEqual(["action", ["score", "verify"]]);
    expect(read.calls.find((c) => c.method === "order")?.args).toEqual([
      "created_at",
      { ascending: false },
    ]);
  });

  it("keeps the newest scored event per colour; a tick with no score is skipped", async () => {
    rows = [
      row("w", "verify", "2026-09-28T12:00:00Z", null), // the tick's score failed
      row("w", "score", "2026-09-28T11:00:00Z", { overall: 71 }),
      row("u", "verify", "2026-09-28T10:00:00Z", { overall: 64 }),
      row("u", "score", "2026-09-27T10:00:00Z", { overall: 12 }),
    ];
    db();
    const latest = await latestScoreEvents("saga");
    expect(latest.get("w")).toMatchObject({ action: "score", scoreJson: { overall: 71 } });
    expect(latest.get("u")).toMatchObject({ action: "verify", scoreJson: { overall: 64 } });
    expect(latest.has("b")).toBe(false);
  });

  it("an error reads as no scores", async () => {
    state.client = chainClient(() => ({ data: null, error: { message: "boom" } })).client;
    expect((await latestScoreEvents("saga")).size).toBe(0);
  });
});

describe("latestScoreEventsForTemplates (TODO 4.12's treatment panel)", () => {
  it("picks the newest scored event per template and colour from a light read, then loads only those rows", async () => {
    const candidates = [
      { id: "a1", template: "m15borderless", color_key: "w", created_at: "2026-09-29T12:00:00Z", overall: null }, // failed tick
      { id: "a2", template: "m15borderless", color_key: "w", created_at: "2026-09-29T11:00:00Z", overall: 7 },
      { id: "a3", template: "m15borderless", color_key: "w", created_at: "2026-09-29T10:00:00Z", overall: 9 },
      { id: "b1", template: "m15borderlessartifact", color_key: "w", created_at: "2026-09-29T09:00:00Z", overall: 4 },
    ];
    const full = [
      { ...row("w", "score", "2026-09-29T11:00:00Z", { overall: 7, slots: {} }), id: "a2", template: "m15borderless" },
      { ...row("w", "verify", "2026-09-29T09:00:00Z", { overall: 4 }), id: "b1", template: "m15borderlessartifact" },
    ];
    const stub = chainClient((_table, calls): ChainAnswer => {
      const byId = calls.find((c) => c.method === "in" && c.args[0] === "id");
      return { data: byId ? full : candidates, error: null };
    });
    state.client = stub.client;

    const latest = await latestScoreEventsForTemplates(["m15borderless", "m15borderlessartifact"]);
    const [light, heavy] = stub.forTable("frame_review_events");
    // The candidate read leaves the score body out.
    expect(light.calls.find((c) => c.method === "select")?.args[0]).not.toMatch(/score_json,|score_json$/);
    expect(light.calls.find((c) => c.method === "in" && c.args[0] === "template")?.args[1]).toEqual([
      "m15borderless",
      "m15borderlessartifact",
    ]);
    expect(heavy.calls.find((c) => c.method === "in" && c.args[0] === "id")?.args[1]).toEqual(["a2", "b1"]);
    expect(latest.get("m15borderless")?.get("w")).toMatchObject({ id: "a2", scoreJson: { overall: 7, slots: {} } });
    expect(latest.get("m15borderlessartifact")?.get("w")).toMatchObject({ id: "b1", action: "verify" });
  });

  it("no templates, no read; an error reads as no scores", async () => {
    const stub = db();
    expect((await latestScoreEventsForTemplates([])).size).toBe(0);
    expect(stub.log).toHaveLength(0);
    state.client = chainClient(() => ({ data: null, error: { message: "boom" } })).client;
    expect((await latestScoreEventsForTemplates(["saga"])).size).toBe(0);
  });
});
