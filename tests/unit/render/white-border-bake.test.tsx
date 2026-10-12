import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { cardCornerRadiusPx } from "@/lib/cards/card-corner";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { WHITE_BORDER_RGB } from "@/lib/cards/white-border";
import { MPC_BLEED_IN } from "@/lib/cards/print-export";
import { renderCardImage, squareCornerFillsOf, type RenderPreset } from "@/lib/render/card-image";
import { renderCardPrint } from "@/lib/render/card-print";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// TODO 4.30 on REAL bakes (flat stand-in masters served from a stubbed
// bucket): the white border as the card draws it, at HD and at the default
// bake, and through every output that reads the border —
//   • the white (#ececea) from the PNG's edge to the frame box, the black
//     keyline inside it, and NOTHING else: inside the keyline the bake is
//     the black-bordered bake, pixel for pixel;
//   • the round corner still cut into the alpha, with white under the arc;
//   • off, absent, "black", or on a frame that declares no white border:
//     the bake is today's, byte for byte;
//   • a square output fills its corners WHITE, and a bleed (1/8 in,
//     MakePlayingCards') extends WHITE on every edge;
//   • foil and etched: the sheens are masked with the border too.
// ---------------------------------------------------------------------------

const TONE = 128;
const WHITE = [...WHITE_BORDER_RGB];
type Raw = { data: Buffer; w: number; h: number; png: Buffer };

async function decode(png: Buffer): Promise<Raw> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, png };
}
async function bake(card: CardPreviewData, preset: RenderPreset, corners: "round" | "square" = "round"): Promise<Raw> {
  const res = await renderCardImage(card, preset, { brandMark: true, watermarkText: null, corners });
  return decode(Buffer.from(await res.arrayBuffer()));
}
const px = (r: Raw, x: number, y: number) => [...r.data.subarray((y * r.w + x) * 4, (y * r.w + x) * 4 + 4)];
const rgb = (r: Raw, x: number, y: number) => px(r, x, y).slice(0, 3);

function card(template: string, border?: string, over: Record<string, unknown> = {}): CardPreviewData {
  const land = template.endsWith("land");
  return {
    title: "Border Sentinel",
    cost: land ? "" : "{2}{R}",
    cardType: land ? "land" : "creature",
    supertype: null,
    subtypes: land ? [] : ["Soldier"],
    rarity: "uncommon",
    colorIdentity: land ? ["colorless"] : ["red"],
    rulesText: "Vigilance",
    flavorText: null,
    power: land ? null : "2",
    toughness: land ? null : "3",
    loyalty: null,
    defense: null,
    artistCredit: "A. Painter",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish: "regular", ...(border ? { border } : {}) },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as unknown as CardPreviewData;
}

let frames: StandInFrames;
beforeAll(async () => {
  frames = await serveStandInFrames([
    { template: "retro", keys: ["r"], tone: TONE },
    { template: "retroland", keys: ["c"], tone: TONE },
    { template: "modern", keys: ["r"], tone: TONE },
    { template: "modernland", keys: ["c"], tone: TONE },
    { template: "m15", keys: ["r"], tone: TONE },
  ]);
}, 120_000);
afterAll(() => frames.restore());

describe.each(["retro", "retroland", "modern", "modernland"])("%s with the white border", (template) => {
  const { insetPx, keylinePx } = getFrameProfile(template).whiteBorder!;

  it("HD: the white to the frame box, the keyline inside it, the black-bordered bake inside that", async () => {
    const [white, black] = await Promise.all([bake(card(template, "white"), "hd"), bake(card(template), "hd")]);
    expect([white.w, white.h]).toEqual([1500, 2100]);
    const midY = 1050;
    const midX = 750;
    // Left and right edges, along the middle row.
    for (let x = 0; x < insetPx.left; x += 1) expect(px(white, x, midY), `left ${x}`).toEqual([...WHITE, 255]);
    for (let x = insetPx.left; x < insetPx.left + keylinePx; x += 1) expect(px(white, x, midY), `left keyline ${x}`).toEqual([0, 0, 0, 255]);
    for (let x = 1500 - insetPx.right; x < 1500; x += 1) expect(px(white, x, midY), `right ${x}`).toEqual([...WHITE, 255]);
    for (let x = 1500 - insetPx.right - keylinePx; x < 1500 - insetPx.right; x += 1) expect(px(white, x, midY), `right keyline ${x}`).toEqual([0, 0, 0, 255]);
    // Top and bottom, along the middle column.
    for (let y = 0; y < insetPx.top; y += 1) expect(px(white, midX, y), `top ${y}`).toEqual([...WHITE, 255]);
    for (let y = insetPx.top; y < insetPx.top + keylinePx; y += 1) expect(px(white, midX, y), `top keyline ${y}`).toEqual([0, 0, 0, 255]);
    for (let y = 2100 - insetPx.bottom; y < 2100; y += 1) expect(px(white, midX, y), `bottom ${y}`).toEqual([...WHITE, 255]);
    for (let y = 2100 - insetPx.bottom - keylinePx; y < 2100 - insetPx.bottom; y += 1) expect(px(white, midX, y), `bottom keyline ${y}`).toEqual([0, 0, 0, 255]);
    // Inside the keyline nothing moved and nothing changed colour: the
    // title, the rules, the credit, the mark and the P/T are the
    // black-bordered card's.
    let differing = 0;
    for (let y = insetPx.top + keylinePx; y < 2100 - insetPx.bottom - keylinePx; y += 1) {
      const from = (y * 1500 + insetPx.left + keylinePx) * 4;
      const to = (y * 1500 + 1500 - insetPx.right - keylinePx) * 4;
      if (!white.data.subarray(from, to).equals(black.data.subarray(from, to))) differing += 1;
    }
    expect(differing).toBe(0);
    // The round corner is still cut into the alpha, with the white under it.
    expect(px(white, 0, 0)[3]).toBe(0);
    expect(white.data.filter((_, i) => i % 4 === 3).every((a, i) => a === black.data[i * 4 + 3])).toBe(true);
    const r = Math.ceil(cardCornerRadiusPx(1500, 2100));
    expect(px(white, r, 8)).toEqual([...WHITE, 255]);
    expect(px(white, 8, r)).toEqual([...WHITE, 255]);
  }, 120_000);

  it("the default bake: the same card at half the px — white edge, a dark keyline, the frame", async () => {
    const white = await bake(card(template, "white"), "default");
    expect([white.w, white.h]).toEqual([750, 1050]);
    const edge = insetPx.left / 2;
    for (let x = 0; x < Math.floor(edge); x += 1) expect(px(white, x, 525), `left ${x}`).toEqual([...WHITE, 255]);
    // The keyline is 1.5–2 px here: its darkest pixel is black.
    const row = [0, 1, 2, 3].map((d) => rgb(white, Math.floor(edge) + d, 525).reduce((a, b) => a + b, 0));
    expect(Math.min(...row)).toBeLessThan(30);
    expect(px(white, 0, 0)[3]).toBe(0);
  }, 120_000);

  it("a square bake fills its four corners with the white", async () => {
    const c = card(template, "white");
    expect(squareCornerFillsOf(c)).toEqual([WHITE, WHITE, WHITE, WHITE]);
    expect(squareCornerFillsOf(card(template))).toEqual([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const square = await bake(c, "hd", "square");
    for (const [x, y] of [[0, 0], [1499, 0], [0, 2099], [1499, 2099], [3, 3], [20, 4]]) {
      expect(px(square, x, y), `${x},${y}`).toEqual([...WHITE, 255]);
    }
  }, 120_000);
});

describe("no other card changes", () => {
  it("absent, \"black\" and any other value bake today's card, byte for byte", async () => {
    for (const template of ["retro", "modern"]) {
      const base = await bake(card(template), "hd");
      for (const border of ["black", "silver", "White"]) {
        const other = await bake(card(template, border), "hd");
        expect(other.png.equals(base.png), `${template} ${border}`).toBe(true);
      }
    }
  }, 240_000);

  it("\"white\" on a frame that declares no white border draws nothing", async () => {
    const [base, white] = await Promise.all([bake(card("m15"), "hd"), bake(card("m15", "white"), "hd")]);
    expect(white.png.equals(base.png)).toBe(true);
    expect(squareCornerFillsOf(card("m15", "white"))).toEqual(squareCornerFillsOf(card("m15")));
  }, 120_000);
});

describe("print", () => {
  it("600 ppi with the 1/8 in bleed: white corners, and white copied out on every edge", async () => {
    const c = card("modern", "white");
    const trim = await decode(await renderCardPrint(c, { ppi: 600, bleed: false, brandMark: true, watermarkText: null }));
    expect([trim.w, trim.h]).toEqual([1500, 2100]);
    for (const [x, y] of [[0, 0], [1499, 0], [0, 2099], [1499, 2099]]) expect(rgb(trim, x, y), `${x},${y}`).toEqual(WHITE);
    const bleed = await decode(await renderCardPrint(c, { ppi: 600, bleed: true, brandMark: true, watermarkText: null }));
    expect([bleed.w, bleed.h]).toEqual([1650, 2250]);
    // The whole bleed band is the white, corners included.
    for (let y = 0; y < bleed.h; y += 1) {
      for (let x = 0; x < bleed.w; x += x >= 75 && x < bleed.w - 75 && y >= 75 && y < bleed.h - 75 ? bleed.w - 150 : 1) {
        if (x >= 75 && x < bleed.w - 75 && y >= 75 && y < bleed.h - 75) continue;
        if ((x + y) % 7 !== 0) continue;
        expect(rgb(bleed, x, y), `${x},${y}`).toEqual(WHITE);
      }
    }
    // …and the trim box inside it is the export without bleed.
    for (const [x, y] of [[0, 1000], [100, 100], [750, 80], [1400, 2000]]) expect(rgb(bleed, x + 75, y + 75)).toEqual(rgb(trim, x, y));
    // A black-bordered card's bleed is as before: its corners the border
    // black, its edges the master's own edge copied out (the stand-in's
    // flat tone here).
    const black = await decode(await renderCardPrint(card("modern"), { ppi: 600, bleed: true, brandMark: true, watermarkText: null }));
    for (const [x, y] of [[0, 0], [1649, 2249]]) expect(rgb(black, x, y)).toEqual([0, 0, 0]);
    for (const [x, y] of [[10, 1100], [800, 5]]) expect(rgb(black, x, y)).toEqual([TONE, TONE, TONE]);
  }, 240_000);

  it("MakePlayingCards' file and 800 ppi: white to the last pixel", async () => {
    const c = card("retro", "white");
    const mpc = await decode(await renderCardPrint(c, { ppi: 600, bleed: "mpc", brandMark: true, watermarkText: null }));
    expect(mpc.w).toBe(1500 + 2 * Math.round(MPC_BLEED_IN.x * 600));
    for (const [x, y] of [[0, 0], [mpc.w - 1, 0], [0, mpc.h - 1], [mpc.w - 1, mpc.h - 1], [5, Math.round(mpc.h / 2)], [Math.round(mpc.w / 2), 5]]) {
      expect(rgb(mpc, x, y), `${x},${y}`).toEqual(WHITE);
    }
    const hi = await decode(await renderCardPrint(c, { ppi: 800, bleed: true, brandMark: true, watermarkText: null }));
    expect([hi.w, hi.h]).toEqual([2200, 3000]);
    for (const [x, y] of [[0, 0], [2199, 2999], [50, 1500], [1100, 50], [150, 1500]]) expect(rgb(hi, x, y), `${x},${y}`).toEqual(WHITE);
    // The keyline at 800 ppi: 3 px × 4/3 = 4 px, black, where the white ends
    // (73 px × 4/3 = 97.33 px in from the trim edge, 100 px into the bleed).
    expect(rgb(hi, 100 + 99, 1500)).toEqual([0, 0, 0]);
  }, 240_000);
});

describe("finishes", () => {
  it.each(["foil", "etched"] as const)("%s: the sheen's mask holds the border, so the white takes the finish like the frame", async (finish) => {
    const plain = await bake(card("modern", "white"), "hd");
    const finished = await bake(card("modern", "white", { frameStyle: { template: "modern", finish, border: "white" } }), "hd");
    // The keyline (luminance 0) takes no sheen; the white does somewhere.
    expect(px(finished, 71, 1050)).toEqual([0, 0, 0, 255]);
    let changed = 0;
    for (let y = 100; y < 2000; y += 3) if (!rgb(finished, 30, y).every((v, i) => v === rgb(plain, 30, y)[i])) changed += 1;
    expect(changed).toBeGreaterThan(0);
  }, 240_000);
});
