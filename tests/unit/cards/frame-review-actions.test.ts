import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chainClient,
  called,
  payloadOf,
  type ChainAnswer,
} from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// Verification checklist actions. Contract: admin gate first; a tick stamps
// what it measured (layout version, override hash, the reference on screen,
// the score) and appends a history event; a withdraw keeps the stamped
// record and appends an event; pinning validates colour/kind and appends
// pin/unpin events; the reference_* columns are never touched by a tick.
// ---------------------------------------------------------------------------

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REF = "b56b9131-4f7e-4912-ba47-63ed82f21d1b";

const state = vi.hoisted(() => ({
  profile: null as null | { id: string; is_admin: boolean },
  configured: true,
  client: null as unknown,
  overrides: {} as Record<string, unknown>,
  score: null as unknown,
  card: null as unknown,
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => state.profile }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.client,
  isAdminConfigured: () => state.configured,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({
  FRAME_PROFILE_OVERRIDES_TAG: "frame-profile-overrides",
  getFrameProfileOverrides: async () => state.overrides,
}));
vi.mock("@/lib/frames/score-combo", () => ({
  scoreFrameCombo: async () => state.score,
}));
vi.mock("@/lib/scryfall/client", () => ({
  getCardById: async () => state.card,
  assessPrintImageQuality: () => "ok",
}));

import {
  setFrameReferenceAction,
  setFrameReviewAction,
} from "@/lib/cards/frame-review-actions";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { overrideHash } from "@/lib/cards/frame-verification-state";

function db() {
  const stub = chainClient((): ChainAnswer => ({ error: null, data: [] }));
  state.client = stub.client;
  return stub;
}

const events = (stub: ReturnType<typeof chainClient>) =>
  stub.forTable("frame_review_events").map((e) => payloadOf(e.calls, "insert") as Record<string, unknown>);

beforeEach(() => {
  state.profile = { id: ADMIN, is_admin: true };
  state.configured = true;
  state.overrides = { saga: { type: { rect: { topPct: 85.1 } } } };
  state.score = {
    ok: true,
    overall: 4.9,
    perSlot: { title: 14.7 },
    global: { dxPct: 0, dyPct: -0.1, confidence: 0.48 },
    slots: { title: { score: 14.7, best: 12.8, dxPct: 0.3, dyPct: -0.3 } },
    referenceId: REF,
  };
});

describe("setFrameReviewAction", () => {
  it("refuses non-admins before touching the database", async () => {
    state.profile = { id: ADMIN, is_admin: false };
    const stub = db();
    const result = await setFrameReviewAction({ template: "saga", colorKey: "w", verified: true });
    expect(result).toEqual({ ok: false, error: "Not authorized." });
    expect(stub.log).toHaveLength(0);
  });

  it("rejects an unknown template or colour", async () => {
    db();
    expect((await setFrameReviewAction({ template: "nope", colorKey: "w", verified: true })).ok).toBe(false);
    expect((await setFrameReviewAction({ template: "saga", colorKey: "x", verified: true })).ok).toBe(false);
  });

  it("a tick stamps version, override hash, reference and score, and logs an event", async () => {
    const stub = db();
    const result = await setFrameReviewAction({
      template: "saga",
      colorKey: "w",
      verified: true,
      referenceId: REF,
    });
    expect(result).toEqual({ ok: true, scored: true });

    const upsert = payloadOf(stub.forTable("frame_reviews")[0].calls, "upsert") as Record<string, unknown>;
    expect(upsert).toMatchObject({
      template: "saga",
      color_key: "w",
      verified: true,
      verified_by: ADMIN,
      verified_layout_version: CARD_LAYOUT_VERSION,
      verified_override_hash: overrideHash(state.overrides.saga),
      verified_reference_id: REF,
    });
    expect((upsert.score_json as { overall: number }).overall).toBe(4.9);
    // The pinned-reference columns are not the tick's business.
    expect("reference_scryfall_id" in upsert).toBe(false);

    const [event] = events(stub);
    expect(event).toMatchObject({
      template: "saga",
      color_key: "w",
      action: "verify",
      actor: ADMIN,
      layout_version: CARD_LAYOUT_VERSION,
      override_hash: overrideHash(state.overrides.saga),
      reference_scryfall_id: REF,
    });
  });

  it("still publishes when the score is unavailable, and says so", async () => {
    state.score = { ok: false, error: "No reference printing for this combination.", status: 404 };
    const stub = db();
    const result = await setFrameReviewAction({ template: "split", colorKey: "w", verified: true });
    expect(result).toEqual({ ok: true, scored: false });
    const upsert = payloadOf(stub.forTable("frame_reviews")[0].calls, "upsert") as Record<string, unknown>;
    expect(upsert.verified).toBe(true);
    expect(upsert.score_json).toBeNull();
    expect(upsert.verified_override_hash).toBe("none");
  });

  it("a withdraw keeps the stamped record and logs an event", async () => {
    const stub = db();
    const result = await setFrameReviewAction({ template: "saga", colorKey: "w", verified: false });
    expect(result).toEqual({ ok: true, scored: false });
    const upsert = payloadOf(stub.forTable("frame_reviews")[0].calls, "upsert") as Record<string, unknown>;
    expect(upsert).toMatchObject({ verified: false, verified_at: null, verified_by: null });
    expect("verified_layout_version" in upsert).toBe(false);
    expect(events(stub)[0]).toMatchObject({ action: "withdraw", actor: ADMIN });
  });
});

describe("setFrameReferenceAction", () => {
  it("refuses a printing whose colour doesn't match the row", async () => {
    state.card = {
      id: REF,
      name: "Frost Lynx",
      layout: "normal",
      frame: "2015",
      type_line: "Creature — Cat Beast",
      color_identity: ["U"],
      colors: ["U"],
      set: "iko",
    };
    const stub = db();
    const result = await setFrameReferenceAction({ template: "m15", colorKey: "w", scryfallId: REF });
    expect(result.ok).toBe(false);
    expect(stub.forTable("frame_reviews")).toHaveLength(0);
  });

  it("pins a matching printing and logs a pin event; null unpins and logs", async () => {
    state.card = {
      id: REF,
      name: "Serra Angel",
      layout: "normal",
      frame: "2015",
      type_line: "Creature — Angel",
      color_identity: ["W"],
      colors: ["W"],
      set: "dom",
    };
    const stub = db();
    const pinned = await setFrameReferenceAction({ template: "m15", colorKey: "w", scryfallId: REF });
    expect(pinned).toEqual({ ok: true, warning: null, name: "Serra Angel" });
    expect(payloadOf(stub.forTable("frame_reviews")[0].calls, "upsert")).toMatchObject({
      reference_scryfall_id: REF,
      reference_name: "Serra Angel",
      reference_set: "dom",
    });
    expect(events(stub)[0]).toMatchObject({ action: "pin", reference_scryfall_id: REF });
    expect(called(stub.forTable("frame_reviews")[0].calls, "upsert")).toBe(true);

    const unpinned = await setFrameReferenceAction({ template: "m15", colorKey: "w", scryfallId: null });
    expect(unpinned).toEqual({ ok: true, warning: null, name: null });
    expect(events(stub)[1]).toMatchObject({ action: "unpin" });
  });
});
