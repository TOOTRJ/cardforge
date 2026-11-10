import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { MANA_GEM_BG } from "@/lib/cards/mana-gem";
import { renderCardImage } from "@/lib/render/card-image";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// The card owner's own mana symbols on REAL bakes (layout v76): `{*CODE}` in
// the cost and in rules text draws the owner's picture (`*CODE` in the pip
// map) at a plain pip's size, and a code with no picture draws the
// placeholder — a plain colourless disc, nothing on it. Until v76 neither
// was drawn at all. Flat stand-in masters (tests/stubs/stand-in-frames.ts):
// text and pips are the only ink.
// ---------------------------------------------------------------------------

const HD_W = 1500;
const COST = [700, 60, 1460, 230] as const;
const RULES = [100, 1240, 1400, 1860] as const;

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "H",
    cost: "{1}",
    cardType: "creature",
    supertype: null,
    subtypes: [],
    rarity: "common",
    colorIdentity: ["green"],
    rulesText: "Flying",
    flavorText: null,
    power: "1",
    toughness: "1",
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as unknown as CardPreviewData;
}

type Raw = { data: Buffer; w: number; h: number };
async function bake(data: CardPreviewData): Promise<Raw> {
  const res = await renderCardImage(data, "hd", { brandMark: false, watermarkText: null, corners: "square" });
  const { data: raw, info } = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: raw, w: info.width, h: info.height };
}
const px = (r: Raw, x: number, y: number) => {
  const i = (y * r.w + x) * 3;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
};
type Box = { x0: number; x1: number; y0: number; y1: number };
function inkBox(r: Raw, [x0, y0, x1, y1]: readonly number[], pred: (c: number[]) => boolean): Box | null {
  const k = r.w / HD_W;
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (let y = Math.ceil(y0 * k); y < Math.floor(y1 * k); y += 1) {
    for (let x = Math.ceil(x0 * k); x < Math.floor(x1 * k); x += 1) {
      if (!pred(px(r, x, y))) continue;
      b.x0 = Math.min(b.x0, x);
      b.x1 = Math.max(b.x1, x);
      b.y0 = Math.min(b.y0, y);
      b.y1 = Math.max(b.y1, y);
    }
  }
  return Number.isFinite(b.x0) ? { x0: b.x0 / k, x1: (b.x1 + 1) / k, y0: b.y0 / k, y1: (b.y1 + 1) / k } : null;
}

const isMagenta = (c: number[]) => c[0] > 220 && c[2] > 220 && c[1] < 60;
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const PLACEHOLDER = hex(MANA_GEM_BG.c);
const isPlaceholder = (c: number[]) => c.every((v, i) => Math.abs(v - PLACEHOLDER[i]) <= 3);

describe("the owner's own symbols on the bake (layout v76)", () => {
  let frames: StandInFrames;
  let magenta: string;
  beforeAll(async () => {
    // A tone no placeholder disc or text ink is near.
    frames = await serveStandInFrames([{ template: "m15", keys: ["g"], tone: 40 }]);
    const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } }).png().toBuffer();
    magenta = `data:image/png;base64,${png.toString("base64")}`;
  });
  afterAll(() => frames.restore());

  it("draws the owner's picture for {*CODE} in the cost and in rules text, any case, at a plain pip's size", async () => {
    const withPicture = await bake(
      card({ cost: "{G}{*abc}", rulesText: "Add {*ABC}.", pipOverrides: { "*ABC": magenta } } as Partial<CardPreviewData>),
    );
    const plain = await bake(card({ cost: "{G}", rulesText: "Add {G}." }));
    const cost = inkBox(withPicture, COST, isMagenta)!;
    expect(cost, "the cost's picture").not.toBeNull();
    const rules = inkBox(withPicture, RULES, isMagenta)!;
    expect(rules, "the rules text's picture").not.toBeNull();
    // A plain pip's disc: the {G} beside it on the same row is the same size.
    const isGreen = (c: number[]) => c.every((v, i) => Math.abs(v - hex(MANA_GEM_BG.g)[i]) <= 3);
    const green = inkBox(plain, COST, isGreen)!;
    expect(Math.abs(cost.x1 - cost.x0 - (green.x1 - green.x0))).toBeLessThanOrEqual(2);
    expect(Math.abs(cost.y1 - cost.y0 - (green.y1 - green.y0))).toBeLessThanOrEqual(2);
    // No placeholder in the cost row.
    expect(inkBox(withPicture, COST, isPlaceholder)).toBeNull();
  }, 60_000);

  it("draws the placeholder disc for a code with no picture — in the cost and in rules text, where the picture would be", async () => {
    const text = { cost: "{G}{*ZZZ}", rulesText: "Pay {*zzz}: Draw a card." };
    const r = await bake(card({ ...text, pipOverrides: { "*ABC": magenta } } as Partial<CardPreviewData>));
    // The same card with a picture for ZZZ: where each pip is.
    const pictured = await bake(card({ ...text, pipOverrides: { "*ZZZ": magenta } } as Partial<CardPreviewData>));
    const isInk = (c: number[]) => c[0] + c[1] + c[2] < 120;
    const inset = (b: Box, by: number) => [b.x0 + by, b.y0 + by, b.x1 - by, b.y1 - by];
    for (const [where, region] of [["cost", COST], ["rules", RULES]] as const) {
      const pip = inkBox(pictured, region, isMagenta)!;
      expect(pip, where).not.toBeNull();
      // The placeholder is a flat disc where the picture is: the square
      // inside the circle (16 % of the diameter in from each side) is all
      // placeholder, nothing drawn on it.
      const by = Math.ceil((pip.x1 - pip.x0) * 0.16) + 1;
      const inner = inset(pip, by);
      expect(inkBox(r, inner, isPlaceholder), `${where}: the placeholder`).not.toBeNull();
      expect(inkBox(r, inner, (c) => !isPlaceholder(c)), `${where}: a flat disc`).toBeNull();
      expect(inkBox(r, inner, isInk), `${where}: no glyph`).toBeNull();
    }
    expect(inkBox(r, [0, 0, 1500, 2100], isMagenta)).toBeNull();
    // Before v76 nothing was drawn there: the cost row's disc is new ink.
    const without = await bake(card({ cost: "{G}", rulesText: "Pay : Draw a card." }));
    expect(inkBox(without, COST, isPlaceholder)).toBeNull();
  }, 60_000);

  it("a symbol the card doesn't name is never fetched — an unfetchable one breaks nothing", async () => {
    const r = await bake(
      card({ cost: "{1}{*ABC}", pipOverrides: { "*ABC": magenta, "*NOPE": "https://unreachable.test/nope.png" } } as Partial<CardPreviewData>),
    );
    expect(inkBox(r, COST, isMagenta)).not.toBeNull();
  }, 60_000);
});
