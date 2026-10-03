import { describe, expect, it } from "vitest";
import {
  DEFAULT_DFC_ICON,
  DFC_ICON_FAMILY_VALUES,
  backBodyError,
  bodyFor,
  colorlessFaceAllowed,
  dfcBodyOf,
  faceUnderTest,
  frontBodyFor,
  isDfcBackBody,
  isDfcIconFamily,
  templateHasBackFace,
} from "@/lib/cards/dfc";
import { CARD_FACE_VALUES, isCardFace, parseCardFace, scryfallFaceIndex } from "@/lib/cards/card-face";
import { frameProfileOverrideSchema } from "@/lib/cards/profile-override";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.0a — lib/cards/dfc.ts on the REAL profiles: no template is a
// double-faced body yet (5.1a / 5.1b bring them), so every predicate is
// false, the body table answers null, and a back body can be stored on no
// card. The declared-profile half (what the predicates answer once a body
// exists) is tests/unit/cards/dfc-declared.test.ts.
// ---------------------------------------------------------------------------

describe("the vocabulary", () => {
  it("five families, arrows the default (owner decision Q5); spark waits for the walker bodies (5.13)", () => {
    expect([...DFC_ICON_FAMILY_VALUES]).toEqual(["arrows", "sunmoon", "moon", "compass", "fan"]);
    expect(DEFAULT_DFC_ICON).toBe("arrows");
    for (const family of DFC_ICON_FAMILY_VALUES) expect(isDfcIconFamily(family), family).toBe(true);
    for (const bad of ["spark", "Arrows", "", null, undefined, 1, true, {}, ["arrows"]]) expect(isDfcIconFamily(bad), String(bad)).toBe(false);
  });
});

describe("on today's profiles: no template is a DFC body", () => {
  it("every template declares no `dfc`: not a front with a back face, not a back body", () => {
    expect(FRAME_TEMPLATE_VALUES.length).toBeGreaterThan(40);
    for (const template of FRAME_TEMPLATE_VALUES) {
      expect(getFrameProfile(template).dfc, template).toBeUndefined();
      expect(dfcBodyOf(template), template).toBeNull();
      expect(templateHasBackFace(template), template).toBe(false);
      expect(isDfcBackBody(template), template).toBe(false);
    }
    // An unknown or empty template reads as m15 (no body).
    for (const template of [undefined, null, "", "{}", "no-such-frame"]) {
      expect(templateHasBackFace(template), String(template)).toBe(false);
      expect(isDfcBackBody(template), String(template)).toBe(false);
    }
  });

  it("bodyFor answers null for every layout × role × face kind × family — the table is empty until 5.1a / 5.1b", () => {
    for (const layout of ["transform", "modal"] as const) {
      for (const role of ["front", "back"] as const) {
        for (const faceType of ["creature", "land", "artifact", "instant", null, undefined]) {
          expect(bodyFor(layout, role, faceType), `${layout}/${role}/${faceType}`).toBeNull();
          for (const family of DFC_ICON_FAMILY_VALUES) {
            expect(bodyFor(layout, role, faceType, family), `${layout}/${role}/${faceType}/${family}`).toBeNull();
          }
        }
      }
    }
  });

  it("colorlessFaceAllowed is the ordinary gate's business on a non-DFC template: always true", () => {
    for (const template of ["m15", "m15artifact", "m15land", "m15borderless", "emblem", "agclassic", undefined]) {
      expect(colorlessFaceAllowed(template, { cardType: "creature", supertype: null }), String(template)).toBe(true);
      expect(colorlessFaceAllowed(template, { cardType: "artifact" }), String(template)).toBe(true);
      expect(colorlessFaceAllowed(template, null), String(template)).toBe(true);
    }
  });

  it("backBodyError: a body-less back face is always fine; ANY back body is refused today (no front has a back face)", () => {
    const legacy = { title: "Avacyn, the Purifier", card_type: "creature" };
    for (const front of FRAME_TEMPLATE_VALUES) {
      expect(backBodyError(front, legacy), front).toBeNull();
      expect(backBodyError(front, null), front).toBeNull();
      expect(backBodyError(front, undefined), front).toBeNull();
      expect(backBodyError(front, { frame_style: { template: "m15" } }), front).toBe("This frame has no back face of its own.");
      expect(backBodyError(front, { frame_style: { template: front } }), front).toBe("This frame has no back face of its own.");
    }
    expect(backBodyError(undefined, { frame_style: { template: "m15" } })).toBe("This frame has no back face of its own.");
    // An empty frame_style is no body.
    expect(backBodyError("m15", { frame_style: {} })).toBeNull();
  });
});

describe("the face under test (TODO 5.0b) on today's profiles: no back body, so the face is the one asked for", () => {
  it("every template is compared on the front unless the view asks for the back", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      expect(faceUnderTest(template), template).toBe("front");
      expect(faceUnderTest(template, null), template).toBe("front");
      expect(faceUnderTest(template, "front"), template).toBe("front");
      expect(faceUnderTest(template, "back"), template).toBe("back");
    }
    expect(faceUnderTest(undefined, "back")).toBe("back");
    expect(faceUnderTest("no-such-frame")).toBe("front");
  });

  it("frontBodyFor is null everywhere: no template is a back body", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      expect(frontBodyFor(template), template).toBeNull();
      expect(frontBodyFor(template, "land"), template).toBeNull();
    }
    expect(frontBodyFor(undefined)).toBeNull();
  });

  it("the face vocabulary: two faces, Scryfall's indexes, a URL value parsed strictly", () => {
    expect([...CARD_FACE_VALUES]).toEqual(["front", "back"]);
    expect(scryfallFaceIndex("front")).toBe(0);
    expect(scryfallFaceIndex("back")).toBe(1);
    expect(parseCardFace("back")).toBe("back");
    expect(parseCardFace("front")).toBe("front");
    expect(parseCardFace(["back", "front"])).toBe("back");
    for (const bad of ["Back", "BACK", "1", "", null, undefined, []]) {
      expect(parseCardFace(bad as never), String(bad)).toBeNull();
      expect(isCardFace(bad), String(bad)).toBe(false);
    }
  });
});

describe("code-owned", () => {
  it("the admin override schema refuses a `dfc` declaration (like overlays and the pair masters)", () => {
    const base = frameProfileOverrideSchema.safeParse({});
    expect(base.success).toBe(true);
    const crafted = frameProfileOverrideSchema.safeParse({ dfc: { layout: "transform", role: "front", well: "left" } });
    expect(crafted.success).toBe(false);
  });
});
