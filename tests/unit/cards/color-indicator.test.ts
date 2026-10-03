import { describe, expect, it } from "vitest";
import {
  COLOR_INDICATOR,
  COLOR_INDICATOR_FILLS,
  COLOR_INDICATOR_VIEW,
  colorIndicatorBox,
  colorIndicatorFillRadius,
  colorIndicatorFills,
  colorIndicatorOutlineRadius,
  colorIndicatorWedges,
  drawsColorIndicator,
  typeRectWithIndicator,
} from "@/lib/cards/color-indicator";
import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { backPreviewData, frontPreviewData } from "@/lib/cards/faces";
import { getFrameProfile } from "@/lib/cards/template-layout";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// TODO 5.1a — lib/cards/color-indicator.ts, the ONE module both renderers
// draw the dot from (4.6c reuses it as a switch on ordinary cards): the
// geometry 4.6c measured (Ø 3.5 %W at 9.3 / 59.0 %, the type line from
// 13.4 %W), the fills in the PRINTED order (the mana cost's: {G}{W} green
// first, as MOM #43's green-white back prints — WUBRG would put white
// first, which the scan refutes), one disc / two halves on the diagonal
// (the first colour top-left) / wedges from the top, and which
// identities draw it on a body that declares `indicator: "coloured"`. And
// the icon rider's resolution from a face's `dfc` block (never the
// `dfcIcon` switch, which is off for an absent key while the family is
// `arrows` — lib/cards/anatomy.ts resolveFrameOverlays).
// ---------------------------------------------------------------------------

describe("the colour indicator (TODO 5.1a)", () => {
  it("geometry: 4.6c's measurement, the box square in card-width units", () => {
    expect(COLOR_INDICATOR).toMatchObject({ diameterPct: 3.5, centre: { xPct: 9.3, yPct: 59.0 }, typeLeftPct: 13.4 });
    const box = colorIndicatorBox();
    expect(box.leftPct + box.widthPct / 2).toBeCloseTo(9.3, 9);
    expect(box.topPct + box.heightPct / 2).toBeCloseTo(59.0, 9);
    expect(box.widthPct).toBeCloseTo(3.5 + 2 * COLOR_INDICATOR.outlinePct, 9);
    // Square on the 5:7 card: the height in %H is the width in %W × 5 / 7.
    expect(box.heightPct).toBeCloseTo(box.widthPct * (5 / 7), 9);
    expect(colorIndicatorOutlineRadius()).toBe(COLOR_INDICATOR_VIEW / 2);
    expect(colorIndicatorFillRadius()).toBeLessThan(colorIndicatorOutlineRadius());
    expect(colorIndicatorFillRadius() / colorIndicatorOutlineRadius()).toBeCloseTo(3.5 / (3.5 + 0.6), 9);
  });

  it("fills: the mana cost's printed order, the standard mana colours; none for colourless or a word-less identity", () => {
    const F = COLOR_INDICATOR_FILLS;
    expect(colorIndicatorFills(["blue"])).toEqual([F.blue]);
    // MOM #43 Burnished Dunestomper (green-white): green top-left, as the
    // scan shows and as {G}{W} prints — whatever order the identity holds.
    expect(colorIndicatorFills(["green", "white"])).toEqual([F.green, F.white]);
    expect(colorIndicatorFills(["white", "green"])).toEqual([F.green, F.white]);
    // The other guild pairs whose printed order isn't WUBRG's.
    expect(colorIndicatorFills(["white", "red"])).toEqual([F.red, F.white]);
    expect(colorIndicatorFills(["blue", "green"])).toEqual([F.green, F.blue]);
    // Ally pairs and WB / UR / BG read as WUBRG does.
    expect(colorIndicatorFills(["blue", "white"])).toEqual([F.white, F.blue]);
    expect(colorIndicatorFills(["black", "white"])).toEqual([F.white, F.black]);
    expect(colorIndicatorFills(["green", "black"])).toEqual([F.black, F.green]);
    // Shards and wedges: Grixis {U}{B}{R}, Naya {R}{G}{W}, Mardu {R}{W}{B}.
    expect(colorIndicatorFills(["black", "red", "blue", "multicolor"])).toEqual([F.blue, F.black, F.red]);
    expect(colorIndicatorFills(["white", "red", "green"])).toEqual([F.red, F.green, F.white]);
    expect(colorIndicatorFills(["white", "black", "red"])).toEqual([F.red, F.white, F.black]);
    expect(colorIndicatorFills(["white", "blue", "black", "red", "green"])).toEqual([F.white, F.blue, F.black, F.red, F.green]);
    expect(colorIndicatorFills(["colorless"])).toEqual([]);
    expect(colorIndicatorFills(["multicolor"])).toEqual([]);
    expect(colorIndicatorFills([])).toEqual([]);
    expect(colorIndicatorFills(null)).toEqual([]);
    expect(COLOR_INDICATOR_FILLS.blue).toBe("#0e68ab");
  });

  it("drawsColorIndicator: a body that declares it, for a coloured identity only", () => {
    expect(drawsColorIndicator("coloured", ["blue"])).toBe(true);
    expect(drawsColorIndicator("coloured", ["white", "green"])).toBe(true);
    expect(drawsColorIndicator("coloured", ["colorless"])).toBe(false);
    expect(drawsColorIndicator("coloured", ["multicolor"])).toBe(false);
    expect(drawsColorIndicator(undefined, ["blue"])).toBe(false);
    // The two coloured back bodies declare it; the land back, the fronts and
    // every other template don't.
    expect(getFrameProfile("m15dfcback").indicator).toBe("coloured");
    expect(getFrameProfile("m15dfcbackleft").indicator).toBe("coloured");
    for (const t of ["m15dfclandback", "m15dfcfront", "m15dfclandfront", "m15", "m15artifact", "emblem"]) expect(getFrameProfile(t).indicator, t).toBeUndefined();
  });

  it("wedges: one disc, two halves on the top-right → bottom-left diagonal (the first colour top-left), else equal wedges from the top, clockwise", () => {
    expect(colorIndicatorWedges([])).toEqual([]);
    const one = colorIndicatorWedges(["#111"]);
    expect(one).toHaveLength(1);
    expect(one[0].fill).toBe("#111");
    expect(one[0].d).toMatch(/^M .* A .* Z$/);
    const two = colorIndicatorWedges(["#aaa", "#bbb"]);
    expect(two.map((w) => w.fill)).toEqual(["#aaa", "#bbb"]);
    const c = COLOR_INDICATOR_VIEW / 2;
    const k = colorIndicatorFillRadius() * Math.SQRT1_2;
    // The first half runs from the top-right point to the bottom-left one
    // the long way round the TOP-LEFT (sweep 0 = counter-clockwise).
    expect(two[0].d).toBe(`M ${c + k} ${c - k} A ${colorIndicatorFillRadius()} ${colorIndicatorFillRadius()} 0 0 0 ${c - k} ${c + k} Z`);
    expect(two[1].d).toBe(`M ${c - k} ${c + k} A ${colorIndicatorFillRadius()} ${colorIndicatorFillRadius()} 0 0 0 ${c + k} ${c - k} Z`);
    const three = colorIndicatorWedges(["a", "b", "c"]);
    expect(three).toHaveLength(3);
    // Each wedge starts at the centre; the first from the top (12 o'clock).
    for (const w of three) expect(w.d.startsWith(`M ${c} ${c} L `)).toBe(true);
    expect(three[0].d).toContain(`L ${c.toFixed(3)} ${(c - colorIndicatorFillRadius()).toFixed(3)} A`);
    expect(colorIndicatorWedges(["a", "b", "c", "d", "e"])).toHaveLength(5);
  });

  it("typeRectWithIndicator: the left edge to 13.4 %W, the right edge kept", () => {
    const m15 = getFrameProfile("m15").type.rect;
    const indented = typeRectWithIndicator(m15);
    expect(indented.leftPct).toBe(13.4);
    expect(indented.leftPct + indented.widthPct).toBeCloseTo(m15.leftPct + m15.widthPct, 9);
    expect(indented.topPct).toBe(m15.topPct);
    expect(indented.heightPct).toBe(m15.heightPct);
  });
});

const card = (over: Partial<CardPreviewData> = {}, back: Record<string, unknown> | null = {}): CardPreviewData =>
  ({
    title: "Delver of Secrets",
    cost: "{U}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Human", "Wizard"],
    rarity: "common",
    colorIdentity: ["blue"],
    rulesText: "Flying",
    flavorText: null,
    power: "1",
    toughness: "1",
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15dfcfront", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace:
      back === null
        ? null
        : {
            title: "Insectile Aberration",
            cost: "",
            card_type: "creature",
            subtypes: ["Human", "Insect"],
            rules_text: "Flying",
            power: "3",
            toughness: "2",
            frame_style: { template: "m15dfcback" },
            color_identity: ["blue"],
            ...back,
          },
    faceContent: null,
    watermark: null,
    ...over,
  }) as unknown as CardPreviewData;

describe("the icon rider resolves from the face's dfc block, never from the dfcIcon switch (TODO 5.1a)", () => {
  const facts = (c: CardPreviewData) => ({ colors: c.colorIdentity, cost: c.cost, cardType: c.cardType, supertype: c.supertype, dfc: c.dfc ? { role: c.dfc.role, icon: c.dfc.icon } : null, colorKey: "u" });

  it("an absent key draws the arrows' front glyph on the front; the family picks the glyph; the role is the BODY's", () => {
    const front = frontPreviewData(card());
    expect(front.dfc?.icon).toBe("arrows");
    expect(resolveFrameOverlays(getFrameProfile("m15dfcfront"), front.frameStyle, facts(front))).toEqual([
      { anatomy: "dfcIcon", rect: getFrameProfile("m15dfcfront").overlays![0].rect, key: "default", path: "/frames/dfcicon/default.png" },
    ]);
    const sun = frontPreviewData(card({ frameStyle: { template: "m15dfcfront", finish: "regular", dfcIcon: "sunmoon" } }));
    expect(resolveFrameOverlays(getFrameProfile("m15dfcfront"), sun.frameStyle, facts(sun)).map((o) => o.key)).toEqual(["sun"]);
    // The 2016–22 back draws the family's BACK glyph: the body's role, not
    // the block's alone.
    const back = backPreviewData(card({ frameStyle: { template: "m15dfcfront", finish: "regular", dfcIcon: "sunmoon" } }, { frame_style: { template: "m15dfcbackleft" } }))!;
    expect(back.dfc?.role).toBe("back");
    expect(resolveFrameOverlays(getFrameProfile("m15dfcbackleft"), back.frameStyle, facts(back)).map((o) => o.key)).toEqual(["moon"]);
    for (const [family, glyph] of [["moon", "emrakul"], ["compass", "land"], ["fan", "fanopen"]] as const) {
      const b = backPreviewData(card({ frameStyle: { template: "m15dfcfront", finish: "regular", dfcIcon: family } }, { frame_style: { template: "m15dfcbackleft" } }))!;
      expect(resolveFrameOverlays(getFrameProfile("m15dfcbackleft"), b.frameStyle, facts(b)).map((o) => o.key), family).toEqual([glyph]);
    }
    // The ▼ back has no slot.
    const right = backPreviewData(card())!;
    expect(resolveFrameOverlays(getFrameProfile("m15dfcback"), right.frameStyle, facts(right))).toEqual([]);
  });

  it("no block (a front with no back face, a plain card) draws no rider — and the switch alone never does", () => {
    const alone = frontPreviewData(card({}, null));
    expect(alone.dfc).toBeUndefined();
    expect(resolveFrameOverlays(getFrameProfile("m15dfcfront"), alone.frameStyle, facts(alone))).toEqual([]);
    // A stored family with no block: nothing (the block is the one source).
    expect(resolveFrameOverlays(getFrameProfile("m15dfcfront"), { dfcIcon: "sunmoon" }, { colors: ["blue"], colorKey: "u" })).toEqual([]);
    // A plain card never draws the rider, block or not.
    const plain = frontPreviewData(card());
    expect(resolveFrameOverlays(getFrameProfile("m15"), { crown: true }, facts(plain)).map((o) => o.anatomy)).not.toContain("dfcIcon");
  });

  it("the front body's crown is never drawn (no overlay, no masters: design D17), whatever the switch", () => {
    const legend = frontPreviewData(card({ supertype: "Legendary", frameStyle: { template: "m15dfcfront", finish: "regular", crown: true } }));
    expect(resolveFrameOverlays(getFrameProfile("m15dfcfront"), legend.frameStyle, facts(legend)).map((o) => o.anatomy)).toEqual(["dfcIcon"]);
  });
});
