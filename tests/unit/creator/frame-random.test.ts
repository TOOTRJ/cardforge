import { describe, expect, it } from "vitest";
import {
  colorHintsForFrame,
  frameChoicesForType,
  resolveGeneratedFrame,
} from "@/lib/creator/frame-random";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";

// Verified-keys fixtures — the gate is (template, colorKey) pairs exactly as
// /admin/frame-compare publishes them.
const keys = (...pairs: Array<[string, string]>) =>
  new Set(pairs.map(([template, color]) => frameComboKey(template as never, color)));

describe("frameChoicesForType", () => {
  it("only offers frames that can dress the type", () => {
    const verified = keys(["m15", "r"], ["retro", "r"], ["m15pw", "r"]);
    const templates = frameChoicesForType("creature", verified).map(
      (choice) => choice.template,
    );
    expect(templates).toContain("m15");
    expect(templates).not.toContain("m15pw");
  });
});

describe("resolveGeneratedFrame", () => {
  it("returns null when the caller didn't ask for a frame", () => {
    expect(
      resolveGeneratedFrame({
        cardType: "creature",
        requested: undefined,
        colorIdentity: ["red"],
        verifiedKeys: keys(["m15", "r"]),
      }),
    ).toBeNull();
  });

  it("keeps a specific frame when its color is published", () => {
    expect(
      resolveGeneratedFrame({
        cardType: "creature",
        requested: "retro",
        colorIdentity: ["red"],
        verifiedKeys: keys(["retro", "r"], ["m15", "r"]),
      }),
    ).toBe("retro");
  });

  it("falls back to a published frame when the requested color isn't", () => {
    const resolved = resolveGeneratedFrame({
      cardType: "creature",
      requested: "retro",
      colorIdentity: ["blue"], // retro/u NOT published
      verifiedKeys: keys(["retro", "r"], ["m15", "u"]),
      random: () => 0,
    });
    expect(resolved).toBe("m15");
  });

  it("random picks only frames published for the card's color key", () => {
    const verified = keys(["m15", "m"], ["retro", "r"], ["alpha", "g"]);
    const resolved = resolveGeneratedFrame({
      cardType: "creature",
      requested: "random",
      colorIdentity: ["red", "green", "multicolor"], // colorKey "m"
      verifiedKeys: verified,
      random: () => 0,
    });
    expect(resolved).toBe("m15");
  });

  it("returns null when nothing is published for the color", () => {
    expect(
      resolveGeneratedFrame({
        cardType: "creature",
        requested: "random",
        colorIdentity: ["white"],
        verifiedKeys: keys(["m15", "r"]),
      }),
    ).toBeNull();
  });
});

describe("colorHintsForFrame", () => {
  it("maps a frame's published color keys to identity words", () => {
    const hints = colorHintsForFrame(
      "creature",
      "m15",
      keys(["m15", "r"], ["m15", "m"], ["m15", "c"]),
    );
    expect(new Set(hints)).toEqual(
      new Set(["red", "multicolor", "colorless"]),
    );
  });

  it("returns [] for a frame that can't dress the type", () => {
    expect(
      colorHintsForFrame("creature", "m15pw", keys(["m15pw", "r"])),
    ).toEqual([]);
  });
});
