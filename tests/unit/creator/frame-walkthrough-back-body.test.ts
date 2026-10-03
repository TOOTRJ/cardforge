import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// "Walk the stepper" on a BACK body (TODO 5.0b), under 5.0a's declared-
// profile fixture (tests/unit/cards/dfc-fixture.ts: m15artifact = a
// transform back paired with m15; m15devoid = a modal back paired with
// m15snow — never the real PROFILES). A back body never dresses a front, so
// the walk pins the CARD to the paired front body, keeps the row's template
// as the one under test, and opens the preview on the back face whatever
// the link says. The kind gate and the sample are the paired front's.
// ---------------------------------------------------------------------------

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { dfcGetFrameProfile } = await import("../cards/dfc-fixture");
  return { ...real, getFrameProfile: dfcGetFrameProfile(real.getFrameProfile) };
});

const state = vi.hoisted(() => ({
  payload: null as unknown,
  lookups: [] as Array<{ id: string; template: string; face?: string }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cards/frame-reviews", () => ({ getFrameReviews: async () => new Map() }));
vi.mock("@/lib/scryfall/reference-preview", () => ({
  buildFrameComparePayload: async (id: string, template: string, face?: string) => {
    state.lookups.push({ id, template, face });
    return state.payload;
  },
}));

import { buildFrameWalkthrough } from "@/lib/creator/frame-walkthrough";
import { FRAME_REFERENCES } from "@/lib/cards/frame-reference-registry";

beforeEach(() => {
  state.payload = null;
  state.lookups = [];
});

describe("a back body's walk", () => {
  it("pins the card to the paired front, keeps the row's template, opens on the back — even when the link says front", async () => {
    const reference = FRAME_REFERENCES.m15artifact.w!;
    state.payload = {
      cardName: "Archangel Avacyn // Avacyn, the Purifier",
      scryfallUri: "https://scryfall.com/card/soi/5",
      patch: {
        title: "Archangel Avacyn",
        kind: "creature",
        frame_template: "m15",
        color_identity: ["white"],
        back_face: { title: "Avacyn, the Purifier", card_type: "creature" },
      },
    };
    const walk = await buildFrameWalkthrough({ template: "m15artifact", color: "w", seed: "reference", face: "front" });
    expect(state.lookups).toEqual([{ id: reference.scryfallId, template: "m15artifact", face: undefined }]);
    expect(walk).toMatchObject({
      template: "m15artifact",
      cardTemplate: "m15",
      previewFace: "back",
      colorKey: "w",
      kind: "creature",
    });
    expect(walk?.seed?.patch.frame_template).toBe("m15");
    expect(walk?.seed?.fromReference).toBe(true);
    expect(walk?.note).toMatch(/^Walking m15artifact\/w, prefilled from/);
    expect(walk?.note).toMatch(/The preview opens on the back face\.$/);
  });

  it("a modal back walks its own paired front", async () => {
    const walk = await buildFrameWalkthrough({ template: "m15devoid", color: "u", seed: "sample" });
    expect(walk).toMatchObject({ template: "m15devoid", cardTemplate: "m15snow", previewFace: "back" });
    expect(walk?.seed?.patch.frame_template).toBe("m15snow");
  });

  it("a blank walk on a back body still pins the paired front", async () => {
    const walk = await buildFrameWalkthrough({ template: "m15artifact", color: "g" });
    expect(walk).toMatchObject({ seed: null, cardTemplate: "m15", previewFace: "back" });
    expect(state.lookups).toHaveLength(0);
  });

  it("a front body walks as itself", async () => {
    const walk = await buildFrameWalkthrough({ template: "m15", color: "w", seed: "sample" });
    expect(walk).toMatchObject({ template: "m15", cardTemplate: "m15", previewFace: "front" });
  });
});
