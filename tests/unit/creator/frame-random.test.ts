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

// TODO 1.7: a creature borrows the M15 artifact frame as a variation. An AI
// pick — random or by name — must not dress a plain creature as an
// artifact; an Artifact Creature gets it.
describe("resolveGeneratedFrame — the artifact frame on a creature", () => {
  const verified = keys(["m15artifact", "c"]);
  const face = (supertype: string | null) => ({
    cardType: "creature",
    supertype,
    subtypes: ["Golem"],
    title: "Test Golem",
    rulesText: "",
  });

  it("offers it among a creature's frames", () => {
    expect(frameChoicesForType("creature", verified).map((c) => c.template)).toContain("m15artifact");
  });

  it("never picks it at random for a plain creature", () => {
    for (const f of [face(null), face("Legendary"), undefined]) {
      expect(
        resolveGeneratedFrame({
          cardType: "creature",
          requested: "random",
          colorIdentity: ["colorless"],
          verifiedKeys: verified,
          face: f,
          random: () => 0,
        }),
      ).toBeNull();
    }
  });

  it("picks it at random for an Artifact Creature", () => {
    expect(
      resolveGeneratedFrame({
        cardType: "creature",
        requested: "random",
        colorIdentity: ["colorless"],
        verifiedKeys: verified,
        face: face("Legendary Artifact"),
        random: () => 0,
      }),
    ).toBe("m15artifact");
  });

  it("honours an explicit request only for an Artifact Creature", () => {
    expect(
      resolveGeneratedFrame({
        cardType: "creature",
        requested: "m15artifact",
        colorIdentity: ["colorless"],
        verifiedKeys: verified,
        face: face("Artifact"),
      }),
    ).toBe("m15artifact");
    // A designed plain creature never lands on it by name either: the
    // request degrades like any frame that can't dress the card (here to
    // nothing, since m15artifact is the only verified frame).
    expect(
      resolveGeneratedFrame({
        cardType: "creature",
        requested: "m15artifact",
        colorIdentity: ["colorless"],
        verifiedKeys: verified,
        face: face(null),
      }),
    ).toBeNull();
    expect(
      resolveGeneratedFrame({
        cardType: "creature",
        requested: "m15artifact",
        colorIdentity: ["colorless"],
        verifiedKeys: new Set([...verified, ...keys(["m15", "c"])]),
        face: face("Legendary"),
        random: () => 0,
      }),
    ).toBe("m15");
  });
});

// TODO 0.26: the full-art basic land frame can't draw a nonbasic's rules, so
// an AI-generated land only lands on it when the design is one basic land.
describe("resolveGeneratedFrame — basic-only frames", () => {
  const verified = keys(["fullartland", "w"]);
  const plains = { cardType: "land", supertype: "Basic", subtypes: ["Plains"], title: "Plains", rulesText: "" };
  const fountain = {
    cardType: "land",
    supertype: null,
    subtypes: ["Plains", "Island"],
    title: "Hallowed Fountain",
    rulesText: "({T}: Add {W} or {U}.)",
  };

  it("gives a generated basic land the full-art basic frame", () => {
    for (const requested of ["fullartland", "random"] as const) {
      expect(
        resolveGeneratedFrame({
          cardType: "land",
          requested,
          colorIdentity: ["white"],
          verifiedKeys: verified,
          face: plains,
          random: () => 0,
        }),
      ).toBe("fullartland");
    }
  });

  it("never gives it to a nonbasic land, nor to a card whose identity is unknown", () => {
    for (const face of [fountain, undefined]) {
      for (const requested of ["fullartland", "random"] as const) {
        expect(
          resolveGeneratedFrame({
            cardType: "land",
            requested,
            colorIdentity: ["white"],
            verifiedKeys: keys(["fullartland", "w"], ["m15land", "w"]),
            face,
            random: () => 0,
          }),
        ).toBe("m15land");
      }
    }
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
