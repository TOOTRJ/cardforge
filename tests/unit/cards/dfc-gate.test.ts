import { describe, expect, it } from "vitest";
import {
  DFC_BACK_BODY_MISMATCH,
  DFC_BACK_BODY_SET,
  DFC_BACK_TYPE_REFUSED,
  DFC_COLORLESS_FRONT_NEEDS_ARTIFACT,
  DFC_COLORLESS_NEEDS_ARTIFACT,
  DFC_FRONT_HAS_NO_BACK,
  DFC_NEEDS_BACK_FACE,
  DFC_NO_BACK_BODY_YET,
  dfcBackArtMissing,
  dfcFamilyOf,
  dfcFrontColorError,
  resolveDfcBackFace,
  stripBackBody,
} from "@/lib/cards/dfc-gate";
import { dfcIconFamilyForBackBody, withTransformBackShape, DFC_FACE_TYPES, isDfcFaceType } from "@/lib/cards/dfc";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.2 — the back face's gate (lib/cards/dfc-gate.ts) on the REAL
// transform bodies (5.1a): the one rule the create, the update and the Q3
// move run a back face through.
// ---------------------------------------------------------------------------

const BACK = {
  title: "Insectile Aberration",
  card_type: "creature",
  subtypes: ["Human", "Insect"],
  power: "3",
  toughness: "2",
  art_url: "https://example.com/back.png",
};
const VERIFIED = new Set([
  frameComboKey("m15dfcfront", "u"),
  frameComboKey("m15dfcback", "u"),
  frameComboKey("m15dfcback", "g"),
  frameComboKey("m15dfcbackleft", "g"),
  frameComboKey("m15dfclandback", "c"),
  frameComboKey("m15dfcback", "c"),
]);

describe("resolveDfcBackFace — create", () => {
  it("a card with no DFC front: a legacy or inline back is untouched, any body on it is refused (the front first)", () => {
    expect(resolveDfcBackFace({ frontTemplate: "m15", back: BACK, family: null, frontColorIdentity: ["blue"], verifiedKeys: VERIFIED })).toEqual({ ok: true, back: BACK, layout: null });
    expect(resolveDfcBackFace({ frontTemplate: "adventure", back: null, family: null, frontColorIdentity: ["blue"], verifiedKeys: VERIFIED })).toEqual({ ok: true, back: null, layout: null });
    for (const body of ["m15dfcback", "m15artifact", "m15dfcfront"]) {
      const result = resolveDfcBackFace({ frontTemplate: "m15", back: { ...BACK, frame_style: { template: body } }, family: null, frontColorIdentity: ["blue"], verifiedKeys: VERIFIED });
      expect(result, body).toEqual({ ok: false, field: "back_face.frame_style", message: DFC_FRONT_HAS_NO_BACK });
    }
    // A stray colour alone on a legacy back is kept as it was (faces.ts
    // reads it only with a body).
    const colour = resolveDfcBackFace({ frontTemplate: "m15", back: { ...BACK, color_identity: ["red"] }, family: null, frontColorIdentity: ["blue"], verifiedKeys: VERIFIED });
    expect(colour.ok && colour.back).toEqual({ ...BACK, color_identity: ["red"] });
  });

  it("a transform front NEEDS its back face, typed one of the wave-1 face types", () => {
    expect(resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: null, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED })).toEqual({ ok: false, field: "back_face.frame_style", message: DFC_NEEDS_BACK_FACE });
    for (const type of ["planeswalker", "battle", "token", "emblem", "spell", undefined, null]) {
      const result = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, card_type: type as string }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED });
      expect(result, String(type)).toEqual({ ok: false, field: "back_face.card_type", message: DFC_BACK_TYPE_REFUSED });
    }
    expect(DFC_FACE_TYPES).toEqual(["creature", "artifact", "enchantment", "land", "instant", "sorcery"]);
    for (const type of DFC_FACE_TYPES) expect(isDfcFaceType(type)).toBe(true);
    expect(isDfcFaceType("planeswalker")).toBe(false);
  });

  it("fills in the derived body when the payload names none, stores the colour explicitly (the front's by default), strips a transform back's cost", () => {
    const result = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, cost: "{1}{U}" }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED });
    expect(result).toEqual({
      ok: true,
      layout: "transform",
      back: { ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["blue"] },
    });
    // The back's own colour wins over the front's.
    const own = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, color_identity: ["green"] }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED });
    expect(own.ok && own.back?.color_identity).toEqual(["green"]);
    // The family picks the back body; a land back wears the land back
    // whatever the family; the land front pairs the same way.
    const left = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, color_identity: ["green"] }, family: "sunmoon", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED });
    expect(left.ok && left.back?.frame_style).toEqual({ template: "m15dfcbackleft" });
    const land = resolveDfcBackFace({ frontTemplate: "m15dfclandfront", back: { ...BACK, card_type: "land", color_identity: ["colorless"] }, family: "compass", frontColorIdentity: ["colorless"], verifiedKeys: VERIFIED });
    expect(land.ok && land.back?.frame_style).toEqual({ template: "m15dfclandback" });
    // The family absent reads as arrows (dfcFamilyOf).
    expect(dfcFamilyOf(undefined)).toBe("arrows");
    expect(dfcFamilyOf("fan")).toBe("fan");
    expect(dfcFamilyOf("spark")).toBe("arrows");
  });

  it("refuses a body that isn't the derived one (a crafted payload)", () => {
    for (const body of ["m15dfcbackleft", "m15dfclandback", "m15dfcfront", "m15artifact", "m15"]) {
      const result = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, frame_style: { template: body } }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED });
      expect(result, body).toEqual({ ok: false, field: "back_face.frame_style", message: DFC_BACK_BODY_MISMATCH });
    }
    // The derived one named explicitly passes.
    const ok = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, frame_style: { template: "m15dfcback" } }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED });
    expect(ok.ok).toBe(true);
  });

  it("verifies the back's colour for its body (the front's gate, per colour) — unless an admin's frame preview skips it", () => {
    const red = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, color_identity: ["red"] }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED });
    expect(red).toMatchObject({ ok: false, field: "back_face.color_identity", code: "unverified" });
    expect(red.ok ? "" : red.message).toMatch(/isn't available in red yet/);
    // The front's colour, when the back names none, is what gets verified.
    const front = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: BACK, family: "arrows", frontColorIdentity: ["red"], verifiedKeys: VERIFIED });
    expect(front).toMatchObject({ ok: false, code: "unverified" });
    const preview = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, color_identity: ["red"] }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED, skipVerification: true });
    expect(preview.ok).toBe(true);
  });

  it("a colourless back only with Artifact on its type line, where the body's `c` is the artifact stand-in (D2); the land back takes any land", () => {
    const eldrazi = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, color_identity: ["colorless"] }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED });
    expect(eldrazi).toEqual({ ok: false, field: "back_face.color_identity", message: DFC_COLORLESS_NEEDS_ARTIFACT });
    const artifactType = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, card_type: "artifact", color_identity: ["colorless"] }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED });
    expect(artifactType.ok).toBe(true);
    const artifactWord = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, supertype: "Artifact", color_identity: ["colorless"] }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED });
    expect(artifactWord.ok).toBe(true);
    const landBack = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, card_type: "land", color_identity: ["colorless"] }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED });
    expect(landBack.ok && landBack.back?.frame_style).toEqual({ template: "m15dfclandback" });
  });

  it("a kind whose back bodies don't exist yet (the modal pair until 5.1b) is refused by name", () => {
    // No modal front body exists either, so the front reads as a plain
    // card here; the rule shows through bodyFor's null on a declared front
    // (tests/unit/cards/dfc-declared.test.ts holds the declared fixture).
    expect(DFC_NO_BACK_BODY_YET).toMatch(/No back-face frame exists/);
  });
});

describe("resolveDfcBackFace — update (the stored body wins)", () => {
  const stored = { ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["blue"] as ColorIdentity[] };

  it("keeps the stored body whatever the patch names, and re-checks nothing when neither the body nor the colour changed", () => {
    const patch = { ...BACK, rules_text: "Flying", frame_style: { template: "m15dfcbackleft" }, color_identity: ["blue"] as ColorIdentity[] };
    const result = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: patch, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: new Set(), stored: { back: stored, familyChanged: false } });
    expect(result.ok && result.back).toEqual({ ...patch, frame_style: { template: "m15dfcback" } });
    // The colour unchanged by letter (a stored pair resent in another order).
    const same = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, color_identity: ["blue"] }, family: "arrows", frontColorIdentity: ["red"], verifiedKeys: new Set(), stored: { back: stored, familyChanged: false } });
    expect(same.ok).toBe(true);
  });

  it("a changed colour is verified for the body (and a legacy pin stays editable)", () => {
    const unverified = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, color_identity: ["red"] }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED, stored: { back: stored, familyChanged: false } });
    expect(unverified).toMatchObject({ ok: false, field: "back_face.color_identity", code: "unverified" });
    const verified = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, color_identity: ["green"] }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED, stored: { back: stored, familyChanged: false } });
    expect(verified.ok && verified.back?.color_identity).toEqual(["green"]);
    // A stored back on a since-withdrawn colour: left alone, it saves.
    const withdrawn = { ...stored, color_identity: ["red"] as ColorIdentity[] };
    const kept = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, rules_text: "Flying", color_identity: ["red"] }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED, stored: { back: withdrawn, familyChanged: false } });
    expect(kept.ok).toBe(true);
  });

  it("a back type that would derive another body is refused; the same type keeps the body", () => {
    const land = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, card_type: "land" }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED, stored: { back: stored, familyChanged: false } });
    expect(land).toEqual({ ok: false, field: "back_face.card_type", message: DFC_BACK_BODY_SET });
    // creature → artifact derives the same spell body: fine.
    const artifact = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...BACK, card_type: "artifact" }, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED, stored: { back: stored, familyChanged: false } });
    expect(artifact.ok && artifact.back?.frame_style).toEqual({ template: "m15dfcback" });
  });

  it("a family change re-derives the body — verified in the back's colour, or refused", () => {
    const ok = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: { ...stored, color_identity: ["green"] }, family: "sunmoon", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED, stored: { back: { ...stored, color_identity: ["green"] }, familyChanged: true } });
    expect(ok.ok && ok.back?.frame_style).toEqual({ template: "m15dfcbackleft" });
    const refused = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: stored, family: "sunmoon", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED, stored: { back: stored, familyChanged: true } });
    expect(refused).toMatchObject({ ok: false, field: "back_face.color_identity", code: "unverified" });
  });

  it("a stored back with no body under a DFC front (a 5.1a-era save) takes the derived body", () => {
    const legacy = { ...BACK };
    const result = resolveDfcBackFace({ frontTemplate: "m15dfcfront", back: legacy, family: "arrows", frontColorIdentity: ["blue"], verifiedKeys: VERIFIED, stored: { back: legacy, familyChanged: false } });
    expect(result.ok && result.back).toEqual({ ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["blue"] });
  });
});

describe("dfcFrontColorError — the front's colourless rule (D2)", () => {
  it("refuses a colourless non-artifact front on a DFC body; an Artifact word or any colour passes; the land front and plain cards are never judged", () => {
    expect(dfcFrontColorError("m15dfcfront", { cardType: "creature" }, ["colorless"])).toBe(DFC_COLORLESS_FRONT_NEEDS_ARTIFACT);
    expect(dfcFrontColorError("m15dfcfront", { cardType: "creature" }, [])).toBe(DFC_COLORLESS_FRONT_NEEDS_ARTIFACT);
    expect(dfcFrontColorError("m15dfcfront", { cardType: "enchantment" }, null)).toBe(DFC_COLORLESS_FRONT_NEEDS_ARTIFACT);
    expect(dfcFrontColorError("m15dfcfront", { cardType: "artifact" }, ["colorless"])).toBeNull();
    expect(dfcFrontColorError("m15dfcfront", { cardType: "creature", supertype: "Legendary Artifact" }, ["colorless"])).toBeNull();
    expect(dfcFrontColorError("m15dfcfront", { cardType: "creature" }, ["blue"])).toBeNull();
    expect(dfcFrontColorError("m15dfcfront", { cardType: "creature" }, ["white", "blue"])).toBeNull();
    expect(dfcFrontColorError("m15dfclandfront", { cardType: "land" }, ["colorless"])).toBeNull();
    expect(dfcFrontColorError("m15", { cardType: "creature" }, ["colorless"])).toBeNull();
    expect(dfcFrontColorError("m15dfcback", { cardType: "creature" }, ["colorless"])).toBeNull();
  });
});

describe("the helpers", () => {
  it("stripBackBody keeps the content only; dfcBackArtMissing reads a DFC front's back art", () => {
    expect(stripBackBody({ ...BACK, frame_style: { template: "m15dfcback" }, color_identity: ["blue"] })).toEqual(BACK);
    expect(dfcBackArtMissing("m15dfcfront", { ...BACK, art_url: undefined })).toBe(true);
    expect(dfcBackArtMissing("m15dfcfront", null)).toBe(true);
    expect(dfcBackArtMissing("m15dfcfront", BACK)).toBe(false);
    expect(dfcBackArtMissing("m15", { ...BACK, art_url: undefined })).toBe(false);
  });

  it("withTransformBackShape strips a transform back's cost and nothing else; dfcIconFamilyForBackBody names a back's first family", () => {
    expect(withTransformBackShape({ title: "A", cost: "{U}" }, "transform")).toEqual({ title: "A" });
    expect(withTransformBackShape({ title: "A", cost: null }, "transform")).toEqual({ title: "A" });
    const noCost: { title: string; cost?: string } = { title: "A" };
    expect(withTransformBackShape(noCost, "transform")).toBe(noCost);
    const modal = { title: "A", cost: "{U}" };
    expect(withTransformBackShape(modal, "modal")).toBe(modal);
    expect(dfcIconFamilyForBackBody("m15dfcback")).toBe("arrows");
    expect(dfcIconFamilyForBackBody("m15dfcbackleft")).toBe("sunmoon");
    expect(dfcIconFamilyForBackBody("m15dfclandback")).toBeNull();
    expect(dfcIconFamilyForBackBody("m15dfcfront")).toBeNull();
    expect(dfcIconFamilyForBackBody(null)).toBeNull();
  });
});
