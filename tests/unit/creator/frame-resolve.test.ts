import { describe, expect, it } from "vitest";
import { basicOnlyFrameFallback, resolvePublishedFrame } from "@/lib/creator/frame-resolve";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// The one resolver behind every programmatic frame write. It must never
// answer with an unpublished (template, colour) pair, and it must SAY what
// it changed so the creator can tell the user instead of substituting
// silently (the audit's most common finding).

const verified = (...keys: string[]) => new Set(keys);
const k = frameComboKey;

describe("resolvePublishedFrame", () => {
  it("returns the wanted frame untouched when it is published in that colour", () => {
    const result = resolvePublishedFrame({
      kind: "creature",
      candidates: ["m15snow"],
      colorKey: "u",
      verifiedKeys: verified(k("m15snow", "u")),
      prefer: "frame",
    });
    expect(result).toEqual({ status: "exact", template: "m15snow", colorKey: "u" });
  });

  it("prefer frame: keeps the colour and walks the candidates in order", () => {
    const result = resolvePublishedFrame({
      kind: "creature",
      candidates: ["m15snow", "m15", "agclassic"],
      colorKey: "u",
      verifiedKeys: verified(k("m15snow", "w"), k("agclassic", "u"), k("m15", "u")),
      prefer: "frame",
    });
    expect(result).toEqual({
      status: "frame-switched",
      template: "m15",
      colorKey: "u",
      fromTemplate: "m15snow",
    });
  });

  it("prefer frame: falls back to any frame of the kind in that colour", () => {
    const result = resolvePublishedFrame({
      kind: "creature",
      candidates: ["m15snow"],
      colorKey: "g",
      verifiedKeys: verified(k("retro", "g"), k("m15snow", "w")),
      prefer: "frame",
    });
    expect(result).toEqual({
      status: "frame-switched",
      template: "retro",
      colorKey: "g",
      fromTemplate: "m15snow",
    });
  });

  it("prefer frame: only switches colour when NO frame of the kind has the colour", () => {
    const result = resolvePublishedFrame({
      kind: "planeswalker",
      candidates: ["m15pw"],
      colorKey: "r",
      verifiedKeys: verified(k("m15pw", "w"), k("m15pw", "u")),
      prefer: "frame",
    });
    expect(result).toEqual({
      status: "colour-switched",
      template: "m15pw",
      colorKey: "w",
      fromColorKey: "r",
    });
  });

  it("prefer colour: keeps the clicked frame and moves to its first published colour", () => {
    const result = resolvePublishedFrame({
      kind: "creature",
      candidates: ["retro"],
      colorKey: "u",
      verifiedKeys: verified(k("retro", "w"), k("m15", "u")),
      prefer: "colour",
    });
    expect(result).toEqual({
      status: "colour-switched",
      template: "retro",
      colorKey: "w",
      fromColorKey: "u",
    });
  });

  it("prefer colour: falls back to another frame only when the clicked one has no colour at all", () => {
    const result = resolvePublishedFrame({
      kind: "creature",
      candidates: ["retro"],
      colorKey: "u",
      verifiedKeys: verified(k("m15", "u")),
      prefer: "colour",
    });
    expect(result).toEqual({
      status: "frame-switched",
      template: "m15",
      colorKey: "u",
      fromTemplate: "retro",
    });
  });

  it("never invents a frame the kind cannot wear", () => {
    // saga/w is published, but a creature never gets the saga frame.
    const result = resolvePublishedFrame({
      kind: "creature",
      candidates: ["m15"],
      colorKey: "w",
      verifiedKeys: verified(k("saga", "w")),
      prefer: "frame",
    });
    expect(result).toEqual({ status: "unavailable" });
  });

  it("is unavailable with no candidates or nothing published", () => {
    expect(
      resolvePublishedFrame({
        kind: "creature",
        candidates: [],
        colorKey: "w",
        verifiedKeys: verified(k("m15", "w")),
        prefer: "frame",
      }),
    ).toEqual({ status: "unavailable" });
    expect(
      resolvePublishedFrame({
        kind: "battle",
        candidates: ["battle"],
        colorKey: "w",
        verifiedKeys: verified(),
        prefer: "colour",
      }),
    ).toEqual({ status: "unavailable" });
  });
});

// TODO 0.26: the full-art basic land frame dresses basic lands only, so it is
// never a stand-in for another land frame, and a card that stops being a
// basic land leaves it for the land frame it is a variation of.
describe("basic-only frames", () => {
  it("are never the 'any frame in this colour' fallback", () => {
    // Only the full-art basic frame is published in white: an import or a
    // kind change must not land a (possibly nonbasic) land on it.
    const result = resolvePublishedFrame({
      kind: "land",
      candidates: ["m15snowland"],
      colorKey: "w",
      verifiedKeys: verified(k("fullartland", "w"), k("m15land", "u")),
      prefer: "frame",
    });
    expect(result).toEqual({ status: "unavailable" });
  });

  it("stay reachable as an explicit candidate", () => {
    expect(
      resolvePublishedFrame({
        kind: "land",
        candidates: ["fullartland"],
        colorKey: "w",
        verifiedKeys: verified(k("fullartland", "w")),
        prefer: "frame",
      }),
    ).toEqual({ status: "exact", template: "fullartland", colorKey: "w" });
  });

  it("basicOnlyFrameFallback: the full-art basic land falls back to M15 Land in the same colour", () => {
    const keys = verified(k("fullartland", "w"), k("m15land", "w"));
    expect(basicOnlyFrameFallback("fullartland", "w", keys)).toBe("m15land");
    // Another published land frame in that colour when M15 Land isn't.
    expect(
      basicOnlyFrameFallback("fullartland", "w", verified(k("fullartland", "w"), k("m15snowland", "w"))),
    ).toBe("m15snowland");
  });

  it("the artifact frame a creature borrows is never the fallback either (TODO 1.7)", () => {
    // Only m15artifact is published in blue: a plain creature must not be
    // dressed as an artifact behind the user's back…
    expect(
      resolvePublishedFrame({
        kind: "creature",
        candidates: ["m15snow", "m15"],
        colorKey: "u",
        verifiedKeys: verified(k("m15artifact", "u")),
        prefer: "frame",
      }),
    ).toEqual({ status: "unavailable" });
    // …while an Artifact Creature import asks for it by name and gets it.
    expect(
      resolvePublishedFrame({
        kind: "creature",
        candidates: ["m15artifact", "m15"],
        colorKey: "u",
        verifiedKeys: verified(k("m15artifact", "u")),
        prefer: "frame",
      }),
    ).toEqual({ status: "exact", template: "m15artifact", colorKey: "u" });
  });

  it("basicOnlyFrameFallback: never recolours, and ignores frames that aren't basic-only", () => {
    expect(
      basicOnlyFrameFallback("fullartland", "w", verified(k("fullartland", "w"), k("m15land", "u"))),
    ).toBeNull();
    expect(basicOnlyFrameFallback("m15land", "w", verified(k("m15land", "w")))).toBeNull();
    expect(basicOnlyFrameFallback("fullart", "w", verified(k("m15", "w")))).toBeNull();
  });
});
