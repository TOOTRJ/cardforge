import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { ADVENTURE_PAGE } from "@/lib/cards/template-layout";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { serveStandInFrames, type StandInFrames, type StandInSpec } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// TODO 4.26, the ADVENTURE page on REAL bakes (flat stand-in masters, one
// tone per colour key, flat stand-in pages, served from a stubbed bucket):
//   • THE ROLLOUT RULE (owner 2026-09-29, an addition): an adventure stored
//     before 4.26 — no `partColor` key — or one switched off bakes BYTE FOR
//     BYTE as it did, whatever its back_face.color_identity says;
//   • on: the spell's page (`adventure/page/<key>`) over the creature's
//     master at the slot's rect — x 72..753 × y 1312..1937 at HD, 36..376 ×
//     656..968 at the 750 bake — and nothing outside it;
//   • none where the spell is the creature's own colour; a two-colour spell
//     the gold page.
// ---------------------------------------------------------------------------

const TONES: Record<string, number> = { r: 70, u: 190, b: 40, w: 230, g: 120, m: 160, c: 100 };
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

/** Callous Sell-Sword // Burn Together (WOE #221): a black creature, a red spell. */
function card(over: { frameStyle?: Record<string, unknown>; backColors?: string[]; backCost?: string; colors?: string[] } = {}): CardPreviewData {
  return {
    title: "Callous Sell-Sword",
    cost: "{1}{B}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Human", "Soldier"],
    rarity: "uncommon",
    colorIdentity: over.colors ?? ["black"],
    rulesText: null,
    flavorText: null,
    power: "2",
    toughness: "2",
    loyalty: null,
    defense: null,
    artistCredit: "A. Painter",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "adventure", finish: "regular", ...(over.frameStyle ?? {}) },
    setIconUrl: null,
    setIconCode: null,
    backFace: {
      title: "Burn Together",
      cost: over.backCost ?? "{R}",
      card_type: "sorcery",
      subtypes: ["Adventure"],
      ...(over.backColors ? { color_identity: over.backColors } : {}),
    },
    faceContent: null,
    watermark: null,
  } as unknown as CardPreviewData;
}

let frames: StandInFrames;
beforeAll(async () => {
  const specs: StandInSpec[] = [];
  const pieces: Record<string, { rgb: number[]; width: number; height: number }> = {};
  for (const key of ["r", "m", "w"]) pieces[ADVENTURE_PAGE.assetPathTemplate.replace("{key}", key)] = { rgb: PAGE_RGB, width: 682, height: 626 };
  specs.push({ template: "adventure", keys: ["b"], tone: TONES.b!, pieces });
  specs.push({ template: "adventure", keys: ["r"], tone: TONES.r! });
  specs.push({ template: "adventure", keys: ["c"], tone: TONES.c! });
  frames = await serveStandInFrames(specs);
}, 60_000);
afterAll(() => frames?.restore());

describe("an adventure stored before 4.26 keeps its bake", () => {
  it("a spell colour with the switch absent or off bakes byte for byte as none", async () => {
    const plain = await bake(card());
    const stored = await bake(card({ backColors: ["red"] }));
    const off = await bake(card({ backColors: ["red"], frameStyle: { partColor: false } }));
    expect(stored.png.equals(plain.png)).toBe(true);
    expect(off.png.equals(plain.png)).toBe(true);
    // …and on, with no colour of its own (every stored back today): the same.
    const onNoColour = await bake(card({ frameStyle: { partColor: true } }));
    expect(onNoColour.png.equals(plain.png)).toBe(true);
  }, 60_000);
});

describe("the spell's page in its own colour", () => {
  it("draws the red page over the black creature's master, at its rect, at HD", async () => {
    const before = frames.fetched.length;
    const r = await bake(card({ backColors: ["red"], frameStyle: { partColor: true } }));
    expect(frames.fetched.slice(before)).toContain("adventure/page/r.png");
    // Inside the page's rect, clear of its text: the page. Its corners.
    expect(rgb(r, 74, 1314)).toEqual(PAGE_RGB);
    expect(rgb(r, 752, 1936)).toEqual(PAGE_RGB);
    expect(rgb(r, 700, 1900)).toEqual(PAGE_RGB);
    // Just outside it: the black master.
    expect(grey(r, 70, 1600)).toBe(TONES.b);
    expect(grey(r, 755, 1900)).toBe(TONES.b);
    expect(grey(r, 400, 1310)).toBe(TONES.b);
    expect(grey(r, 400, 1939)).toBe(TONES.b);
    // The creature's page (right) stays the creature's.
    expect(grey(r, 1000, 1700)).toBe(TONES.b);
  }, 60_000);

  it("at the 750 bake: the page on whole px (36..376 × 656..968)", async () => {
    const r = await bake(card({ backColors: ["red"], frameStyle: { partColor: true } }), "default");
    expect(r.w).toBe(750);
    expect(rgb(r, 37, 657)).toEqual(PAGE_RGB);
    expect(rgb(r, 376, 968)).toEqual(PAGE_RGB);
    expect(grey(r, 35, 800)).toBe(TONES.b);
    expect(grey(r, 377, 950)).toBe(TONES.b);
    expect(grey(r, 200, 969)).toBe(TONES.b);
  }, 60_000);

  it("a colourless creature with a white spell (HOB #170): the white page over adventure/c", async () => {
    const before = frames.fetched.length;
    const r = await bake(card({ colors: ["colorless"], backColors: ["white"], backCost: "{2}{W}", frameStyle: { partColor: true } }));
    expect(frames.fetched.slice(before)).toContain("adventure/page/w.png");
    expect(rgb(r, 700, 1900)).toEqual(PAGE_RGB);
    expect(grey(r, 70, 1600)).toBe(TONES.c);
  }, 60_000);

  it("a two-colour spell draws the gold page", async () => {
    const before = frames.fetched.length;
    await bake(card({ backColors: ["blue", "red"], backCost: "{U}{R}", frameStyle: { partColor: true } }));
    expect(frames.fetched.slice(before)).toContain("adventure/page/m.png");
  }, 60_000);

  it("no page where the spell is the creature's own colour", async () => {
    const before = frames.fetched.length;
    const plain = await bake(card({ backCost: "{B}" }));
    const own = await bake(card({ backColors: ["black"], backCost: "{B}", frameStyle: { partColor: true } }));
    expect(frames.fetched.slice(before).some((k) => k.startsWith("adventure/page/"))).toBe(false);
    expect(own.png.equals(plain.png)).toBe(true);
  }, 60_000);
});
