import { describe, expect, it } from "vitest";
import snapshot from "./fixtures/prod-verified-frames-2026-11-22.json";
import { designHasPublishedFrame, frameChoicesForType, resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { tokenFrameFor } from "@/lib/creator/card-kinds";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { printsPowerToughness, supertypeHasWord } from "@/lib/cards/card-display";
import { tokenDesignOf } from "@/lib/cards/token-faces";
import { tokenHeightOf } from "@/lib/cards/token-height";
import { dfcFitOf, normalizeDfcDesign, type DfcDesignCard } from "@/lib/ai/dfc-design";
import type { ColorIdentity, FrameTemplate } from "@/types/card";
import { DFC_TOKEN } from "../ai/fixtures/dfc-designs";

// ---------------------------------------------------------------------------
// A RANDOM frame for an AI token comes from the token frames only (owner
// 2026-11-25): the 2014–19 arch (`m15token…`) and the full-art design
// (`m20token…`, its Nyx dress included), with the token rules on top — the
// Artifact word, the text box / height, the Nyx follow. On production's
// verified list (read 2026-11-22, the fixture) the token pool also held
// extended art and sixteen showcases, and a white 1/1 Soldier with
// "Vigilance" landed on one about 9 draws in 10. A showcase asked for BY NAME
// is kept as before; every other kind's pool is unchanged.
// ---------------------------------------------------------------------------

const PROD: ReadonlySet<string> = new Set(
  Object.entries(snapshot.verified as Record<string, string>).flatMap(([template, keys]) =>
    [...keys].map((key) => frameComboKey(template, key)),
  ),
);
const without = (verified: ReadonlySet<string>, drop: (template: string, key: string) => boolean) =>
  new Set([...verified].filter((combo) => {
    const [template, key] = combo.split("/");
    return !drop(template!, key!);
  }));

/** `n` evenly spaced rolls — every slot of a pool of up to `n` frames (the
 *  token pool held 19 on production before the fix) — then `n` from a
 *  seeded generator (mulberry32): the same answers on every run. A long
 *  text is measured for every height of every token frame on each draw, so
 *  its cases take fewer. */
function* rolls(n = 32): Generator<() => number> {
  for (let i = 0; i < n; i += 1) yield () => i / n;
  let seed = 0x2026_1125;
  for (let i = 0; i < n; i += 1) {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    yield () => value;
  }
}

const COLOURS: Array<[string, ColorIdentity[]]> = [
  ["w", ["white"]],
  ["u", ["blue"]],
  ["b", ["black"]],
  ["r", ["red"]],
  ["g", ["green"]],
  ["c", ["colorless"]],
  ["m", ["blue", "red"]],
];

type TokenFace = {
  cardType: "token";
  supertype: string;
  subtypes: string[];
  rulesText: string;
  flavorText?: string | null;
  power?: string | null;
  toughness?: string | null;
};
const token = (supertype: string, subtypes: string[], rulesText: string, over: Partial<TokenFace> = {}): TokenFace => ({
  cardType: "token",
  supertype,
  subtypes,
  rulesText,
  ...(supertypeHasWord(supertype, "Creature") ? { power: "1", toughness: "1" } : {}),
  ...over,
});

const LONG = "Creature — Angel, long text";
const FACES: Record<string, TokenFace> = {
  // The probe's card: on production it drew m15tokentext 19 times and
  // m20tokentext 20 times in 400 — every other draw a showcase.
  "Creature — Soldier, Vigilance": token("Creature", ["Soldier"], "Vigilance"),
  "Creature — Zombie, no text": token("Creature", ["Zombie"], ""),
  "Creature — Spirit, flavour only": token("Creature", ["Spirit"], "", { flavorText: "It remembers the war." }),
  [LONG]: token(
    "Creature",
    ["Angel"],
    "Flying, vigilance, lifelink\nWhenever this creature attacks, create a 1/1 white Soldier creature token that's tapped and attacking.\nAt the beginning of your end step, if you gained 3 or more life this turn, put a +1/+1 counter on each creature you control.",
  ),
  "Artifact — Treasure": token("Artifact", ["Treasure"], "{T}, Sacrifice this token: Add one mana of any color."),
  "Artifact Creature — Thopter, Flying": token("Artifact Creature", ["Thopter"], "Flying"),
  "Artifact Creature — Construct, no text": token("Artifact Creature", ["Construct"], ""),
  "Enchantment Creature — Nymph, no text": token("Enchantment Creature", ["Nymph"], ""),
  "Enchantment Creature — Spirit, Lifelink": token("Enchantment Creature", ["Spirit"], "Lifelink"),
  "Enchantment Artifact Creature — Golem, Trample": token("Enchantment Artifact Creature", ["Golem"], "Trample"),
};

const draw = (face: TokenFace | undefined, colorIdentity: ColorIdentity[], verifiedKeys: ReadonlySet<string>, random: () => number, requested: FrameTemplate | "random" = "random") =>
  resolveGeneratedFrame({ cardType: "token", requested, colorIdentity, verifiedKeys, face, random });

describe("the production list this test reads", () => {
  it("offers a token extended art and the showcases in every colour — what reached the random pool", () => {
    const offered = frameChoicesForType("token", PROD).filter((choice) => choice.availableColorKeys.length === 7);
    const others = offered.filter((choice) => tokenDesignOf(choice.template) === null).map((choice) => choice.template);
    expect(others).toEqual(expect.arrayContaining(["extendedart", "lotr", "fullart", "breakingnews"]));
    expect(others.length).toBeGreaterThanOrEqual(17);
    // …and the token frames themselves, all eighteen, in every colour.
    expect(offered.filter((choice) => tokenDesignOf(choice.template) !== null)).toHaveLength(18);
  });
});

describe("a random frame for an AI token is a token frame (owner 2026-11-25)", () => {
  it.each(Object.keys(FACES))("%s — in every colour, every draw", (name) => {
    const face = FACES[name]!;
    const artifact = supertypeHasWord(face.supertype, "Artifact");
    const enchantment = supertypeHasWord(face.supertype, "Enchantment");
    const tokenFace = {
      supertype: face.supertype,
      rulesText: face.rulesText,
      flavorText: face.flavorText,
      printsPowerToughness: printsPowerToughness({ ...face }),
    };
    for (const [key, colours] of COLOURS) {
      const designs = new Set<string>();
      for (const random of rolls(name === LONG ? 12 : 32)) {
        const frame = draw(face, colours, PROD, random);
        const where = `${name} / ${key} → ${frame}`;
        expect(frame, where).not.toBeNull();
        const design = tokenDesignOf(frame);
        expect(design, where).not.toBeNull();
        designs.add(design!);
        // The token rules on top: the Artifact word's dress, the box and
        // the height the text asks for…
        const of = tokenHeightOf(frame)!;
        expect(of.artifact, where).toBe(artifact);
        expect(tokenFrameFor("token", frame!, tokenFace), where).toBe(frame);
        // …and the Nyx dress: a one-colour Enchantment token on the
        // full-art design wears it, nothing else does (the arch has none).
        expect(of.nyx, where).toBe(enchantment && design === "fullart" && key !== "m");
      }
      // Both designs are drawn.
      expect([...designs].sort(), `${name} / ${key}`).toEqual(["arch", "fullart"]);
    }
  }, 30_000);

  it("the long text takes the tall box and the flavour alone a text box", () => {
    for (const random of rolls(12)) expect(tokenHeightOf(draw(FACES[LONG], ["white"], PROD, random))?.height).toBe("tall");
    for (const random of rolls()) {
      expect(tokenHeightOf(draw(FACES["Creature — Spirit, flavour only"], ["white"], PROD, random))?.height).not.toBe("textless");
      expect(tokenHeightOf(draw(FACES["Creature — Zombie, no text"], ["white"], PROD, random))?.height).toBe("textless");
    }
  }, 30_000);

  it("a token designed with no face to read still draws a token frame", () => {
    for (const random of rolls()) expect(tokenDesignOf(draw(undefined, ["red"], PROD, random))).not.toBeNull();
  });

  it("a plan-time check of a free design reads the same pool", () => {
    for (const [, colours] of COLOURS) {
      expect(designHasPublishedFrame({ cardType: "token", colorIdentity: colours, face: FACES["Creature — Soldier, Vigilance"] }, PROD)).toBe(true);
    }
  });

  it("a Surprise-me double-sided token lands on a token front on every roll (the front gate refused a showcase)", () => {
    const card = normalizeDfcDesign(structuredClone(DFC_TOKEN) as unknown as DfcDesignCard, "dfc_token") as DfcDesignCard & { flavor_text?: string | null };
    const face = {
      card_type: card.card_type,
      supertype: card.supertype,
      subtypes: card.subtypes,
      title: card.title,
      cost: card.cost,
      rules_text: card.rules_text,
      flavor_text: card.flavor_text ?? null,
      color_identity: card.color_identity,
      power: card.power,
      toughness: card.toughness,
      back_face: card.back_face ?? null,
    };
    for (const random of rolls()) {
      const fit = dfcFitOf("dfc_token", face, PROD, { picked: null, random });
      expect(fit.ok, fit.reason ?? "").toBe(true);
      expect(tokenDesignOf(fit.front)).not.toBeNull();
    }
  });
});

describe("a frame asked for by name", () => {
  const soldier = FACES["Creature — Soldier, Vigilance"]!;
  const zombie = FACES["Creature — Zombie, no text"]!;

  it("keeps extended art or a showcase a token is asked onto, as before", () => {
    const named = frameChoicesForType("token", PROD)
      .filter((choice) => tokenDesignOf(choice.template) === null && choice.availableColorKeys.includes("w"))
      .map((choice) => choice.template);
    expect(named.length).toBeGreaterThanOrEqual(17);
    for (const template of named) {
      for (const face of [soldier, zombie]) {
        expect(draw(face, ["white"], PROD, () => 0.999, template), template).toBe(template);
      }
    }
  });

  it("keeps a token frame asked for, dressed by the token's rules", () => {
    expect(draw(soldier, ["white"], PROD, () => 0.999, "m15token")).toBe("m15tokentext");
    expect(draw(zombie, ["white"], PROD, () => 0.999, "m20tokentext")).toBe("m20token");
    expect(draw(FACES["Artifact — Treasure"], ["colorless"], PROD, () => 0.999, "m20token")).toBe("m20tokenartifacttext");
  });

  it("falls back to a token frame where the one asked for can't dress the token", () => {
    const noWhiteLotr = without(PROD, (template, key) => template === "lotr" && key === "w");
    for (const random of rolls()) {
      expect(tokenDesignOf(draw(soldier, ["white"], noWhiteLotr, random, "lotr"))).not.toBeNull();
    }
    // …and to nothing where the caller asked for no fallback (the AI deck).
    expect(resolveGeneratedFrame({ cardType: "token", requested: "lotr", colorIdentity: ["white"], verifiedKeys: noWhiteLotr, face: soldier, fallback: "none" })).toBeNull();
  });
});

describe("a token whose colour has no token frame published", () => {
  // White: every token frame unticked, the showcases and extended art still
  // published in white.
  const noWhiteTokens = without(PROD, (template, key) => key === "w" && tokenDesignOf(template) !== null);

  it("still has showcases published in that colour", () => {
    expect(frameChoicesForType("token", noWhiteTokens).find((choice) => choice.template === "lotr")?.availableColorKeys).toContain("w");
  });

  it("falls back as before — no template — never onto a showcase", () => {
    for (const face of Object.values(FACES)) {
      for (const random of rolls()) {
        expect(draw(face, ["white"], noWhiteTokens, random)).toBeNull();
        expect(draw(face, ["white"], noWhiteTokens, random, "m20token")).toBeNull();
      }
    }
    expect(designHasPublishedFrame({ cardType: "token", colorIdentity: ["white"], face: FACES["Creature — Soldier, Vigilance"] }, noWhiteTokens)).toBe(false);
    // Other colours are untouched.
    expect(tokenDesignOf(draw(FACES["Creature — Soldier, Vigilance"], ["red"], noWhiteTokens, () => 0.999))).not.toBeNull();
  });

  it("keeps the textless arch's scrim for a text where it is the one token frame published (a preference, not a gate)", () => {
    const verified = new Set([...noWhiteTokens, frameComboKey("m15token", "w")]);
    for (const random of rolls()) expect(draw(FACES["Creature — Soldier, Vigilance"], ["white"], verified, random)).toBe("m15token");
  });
});

describe("every other kind's random pool is unchanged", () => {
  it("a creature, an instant, an artifact, an enchantment and a land still draw showcases", () => {
    const cases: Array<[Parameters<typeof resolveGeneratedFrame>[0]["cardType"], string | null, string[]]> = [
      ["creature", null, ["Dragon"]],
      ["instant", null, []],
      ["artifact", null, ["Equipment"]],
      ["enchantment", null, ["Aura"]],
      ["land", null, []],
    ];
    for (const [cardType, supertype, subtypes] of cases) {
      const drawn = new Set<string | null>();
      for (const random of rolls()) {
        drawn.add(
          resolveGeneratedFrame({
            cardType,
            requested: "random",
            colorIdentity: ["red"],
            verifiedKeys: PROD,
            face: { cardType, supertype, subtypes, rulesText: "Haste" },
            random,
          }),
        );
      }
      const showcases = new Set(frameChoicesForType(cardType, PROD).filter((choice) => choice.group === "showcase").map((choice) => choice.template));
      expect([...drawn].some((frame) => frame !== null && showcases.has(frame as FrameTemplate)), cardType).toBe(true);
      expect([...drawn].some((frame) => tokenDesignOf(frame) !== null), cardType).toBe(false);
    }
  });

  it("a red creature with Haste draws m15, extended art and the showcases", () => {
    const drawn = new Set<string | null>();
    for (const random of rolls()) {
      drawn.add(resolveGeneratedFrame({ cardType: "creature", requested: "random", colorIdentity: ["red"], verifiedKeys: PROD, face: { cardType: "creature", subtypes: ["Dragon"], rulesText: "Haste" }, random }));
    }
    expect([...drawn]).toEqual(expect.arrayContaining(["m15", "extendedart", "lotr", "breakingnews", "fullart"]));
  });
});
