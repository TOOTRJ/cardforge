import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { PREPARE_PAGE } from "@/lib/cards/template-layout";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { serveStandInFrames, type StandInFrames, type StandInSpec } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// TODO 4.26 on REAL bakes (flat stand-in masters, one tone per colour key,
// served from a stubbed bucket): each part in its own colour.
//   • THE ROLLOUT RULE (owner 2026-09-29, an addition): a card stored before
//     4.26 — no `partColor` key — or one switched off bakes BYTE FOR BYTE as
//     it did, whatever its back_face.color_identity says (the dev DB's 108
//     two-part cards name none today; a later edit or import may);
//   • split: the right half of the landscape card is the second half's
//     master past x 52 %, the left the card's;
//   • aftermath: the lower part is the second part's master below y 1140;
//   • prepare: the page overlay of the spell's colour over the creature's
//     master, at its rect — and none where the spell is the creature's own.
// ---------------------------------------------------------------------------

const TONES: Record<string, number> = { r: 70, u: 190, b: 40, w: 230, g: 120, m: 160 };
const PAGE_RGB = [10, 200, 30];
type Raw = { data: Buffer; w: number; h: number; png: Buffer };

async function bake(card: CardPreviewData, preset: RenderPreset = "hd"): Promise<Raw> {
  const res = await renderCardImage(card, preset, { brandMark: true, watermarkText: null, corners: "round" });
  const png = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, png };
}
const grey = (r: Raw, x: number, y: number) => r.data[(y * r.w + x) * 4]!;
const rgb = (r: Raw, x: number, y: number) => [...r.data.subarray((y * r.w + x) * 4, (y * r.w + x) * 4 + 3)];

function card(template: "split" | "aftermath" | "prepare", over: { frameStyle?: Record<string, unknown>; backColors?: string[]; backCost?: string; colors?: string[] } = {}): CardPreviewData {
  const prepare = template === "prepare";
  return {
    title: prepare ? "Blazing Firesinger" : "Fire",
    cost: "{1}{R}",
    cardType: prepare ? "creature" : "instant",
    supertype: null,
    subtypes: prepare ? ["Dwarf"] : [],
    rarity: "common",
    colorIdentity: over.colors ?? ["red"],
    rulesText: null,
    flavorText: null,
    power: prepare ? "2" : null,
    toughness: prepare ? "3" : null,
    loyalty: null,
    defense: null,
    artistCredit: "A. Painter",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish: "regular", ...(over.frameStyle ?? {}) },
    setIconUrl: null,
    setIconCode: null,
    backFace: {
      title: prepare ? "Seething Song" : "Ice",
      cost: over.backCost ?? "{1}{U}",
      card_type: "instant",
      subtypes: [],
      ...(over.backColors ? { color_identity: over.backColors } : {}),
    },
    faceContent: null,
    watermark: null,
  } as unknown as CardPreviewData;
}

let frames: StandInFrames;
beforeAll(async () => {
  frames = await serveStandInFramesByKey();
}, 60_000);
afterAll(() => frames?.restore());

/** One stand-in per (template, key) at TONES[key], and the Prepare pages. */
async function serveStandInFramesByKey(): Promise<StandInFrames> {
  const specs: StandInSpec[] = [];
  for (const template of ["split", "aftermath", "prepare"]) {
    for (const key of ["r", "u", "b", "m"]) specs.push({ template, keys: [key], tone: TONES[key]! });
  }
  const pieces: Record<string, { rgb: number[]; width: number; height: number }> = {};
  for (const key of ["u", "b", "wb-h"]) pieces[PREPARE_PAGE.assetPathTemplate.replace("{key}", key)] = { rgb: PAGE_RGB, width: 668, height: 562 };
  specs.push({ template: "prepare", keys: ["r"], tone: TONES.r!, pieces });
  return serveStandInFrames(specs);
}

describe("a card stored before 4.26 keeps its bake", () => {
  it.each(["split", "aftermath", "prepare"] as const)("%s: a second colour with the switch absent or off bakes byte for byte as none", async (template) => {
    const plain = await bake(card(template));
    const stored = await bake(card(template, { backColors: ["blue"] }));
    const off = await bake(card(template, { backColors: ["blue"], frameStyle: { partColor: false } }));
    expect(stored.png.equals(plain.png)).toBe(true);
    expect(off.png.equals(plain.png)).toBe(true);
    // …and on, with no colour of its own (every stored back today): the same.
    const onNoColour = await bake(card(template, { frameStyle: { partColor: true } }));
    expect(onNoColour.png.equals(plain.png)).toBe(true);
  }, 60_000);
});

describe("M2: a card whose colour is the WHOLE card's (Fire // Ice: gold), its first half's on frame_style", () => {
  it("draws Fire red and Ice blue with the look on — and main's gold with it off", async () => {
    const on = await bake(card("split", { colors: ["multicolor"], backColors: ["blue"], frameStyle: { partColor: true, firstPartColor: ["red"] } }));
    expect(grey(on, 600, 12)).toBe(TONES.r);
    expect(grey(on, 1700, 12)).toBe(TONES.u);
    const off = await bake(card("split", { colors: ["multicolor"], backColors: ["blue"], frameStyle: { partColor: false, firstPartColor: ["red"] } }));
    const main = await bake(card("split", { colors: ["multicolor"] }));
    expect(grey(off, 600, 12)).toBe(TONES.m);
    expect(grey(off, 1700, 12)).toBe(TONES.m);
    expect(off.png.equals(main.png)).toBe(true);
  }, 60_000);

  it("a first half of its own colour with no second colour: the whole card in that colour", async () => {
    const r = await bake(card("split", { colors: ["multicolor"], frameStyle: { partColor: true, firstPartColor: ["red"] } }));
    expect(grey(r, 600, 12)).toBe(TONES.r);
    expect(grey(r, 1700, 12)).toBe(TONES.r);
  }, 60_000);
});

describe("each part in its own colour", () => {
  it("split: the right half is the second half's master, from x 52 %", async () => {
    const r = await bake(card("split", { backColors: ["blue"], frameStyle: { partColor: true } }));
    expect([r.w, r.h]).toEqual([2100, 1500]);
    // The top border strip (no text): left of the seam red, right blue.
    expect(grey(r, 600, 12)).toBe(TONES.r);
    expect(grey(r, 1090, 12)).toBe(TONES.r);
    expect(grey(r, 1093, 12)).toBe(TONES.u);
    expect(grey(r, 1700, 12)).toBe(TONES.u);
  }, 60_000);

  it("aftermath: the lower part is the second part's master, from y 1140", async () => {
    const r = await bake(card("aftermath", { backColors: ["black"], backCost: "{X}{B}{B}", frameStyle: { partColor: true } }));
    expect(grey(r, 12, 600)).toBe(TONES.r);
    expect(grey(r, 12, 1138)).toBe(TONES.r);
    expect(grey(r, 12, 1141)).toBe(TONES.b);
    expect(grey(r, 12, 1900)).toBe(TONES.b);
  }, 60_000);

  it("aftermath at the 750 bake: the seam on a whole px (570)", async () => {
    const r = await bake(card("aftermath", { backColors: ["black"], frameStyle: { partColor: true } }), "default");
    expect(r.w).toBe(750);
    expect(grey(r, 6, 568)).toBe(TONES.r);
    expect(grey(r, 6, 571)).toBe(TONES.b);
  }, 60_000);

  it("prepare: the spell's page over the creature's master, at its rect", async () => {
    const before = frames.fetched.length;
    const r = await bake(card("prepare", { backColors: ["blue"], frameStyle: { partColor: true } }));
    expect(frames.fetched.slice(before)).toContain("prepare/page/u.png");
    // Inside the page's rect (clear of its text): the page; outside: red.
    expect(rgb(r, 1000, 1850)).toEqual(PAGE_RGB);
    expect(rgb(r, 760, 1320)).toEqual(PAGE_RGB);
    expect(grey(r, 740, 1860)).toBe(TONES.r);
    expect(grey(r, 1420, 1860)).toBe(TONES.r);
    expect(grey(r, 900, 1880)).toBe(TONES.r);
  }, 60_000);

  it("prepare: a hybrid spell's grey page (the pair's -h page) over a mono creature", async () => {
    const before = frames.fetched.length;
    await bake(card("prepare", { backColors: ["white", "black"], backCost: "{1}{W/B}", frameStyle: { partColor: true } }));
    expect(frames.fetched.slice(before)).toContain("prepare/page/wb-h.png");
  }, 60_000);

  it("prepare: no page where the spell is the creature's own colour", async () => {
    const before = frames.fetched.length;
    const plain = await bake(card("prepare", { backCost: "{R}" }));
    const own = await bake(card("prepare", { backColors: ["red"], backCost: "{R}", frameStyle: { partColor: true } }));
    expect(frames.fetched.slice(before).some((k) => k.startsWith("prepare/page/"))).toBe(false);
    expect(own.png.equals(plain.png)).toBe(true);
  }, 60_000);
});
