import { describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { AGADEEM_ID, ARCHANGEL_AVACYN_ID, SERRA_ANGEL_ID, TERGRID_ID, VALKI_ID } from "./fixtures/dfc-printings";

// ---------------------------------------------------------------------------
// buildFrameComparePayload on a BACK BODY (TODO 5.0b) — what the compare
// view renders once 5.1a / 5.1b declare one, under 5.0a's declared-profile
// fixture (tests/unit/cards/dfc-fixture.ts; never the real PROFILES):
// m15artifact stands in for the transform back, m15 for its front;
// m15devoid for the modal back, m15snow for its front. The back is drawn
// exactly as the card page and the bake will draw it — lib/cards/faces.ts
// backPreviewData on the card the import would store: the back on the body
// under test, in its OWN printed colour, under the body's paired front
// (frontBodyFor), carrying the `dfc` block whose `otherFace` is the front's.
// ---------------------------------------------------------------------------

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { dfcGetFrameProfile } = await import("../cards/dfc-fixture");
  return { ...real, getFrameProfile: dfcGetFrameProfile(real.getFrameProfile) };
});

vi.mock("@/lib/scryfall/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scryfall/client")>();
  const { DFC_PRINTINGS } = await import("./fixtures/dfc-printings");
  return {
    ...actual,
    getCardById: async (id: string) => (DFC_PRINTINGS as Record<string, ScryfallCard>)[id] ?? null,
  };
});

import { faceUnderTest, frontBodyFor, isDfcBackBody } from "@/lib/cards/dfc";
import { FrameCompareFaceError, buildFrameComparePayload } from "@/lib/scryfall/reference-preview";

const BACK_PNG = (id: string) => `https://cards.scryfall.io/png/back/${id[0]}/${id[1]}/${id}.png`;

describe("fixture", () => {
  it("m15artifact is a transform back paired with m15; m15devoid a modal back paired with m15snow", () => {
    expect(isDfcBackBody("m15artifact")).toBe(true);
    expect(frontBodyFor("m15artifact", "creature")).toBe("m15");
    // bodyFor's table is empty until 5.1a fills it, so even a land face
    // falls back to the layout's first non-land front (the fixture's
    // m15land is a transform land front, but not the fallback).
    expect(frontBodyFor("m15artifact", "land")).toBe("m15");
    expect(isDfcBackBody("m15devoid")).toBe(true);
    expect(frontBodyFor("m15devoid", "creature")).toBe("m15snow");
    expect(faceUnderTest("m15artifact")).toBe("back");
    expect(faceUnderTest("m15artifact", "front")).toBe("back");
  });
});

describe("a transform back body", () => {
  it("draws the printing's back on the body, in the back's own colour, with the front's facts in `otherFace`", async () => {
    const payload = await buildFrameComparePayload(ARCHANGEL_AVACYN_ID, "m15artifact", "back");
    if (!payload) throw new Error("no payload");
    const { preview } = payload;
    expect(preview.title).toBe("Avacyn, the Purifier");
    expect(preview.frameStyle).toEqual({ template: "m15artifact" });
    // RED (the back's colour indicator), not the front's white.
    expect(preview.colorIdentity).toEqual(["red"]);
    expect(preview).toMatchObject({ cardType: "creature", supertype: "Legendary", subtypes: ["Angel"], power: "6", toughness: "5" });
    expect(preview.backFace).toBeNull();
    expect(preview.dfc).toEqual({
      layout: "transform",
      role: "back",
      icon: "arrows",
      otherFace: { typeWord: "Angel", line: "{3}{W}{W}", printsPt: true, power: "4", toughness: "4" },
    });
    // The card's rarity rides on both faces.
    expect(preview.rarity).toBe("mythic");
    expect(payload.scanUrl).toBe(BACK_PNG(ARCHANGEL_AVACYN_ID));
    expect(payload).toMatchObject({ face: "back", faceName: "Avacyn, the Purifier", hasBackScan: true });
  });

  it("is the back the stored card would draw: the same picture through facesOf on the paired front", async () => {
    const payload = await buildFrameComparePayload(ARCHANGEL_AVACYN_ID, "m15artifact", "back");
    const front = await buildFrameComparePayload(ARCHANGEL_AVACYN_ID, "m15");
    if (!payload || !front) throw new Error("no payload");
    const { backPreviewData } = await import("@/lib/cards/faces");
    const stored = {
      ...front.preview,
      backFace: {
        ...front.preview.backFace!,
        frame_style: { template: "m15artifact" as const },
        color_identity: ["red" as const],
      },
    };
    expect(payload.preview).toEqual(backPreviewData(stored));
  });

  it("a colourless creature back (no Artifact word) draws colourless — the stand-in the gate refuses later (D2), the compare still shows it", async () => {
    const { aang } = await import("./fixtures/dfc-printings");
    const payload = await buildFrameComparePayload(aang.id, "m15artifact", "back");
    expect(payload?.preview.colorIdentity).toEqual(["colorless"]);
    expect(payload?.preview.dfc?.otherFace.typeWord).toBe("Avatar");
  });
});

describe("a modal back body", () => {
  it("an artifact back with a cost: colourless, the cost kept, the strip facts from the front", async () => {
    const payload = await buildFrameComparePayload(TERGRID_ID, "m15devoid", "back");
    if (!payload) throw new Error("no payload");
    expect(payload.preview.frameStyle).toEqual({ template: "m15devoid" });
    expect(payload.preview.colorIdentity).toEqual(["colorless"]);
    expect(payload.preview).toMatchObject({ title: "Tergrid's Lantern", cost: "{3}{B}", cardType: "artifact" });
    expect(payload.preview.dfc).toEqual({
      layout: "modal",
      role: "back",
      icon: null,
      otherFace: { typeWord: "God", line: "{3}{B}{B}", printsPt: true, power: "4", toughness: "5" },
    });
  });

  it("a land back is coloured by its mana ability; a two-colour walker back keeps both colours", async () => {
    const land = await buildFrameComparePayload(AGADEEM_ID, "m15devoid", "back");
    expect(land?.preview.colorIdentity).toEqual(["black"]);
    expect(land?.preview.dfc?.otherFace).toEqual({ typeWord: "Sorcery", line: "{X}{B}{B}{B}", printsPt: false, power: null, toughness: null });
    const walker = await buildFrameComparePayload(VALKI_ID, "m15devoid", "back");
    expect(walker?.preview.colorIdentity).toEqual(["black", "red"]);
    expect(walker?.preview.loyalty).toBe("5");
  });
});

describe("refusals on a back body", () => {
  it("a printing with no second face is named, never drawn from its front", async () => {
    await expect(buildFrameComparePayload(SERRA_ANGEL_ID, "m15artifact", "back")).rejects.toThrow(FrameCompareFaceError);
  });
});
