import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { backPreviewData, frontPreviewData } from "@/lib/cards/faces";
import { MDFC_FLIPSIDE_FRONT, getFrameProfile } from "@/lib/cards/template-layout";
import { frameAssetPathsFor } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// TODO 5.1b on REAL bakes, at HD and at the 750 px default: the modal
// bodies draw the flipside strip's two texts from the OTHER face — its last
// type word in Beleren Bold from the strip box's left edge (the prints' ink
// from 103–110 px, capitals 35–36 px tall) and its cost or mana line as an
// inline-pip run ending at the box's right edge (the prints' last ink at
// 647–650 px) — white on a front, dark on a back; the name from the icon
// face's inset on both faces; a cost on a back (hideCost off); no cost and
// no P/T on the land pair; no reverse P/T, no rider, no indicator on any
// modal face. The masters live in the frames bucket (never in git): the
// bake is served a flat mid-grey card and a dark plate, so the text is the
// only mark on it. frameAssetPathsFor lists the dark plate for a creature
// back and nothing for the land pair. The preview half:
// tests/unit/components/mdfc-bodies-preview.test.tsx.
// ---------------------------------------------------------------------------

const stand = vi.hoisted(() => ({ grey: "", plate: "", black: "" }));

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async () => {},
    preloadFrameAssets: async () => {},
    getFrameDataUrl: () => stand.grey,
    getPlateDataUrlForPath: () => stand.plate,
    getFrameOverlayDataUrl: () => null,
    getFrameAssetDataUrl: () => null,
  };
});

const BG = 128;

async function solid(v: number, w = 16, h = 16): Promise<string> {
  const png = await sharp({ create: { width: w, height: h, channels: 4, background: { r: v, g: v, b: v, alpha: 1 } } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

beforeAll(async () => {
  stand.grey = await solid(BG);
  stand.plate = await solid(40, 64, 32);
  stand.black = await solid(0);
});

type Back = {
  title: string;
  cost: string;
  card_type: "creature" | "artifact" | "enchantment" | "land" | "instant" | "sorcery" | "planeswalker";
  supertype: string | null;
  subtypes: string[];
  rules_text: string;
  power: string | null;
  toughness: string | null;
  frame_style: { template: "m15mdfcback" | "m15mdfclandback" };
  color_identity: ("white" | "blue" | "black" | "red" | "green" | "colorless")[];
};
/** MH3 #241's land back (Soporific Springs). */
const LAND_BACK: Back = {
  title: "Soporific Springs",
  cost: "",
  card_type: "land",
  supertype: null,
  subtypes: [],
  rules_text: "As Soporific Springs enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {U}.",
  power: null,
  toughness: null,
  frame_style: { template: "m15mdfclandback" },
  color_identity: ["blue"],
};
/** STX #147's sorcery back (Echoing Equation), a cost of its own. */
const SPELL_BACK: Back = {
  title: "Echoing Equation",
  cost: "{3}{U}{U}",
  card_type: "sorcery",
  supertype: null,
  subtypes: [],
  rules_text: "Choose target creature you control.",
  power: null,
  toughness: null,
  frame_style: { template: "m15mdfcback" },
  color_identity: ["blue"],
};

function modal(over: Partial<CardPreviewData> = {}, back: Partial<Back> | null = {}): CardPreviewData {
  return {
    title: "HHHH",
    cost: "{2}{U}",
    cardType: "instant",
    supertype: null,
    subtypes: [],
    rarity: "common",
    colorIdentity: ["blue"],
    rulesText: "Return target spell to its owner's hand.",
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15mdfcfront", finish: "regular" },
    setIconUrl: stand.black,
    setIconCode: null,
    backFace: back === null ? null : { ...LAND_BACK, ...back },
    faceContent: null,
    watermark: null,
    ...over,
  } as unknown as CardPreviewData;
}

type Baked = { rgb: Buffer; lum: Float32Array; w: number; h: number };

async function bake(card: CardPreviewData, preset: "hd" | "default"): Promise<Baked> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const png = Buffer.from(await (await renderCardImage(card, preset, { brandMark: false, watermarkText: null })).arrayBuffer());
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = new Float32Array(info.width * info.height);
  for (let i = 0; i < lum.length; i += 1) lum[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
  return { rgb: data, lum, w: info.width, h: info.height };
}

type Box = { x0: number; y0: number; x1: number; y1: number };

function inkBox(b: Baked, area: Box, hit: (l: number, i: number) => boolean): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = Math.max(0, Math.floor(area.y0)); y < Math.min(b.h, area.y1); y += 1) {
    for (let x = Math.max(0, Math.floor(area.x0)); x < Math.min(b.w, area.x1); x += 1) {
      const i = y * b.w + x;
      if (!hit(b.lum[i], i)) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

const dark = (l: number) => l < 60;
const white = (l: number) => l > 200;
/** Any mark on the mid-grey card: text ink of either colour and a pip's
 *  disc (a blue disc's fill is luma ≈ 84, neither dark nor white). */
const mark = (l: number) => Math.abs(l - BG) > 40;

const PRESETS = [
  ["hd", 1],
  ["default", 0.5],
] as const;

/** The strip's box (CC's 6.8 / 89.2 / 36.4 × 3.91 %) at the bake's scale,
 *  padded a few px for the glyphs' overhang. */
const strip = (s: number): Box => {
  const r = MDFC_FLIPSIDE_FRONT.word.rect;
  return { x0: (r.leftPct / 100) * 1500 * s - 6 * s, x1: ((r.leftPct + r.widthPct) / 100) * 1500 * s + 6 * s, y0: (r.topPct / 100) * 2100 * s - 8 * s, y1: ((r.topPct + r.heightPct) / 100) * 2100 * s + 8 * s };
};
/** The strip split where the word ends and the line starts: the word's
 *  columns (left third) and the line's (the right half). */
const WORD_END = 330;
const LINE_START = 380;

describe("the modal bodies on real bakes (TODO 5.1b)", () => {
  it("frameAssetPathsFor: no rider on any modal face; M15's plate on a creature front, the dark plate on a creature back, nothing on a spell or land face", () => {
    const front = frontPreviewData(modal({ cardType: "creature", subtypes: ["Human"], power: "2", toughness: "2" }));
    expect(frameAssetPathsFor(front)).toEqual(["/frames/m15/pt/u.png"]);
    expect(frameAssetPathsFor(frontPreviewData(modal()))).toEqual([]);
    const creatureBack = backPreviewData(modal({}, { ...SPELL_BACK, card_type: "creature", subtypes: ["Bird"], power: "3", toughness: "4" }))!;
    expect(frameAssetPathsFor(creatureBack)).toEqual(["/frames/m15dfcback/pt/u.png"]);
    expect(frameAssetPathsFor(backPreviewData(modal({}, SPELL_BACK))!)).toEqual([]);
    expect(frameAssetPathsFor(backPreviewData(modal())!)).toEqual([]);
    const landFront = frontPreviewData(modal({ frameStyle: { template: "m15mdfclandfront", finish: "regular" }, cardType: "land", cost: null, rulesText: "{T}: Add {U}." }));
    expect(frameAssetPathsFor(landFront)).toEqual([]);
  });

  it.each(PRESETS)("@%s: the front — the strip's word (the back's 'Land') in white from the box's left edge, its mana line ending at the box's right edge, the name from the icon face's inset, the cost drawn, no reverse P/T", async (preset, s) => {
    const b = await bake(frontPreviewData(modal()), preset);
    const area = strip(s);
    const word = inkBox(b, { ...area, x1: WORD_END * s }, white)!;
    expect(word, "the word drawn").not.toBeNull();
    // "Land"'s L: the prints' ink starts at 103–110 px.
    expect(word.x0 / s).toBeGreaterThanOrEqual(100);
    expect(word.x0 / s).toBeLessThanOrEqual(112);
    // Capitals ≈ 35 px tall at HD (a 49 px Beleren Bold), on the prints'
    // rows (1892–1927 on ZNR #189 / #259 / #261).
    expect((word.y1 - word.y0) / s).toBeGreaterThanOrEqual(31);
    expect((word.y1 - word.y0) / s).toBeLessThanOrEqual(40);
    expect(word.y0 / s).toBeGreaterThanOrEqual(1885);
    expect(word.y1 / s).toBeLessThanOrEqual(1936);
    // "{T}: Add {U}." ends at the box's right edge: the prints' 647–650.
    const line = inkBox(b, { ...area, x0: LINE_START * s }, mark)!;
    expect(line, "the line drawn").not.toBeNull();
    expect(line.x1 / s).toBeGreaterThanOrEqual(640);
    expect(line.x1 / s).toBeLessThanOrEqual(652);
    // The name: its first ink column at 249–252 px (the icon face's inset).
    const name = inkBox(b, { x0: 230 * s, x1: 900 * s, y0: 100 * s, y1: 230 * s }, dark)!;
    expect(name, "name drawn").not.toBeNull();
    expect(name.x0 / s).toBeGreaterThanOrEqual(249 - 1 / s);
    expect(name.x0 / s).toBeLessThanOrEqual(252 + 1 / s);
    // The cost is drawn on the front (a pip's dark ink at the band's right).
    expect(inkBox(b, { x0: 1250 * s, x1: 1420 * s, y0: 100 * s, y1: 230 * s }, dark), "cost drawn").not.toBeNull();
    // No reverse P/T slot on a modal front (no tab): nothing grey in the tab's rows.
    expect(getFrameProfile("m15mdfcfront").reversePt).toBeUndefined();
    // The modal front's one overlay is 5.1d's crown (drawn only for a
    // Legendary card with the switch on): no rider, no stamp.
    expect(getFrameProfile("m15mdfcfront").overlays?.map((o) => o.anatomy)).toEqual(["crown"]);
    expect(getFrameProfile("m15mdfcfront").indicator).toBeUndefined();
  }, 90_000);

  it.each(PRESETS)("@%s: the back — the strip's word (the front's 'Instant') and cost in DARK ink, its own cost drawn (hideCost off), white name from the inset, no indicator", async (preset, s) => {
    const b = await bake(backPreviewData(modal({}, SPELL_BACK))!, preset);
    const area = strip(s);
    const word = inkBox(b, { ...area, x1: WORD_END * s }, dark)!;
    expect(word, "the dark word").not.toBeNull();
    expect(word.x0 / s).toBeGreaterThanOrEqual(100);
    expect(word.x0 / s).toBeLessThanOrEqual(112);
    // No white strip text on a back.
    expect(inkBox(b, { ...area, x1: WORD_END * s }, white)).toBeNull();
    // The front's cost "{2}{U}" ends at the box's right edge (the blue
    // disc's fill is the last mark; its dark droplet sits inside it).
    const line = inkBox(b, { ...area, x0: LINE_START * s }, mark)!;
    expect(line, "the line").not.toBeNull();
    expect(line.x1 / s).toBeGreaterThanOrEqual(640);
    expect(line.x1 / s).toBeLessThanOrEqual(652);
    // The back's OWN cost prints in the name bar (a modal back keeps it).
    expect(inkBox(b, { x0: 1250 * s, x1: 1420 * s, y0: 100 * s, y1: 230 * s }, dark), "the back's cost").not.toBeNull();
    expect(getFrameProfile("m15mdfcback").hideCost).toBeFalsy();
    // White name from the icon face's inset.
    const name = inkBox(b, { x0: 230 * s, x1: 900 * s, y0: 100 * s, y1: 230 * s }, white)!;
    expect(name, "white name").not.toBeNull();
    expect(name.x0 / s).toBeGreaterThanOrEqual(249 - 1 / s);
    expect(name.x0 / s).toBeLessThanOrEqual(252 + 1 / s);
    // No colour-indicator dot (no modal back prints one).
    expect(getFrameProfile("m15mdfcback").indicator).toBeUndefined();
    expect(inkBox(b, { x0: 60 * s, x1: 260 * s, y0: 1150 * s, y1: 1330 * s }, (l) => l < 30)).toBeNull();
  }, 90_000);

  it.each(PRESETS)("@%s: the land pair — no cost on either face, no P/T slot, the pathway's strips both a mana line", async (preset, s) => {
    const land = modal(
      { frameStyle: { template: "m15mdfclandfront", finish: "regular" }, cardType: "land", cost: null, rulesText: "{T}: Add {U}." },
      { ...LAND_BACK, title: "Murkwater Pathway", rules_text: "{T}: Add {B}.", color_identity: ["black"] },
    );
    const front = await bake(frontPreviewData(land), preset);
    const back = await bake(backPreviewData(land)!, preset);
    for (const [face, b, ink] of [["front", front, white], ["back", back, dark]] as const) {
      const area = strip(s);
      const word = inkBox(b, { ...area, x1: WORD_END * s }, ink)!;
      expect(word, `${face}: Land`).not.toBeNull();
      const line = inkBox(b, { ...area, x0: LINE_START * s }, mark)!;
      expect(line, `${face}: the mana line`).not.toBeNull();
      expect(line.x1 / s).toBeGreaterThanOrEqual(640);
      // No cost pips in the name bar of a land face.
      expect(inkBox(b, { x0: 1250 * s, x1: 1420 * s, y0: 100 * s, y1: 230 * s }, face === "front" ? dark : white), `${face}: no cost`).toBeNull();
    }
    expect(getFrameProfile("m15mdfclandfront").pt).toBeUndefined();
    expect(getFrameProfile("m15mdfclandback").pt).toBeUndefined();
    expect(getFrameProfile("m15mdfclandfront").hideCost).toBe(true);
    expect(getFrameProfile("m15mdfclandback").hideCost).toBe(true);
  }, 120_000);

  it("the strip's word on every scan case of the design — Land, Sorcery, Instant, Equipment, Artifact, God, Warrior, Druid, Monk, Tibalt — drawn as the other face's LAST type word (HD)", async () => {
    const cases: Array<[Partial<Back>, string]> = [
      [{ card_type: "land", rules_text: "{T}: Add {W}." }, "Land"],
      [{ card_type: "sorcery", cost: "{4}{W}{W}{W}" }, "Sorcery"],
      [{ card_type: "instant", cost: "{2}{U}" }, "Instant"],
      [{ card_type: "artifact", supertype: "Legendary", subtypes: ["Equipment"], cost: "{1}{W}" }, "Equipment"],
      [{ card_type: "artifact", supertype: "Legendary", subtypes: [], cost: "{3}{G}" }, "Artifact"],
      [{ card_type: "creature", supertype: "Legendary", subtypes: ["God"], cost: "{2}{W}{W}", power: "4", toughness: "4" }, "God"],
      [{ card_type: "creature", subtypes: ["Minotaur", "Warrior"], cost: "{5}{R}", power: "4", toughness: "5" }, "Warrior"],
      [{ card_type: "creature", subtypes: ["Troll", "Druid"], cost: "{1}{G}{G}", power: "8", toughness: "8" }, "Druid"],
      [{ card_type: "creature", subtypes: ["Djinn", "Monk"], cost: "{3}{R}", power: "3", toughness: "4" }, "Monk"],
      [{ card_type: "planeswalker", supertype: "Legendary", subtypes: ["Tibalt"], cost: "{5}{B}{R}" }, "Tibalt"],
    ];
    const widths: number[] = [];
    for (const [back, word] of cases) {
      const card = modal({}, { ...SPELL_BACK, ...back, frame_style: { template: back.card_type === "land" ? "m15mdfclandback" : "m15mdfcback" } });
      expect(frontPreviewData(card).dfc?.otherFace.typeWord, word).toBe(word);
      const b = await bake(frontPreviewData(card), "hd");
      const ink = inkBox(b, { ...strip(1), x1: WORD_END }, white)!;
      expect(ink, `${word} drawn`).not.toBeNull();
      expect(ink.x0).toBeGreaterThanOrEqual(100);
      expect(ink.x0).toBeLessThanOrEqual(112);
      widths.push(ink.x1 - ink.x0);
    }
    // Different words, different widths: "Equipment" the widest, "God" the
    // narrowest — each drawn, none clipped by the word's box.
    expect(Math.max(...widths)).toBe(widths[3]);
    expect(Math.min(...widths)).toBe(widths[5]);
    expect(new Set(widths).size).toBeGreaterThan(6);
  }, 300_000);

  it("the rules lines keep out of the painted strip (DrawnStats.strip): a long text ends above it or stops at its chevron, never inside it (HD) — the prints cut the strip into the box", async () => {
    const { drawnStatInk } = await import("@/lib/cards/rules-box");
    const profile = getFrameProfile("m15mdfcfront");
    expect(drawnStatInk(profile, { pt: false, strip: profile.flipside!.keepOut }, 7 / 5)).toEqual([profile.flipside!.keepOut]);
    expect(drawnStatInk(getFrameProfile("m15"), { pt: false, strip: null }, 7 / 5)).toEqual([]);
    // KHM #15 Halvar's text (six lines at the standard size) on a modal
    // front: nothing of it inside the strip's tab; with the strip's own
    // texts the only dark/white marks there are the strip's (the word left,
    // the line right), none across the tab's middle rows at x 330–380.
    const halvar = modal(
      {
        title: "Halvar, God of Battle",
        cardType: "creature",
        supertype: "Legendary",
        subtypes: ["God"],
        cost: "{2}{W}{W}",
        colorIdentity: ["white"],
        power: "4",
        toughness: "4",
        rulesText:
          "Creatures you control that are enchanted or equipped have double strike.\nAt the beginning of each combat, you may attach target Aura or Equipment attached to a creature you control to target creature you control.",
      },
      { ...SPELL_BACK, title: "Sword of the Realms", cost: "{1}{W}", card_type: "artifact", supertype: "Legendary", subtypes: ["Equipment"], color_identity: ["white"] },
    );
    const b = await bake(frontPreviewData(halvar), "hd");
    // The gap between the word and the line inside the strip's rows: no
    // rules glyph lands there (the rules box's lines are black ink on grey).
    expect(inkBox(b, { x0: WORD_END, x1: LINE_START, y0: 1866, y1: 1948 }, dark)).toBeNull();
    // …and no rules ink in the rows just above the strip's tab where the
    // text would have run (the keep-out's 4 px of air), left of the chevron.
    expect(inkBox(b, { x0: 120, x1: 690, y0: 1862, y1: 1866 }, dark)).toBeNull();
    // The text IS long enough to reach the strip's rows right of the
    // chevron (the box's bottom is 1936): the keep-out shortened lines, it
    // didn't shrink the text away.
    expect(inkBox(b, { x0: 720, x1: 1380, y0: 1866, y1: 1936 }, dark), "text beside the strip").not.toBeNull();
  }, 90_000);

  it("a modal card with no back face yet draws no strip; a transform front draws none either", async () => {
    const alone = await bake(frontPreviewData(modal({}, null)), "default");
    expect(inkBox(alone, strip(0.5), white)).toBeNull();
    const transform = await bake(frontPreviewData(modal({ frameStyle: { template: "m15dfcfront", finish: "regular" } }, { ...SPELL_BACK, frame_style: { template: "m15dfcback" as never } })), "default");
    expect(inkBox(transform, strip(0.5), white)).toBeNull();
  }, 90_000);
});
