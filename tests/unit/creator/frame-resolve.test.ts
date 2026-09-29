import { describe, expect, it } from "vitest";
import {
  basicOnlyFrameFallback,
  finalizeImportMatch,
  resolvePublishedFrame,
  withVerification,
} from "@/lib/creator/frame-resolve";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FrameMatch } from "@/lib/scryfall/frame-signatures";

describe("withVerification (TODO 1.4)", () => {
  const match = (over: Partial<FrameMatch> = {}): FrameMatch => ({
    status: "exact",
    template: "m15fullartland",
    exactLabel: "Full-art basic land",
    reason: null,
    signature: "fullart/basic/2022",
    ...over,
  });

  it("keeps an exact match only when the combo is verified in the card's colour", () => {
    expect(withVerification(match(), "w", new Set([frameComboKey("m15fullartland", "w")]))).toEqual(match());
  });

  it("downgrades an unverified exact match to nearest, naming the colour", () => {
    expect(withVerification(match(), "u", new Set([frameComboKey("m15fullartland", "w")]))).toEqual(
      match({ status: "nearest", reason: "not yet verified in blue" }),
    );
    expect(withVerification(match(), "m", new Set())).toMatchObject({
      status: "nearest",
      reason: "not yet verified in multicolor",
    });
  });

  it("passes nearest and unsupported matches through unchanged", () => {
    const nearest = match({ status: "nearest", reason: "the 2023 bars" });
    const unsupported = match({ status: "unsupported", template: "m15", reason: "poster", forGood: true });
    expect(withVerification(nearest, "w", new Set())).toBe(nearest);
    expect(withVerification(unsupported, "w", new Set())).toBe(unsupported);
  });

  it("checks the matched template, not where the import lands", () => {
    const borderless = match({ template: "m15borderless", landOn: "m15", signature: "borderless/standard" });
    expect(withVerification(borderless, "b", new Set([frameComboKey("m15", "b")])).status).toBe("nearest");
    expect(withVerification(borderless, "b", new Set([frameComboKey("m15borderless", "b")])).status).toBe("exact");
  });

  // Owner decision A9: a 2003-frame textless promo names the 2003 frame
  // until the textless frame is verified in its colour.
  const promo = match({
    status: "nearest",
    template: "modern",
    reason: "PipGlyph doesn't have this old-frame textless design yet",
    signature: "textless/old-frame",
    blockedBy: "4.43",
    onceVerified: "m15textless",
  });

  it("keeps the named frame while the later one isn't verified in the card's colour", () => {
    expect(withVerification(promo, "w", new Set([frameComboKey("modern", "w")]))).toBe(promo);
    expect(withVerification(promo, "w", new Set([frameComboKey("m15textless", "u")]))).toBe(promo);
  });

  it("takes the later frame once it is verified, and drops the pointer", () => {
    const later = withVerification(promo, "w", new Set([frameComboKey("m15textless", "w")]));
    expect(later).toEqual({
      status: "nearest",
      template: "m15textless",
      exactLabel: "Full-art basic land",
      reason: "PipGlyph doesn't have this old-frame textless design yet",
      signature: "textless/old-frame",
      blockedBy: "4.43",
    });
    expect("onceVerified" in later).toBe(false);
  });
});

describe("finalizeImportMatch (the /api/scryfall/named step)", () => {
  const promoMatch: FrameMatch = {
    status: "nearest",
    template: "modern",
    exactLabel: "2003 frame textless promo",
    reason: "PipGlyph doesn't have this old-frame textless design yet",
    signature: "textless/old-frame",
    blockedBy: "4.43",
    onceVerified: "m15textless",
  };

  it("finalizes the match in the patch's own colour and moves frame_template with it", () => {
    const patch = { frame_match: promoMatch, frame_template: "modern" as const, color_identity: ["white" as const] };
    expect(finalizeImportMatch(patch, new Set())).toEqual(patch);
    const later = finalizeImportMatch(patch, new Set([frameComboKey("m15textless", "w")]));
    expect(later.frame_template).toBe("m15textless");
    expect(later.frame_match?.template).toBe("m15textless");
    // Blue isn't white: the swap is per colour.
    const blue = { ...patch, color_identity: ["blue" as const] };
    expect(finalizeImportMatch(blue, new Set([frameComboKey("m15textless", "w")])).frame_template).toBe("modern");
  });

  it("downgrades an unverified exact match without touching frame_template", () => {
    const exact: FrameMatch = {
      status: "exact",
      template: "m15borderless",
      landOn: "m15",
      exactLabel: "Borderless frame",
      reason: null,
      signature: "borderless/standard",
    };
    const patch = { frame_match: exact, frame_template: "m15" as const, color_identity: ["black" as const] };
    const out = finalizeImportMatch(patch, new Set());
    expect(out.frame_match).toMatchObject({ status: "nearest", reason: "not yet verified in black" });
    expect(out.frame_template).toBe("m15");
  });

  it("leaves a layout kind's frame_template undefined and a patch without a match alone", () => {
    const layout: { frame_match: FrameMatch; frame_template?: "modern"; color_identity: "white"[] } = {
      frame_match: promoMatch,
      color_identity: ["white"],
    };
    expect(finalizeImportMatch(layout, new Set([frameComboKey("m15textless", "w")])).frame_template).toBeUndefined();
    const bare = { frame_template: "m15" as const };
    expect(finalizeImportMatch(bare, new Set())).toBe(bare);
  });
});

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

  it("nor is the Nyx showcase a creature borrows (A3)", () => {
    // Only nyx is published in blue: a plain creature is never dressed as
    // an Enchantment Creature behind the user's back…
    expect(
      resolvePublishedFrame({
        kind: "creature",
        candidates: ["m15snow", "m15"],
        colorKey: "u",
        verifiedKeys: verified(k("nyx", "u")),
        prefer: "frame",
      }),
    ).toEqual({ status: "unavailable" });
    // …while a Theros god's import asks for it by name and gets it.
    expect(
      resolvePublishedFrame({
        kind: "creature",
        candidates: ["nyx", "m15"],
        colorKey: "u",
        verifiedKeys: verified(k("nyx", "u")),
        prefer: "frame",
      }),
    ).toEqual({ status: "exact", template: "nyx", colorKey: "u" });
  });

  it("basicOnlyFrameFallback: never recolours, and ignores frames that aren't basic-only", () => {
    expect(
      basicOnlyFrameFallback("fullartland", "w", verified(k("fullartland", "w"), k("m15land", "u"))),
    ).toBeNull();
    expect(basicOnlyFrameFallback("m15land", "w", verified(k("m15land", "w")))).toBeNull();
    expect(basicOnlyFrameFallback("fullart", "w", verified(k("m15", "w")))).toBeNull();
  });
});
