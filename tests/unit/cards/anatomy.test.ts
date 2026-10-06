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
  offersTwoColor,
  importedFormAnatomy,
  twoColorFits,
  crownKeyOf,
  crownedMasterKey,
} from "@/lib/cards/anatomy";
import { templateSupportsKind } from "@/lib/creator/card-kinds";
import { COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { M15_CROWN, getFrameProfile, type FrameOverlaySlot, type FrameProfile } from "@/lib/cards/template-layout";
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

type Anatomical = Pick<FrameProfile, "overlays" | "twoColorMasters" | "crownMasters">;
const m15Like: Anatomical = { overlays: [CROWN], twoColorMasters: ["split", "hybrid"] };
const artifactLike: Anatomical = { overlays: [{ ...CROWN, keyMap: { c: "a" } }], twoColorMasters: ["split"] };
const landLike: Anatomical = { overlays: [{ ...CROWN, keyMap: { c: "l" } }], twoColorMasters: ["split"] };
/** A 4.6f-shaped profile: the crown baked into `-legendary` masters. */
const borderlessLike: Anatomical = { crownMasters: true, twoColorMasters: ["split", "hybrid"] };

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

describe("the cards the two-colour frame is for (the creator's switch; 4.6 review 2026-09-29)", () => {
  /** A nonland card on m15, the frame with both dresses. */
  const ON_M15 = { template: "m15", cardType: "creature" } as const;

  it("a pair, or plain multicolor whose cost spans exactly two colours or none", () => {
    expect(offersTwoColor(["white", "blue"], null, ON_M15)).toBe(true);
    expect(offersTwoColor(["blue", "white", "multicolor"], "{W}{U}", ON_M15)).toBe(true);
    expect(offersTwoColor(["multicolor"], "{2}{B}{G}", ON_M15)).toBe(true);
    expect(offersTwoColor(["multicolor"], "{G/W}{G/W}", ON_M15)).toBe(true);
    expect(offersTwoColor(["multicolor"], null, ON_M15)).toBe(true);
    expect(offersTwoColor(["multicolor"], "—", ON_M15)).toBe(true);
    expect(offersTwoColor(["multicolor"], "{3}", ON_M15)).toBe(true);
  });

  it("never an identity with one or three-plus colour words, a multicolor card whose cost spans one or 3+ colours, or no multicolour at all", () => {
    expect(offersTwoColor(["white", "blue", "black"], "{W}{U}{B}", ON_M15)).toBe(false);
    expect(offersTwoColor(["white", "blue", "black"], "{W}{U}", ON_M15)).toBe(false);
    expect(offersTwoColor(["black"], "{3}{U}{B}", ON_M15)).toBe(false);
    expect(offersTwoColor(["red", "multicolor"], "{1}{R}{G}", ON_M15)).toBe(false);
    expect(offersTwoColor(["multicolor"], "{1}{W}{U}{B}", ON_M15)).toBe(false);
    expect(offersTwoColor(["multicolor"], "{G}{G}", ON_M15)).toBe(false);
    expect(offersTwoColor(["colorless"], null, ON_M15)).toBe(false);
    expect(offersTwoColor([], "{W}{U}", ON_M15)).toBe(false);
    expect(offersTwoColor(null, "{W}{U}", ON_M15)).toBe(false);
  });

  it("never a LAND on a nonland frame — only on the land frame (owner round 17, 2026-09-30)", () => {
    // Shadowwood Hollow / Sunfade Citadel: two-colour lands stored with no
    // template, drawn on m15 — m15's gold-split isn't a land's.
    // The dev seed's Duskmire Thicket (owner pick (c), 2026-09-30) stores
    // its pair the AI's way, with "multicolor" after the two words.
    for (const template of [undefined, null, "m15", "regular", "m15artifact"]) {
      expect(offersTwoColor(["black", "green"], null, { template, cardType: "land" }), String(template)).toBe(false);
      expect(offersTwoColor(["black", "green", "multicolor"], null, { template, cardType: "land" }), String(template)).toBe(false);
      expect(offersTwoColor(["multicolor"], null, { template, cardType: "land" }), String(template)).toBe(false);
    }
    expect(offersTwoColor(["black", "green"], null, { template: "m15land", cardType: "land" })).toBe(true);
    expect(offersTwoColor(["black", "green", "multicolor"], null, { template: "m15land", cardType: "land" })).toBe(true);
    expect(offersTwoColor(["multicolor"], null, { template: "m15land", cardType: "land" })).toBe(true);
    // The same pair on a nonland card keeps the switch on m15 and m15artifact.
    expect(offersTwoColor(["black", "green"], "{B}{G}", { template: undefined, cardType: "creature" })).toBe(true);
    expect(offersTwoColor(["black", "green"], "{B}{G}", { template: "m15artifact", cardType: "artifact" })).toBe(true);
    // A frame with no pair masters offers it to nobody (devoid: its
    // two-colour printings are the gold frame, owner round 20).
    expect(offersTwoColor(["black", "green"], "{B}{G}", { template: "m15devoid", cardType: "creature" })).toBe(false);
    // The snow frames offer it since 4.6f wave 2c — a LAND only on the
    // snow land frame.
    expect(offersTwoColor(["black", "green"], "{B}{G}", { template: "m15snow", cardType: "creature" })).toBe(true);
    expect(offersTwoColor(["black", "green"], null, { template: "m15snowland", cardType: "land" })).toBe(true);
    expect(offersTwoColor(["black", "green"], null, { template: "m15snow", cardType: "land" })).toBe(false);
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

describe("what the templates draw (4.6a: the crown; 4.6b: the pair masters; 4.6f: the borderless twins, the extended-art band, the snow band and pairs)", () => {
  /** The entries that draw the crown, in FRAME_TEMPLATE_VALUES order —
   *  since 5.1d the double-faced bodies with a printed legendary face too
   *  (every transform body but the ▼ land back; the modal spell pair). */
  const CROWNED = FRAME_TEMPLATE_VALUES.filter((t) =>
    [
      "m15", "m15land", "m15snowland", "m15artifact", "m15borderless", "m15borderlessartifact", "m15snow", "extendedart",
      "m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandfront", "m15mdfcfront", "m15mdfcback",
    ].includes(t),
  );
  /** …and the pair masters (extendedart draws none: a pair wears gold there;
   *  the transform land front none: no two-colour land face in print). */
  const PAIRED = CROWNED.filter((t): boolean => t !== "extendedart" && t !== "m15dfclandfront");

  it("the crown and the pair masters on exactly the m15, m15artifact, m15land, borderless, extended-art and snow PROFILES entries — never a profile that spreads them", () => {
    const crowned = FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).crown);
    expect(crowned).toEqual(CROWNED);
    // The extended-art frame draws its floating crown as a band (wave 2b)
    // and no pair masters.
    expect(frameAnatomyOf("extendedart")).toEqual({ crown: true, twoColor: [], collector: false, stamp: false, dfcIcon: false });
    const paired = Object.fromEntries(
      FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).twoColor.length > 0).map((t) => [t, frameAnatomyOf(t).twoColor]),
    );
    expect(paired).toEqual({
      m15: ["split", "hybrid"],
      m15land: ["split"],
      m15snowland: ["split"],
      m15artifact: ["split"],
      m15borderless: ["split", "hybrid"],
      m15borderlessartifact: ["split"],
      m15snow: ["split"],
      // The double-faced spell faces (5.1d): the split on every one — the
      // prints split a back's rings and box over its gold bars too — and the
      // hybrid dress on the modal front alone (MH3 #252–261); never the land
      // pair.
      m15dfcfront: ["split"],
      m15dfcback: ["split"],
      m15dfcbackleft: ["split"],
      m15mdfcfront: ["split", "hybrid"],
      m15mdfcback: ["split"],
    });
    // The borderless frames draw their crown from the crowned twins, not a
    // band (4.6f): no overlay slot, crownMasters set.
    for (const t of ["m15borderless", "m15borderlessartifact"]) {
      expect(getFrameProfile(t).overlays, t).toBeUndefined();
      expect(getFrameProfile(t).crownMasters, t).toBe(true);
    }
    // The snow pair (4.6f, wave 2c) draw the STANDARD band — the slot on
    // their entries, never on M15SNOW / M15SNOWLAND — with the colourless
    // card's crown the artifact silver on m15snow (its c master is CC's snow
    // artifact frame) and the land grey on m15snowland, as on m15land.
    // (Beside the holofoil stamp's notch since 4.9c: STAMP_TEMPLATES below.)
    expect(getFrameProfile("m15snow").overlays?.filter((slot) => slot.anatomy === "crown")).toEqual([{ ...M15_CROWN, keyMap: { c: "a" } }]);
    expect(getFrameProfile("m15snowland").overlays?.filter((slot) => slot.anatomy === "crown")).toEqual([{ ...M15_CROWN, keyMap: { c: "l" } }]);
    // Every profile that spreads M15 / M15LAND / M15BORDERLESS draws
    // neither: m15borderlessland spreads M15BORDERLESS (its pairs are
    // 4.56's), m15devoid (no crown and no pairs by the owner's round-20
    // call: its two-colour printings ARE the gold frame) / the layouts /
    // the showcases spread M15 (the layouts' crowns and pairs are 4.6f's);
    // planeswalkers and tokens none here.
    // (The collector line's slot — 4.9b — is on the devoid entry; the rest
    // draw none of the three. extendedart draws the crown alone, wave 2b:
    // checked above.)
    // (…and the holofoil stamp's notch, 4.9c, on the devoid entry too:
    // STAMP_TEMPLATES below.)
    expect(frameAnatomyOf("m15devoid")).toEqual({ crown: false, twoColor: [], collector: true, stamp: true, dfcIcon: false });
    for (const t of ["m15borderlessland", "adventure", "saga", "nyx", "fullart", "expeditionland"]) {
      expect(frameAnatomyOf(t), t).toEqual({ crown: false, twoColor: [], collector: false, stamp: false, dfcIcon: false });
    }
    for (const t of ["m15pw", "m15token"] as const) {
      expect(frameAnatomyOf(t).crown, t).toBe(false);
    }
    // A legacy template draws the m15 frame, so it draws m15's crown and pairs.
    expect(frameAnatomyOf("regular")).toEqual(frameAnatomyOf("m15"));
  });

  /** The entries with the holofoil stamp's notch (4.9c, wave 1). */
  const STAMP_TEMPLATES = ["m15", "m15land", "m15snowland", "m15artifact", "m15snow", "m15devoid", "m15pw"];

  it("the stamp's notch on exactly the seven wave-1 entries (4.9c): the M15 family's bordered frames and the walker, never a token, an emblem or a profile that spreads them", () => {
    expect(FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).stamp)).toEqual(FRAME_TEMPLATE_VALUES.filter((t) => STAMP_TEMPLATES.includes(t)));
    for (const t of ["m15token", "m15tokenartifact", "m15tokentext", "m15tokenartifacttext", "emblem", "m15borderless", "extendedart", "adventure"]) {
      expect(frameAnatomyOf(t).stamp, t).toBe(false);
    }
  });

  it("a save keeps each switch only where the template draws it; a new card starts with each drawn switch on", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const crown = CROWNED.includes(template);
      const pair = PAIRED.includes(template);
      // The collector line's keys (4.9b) ride the same rule on the slotted
      // templates, the stamp's (4.9c) on the notched ones.
      const line = (COLLECTOR_TEMPLATES as readonly string[]).includes(template) ? { collector: "2023" as const } : {};
      const stamp = STAMP_TEMPLATES.includes(template) ? { stamp: "auto" as const } : {};
      // …and the transform icon family's default (`arrows`, TODO 5.2) on the
      // two transform FRONT bodies, the templates that draw it.
      const family = template === "m15dfcfront" || template === "m15dfclandfront" ? { dfcIcon: "arrows" as const } : {};
      expect(anatomyDefaults(template), template).toEqual({ ...(crown ? { crown: true } : {}), ...(pair ? { twoColor: true } : {}), ...line, ...stamp, ...family });
      expect(normalizeAnatomy({ template, finish: "foil", crown: true, twoColor: false, stamp: "oval" }, template, "creature"), template).toEqual({
        template,
        finish: "foil",
        ...(crown ? { crown: true } : {}),
        ...(pair ? { twoColor: false } : {}),
        ...(STAMP_TEMPLATES.includes(template) ? { stamp: "oval" } : {}),
      });
      expect(newCardFrameStyle({ template, finish: "regular", ...NEW_CARD_ANATOMY }, "creature"), template).toEqual({
        template,
        finish: "regular",
        ...(crown ? { crown: true } : {}),
        ...(pair ? { twoColor: true } : {}),
        ...line,
        ...stamp,
        ...family,
      });
    }
    // The AI jobs send no frame_style: the default template (m15) draws both.
    expect(newCardFrameStyle({}, "creature")).toEqual({ crown: true, twoColor: true, collector: "2023", stamp: "auto" });
    // A stored card names no switch: nothing to drop, the same object back.
    const untouched: FrameStyle = { template: "m15", finish: "regular" };
    expect(normalizeAnatomy(untouched, "m15", "creature")).toBe(untouched);
    expect(normalizeAnatomy(untouched, "m15devoid", "creature")).toBe(untouched);
    const off: FrameStyle = { template: "m15", finish: "regular", crown: false };
    expect(normalizeAnatomy(off, "m15", "creature")).toBe(off);
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

  it("an overlay, pair masters or crowned twins can never come from an admin override (code-owned)", () => {
    expect(parseFrameProfileOverride({ overlays: [CROWN] })).toBeNull();
    expect(parseFrameProfileOverride({ twoColorMasters: ["split"] })).toBeNull();
    expect(parseFrameProfileOverride({ crownMasters: true })).toBeNull();
  });
});

describe("a crown baked into the masters (4.6f: FrameProfile.crownMasters)", () => {
  const legend = { cardType: "creature", supertype: "Legendary Creature" };
  const on = { crown: true };

  it("counts as the crown the template draws — the switch, the hint, the default and the registry gap read it", () => {
    expect(frameAnatomyOf("m15borderless").crown).toBe(true);
    expect(anatomyDefaults("m15borderless")).toEqual({ crown: true, twoColor: true });
    expect(normalizeAnatomy({ template: "m15borderless", crown: true, twoColor: true }, "m15borderless", "creature")).toEqual({
      template: "m15borderless",
      crown: true,
      twoColor: true,
    });
  });

  it("paints the crowned twin only with the switch exactly on and a qualifying card; else the master as given", () => {
    expect(crownedMasterKey(borderlessLike, on, legend, "w")).toBe("w-legendary");
    expect(crownedMasterKey(borderlessLike, on, legend, "wu")).toBe("wu-legendary");
    expect(crownedMasterKey(borderlessLike, on, legend, "wu-h")).toBe("wu-h-legendary");
    expect(crownedMasterKey(borderlessLike, { crown: false }, legend, "w")).toBe("w");
    expect(crownedMasterKey(borderlessLike, {}, legend, "w")).toBe("w");
    expect(crownedMasterKey(borderlessLike, null, legend, "w")).toBe("w");
    expect(crownedMasterKey(borderlessLike, on, { cardType: "creature", supertype: null }, "w")).toBe("w");
    expect(crownedMasterKey(borderlessLike, on, { cardType: "planeswalker", supertype: "Legendary" }, "w")).toBe("w");
    expect(crownedMasterKey(borderlessLike, on, { cardType: "token", supertype: "Legendary Creature" }, "w")).toBe("w");
    // A profile whose crown is a band (or none) paints the master as given.
    expect(crownedMasterKey(m15Like, on, legend, "w")).toBe("w");
    expect(crownedMasterKey({}, on, legend, "w")).toBe("w");
  });

  it("crownKeyOf names the twin's key: the colour, the pair where the two-colour frame is drawn, 'c' on either borderless dress", () => {
    const facts = (colors: ColorIdentity[], cost: string | null, colorKey: string) => ({ ...legend, colors, cost, colorKey });
    expect(crownKeyOf(borderlessLike, on, facts(["white"], "{2}{W}", "w"))).toBe("w");
    expect(crownKeyOf(borderlessLike, on, facts(["white", "blue", "black"], "{W}{U}{B}", "m"))).toBe("m");
    expect(crownKeyOf(borderlessLike, on, facts(["colorless"], "{10}", "c"))).toBe("c");
    // A pair drawn gold (two-colour off) keeps the gold crown; drawn as a
    // pair, the pair's — in either dress.
    expect(crownKeyOf(borderlessLike, on, facts(["white", "blue"], "{1}{W}{U}", "m"))).toBe("m");
    expect(crownKeyOf(borderlessLike, { crown: true, twoColor: true }, facts(["white", "blue"], "{1}{W}{U}", "m"))).toBe("wu");
    expect(crownKeyOf(borderlessLike, { crown: true, twoColor: true }, facts(["white", "blue"], "{W/U}{W/U}", "m"))).toBe("wu");
    expect(crownKeyOf(borderlessLike, { crown: false }, facts(["white"], "{2}{W}", "w"))).toBeNull();
    expect(crownKeyOf(borderlessLike, on, { ...facts(["white"], "{2}{W}", "w"), supertype: null })).toBeNull();
    // The band's key on a band profile (resolveFrameOverlays), as before.
    expect(crownKeyOf(m15Like, on, facts(["white"], "{2}{W}", "w"))).toBe("w");
    expect(crownKeyOf(artifactLike, on, facts(["colorless"], "{3}", "c"))).toBe("a");
    expect(crownKeyOf({}, on, facts(["white"], "{2}{W}", "w"))).toBeNull();
    // On the real profiles: no overlay band on the borderless frames.
    expect(resolveFrameOverlays(getFrameProfile("m15borderless"), on, facts(["white"], "{2}{W}", "w"))).toEqual([]);
    expect(crownKeyOf(getFrameProfile("m15borderless"), on, facts(["white"], "{2}{W}", "w"))).toBe("w");
    expect(crownKeyOf(getFrameProfile("m15borderlessartifact"), on, { ...facts(["colorless"], "{3}", "c"), cardType: "artifact" })).toBe("c");
  });
});

describe("an edit's switch flip (frame_anatomy)", () => {
  it("merges over the STORED frame_style, keeping every other key as stored", () => {
    // A legacy template draws the m15 frame: both switches are kept, the
    // template is never rewritten.
    expect(
      applyFrameAnatomyPatch({ frameStyle: { template: "regular", finish: "foil" }, colorIdentity: ["red"], cardType: "creature" }, { crown: true, twoColor: true }),
    ).toEqual({ ok: true, frameStyle: { template: "regular", finish: "foil", crown: true, twoColor: true }, colorIdentity: null });
    // A frame that draws neither drops both switches.
    expect(
      applyFrameAnatomyPatch({ frameStyle: { template: "m15devoid", finish: "foil" }, colorIdentity: ["red"], cardType: "creature" }, { crown: true, twoColor: true }),
    ).toEqual({ ok: true, frameStyle: { template: "m15devoid", finish: "foil" }, colorIdentity: null });
  });

  it("stores a pair only as a refinement of a multicolour card; refuses one that would re-colour it", () => {
    expect(
      applyFrameAnatomyPatch({ frameStyle: { template: "m15" }, colorIdentity: ["multicolor"], cardType: "creature" }, { twoColor: true, pair: ["white", "blue"] }),
    ).toEqual({ ok: true, frameStyle: { template: "m15", twoColor: true }, colorIdentity: ["white", "blue"] });
    expect(
      applyFrameAnatomyPatch({ frameStyle: { template: "m15" }, colorIdentity: ["black"], cardType: "creature" }, { twoColor: true, pair: ["blue", "black"] }),
    ).toMatchObject({ ok: false });
    expect(
      applyFrameAnatomyPatch(
        { frameStyle: { template: "m15" }, colorIdentity: ["white", "blue", "black"], cardType: "creature" },
        { twoColor: true, pair: ["white", "blue"] },
      ),
    ).toMatchObject({ ok: false });
    // On a frame without pair masters the switch and the pair are ignored.
    expect(
      applyFrameAnatomyPatch({ frameStyle: { template: "m15devoid" }, colorIdentity: ["multicolor"], cardType: "creature" }, { twoColor: true, pair: ["white", "blue"] }),
    ).toEqual({ ok: true, frameStyle: { template: "m15devoid" }, colorIdentity: null });
  });
});

describe("imports follow the printing — printing-only (owner round 17, 2026-09-30)", () => {
  it("the switches take the printing's own values; the colour is the printing's pair where the frame draws pairs", () => {
    expect(
      importedAnatomy(
        { color_identity: ["multicolor"], color_pair: "wu", printed_crown: true, printed_two_color: true },
        "m15",
      ),
    ).toEqual({ style: { crown: true, twoColor: true }, colorIdentity: ["white", "blue"] });
    // m15devoid draws no pair: the patch's own "multicolor" stays.
    expect(
      importedAnatomy({ color_identity: ["multicolor"], color_pair: "wu", printed_two_color: true }, "m15devoid"),
    ).toEqual({ style: { twoColor: true }, colorIdentity: ["multicolor"] });
    // A crownless Legendary printing (or a showcase) says false.
    expect(importedAnatomy({ color_identity: ["black"], printed_crown: false }, "m15")).toEqual({
      style: { crown: false },
      colorIdentity: ["black"],
    });
    expect(importedAnatomy({}, "m15")).toEqual({ style: {}, colorIdentity: undefined });
  });

  it("names no two-colour switch, and stores no pair, for a printing that isn't two-coloured", () => {
    // Azorius Charm RTR #145: two colours on the 2003 frame (gold) — the
    // pair is a fact of the card, but the printing isn't two-coloured.
    expect(importedAnatomy({ color_identity: ["multicolor"], color_pair: "wu" }, "m15")).toEqual({
      style: {},
      colorIdentity: ["multicolor"],
    });
    expect(importedAnatomy({ color_identity: ["black"] }, "m15")).toEqual({ style: {}, colorIdentity: ["black"] });
  });

  it("a switch the printing names none for takes the new-card default at the save", () => {
    const style = importedAnatomy({ color_identity: ["black"] }, "m15").style;
    expect(newCardFrameStyle({ template: "m15", ...style }, "creature")).toEqual({ template: "m15", crown: true, twoColor: true, collector: "2023", stamp: "auto" });
    // The creator's form holds the same: the printing's switch, else on.
    expect(importedFormAnatomy(style)).toEqual(NEW_CARD_ANATOMY);
    expect(importedFormAnatomy({ crown: false })).toEqual({ crown: false, twoColor: true, collector: "2023", stamp: "auto" });
    expect(importedFormAnatomy({ crown: true, twoColor: true })).toEqual({ crown: true, twoColor: true, collector: "2023", stamp: "auto" });
    // The stamp a printing names (4.9c) rides through: "none" stays "none".
    expect(importedFormAnatomy({ stamp: "none" })).toEqual({ crown: true, twoColor: true, collector: "2023", stamp: "none" });
    expect(importedAnatomy({ color_identity: ["black"], printed_stamp: "triangle" }, "m15").style).toEqual({ stamp: "triangle" });
  });
});

describe("a LAND wears the two-colour frame only on a land frame (owner round 17, 2026-09-30)", () => {
  const landPair = { colors: ["black", "green"] as ColorIdentity[], cost: null, cardType: "land" };

  it("the renderers draw no pair master for a land on m15 or m15artifact — the land frame's only", () => {
    const on = { twoColor: true };
    expect(resolveTwoColor(getFrameProfile("m15"), on, landPair)).toBeNull();
    expect(resolveTwoColor(getFrameProfile("m15artifact"), on, landPair)).toBeNull();
    expect(resolveTwoColor(getFrameProfile("m15land"), on, landPair)?.masterKey).toBe("bg");
    // A crowned land on m15 then wears the gold crown, as its gold frame.
    expect(
      resolveFrameOverlays(getFrameProfile("m15"), { crown: true, twoColor: true }, { ...landPair, supertype: "Legendary", colorKey: "m" }).map(
        (o) => o.key,
      ),
    ).toEqual(["m"]);
  });

  it("the save drops the switch — true or false — for a land on a nonland frame, whatever the payload says", () => {
    // "regular" is a legacy template the renderers draw as m15.
    for (const template of ["m15", "m15artifact", undefined, "regular"] as (FrameStyle["template"] | undefined)[]) {
      expect(normalizeAnatomy({ template, crown: true, twoColor: true }, template, "land"), String(template)).toEqual({
        template,
        crown: true,
      });
      expect(normalizeAnatomy({ template, twoColor: false }, template, "land"), String(template)).toEqual({ template });
      expect(newCardFrameStyle({ template, ...NEW_CARD_ANATOMY }, "land"), String(template)).toEqual({ template, crown: true, collector: "2023", stamp: "auto" });
    }
    expect(normalizeAnatomy({ template: "m15land", twoColor: true }, "m15land", "land")).toEqual({
      template: "m15land",
      twoColor: true,
    });
    // A nonland card keeps it on m15.
    expect(normalizeAnatomy({ template: "m15", twoColor: true }, "m15", "creature")).toEqual({ template: "m15", twoColor: true });
  });

  it("an edit's crafted flip for a land on m15 is dropped, and its pair ignored (Shadowwood Hollow)", () => {
    expect(
      applyFrameAnatomyPatch(
        { frameStyle: { finish: "regular" }, colorIdentity: ["black", "green"], cardType: "land" },
        { twoColor: true },
      ),
    ).toEqual({ ok: true, frameStyle: { finish: "regular" }, colorIdentity: null });
    expect(
      applyFrameAnatomyPatch(
        { frameStyle: { template: "m15" }, colorIdentity: ["multicolor"], cardType: "land" },
        { twoColor: true, pair: ["black", "green"] },
      ),
    ).toEqual({ ok: true, frameStyle: { template: "m15" }, colorIdentity: null });
    // On the land frame the flip is kept.
    expect(
      applyFrameAnatomyPatch(
        { frameStyle: { template: "m15land" }, colorIdentity: ["black", "green"], cardType: "land" },
        { twoColor: true },
      ),
    ).toEqual({ ok: true, frameStyle: { template: "m15land", twoColor: true }, colorIdentity: null });
  });

  it("the land frames are exactly the pair templates a land can wear (twoColorForLands ⇔ the land kind's gallery)", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const profile = getFrameProfile(template);
      if ((profile.twoColorMasters ?? []).length === 0) {
        expect(profile.twoColorForLands, template).toBeUndefined();
        continue;
      }
      expect(twoColorFits(profile, "land"), template).toBe(templateSupportsKind(template, "land"));
      expect(twoColorFits(profile, "creature"), template).toBe(true);
    }
    expect(FRAME_TEMPLATE_VALUES.filter((t) => getFrameProfile(t).twoColorForLands === true)).toEqual(["m15land", "m15snowland"]);
    expect(parseFrameProfileOverride({ twoColorForLands: true })).toBeNull();
  });
});
