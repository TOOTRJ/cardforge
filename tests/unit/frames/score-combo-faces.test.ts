import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FRAME_REFERENCES } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// scoreFrameCombo per FACE (TODO 5.0b): the compare payload is asked for the
// face under test — a BACK body's back whatever the caller says, otherwise
// the face the compare view shows (`face: "back"`), the front by default —
// and the result names it; a printing with no such face is a named 404,
// never a score against the front's scan. Under 5.0a's declared-profile
// fixture (m15artifact = a transform back; never the real PROFILES); the
// payload, the render and the scan download are stubbed like
// score-combo.test.ts, and so is the alignment itself: WHICH face reaches
// the payload builder and the scan fetch is the point here, and the real
// scorer on a full-size card (score-combo.test.ts runs it once) timed this
// file out under CI's 5 s when it ran six times.
// ---------------------------------------------------------------------------

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { dfcGetFrameProfile } = await import("../cards/dfc-fixture");
  return { ...real, getFrameProfile: dfcGetFrameProfile(real.getFrameProfile) };
});

const state = vi.hoisted(() => ({
  payload: vi.fn(),
  render: vi.fn(),
  fetchScan: vi.fn(),
}));

vi.mock("@/lib/cards/frame-reviews", () => ({ getFrameReviews: async () => new Map() }));
vi.mock("@/lib/cards/frame-profile-overrides", () => ({ getFrameProfileOverrides: async () => ({}) }));
vi.mock("@/lib/scryfall/reference-preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/reference-preview")>();
  return { FrameCompareFaceError: actual.FrameCompareFaceError, buildFrameComparePayload: state.payload };
});
vi.mock("@/lib/scryfall/client", () => ({ fetchScryfallImage: state.fetchScan }));
vi.mock("@/lib/render/card-image", () => ({ renderCardImage: state.render }));
vi.mock("@/lib/frames/align", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/frames/align")>();
  return {
    ...actual,
    alignAndScore: () => ({ overall: 1, perSlot: {}, global: { dxPct: 0, dyPct: 0, confidence: 1 } }),
  };
});

import { FrameCompareFaceError } from "@/lib/scryfall/reference-preview";
import { scoreFrameCombo } from "@/lib/frames/score-combo";

const SCAN_URL = (face: "front" | "back") => `https://cards.scryfall.io/png/${face}/3/0/scan.png`;

/** A tiny opaque PNG: the scorer only needs something sharp can resize onto
 *  the grid (the alignment is stubbed above). */
async function flatCard(): Promise<Buffer> {
  const width = 8;
  const height = 8;
  return sharp(Buffer.alloc(width * height * 4, 255), { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function payloadFor(id: string, template: string, face: "front" | "back" = "front") {
  return {
    preview: { title: `Card ${id}`, cardType: "creature", colorIdentity: ["white"], frameStyle: { template } },
    scanUrl: SCAN_URL(face),
    cardName: `Card ${id}`,
    patch: {},
    scryfallUri: null,
    face,
    faceName: null,
    hasBackScan: face === "back",
  };
}

beforeEach(async () => {
  const png = await flatCard();
  state.payload.mockReset();
  state.payload.mockImplementation(async (id: string, template: string, face?: "front" | "back") =>
    payloadFor(id, template, face ?? "front"),
  );
  state.render.mockReset();
  state.render.mockImplementation(async () => new Response(new Uint8Array(png)));
  state.fetchScan.mockReset();
  state.fetchScan.mockImplementation(async () => ({
    blob: new Blob([new Uint8Array(png)], { type: "image/png" }),
    contentType: "image/png",
  }));
});

describe("which face is scored", () => {
  it("a back body is scored on its back whatever the caller says, and the result names the face", async () => {
    const reference = FRAME_REFERENCES.m15artifact.w!;
    for (const face of [undefined, null, "front", "back"] as const) {
      state.payload.mockClear();
      state.fetchScan.mockClear();
      const result = await scoreFrameCombo({ template: "m15artifact", color: "w", face });
      expect(state.payload).toHaveBeenCalledWith(reference.scryfallId, "m15artifact", "back");
      expect(state.fetchScan).toHaveBeenCalledWith(SCAN_URL("back"));
      expect(result).toMatchObject({ ok: true, referenceId: reference.scryfallId, face: "back" });
    }
  });

  it("any other template scores the face the view shows: the front by default, the back on request", async () => {
    const reference = FRAME_REFERENCES.m15.w!;
    const front = await scoreFrameCombo({ template: "m15", color: "w" });
    expect(state.payload).toHaveBeenLastCalledWith(reference.scryfallId, "m15", "front");
    expect(front).toMatchObject({ ok: true, face: "front" });

    const back = await scoreFrameCombo({ template: "m15", color: "w", face: "back" });
    expect(state.payload).toHaveBeenLastCalledWith(reference.scryfallId, "m15", "back");
    expect(state.fetchScan).toHaveBeenLastCalledWith(SCAN_URL("back"));
    expect(back).toMatchObject({ ok: true, face: "back" });
  });

  it("a printing with no such face is a named 404 — nothing rendered, nothing downloaded", async () => {
    state.payload.mockImplementation(async () => {
      throw new FrameCompareFaceError("Serra Angel has no second face to compare.");
    });
    const result = await scoreFrameCombo({ template: "m15", color: "w", face: "back" });
    expect(result).toEqual({ ok: false, error: "Serra Angel has no second face to compare.", status: 404 });
    expect(state.render).not.toHaveBeenCalled();
    expect(state.fetchScan).not.toHaveBeenCalled();
  });

  it("any other lookup failure still throws to the caller (a 500, not a silent sample)", async () => {
    state.payload.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(scoreFrameCombo({ template: "m15", color: "w" })).rejects.toThrow("fetch failed");
  });
});
