import { describe, expect, it } from "vitest";
import { CROWN_REFERENCES, crownKeyFor, crownOverlayFor, crownReferenceFor, showsCrown, type CrownCard } from "@/lib/cards/crown";
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { M15_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6a — the legendary crown on the REAL profiles (lib/cards/crown.ts
// over lib/cards/anatomy.ts resolveFrameOverlays, the rule both renderers
// draw with): drawn only with the switch exactly on, on a Legendary card of
// a type that prints one, on m15 / m15artifact / m15land; keyed by the
// pinline of the master drawn (design 2026-09-29 §1.1 "Crown key").
// ---------------------------------------------------------------------------

const legendary = (colors: ColorIdentity[], over: Partial<CrownCard> = {}): CrownCard => ({
  colorIdentity: colors,
  cost: "{2}{W}",
  cardType: "creature",
  supertype: "Legendary",
  frameStyle: { crown: true },
  ...over,
});
const m15 = getFrameProfile("m15");
const artifact = getFrameProfile("m15artifact");
const land = getFrameProfile("m15land");

describe("which card draws the crown", () => {
  it("only with the switch exactly on — absent (every stored card) and off are today's look", () => {
    expect(showsCrown(legendary(["white"]), m15)).toBe(true);
    expect(showsCrown(legendary(["white"], { frameStyle: {} }), m15)).toBe(false);
    expect(showsCrown(legendary(["white"], { frameStyle: null }), m15)).toBe(false);
    expect(showsCrown(legendary(["white"], { frameStyle: { crown: false } }), m15)).toBe(false);
  });

  it("only on a Legendary card of a type that prints one — never a planeswalker, token, battle or emblem", () => {
    expect(showsCrown(legendary(["white"], { supertype: null }), m15)).toBe(false);
    expect(showsCrown(legendary(["white"], { supertype: "Lengendary" }), m15)).toBe(false);
    expect(showsCrown(legendary(["white"], { supertype: "Legendary Snow" }), m15)).toBe(true);
    for (const cardType of ["creature", "artifact", "enchantment", "instant", "sorcery", "land"]) {
      expect(showsCrown(legendary(["white"], { cardType }), m15), cardType).toBe(true);
    }
    for (const cardType of ["planeswalker", "token", "battle", "emblem"]) {
      expect(showsCrown(legendary(["white"], { cardType }), m15), cardType).toBe(false);
    }
  });

  it("only on m15, m15artifact, m15land and the borderless frames (4.6f) — and a legacy template, which draws the m15 frame", () => {
    const crowned = FRAME_TEMPLATE_VALUES.filter((t) => showsCrown(legendary(["white"]), getFrameProfile(t)));
    const DRAWN = ["m15", "m15land", "m15artifact", "m15borderless", "m15borderlessartifact"];
    expect(crowned).toEqual(FRAME_TEMPLATE_VALUES.filter((t) => DRAWN.includes(t)));
    expect(showsCrown(legendary(["white"]), getFrameProfile("regular"))).toBe(true);
  });
});

describe("the crown's key — the pinline of the master drawn", () => {
  it("mono: its colour", () => {
    const letters = { white: "w", blue: "u", black: "b", red: "r", green: "g" } as const;
    for (const [color, key] of Object.entries(letters)) {
      expect(crownKeyFor(legendary([color as ColorIdentity]), m15), color).toBe(key);
    }
  });

  it("three or more colours, a multicolour token, and a pair drawn gold: the gold crown", () => {
    expect(crownKeyFor(legendary(["white", "blue", "black"]), m15)).toBe("m");
    expect(crownKeyFor(legendary(["multicolor"]), m15)).toBe("m");
    // A pair with its two-colour switch off (or absent — a stored card) is
    // drawn gold, so its crown is gold too.
    expect(crownKeyFor(legendary(["white", "blue"], { cost: "{1}{W}{U}", frameStyle: { crown: true } }), m15)).toBe("m");
    expect(crownKeyFor(legendary(["white", "blue"], { cost: "{1}{W}{U}", frameStyle: { crown: true, twoColor: false } }), m15)).toBe("m");
  });

  it("a pair drawn as its pair master (4.6b): the split crown in printed order, on every dress and template", () => {
    const both = { crown: true, twoColor: true };
    // Gold-split and hybrid on m15; the first canonical colour left (U|B,
    // whatever order the identity was stored in).
    expect(crownKeyFor(legendary(["white", "blue"], { cost: "{1}{W}{U}", frameStyle: both }), m15)).toBe("wu");
    expect(crownKeyFor(legendary(["black", "blue"], { cost: "{U}{B}", frameStyle: both }), m15)).toBe("ub");
    expect(crownKeyFor(legendary(["green", "white"], { cost: "{G/W}{G/W}", frameStyle: both }), m15)).toBe("gw");
    // The artifact frame (its hybrid falls back to the gold-split master) and
    // the land frame wear the same split band.
    expect(crownKeyFor(legendary(["red", "white"], { cardType: "artifact", cost: "{R/W}{R/W}", frameStyle: both }), artifact)).toBe("rw");
    expect(crownKeyFor(legendary(["black", "red"], { cardType: "land", cost: null, frameStyle: both }), land)).toBe("br");
    // Three colours stay gold with the switch on; the crown switch off draws none.
    expect(crownKeyFor(legendary(["white", "blue", "black"], { frameStyle: both }), m15)).toBe("m");
    expect(crownKeyFor(legendary(["white", "blue"], { cost: "{1}{W}{U}", frameStyle: { twoColor: true } }), m15)).toBeNull();
  });

  it("colourless: m15's see-through grey, the artifact silver, the land grey", () => {
    expect(crownKeyFor(legendary(["colorless"], { cost: "{10}" }), m15)).toBe("c");
    expect(crownKeyFor(legendary([], { cost: "{10}" }), m15)).toBe("c");
    expect(crownKeyFor(legendary(["colorless"], { cardType: "artifact", cost: "{5}" }), artifact)).toBe("a");
    expect(crownKeyFor(legendary(["colorless"], { cardType: "land", cost: null }), land)).toBe("l");
  });

  it("a coloured artifact and a mono land keep their colour; a multicolour land is gold", () => {
    expect(crownKeyFor(legendary(["blue"], { cardType: "artifact", cost: "{1}{U}" }), artifact)).toBe("u");
    expect(crownKeyFor(legendary(["green"], { cardType: "land", cost: null }), land)).toBe("g");
    expect(crownKeyFor(legendary(["multicolor"], { cardType: "land", cost: null }), land)).toBe("m");
  });

  it("paints the published band over the top 410 / 2100 of the card", () => {
    expect(crownOverlayFor(legendary(["red"]), m15)).toEqual({
      anatomy: "crown",
      rect: M15_CROWN.rect,
      key: "r",
      path: "/frames/m15crown/r.png",
    });
    expect(crownOverlayFor(legendary(["colorless"], { cardType: "land", cost: null }), land)?.path).toBe("/frames/m15crown/l.png");
  });
});

describe("the crowned prints the crown is judged against", () => {
  it("names a crowned print for every mono colour, gold and the colourless grey on m15, and the land and artifact keys", () => {
    expect(Object.keys(CROWN_REFERENCES.m15 ?? {}).sort()).toEqual(["b", "c", "g", "m", "r", "u", "w"]);
    expect(crownReferenceFor("m15", "w")).toMatchObject({ set: "fdn", collectorNumber: "2" });
    expect(crownReferenceFor("m15", "m")).toMatchObject({ set: "fdn", collectorNumber: "243" });
    expect(crownReferenceFor("m15land", "c")).toMatchObject({ set: "uma", collectorNumber: "241" });
    expect(crownReferenceFor("m15artifact", "c")).toMatchObject({ set: "fdn", collectorNumber: "677" });
    expect(crownReferenceFor("m15snow", "w")).toBeNull();
    // Scryfall ids only (never a scan).
    for (const refs of Object.values(CROWN_REFERENCES)) {
      for (const ref of Object.values(refs ?? {})) expect(ref?.scryfallId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("only on templates that draw the crown — as a band or as crowned twin masters (4.6f)", () => {
    for (const template of Object.keys(CROWN_REFERENCES)) {
      expect(frameAnatomyOf(template).crown, template).toBe(true);
    }
  });
});
