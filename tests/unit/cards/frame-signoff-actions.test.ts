import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chainClient,
  called,
  payloadOf,
  type ChainAnswer,
  type ChainCall,
} from "@/tests/stubs/supabase-chain";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { FRAME_REFERENCES } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// The stepper walk-through's admin actions (TODO 2.3 / 2.4). Contract: admin
// gate from the profile before any read or write; a score is recorded as a
// "score" event (or the action says it wasn't); the template sign-off
// re-derives the rule on the server — every referenced colour scored on
// today's renderer, plus the tick — stamps each publishable colour like a
// tick and logs verify + signoff events; the delete only ever removes a
// flagged preview.
// ---------------------------------------------------------------------------

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const state = vi.hoisted(() => ({
  profile: null as null | { id: string; is_admin: boolean },
  configured: true,
  client: null as unknown,
  overrides: {} as Record<string, unknown>,
  score: null as unknown,
  scores: new Map<string, unknown>(),
  reviews: new Map<string, unknown>(),
  removed: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => state.profile }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.client,
  isAdminConfigured: () => state.configured,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({
  getFrameProfileOverrides: async () => state.overrides,
}));
vi.mock("@/lib/cards/frame-reviews", () => ({ getFrameReviews: async () => state.reviews }));
vi.mock("@/lib/frames/score-combo", () => ({ scoreFrameCombo: async () => state.score }));
vi.mock("@/lib/cards/bake-core", () => ({
  removeRenderObject: async (_client: unknown, path: string) => {
    state.removed.push(path);
  },
}));
vi.mock("@/lib/cards/frame-review-events", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cards/frame-review-events")>(
    "@/lib/cards/frame-review-events",
  );
  return { ...actual, latestScoreEvents: async () => state.scores };
});

import {
  deleteFramePreviewCardAction,
  scoreFrameColorAction,
  signOffFrameTemplateAction,
} from "@/lib/cards/frame-signoff-actions";

function db(resolve: (table: string, calls: ChainCall[]) => ChainAnswer = () => ({ error: null, data: [] })) {
  const stub = chainClient(resolve);
  state.client = stub.client;
  return stub;
}

const events = (stub: ReturnType<typeof chainClient>) =>
  stub
    .forTable("frame_review_events")
    .map((e) => payloadOf(e.calls, "insert") as Record<string, unknown>);

const currentScore = (overall: number) => ({
  id: `s-${overall}`,
  template: "saga",
  colorKey: "w",
  action: "score",
  actor: ADMIN,
  layoutVersion: CARD_LAYOUT_VERSION,
  overrideHash: "none",
  referenceScryfallId: "ref-id",
  scoreJson: { overall },
  createdAt: "2026-09-28T10:00:00Z",
});

beforeEach(() => {
  state.profile = { id: ADMIN, is_admin: true };
  state.configured = true;
  state.overrides = {};
  state.score = {
    ok: true,
    overall: 6.1,
    perSlot: {},
    global: { dxPct: 0, dyPct: 0, confidence: 0.5 },
    slots: {},
    referenceId: "ref-id",
  };
  state.scores = new Map();
  state.reviews = new Map();
  state.removed = [];
});

describe("scoreFrameColorAction", () => {
  it("refuses non-admins before anything runs", async () => {
    state.profile = { id: ADMIN, is_admin: false };
    const stub = db();
    expect(await scoreFrameColorAction({ template: "saga", colorKey: "w" })).toEqual({
      ok: false,
      error: "Not authorized.",
    });
    expect(stub.log).toHaveLength(0);
  });

  it("rejects an unknown combination", async () => {
    db();
    expect((await scoreFrameColorAction({ template: "nope", colorKey: "w" })).ok).toBe(false);
    expect((await scoreFrameColorAction({ template: "saga", colorKey: "x" })).ok).toBe(false);
  });

  it("records the score as a 'score' event with what it was measured on", async () => {
    const stub = db();
    const result = await scoreFrameColorAction({ template: "saga", colorKey: "w" });
    expect(result).toEqual({ ok: true, overall: 6.1, referenceId: "ref-id" });
    const [event] = events(stub);
    expect(event).toMatchObject({
      template: "saga",
      color_key: "w",
      action: "score",
      actor: ADMIN,
      layout_version: CARD_LAYOUT_VERSION,
      override_hash: "none",
      reference_scryfall_id: "ref-id",
    });
    expect((event.score_json as { overall: number }).overall).toBe(6.1);
    // Scoring publishes nothing.
    expect(stub.forTable("frame_reviews")).toHaveLength(0);
  });

  it("passes the score's own failure through", async () => {
    state.score = { ok: false, error: "No reference printing for this combination.", status: 404 };
    const stub = db();
    expect(await scoreFrameColorAction({ template: "split", colorKey: "w" })).toEqual({
      ok: false,
      error: "No reference printing for this combination.",
    });
    expect(events(stub)).toHaveLength(0);
  });

  it("says so when the score couldn't be recorded", async () => {
    db(() => ({ error: { message: "violates check constraint" } }));
    const result = await scoreFrameColorAction({ template: "saga", colorKey: "w" });
    expect(result.ok).toBe(false);
  });
});

describe("signOffFrameTemplateAction", () => {
  it("refuses non-admins and a missing tick", async () => {
    db();
    expect((await signOffFrameTemplateAction({ template: "saga" })).ok).toBe(false);
    expect((await signOffFrameTemplateAction({ template: "saga", confirmed: false })).ok).toBe(false);
    state.profile = { id: ADMIN, is_admin: false };
    const stub = db();
    expect(await signOffFrameTemplateAction({ template: "saga", confirmed: true })).toEqual({
      ok: false,
      error: "Not authorized.",
    });
    expect(stub.log).toHaveLength(0);
  });

  it("refuses while a referenced colour is unscored, naming it", async () => {
    state.scores = new Map([["w", currentScore(5)]]);
    const stub = db();
    const result = await signOffFrameTemplateAction({ template: "saga", confirmed: true });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/missing or stale: .*U/);
    expect(stub.forTable("frame_reviews")).toHaveLength(0);
  });

  it("refuses a stale score (the override changed since)", async () => {
    state.scores = new Map(
      (["w", "u", "b", "r", "g", "c", "m"] as const).map((k) => [k, { ...currentScore(5), colorKey: k }]),
    );
    state.overrides = { saga: { type: { rect: { topPct: 85 } } } };
    db();
    const result = await signOffFrameTemplateAction({ template: "saga", confirmed: true });
    expect(result.ok).toBe(false);
  });

  it("publishes every scored colour, stamped like a tick, and logs verify + signoff events", async () => {
    // Every colour of the template that has a reference is scored; the ones
    // with no printing are left to their own checkbox.
    const referenced = (["w", "u", "b", "r", "g", "c", "m"] as const).filter(
      (k) => FRAME_REFERENCES.split[k] !== null,
    );
    const noPrinting = (["w", "u", "b", "r", "g", "c", "m"] as const).filter(
      (k) => FRAME_REFERENCES.split[k] === null,
    );
    state.scores = new Map(
      referenced.map((k, i) => [k, { ...currentScore(3 + i), template: "split", colorKey: k }]),
    );
    const stub = db();
    const result = await signOffFrameTemplateAction({ template: "split", confirmed: true });
    expect(result).toEqual({ ok: true, published: referenced, sampleOnly: noPrinting });

    const upsert = payloadOf(stub.forTable("frame_reviews")[0].calls, "upsert") as Array<Record<string, unknown>>;
    expect(upsert.map((row) => row.color_key)).toEqual(referenced);
    for (const row of upsert) {
      expect(row).toMatchObject({
        template: "split",
        verified: true,
        verified_by: ADMIN,
        verified_layout_version: CARD_LAYOUT_VERSION,
        verified_override_hash: "none",
        verified_reference_id: "ref-id",
      });
      expect("reference_scryfall_id" in row).toBe(false);
    }
    const logged = events(stub);
    expect(logged.filter((e) => e.action === "verify").map((e) => e.color_key)).toEqual(referenced);
    const signoff = logged.find((e) => e.action === "signoff");
    expect(signoff).toMatchObject({ template: "split", color_key: "*", actor: ADMIN });
  });
});

describe("deleteFramePreviewCardAction", () => {
  it("refuses non-admins", async () => {
    state.profile = { id: ADMIN, is_admin: false };
    const stub = db();
    expect((await deleteFramePreviewCardAction({ cardId: CARD })).ok).toBe(false);
    expect(stub.log).toHaveLength(0);
  });

  it("only ever deletes a flagged preview", async () => {
    const stub = db((table, calls) =>
      called(calls, "maybeSingle") ? { data: null } : { error: null },
    );
    const result = await deleteFramePreviewCardAction({ cardId: CARD });
    expect(result).toEqual({ ok: false, error: "That frame preview no longer exists." });
    const [read] = stub.forTable("cards");
    expect(called(read.calls, "eq", "frame_preview")).toBe(true);
    expect(stub.forTable("cards").some((e) => called(e.calls, "delete"))).toBe(false);
  });

  it("deletes the flagged row and drops any render objects", async () => {
    const stub = db((table, calls) =>
      called(calls, "maybeSingle") ? { data: { id: CARD, owner_id: ADMIN } } : { error: null },
    );
    expect(await deleteFramePreviewCardAction({ cardId: CARD })).toEqual({ ok: true });
    const del = stub.forTable("cards").find((e) => called(e.calls, "delete"));
    expect(del && called(del.calls, "eq", "frame_preview")).toBe(true);
    expect(state.removed).toHaveLength(2);
    expect(state.removed[0]).toContain(CARD);
  });
});
