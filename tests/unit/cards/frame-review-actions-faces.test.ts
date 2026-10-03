import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// The WRITES stay the template's own face (TODO 5.0b). The compare view can
// show a FRONT template's back (`?face=back`), but a tick, the sign-off's
// score record and a pin never learn a face from the client: the tick
// scores through the REAL scoreFrameCombo with no `face`, so the compare
// payload it measures is the FRONT's (the registry printing's front scan),
// the frame_reviews row it writes carries no face column, and a stray
// `face` in the action's payload is dropped by the schema. Only the payload
// builder, the renderer and the scan fetch are stubbed here — the face
// derivation (faceUnderTest) and the recording are the real code.
// ---------------------------------------------------------------------------

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const state = vi.hoisted(() => ({
  profile: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", is_admin: true } as null | { id: string; is_admin: boolean },
  client: null as unknown,
  payload: vi.fn(),
  score: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => state.profile }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.client,
  isAdminConfigured: () => true,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({
  FRAME_PROFILE_OVERRIDES_TAG: "frame-profile-overrides",
  getFrameProfileOverrides: async () => ({}),
}));
vi.mock("@/lib/cards/frame-reviews", () => ({ getFrameReviews: async () => new Map() }));
vi.mock("@/lib/scryfall/reference-preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/reference-preview")>();
  return { ...actual, buildFrameComparePayload: state.payload };
});
// The renderer and the scan: a 4×4 PNG each, so the real alignment runs
// (the number itself is not the point — that the SAME face reaches it is).
vi.mock("@/lib/render/card-image", () => ({
  renderCardImage: async () => new Response(new Uint8Array(0)),
}));
vi.mock("@/lib/scryfall/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/client")>();
  return {
    ...actual,
    fetchScryfallImage: async () => ({ blob: new Blob([new Uint8Array(0)]) }),
  };
});
vi.mock("@/lib/frames/align", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/frames/align")>();
  return {
    ...actual,
    alignAndScore: () => ({ overall: 7.5, perSlot: {}, global: { dxPct: 0, dyPct: 0, confidence: 1 } }),
  };
});
vi.mock("sharp", () => ({
  default: () => {
    const chain = {
      flatten: () => chain,
      rotate: () => chain,
      resize: () => chain,
      greyscale: () => chain,
      raw: () => chain,
      toBuffer: async () => Buffer.alloc(16),
    };
    return chain;
  },
}));

import { setFrameReferenceAction, setFrameReviewAction } from "@/lib/cards/frame-review-actions";
import { scoreAndRecordCombo } from "@/lib/frames/score-record";
import { FRAME_REFERENCES } from "@/lib/cards/frame-reference-registry";
import type { ScryfallCard } from "@/lib/scryfall/client";

const REF = FRAME_REFERENCES.m15.w!.scryfallId;

function payloadFor(id: string, template: string, face: "front" | "back" = "front") {
  return {
    preview: { title: face === "back" ? "The back" : "The front", frameStyle: { template }, colorIdentity: ["white"] },
    scanUrl: `https://cards.scryfall.io/png/${face}/${id[0]}/${id[1]}/${id}.png`,
    cardName: "Serra Angel",
    patch: {},
    scryfallUri: null,
    face,
    faceName: null,
    hasBackScan: false,
  };
}

function db() {
  const stub = chainClient((): ChainAnswer => ({ error: null, data: [] }));
  state.client = stub.client;
  return stub;
}

beforeEach(() => {
  state.payload.mockReset();
  state.payload.mockImplementation(async (id: string, template: string, face?: "front" | "back") =>
    payloadFor(id, template, face ?? "front"),
  );
});

describe("the tick on a front template", () => {
  it("scores and records the FRONT even when the client says `face: back`; the row carries no face", async () => {
    const stub = db();
    const result = await setFrameReviewAction({
      template: "m15",
      colorKey: "w",
      verified: true,
      referenceId: REF,
      // What a tampered client might add while the compare view shows the
      // back: the schema drops it.
      face: "back",
    });
    expect(result).toEqual({ ok: true, scored: true });

    // The real scoreFrameCombo asked the payload builder for the FRONT.
    expect(state.payload).toHaveBeenCalledTimes(1);
    expect(state.payload).toHaveBeenCalledWith(REF, "m15", "front");

    const upsert = payloadOf(stub.forTable("frame_reviews")[0].calls, "upsert") as Record<string, unknown>;
    expect(Object.keys(upsert).some((key) => /face/i.test(key))).toBe(false);
    expect(upsert).toMatchObject({ template: "m15", color_key: "w", verified: true, verified_reference_id: REF });
    expect((upsert.score_json as { overall: number }).overall).toBe(7.5);
    // The recorded score names no face either: the row's template decides.
    expect(JSON.stringify(upsert.score_json)).not.toMatch(/face/i);

    const event = payloadOf(stub.forTable("frame_review_events")[0].calls, "insert") as Record<string, unknown>;
    expect(Object.keys(event).some((key) => /face/i.test(key))).toBe(false);
    expect(event).toMatchObject({ action: "verify", reference_scryfall_id: REF });
  });
});

describe("the sign-off's score record", () => {
  it("measures the template's own face (the front here) and writes no face", async () => {
    const stub = db();
    const result = await scoreAndRecordCombo({ template: "m15", colorKey: "w", actorId: ADMIN, referenceId: REF });
    expect(result).toMatchObject({ ok: true, overall: 7.5, referenceId: REF });
    expect(state.payload).toHaveBeenCalledWith(REF, "m15", "front");
    const event = payloadOf(stub.forTable("frame_review_events")[0].calls, "insert") as Record<string, unknown>;
    expect(event).toMatchObject({ action: "score", reference_scryfall_id: REF });
    expect(Object.keys(event).some((key) => /face/i.test(key))).toBe(false);
  });
});

describe("the pin on a front template", () => {
  it("writes the printing's id, name and set — no face — and validates the FRONT as before", async () => {
    const stub = db();
    vi.doMock("@/lib/scryfall/client", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/scryfall/client")>();
      return {
        ...actual,
        getCardById: async () =>
          ({
            id: REF,
            name: "Serra Angel",
            layout: "normal",
            set: "dom",
            frame: "2015",
            type_line: "Creature — Angel",
            colors: ["W"],
            color_identity: ["W"],
            image_uris: { png: `https://cards.scryfall.io/png/front/b/5/${REF}.png` },
          }) as unknown as ScryfallCard,
        assessPrintImageQuality: () => "ok",
      };
    });
    const result = await setFrameReferenceAction({ template: "m15", colorKey: "w", scryfallId: REF });
    expect(result).toMatchObject({ ok: true, name: "Serra Angel" });
    const upsert = payloadOf(stub.forTable("frame_reviews")[0].calls, "upsert") as Record<string, unknown>;
    expect(upsert).toEqual({
      template: "m15",
      color_key: "w",
      reference_scryfall_id: REF,
      reference_name: "Serra Angel",
      reference_set: "dom",
    });
  });
});
