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
  /** PostgREST answers at most max_rows (1000 on every project) whatever
   *  .limit() asks for. */
  const MAX_ROWS = 1000;

  /** A "database" of candidate rows (newest first): a light read answers the
   *  rows of the template(s) it filters on, capped like PostgREST; the id
   *  read answers the full rows. */
  function eventsDb(candidates: Array<{ id: string; template: string; color_key: string; overall: unknown }>) {
    const full = (id: string) => {
      const c = candidates.find((r) => r.id === id)!;
      return {
        ...row(c.color_key, "score", "2026-09-29T00:00:00Z", { overall: c.overall, slots: {} }),
        id: c.id,
        template: c.template,
      };
    };
    return chainClient((_table, calls): ChainAnswer => {
      const byId = calls.find((c) => c.method === "in" && c.args[0] === "id");
      if (byId) return { data: (byId.args[1] as string[]).map(full), error: null };
      const one = calls.find((c) => c.method === "eq" && c.args[0] === "template")?.args[1] as string | undefined;
      const many = calls.find((c) => c.method === "in" && c.args[0] === "template")?.args[1] as string[] | undefined;
      const wanted = (t: string) => (one !== undefined ? t === one : (many ?? []).includes(t));
      const limit = (calls.find((c) => c.method === "limit")?.args[0] as number | undefined) ?? MAX_ROWS;
      return { data: candidates.filter((r) => wanted(r.template)).slice(0, Math.min(limit, MAX_ROWS)), error: null };
    });
  }

  it("picks the newest scored event per template and colour from light reads, then loads only those rows", async () => {
    const stub = eventsDb([
      { id: "a1", template: "m15borderless", color_key: "w", overall: null }, // failed tick
      { id: "a2", template: "m15borderless", color_key: "w", overall: 7 },
      { id: "a3", template: "m15borderless", color_key: "w", overall: 9 },
      { id: "b1", template: "m15borderlessartifact", color_key: "w", overall: 4 },
    ]);
    state.client = stub.client;

    const latest = await latestScoreEventsForTemplates(["m15borderless", "m15borderlessartifact"]);
    const reads = stub.forTable("frame_review_events");
    const light = reads.filter((r) => !r.calls.some((c) => c.method === "in" && c.args[0] === "id"));
    const heavy = reads.filter((r) => r.calls.some((c) => c.method === "in" && c.args[0] === "id"));
    // One light read per template, each without the score body.
    expect(light.map((r) => r.calls.find((c) => c.method === "eq" && c.args[0] === "template")?.args[1])).toEqual([
      "m15borderless",
      "m15borderlessartifact",
    ]);
    for (const read of light) {
      expect(read.calls.find((c) => c.method === "select")?.args[0]).not.toMatch(/score_json,|score_json$/);
    }
    expect(heavy).toHaveLength(1);
    expect(heavy[0].calls.find((c) => c.method === "in" && c.args[0] === "id")?.args[1]).toEqual(["a2", "b1"]);
    expect(latest.get("m15borderless")?.get("w")).toMatchObject({ id: "a2", scoreJson: { overall: 7, slots: {} } });
    expect(latest.get("m15borderlessartifact")?.get("w")).toMatchObject({ id: "b1" });
  });

  it("a busy template's history can't crowd a quiet template's newest score out (max_rows)", async () => {
    // m15 was scored over and over since m15borderless was last scored: more
    // newer rows than one PostgREST answer holds.
    const busy = Array.from({ length: MAX_ROWS + 50 }, (_, i) => ({
      id: `m${i}`,
      template: "m15",
      color_key: "wubrgcm"[i % 7],
      overall: 5,
    }));
    const quiet = { id: "q1", template: "m15borderless", color_key: "u", overall: 8 };
    state.client = eventsDb([...busy, quiet]).client;

    const latest = await latestScoreEventsForTemplates(["m15", "m15borderless"]);
    expect(latest.get("m15")?.size).toBe(7);
    expect(latest.get("m15borderless")?.get("u")).toMatchObject({ id: "q1", scoreJson: { overall: 8 } });
  });

  it("no templates, no read; an error reads as no scores", async () => {
    const stub = db();
    expect((await latestScoreEventsForTemplates([])).size).toBe(0);
    expect(stub.log).toHaveLength(0);
    state.client = chainClient(() => ({ data: null, error: { message: "boom" } })).client;
    expect((await latestScoreEventsForTemplates(["saga"])).size).toBe(0);
  });
});
