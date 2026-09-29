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

import { latestScoreEvents } from "@/lib/cards/frame-review-events";

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
