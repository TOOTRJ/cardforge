import { describe, expect, it } from "vitest";
import { resolvePublishedFrame } from "@/lib/creator/frame-resolve";
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
