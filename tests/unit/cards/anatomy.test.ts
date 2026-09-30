import { describe, expect, it } from "vitest";
import {
  NEW_CARD_ANATOMY,
  TWO_COLOR_PAIRS,
  anatomyDefaults,
  applyFrameAnatomyPatch,
  frameAnatomyOf,
  importedAnatomy,
  newCardFrameStyle,
  normalizeAnatomy,
  pairColorIdentity,
  plateKeyFor,
  qualifiesForCrown,
  resolveFrameOverlays,
  resolveTwoColor,
  twoColorDressOf,
  twoColorFromCost,
  twoColorPairOf,
} from "@/lib/cards/anatomy";
import { getFrameProfile, type FrameOverlaySlot, type FrameProfile } from "@/lib/cards/template-layout";
import { parseFrameProfileOverride } from "@/lib/cards/profile-override";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity, type FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6.0 — the anatomy switches' pure rules (lib/cards/anatomy.ts). The
// owner rule (2026-09-29, PR #418): the legendary crown and the two-colour
// frame are ADDITIONS, opt-in per card — drawn only when the card's switch
// is exactly `true`; a stored card (no key) keeps its look; a new card
// starts on; imports follow the printing; a save drops a switch its
// template can't draw. The colour PAIR is stored card data (exactly two
// WUBRG words), never derived from the cost at render; the DRESS is print's
// for the cost (design 2026-09-29 §1.2).
// ---------------------------------------------------------------------------

const WORD: Record<string, ColorIdentity> = { w: "white", u: "blue", b: "black", r: "red", g: "green" };

/** A 4.6a-shaped crown slot (the numbers are the design's band). */
const CROWN: FrameOverlaySlot = {
  anatomy: "crown",
  rect: { topPct: 0, leftPct: 0, widthPct: 100, heightPct: 19.52 },
  assetPathTemplate: "/frames/m15crown/{key}.png",
  keys: ["w", "u", "b", "r", "g", "m", "a", "l", "c", ...TWO_COLOR_PAIRS],
};

type Anatomical = Pick<FrameProfile, "overlays" | "twoColorMasters">;
const m15Like: Anatomical = { overlays: [CROWN], twoColorMasters: ["split", "hybrid"] };
const artifactLike: Anatomical = { overlays: [{ ...CROWN, keyMap: { c: "a" } }], twoColorMasters: ["split"] };
const landLike: Anatomical = { overlays: [{ ...CROWN, keyMap: { c: "l" } }], twoColorMasters: ["split"] };

describe("the colour pair — card data, never the cost", () => {
  it("reads exactly two WUBRG words, in printed order, whatever order they were stored in", () => {
    for (const pair of TWO_COLOR_PAIRS) {
      const [a, b] = [WORD[pair[0]], WORD[pair[1]]];
      expect(twoColorPairOf([a, b]), pair).toBe(pair);
      expect(twoColorPairOf([b, a]), `${pair} reversed`).toBe(pair);
      expect(pairColorIdentity(pair)).toEqual([a, b]);
    }
    expect([...TWO_COLOR_PAIRS]).toEqual(["wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"]);
  });

  it("ignores the multicolor token (the AI's identities) and the colorless one", () => {
    expect(twoColorPairOf(["blue", "white", "multicolor"])).toBe("wu");
    expect(twoColorPairOf(["green", "multicolor", "white"])).toBe("gw");
    expect(twoColorPairOf(["colorless", "black", "red"])).toBe("br");
  });

  it("is no pair for mono, colourless, plain multicolor or three colours — whatever the cost", () => {
    expect(twoColorPairOf(["black"])).toBeNull();
    expect(twoColorPairOf(["colorless"])).toBeNull();
    expect(twoColorPairOf(["multicolor"])).toBeNull();
    expect(twoColorPairOf([])).toBeNull();
    expect(twoColorPairOf(null)).toBeNull();
    expect(twoColorPairOf(["white", "blue", "black"])).toBeNull();
    expect(twoColorPairOf(["white", "white"])).toBeNull();
  });

  it("pre-fills from a cost that spans exactly two colours (the Two colours row), and only then", () => {
    expect(twoColorFromCost("{1}{W}{U}")).toBe("wu");
    expect(twoColorFromCost("{U}{W}")).toBe("wu");
    expect(twoColorFromCost("{G/W}{G/W}")).toBe("gw");
    expect(twoColorFromCost("{1}{B}{B/G}{G}")).toBe("bg");
    expect(twoColorFromCost("{2/W}{2/U}")).toBe("wu");
    expect(twoColorFromCost("{W/P}{U}")).toBe("wu");
    expect(twoColorFromCost("{W/U/P}")).toBe("wu");
    expect(twoColorFromCost("{3}{U}{B}")).toBe("ub");
    expect(twoColorFromCost("{2}{W}")).toBeNull();
    expect(twoColorFromCost("{W}{U}{B}")).toBeNull();
    expect(twoColorFromCost("{3}")).toBeNull();
    expect(twoColorFromCost("{C}{S}{X}")).toBeNull();
    expect(twoColorFromCost("")).toBeNull();
    expect(twoColorFromCost(null)).toBeNull();
  });
});

describe("the dress — print's, for the cost", () => {
  it("gold-split for a two-colour cost, a mixed cost and mono-paying hybrids", () => {
    expect(twoColorDressOf("{1}{W}{U}", "creature")).toBe("split"); // FDN #122
    expect(twoColorDressOf("{1}{B}{B/G}{G}", "creature")).toBe("split"); // STX #175
    expect(twoColorDressOf("{G}{G/W}{W}", "creature")).toBe("split"); // MKM #238 Trostani
    expect(twoColorDressOf("{2/W}{2/U}", "instant")).toBe("split"); // twobrid = mono pips
    expect(twoColorDressOf("{W/P}{U/P}", "instant")).toBe("split"); // mono Phyrexian
  });

  it("hybrid when every coloured pip is a two-colour hybrid, or a nonland has no coloured pip", () => {
    expect(twoColorDressOf("{G/W}{G/W}", "creature")).toBe("hybrid"); // TLA #212
    expect(twoColorDressOf("{2}{U/R}{U/R}", "creature")).toBe("hybrid");
    expect(twoColorDressOf("{W/U/P}", "instant")).toBe("hybrid");
    expect(twoColorDressOf(null, "creature")).toBe("hybrid"); // colour indicator, MH2 #186
    expect(twoColorDressOf("", "sorcery")).toBe("hybrid");
    expect(twoColorDressOf("{3}", "artifact")).toBe("hybrid");
  });

  it("a land is the land frame's own split", () => {
    expect(twoColorDressOf(null, "land")).toBe("split");
    expect(twoColorDressOf("{G/W}", "land")).toBe("split");
  });
});

describe("the two-colour look", () => {
  const on = { twoColor: true };
  const gold = { colors: ["white", "blue"] as ColorIdentity[], cost: "{1}{W}{U}", cardType: "creature" };

  it("draws a pair master only when the switch is exactly true, the card stores a pair and the profile has the dress", () => {
    expect(resolveTwoColor(m15Like, on, gold)).toEqual({ pair: "wu", dress: "split", masterKey: "wu" });
    expect(resolveTwoColor(m15Like, on, { ...gold, colors: ["green", "white"], cost: "{G/W}{G/W}" })).toEqual({
      pair: "gw",
      dress: "hybrid",
      masterKey: "gw-h",
    });
    // Absent and false are today's gold frame.
    expect(resolveTwoColor(m15Like, {}, gold)).toBeNull();
    expect(resolveTwoColor(m15Like, null, gold)).toBeNull();
    expect(resolveTwoColor(m15Like, { twoColor: false }, gold)).toBeNull();
    // No stored pair: plain multicolor, mono, three colours.
    expect(resolveTwoColor(m15Like, on, { ...gold, colors: ["multicolor"] })).toBeNull();
    expect(resolveTwoColor(m15Like, on, { ...gold, colors: ["black"], cost: "{3}{U}{B}" })).toBeNull();
    expect(resolveTwoColor(m15Like, on, { ...gold, colors: ["white", "blue", "black"] })).toBeNull();
    // A profile without pair masters: gold.
    expect(resolveTwoColor({}, on, gold)).toBeNull();
    expect(resolveTwoColor(getFrameProfile("tarkirdragon"), on, gold)).toBeNull();
  });

  it("a dress the template has no masters for falls back to its gold-split masters", () => {
    const hybridArtifact = { colors: ["green", "white"] as ColorIdentity[], cost: "{G/W}{G/W}", cardType: "artifact" };
    expect(resolveTwoColor(artifactLike, on, hybridArtifact)).toEqual({ pair: "gw", dress: "split", masterKey: "gw" });
    expect(resolveTwoColor({ twoColorMasters: ["hybrid"] }, on, gold)).toBeNull();
  });

  it("the plate: the colour key, except the hybrid dress's grey 'c'", () => {
    expect(plateKeyFor("m", null)).toBe("m");
    expect(plateKeyFor("w", null)).toBe("w");
    expect(plateKeyFor("m", { pair: "wu", dress: "split", masterKey: "wu" })).toBe("m");
    expect(plateKeyFor("m", { pair: "gw", dress: "hybrid", masterKey: "gw-h" })).toBe("c");
  });
});

describe("the crown", () => {
  it("prints on a card whose supertype has the whole word Legendary, never on a walker, token, battle or emblem", () => {
    expect(qualifiesForCrown({ cardType: "creature", supertype: "Legendary" })).toBe(true);
    expect(qualifiesForCrown({ cardType: "artifact", supertype: "legendary Snow" })).toBe(true);
    expect(qualifiesForCrown({ cardType: "land", supertype: "Legendary" })).toBe(true);
    expect(qualifiesForCrown({ cardType: "creature", supertype: "Lengendary" })).toBe(false);
    expect(qualifiesForCrown({ cardType: "creature", supertype: "Legendaryish" })).toBe(false);
    expect(qualifiesForCrown({ cardType: "creature", supertype: null })).toBe(false);
    for (const cardType of ["planeswalker", "token", "battle", "emblem"]) {
      expect(qualifiesForCrown({ cardType, supertype: "Legendary" }), cardType).toBe(false);
    }
  });

  const legendary = (colors: ColorIdentity[], over: Record<string, unknown> = {}) => ({
    colors,
    colorKey: colors.length > 1 ? "m" : ({ white: "w", blue: "u", black: "b", red: "r", green: "g", colorless: "c", multicolor: "m" } as const)[colors[0] ?? "colorless"],
    cost: "{2}{W}",
    cardType: "creature",
    supertype: "Legendary",
    ...over,
  });

  it("draws only with the switch exactly on, keyed by the pinline of the master drawn", () => {
    expect(resolveFrameOverlays(m15Like, { crown: true }, legendary(["white"]))).toEqual([
      { anatomy: "crown", rect: CROWN.rect, key: "w", path: "/frames/m15crown/w.png" },
    ]);
    expect(resolveFrameOverlays(m15Like, {}, legendary(["white"]))).toEqual([]);
    expect(resolveFrameOverlays(m15Like, { crown: false }, legendary(["white"]))).toEqual([]);
    expect(resolveFrameOverlays(m15Like, null, legendary(["white"]))).toEqual([]);
    expect(resolveFrameOverlays(m15Like, { crown: true }, legendary(["white"], { supertype: null }))).toEqual([]);
    expect(resolveFrameOverlays(m15Like, { crown: true }, legendary(["white"], { cardType: "planeswalker" }))).toEqual([]);
    expect(resolveFrameOverlays({}, { crown: true }, legendary(["white"]))).toEqual([]);
  });

  it("a pair drawn gold wears the gold crown; drawn as a pair, the pair's band in both dresses", () => {
    const pair = legendary(["blue", "white"], { cost: "{1}{W}{U}" });
    expect(resolveFrameOverlays(m15Like, { crown: true }, pair)[0].key).toBe("m");
    expect(resolveFrameOverlays(m15Like, { crown: true, twoColor: false }, pair)[0].key).toBe("m");
    expect(resolveFrameOverlays(m15Like, { crown: true, twoColor: true }, pair)[0].key).toBe("wu");
    const hybrid = legendary(["green", "white"], { cost: "{G/W}{G/W}" });
    expect(resolveFrameOverlays(m15Like, { crown: true, twoColor: true }, hybrid)[0]).toMatchObject({
      key: "gw",
      path: "/frames/m15crown/gw.png",
    });
    expect(resolveFrameOverlays(m15Like, { crown: true }, legendary(["white", "blue", "black"]))[0].key).toBe("m");
  });

  it("a colourless artifact's crown is the artifact silver, a colourless land's the land grey; coloured ones keep their colour", () => {
    expect(resolveFrameOverlays(artifactLike, { crown: true }, legendary(["colorless"], { cardType: "artifact" }))[0].key).toBe("a");
    expect(resolveFrameOverlays(artifactLike, { crown: true }, legendary(["blue"], { cardType: "artifact" }))[0].key).toBe("u");
    expect(resolveFrameOverlays(landLike, { crown: true }, legendary(["colorless"], { cardType: "land" }))[0].key).toBe("l");
    expect(resolveFrameOverlays(landLike, { crown: true }, legendary(["green"], { cardType: "land" }))[0].key).toBe("g");
    expect(resolveFrameOverlays(m15Like, { crown: true }, legendary(["colorless"]))[0].key).toBe("c");
  });

  it("a key the slot doesn't publish draws nothing — never a stand-in", () => {
    const monoOnly: Anatomical = { overlays: [{ ...CROWN, keys: ["w"] }] };
    expect(resolveFrameOverlays(monoOnly, { crown: true }, legendary(["red"]))).toEqual([]);
    expect(resolveFrameOverlays(monoOnly, { crown: true }, legendary(["white"]))).toHaveLength(1);
  });
});

describe("what the templates draw (4.6b: the pair masters; the crown is 4.6a's)", () => {
  it("pair masters on exactly the m15, m15artifact and m15land PROFILES entries — never a profile that spreads them", () => {
    const paired = Object.fromEntries(
      FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).twoColor.length > 0).map((t) => [t, frameAnatomyOf(t).twoColor]),
    );
    expect(paired).toEqual({ m15: ["split", "hybrid"], m15land: ["split"], m15artifact: ["split"] });
    // Every profile that spreads M15 / M15LAND stays gold: m15snowland spreads
    // M15LAND, m15snow / m15devoid / m15borderless / the layouts spread M15.
    for (const t of ["m15snow", "m15snowland", "m15devoid", "m15borderless", "extendedart", "adventure", "saga", "nyx", "fullart"]) {
      expect(frameAnatomyOf(t), t).toEqual({ crown: false, twoColor: [] });
    }
    // A legacy template draws the m15 frame, so it has m15's pairs.
    expect(frameAnatomyOf("regular")).toEqual(frameAnatomyOf("m15"));
    // No template draws the crown in this step (4.6a declares it).
    expect(FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).crown)).toEqual([]);
  });

  it("a save keeps the two-colour switch only where the template draws it; a new card starts on there", () => {
    const paired = new Set(["m15", "m15land", "m15artifact"]);
    for (const template of FRAME_TEMPLATE_VALUES) {
      const draws = paired.has(template);
      expect(anatomyDefaults(template), template).toEqual(draws ? { twoColor: true } : {});
      expect(normalizeAnatomy({ template, finish: "foil", crown: true, twoColor: false }, template), template).toEqual(
        draws ? { template, finish: "foil", twoColor: false } : { template, finish: "foil" },
      );
      expect(newCardFrameStyle({ template, finish: "regular", ...NEW_CARD_ANATOMY }), template).toEqual(
        draws ? { template, finish: "regular", twoColor: true } : { template, finish: "regular" },
      );
    }
    // The AI jobs send no frame_style: the default template (m15) draws pairs.
    expect(newCardFrameStyle({})).toEqual({ twoColor: true });
    // A stored card names no switch: nothing to drop, the same object back.
    const untouched: FrameStyle = { template: "m15", finish: "regular" };
    expect(normalizeAnatomy(untouched, "m15")).toBe(untouched);
    expect(normalizeAnatomy(untouched, "m15snow")).toBe(untouched);
  });

  it("the real m15 profile draws print's dress; m15artifact's hybrid falls back to its gold-split", () => {
    const on = { twoColor: true };
    const m15 = getFrameProfile("m15");
    expect(resolveTwoColor(m15, on, { colors: ["white", "blue"], cost: "{1}{W}{U}", cardType: "creature" })).toEqual({
      pair: "wu",
      dress: "split",
      masterKey: "wu",
    });
    expect(resolveTwoColor(m15, on, { colors: ["green", "white"], cost: "{G/W}{G/W}", cardType: "creature" })?.masterKey).toBe("gw-h");
    const artifact = getFrameProfile("m15artifact");
    expect(resolveTwoColor(artifact, on, { colors: ["white", "blue"], cost: "{W/U}{W/U}", cardType: "artifact" })?.masterKey).toBe("wu");
    const land = getFrameProfile("m15land");
    expect(resolveTwoColor(land, on, { colors: ["white", "blue"], cost: null, cardType: "land" })?.masterKey).toBe("wu");
  });

  it("an overlay or pair masters can never come from an admin override (code-owned)", () => {
    expect(parseFrameProfileOverride({ overlays: [CROWN] })).toBeNull();
    expect(parseFrameProfileOverride({ twoColorMasters: ["split"] })).toBeNull();
  });
});

describe("an edit's switch flip (frame_anatomy)", () => {
  it("merges over the STORED frame_style, keeping every other key as stored", () => {
    // A legacy template draws the m15 frame: its two-colour switch is kept;
    // the crown (drawn by no template yet) is normalised away.
    expect(
      applyFrameAnatomyPatch({ frameStyle: { template: "regular", finish: "foil" }, colorIdentity: ["red"] }, { crown: true, twoColor: true }),
    ).toEqual({ ok: true, frameStyle: { template: "regular", finish: "foil", twoColor: true }, colorIdentity: null });
    expect(
      applyFrameAnatomyPatch({ frameStyle: { template: "m15snow", finish: "foil" }, colorIdentity: ["red"] }, { twoColor: true }),
    ).toEqual({ ok: true, frameStyle: { template: "m15snow", finish: "foil" }, colorIdentity: null });
  });

  it("stores a pair only as a refinement of a multicolour card; refuses one that would re-colour it", () => {
    expect(
      applyFrameAnatomyPatch({ frameStyle: { template: "m15" }, colorIdentity: ["multicolor"] }, { twoColor: true, pair: ["white", "blue"] }),
    ).toEqual({ ok: true, frameStyle: { template: "m15", twoColor: true }, colorIdentity: ["white", "blue"] });
    expect(
      applyFrameAnatomyPatch({ frameStyle: { template: "m15" }, colorIdentity: ["black"] }, { twoColor: true, pair: ["blue", "black"] }),
    ).toMatchObject({ ok: false });
    expect(
      applyFrameAnatomyPatch(
        { frameStyle: { template: "m15" }, colorIdentity: ["white", "blue", "black"] },
        { twoColor: true, pair: ["white", "blue"] },
      ),
    ).toMatchObject({ ok: false });
    // On a frame without pair masters the switch and the pair are ignored.
    expect(
      applyFrameAnatomyPatch({ frameStyle: { template: "m15snow" }, colorIdentity: ["multicolor"] }, { twoColor: true, pair: ["white", "blue"] }),
    ).toEqual({ ok: true, frameStyle: { template: "m15snow" }, colorIdentity: null });
  });
});

describe("imports follow the printing", () => {
  it("the switches take the printing's own values; the colour is the printing's pair where the frame draws pairs", () => {
    expect(
      importedAnatomy(
        { color_identity: ["multicolor"], color_pair: "wu", printed_crown: true, printed_two_color: true },
        "m15",
      ),
    ).toEqual({ style: { crown: true, twoColor: true }, colorIdentity: ["white", "blue"] });
    // m15snow draws no pair: the patch's own "multicolor" stays.
    expect(
      importedAnatomy({ color_identity: ["multicolor"], color_pair: "wu", printed_two_color: true }, "m15snow"),
    ).toEqual({ style: { twoColor: true }, colorIdentity: ["multicolor"] });
    expect(importedAnatomy({ color_identity: ["black"], printed_crown: false, printed_two_color: false }, "m15")).toEqual({
      style: { crown: false, twoColor: false },
      colorIdentity: ["black"],
    });
    expect(importedAnatomy({}, "m15")).toEqual({ style: {}, colorIdentity: undefined });
  });
});
