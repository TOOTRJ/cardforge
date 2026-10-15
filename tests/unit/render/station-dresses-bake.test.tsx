import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { STATION, STATION_COLOURS } from "@/lib/cards/station";
import { cardStation } from "@/lib/cards/station-layout";
import { getFrameProfile } from "@/lib/cards/template-layout";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { RENDER_PRESETS, renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { renderCardPrint } from "@/lib/render/card-print";

// ---------------------------------------------------------------------------
// TODO 4.27a step 2 — the Spacecraft's extended-art and borderless DRESSES
// (`extendedartstation`, `m15borderlessstation`) in the Satori BAKE, on the
// REAL published masters (at the manifest's sha256 — FRAMES_BUILD_DIR, else
// .frames-build; CI fetches them) from a stubbed frames bucket, over flat
// art so every tone can be computed:
//   • the extended-art dress: the art to the card's SIDE edges beside the
//     art (no rails), the black type bar with white ink, the black border
//     beside the box, the field beside the box the picture — and the box,
//     bands, badges and plate exactly where the bordered frame has them
//     (the masters are M15's pixels there);
//   • the borderless dress: the art to the top and side edges, the black
//     bottom bar, the station box (the bordered frame's own pixels) — and a
//     crowned card's bands in its colour (the `-legendary` twin's key);
//   • a print file with bleed draws both.
// STATION_DRESS_SAVE_DIR keeps the PNGs; STATION_DRESS_CASES (a JSON file of
// cases) bakes a review set there instead of asserting — local use only.
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.test";
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;
const SAVE_DIR = process.env.STATION_DRESS_SAVE_DIR ?? null;
const CASES_FILE = process.env.STATION_DRESS_CASES ?? null;

function real(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!REAL[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === REAL[rel].sha256 ? bytes : null;
}

const KEYS = ["w", "u", "b", "r", "g", "m", "c"] as const;
// The review set may draw any frame (today's landings beside the new ones).
const WANTED = CASES_FILE
  ? Object.keys(REAL).filter((rel) => rel.endsWith(".png"))
  : Object.keys(REAL).filter((rel) => /^(extendedartstation|m15borderlessstation|m15station|extendedcrown|m15holostamp|extendedart|m15borderlessartifact)\/[a-z-]+\.png$/.test(rel));
const served = new Map<string, Buffer>();
for (const rel of WANTED) {
  const bytes = real(rel);
  if (bytes) served.set(rel, bytes);
}
const haveMasters = KEYS.every(
  (k) => served.has(`extendedartstation/${k}.png`) && served.has(`m15borderlessstation/${k}.png`) && served.has(`m15borderlessstation/${k}-legendary.png`) && served.has(`m15station/${k}.png`),
);

let restore: () => void = () => {};
beforeAll(async () => {
  const { frameObjectKey, setFrameStorageForTests } = await import("@/lib/frames/frame-url");
  const { resetFrameAssetCacheForTests } = await import("@/lib/render/card-frames");
  const files = Object.fromEntries([...served.keys()].map((rel) => [rel, REAL[rel]!]));
  const byUrl = new Map<string, Buffer>([...served].map(([rel, bytes]) => [`${ORIGIN}/${frameObjectKey(rel, REAL[rel]!.hash)}`, bytes]));
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const hit = byUrl.get(String(input));
    if (hit) return new Response(new Uint8Array(hit), { status: 200, headers: { "content-type": "image/png" } });
    if (String(input).startsWith(ORIGIN)) throw new Error(`unexpected frame fetch: ${String(input)}`);
    return realFetch(input as never, init);
  });
  restore = setFrameStorageForTests({ manifest: { version: 1, bucket: "frames", files }, origin: ORIGIN });
  resetFrameAssetCacheForTests();
  if (SAVE_DIR) fs.mkdirSync(SAVE_DIR, { recursive: true });
}, 120_000);
afterAll(() => {
  restore();
  vi.unstubAllGlobals();
});

const ART: [number, number, number] = [96, 160, 208];
let flatArt: string | null = null;
async function flatArtUrl(): Promise<string> {
  flatArt ??= `data:image/png;base64,${(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: ART[0], g: ART[1], b: ART[2] } } }).png().toBuffer()).toString("base64")}`;
  return flatArt;
}

const REMINDER = "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 12+.)";

function card(over: Partial<CardPreviewData> & { template?: string; finish?: string; crown?: boolean }): CardPreviewData {
  const { template = "extendedartstation", finish = "regular", crown, ...rest } = over;
  return {
    title: "Lumen-Class Frigate",
    cost: "{1}{U}",
    cardType: "artifact",
    supertype: crown ? "Legendary" : null,
    subtypes: ["Spacecraft"],
    rarity: "rare",
    colorIdentity: ["blue"],
    rulesText: `${REMINDER}\n2+ | Other creatures you control get +1/+1.\n12+ | Flying, lifelink`,
    flavorText: null,
    power: "3",
    toughness: "5",
    loyalty: null,
    defense: null,
    artistCredit: "PipGlyph",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish, ...(crown ? { crown: true } : {}) },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...rest,
  } as unknown as CardPreviewData;
}

type Baked = { data: Buffer; width: number; height: number };
async function bake(source: CardPreviewData, preset: RenderPreset = "hd", name?: string): Promise<Baked> {
  const res = await renderCardImage({ ...source, artUrl: source.artUrl ?? (await flatArtUrl()) }, preset, { brandMark: false, watermarkText: null, corners: "square" });
  const png = Buffer.from(await res.arrayBuffer());
  if (SAVE_DIR && name) fs.writeFileSync(path.join(SAVE_DIR, `${name}.png`), png);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([RENDER_PRESETS[preset].width, RENDER_PRESETS[preset].height]);
  return { data, width: info.width, height: info.height };
}
const px = (img: Baked, x: number, y: number): [number, number, number] => {
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
};
const luma = ([r, g, b]: readonly number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
const over = (under: readonly number[], top: readonly number[], alpha: number) => under.map((v, i) => v * (1 - alpha) + top[i]! * alpha);
const near = (got: readonly number[], want: readonly number[], tol: number, what: string) => {
  for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - want[i]!), `${what}: ${got.join(",")} against ${want.map((v) => v.toFixed(1)).join(",")}`).toBeLessThanOrEqual(tol);
};
function region(img: Baked, x0: number, y0: number, x1: number, y1: number) {
  let max = 0;
  let min = 255;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const l = luma(px(img, x, y));
    max = Math.max(max, l);
    min = Math.min(min, l);
  }
  return { max, min };
}
async function masterPixels(rel: string): Promise<Buffer> {
  return sharp(served.get(rel)!).ensureAlpha().raw().toBuffer();
}

describe.skipIf(!haveMasters || CASES_FILE !== null)("the Spacecraft's dresses, baked", () => {
  it("the masters' station box is the bordered frame's: its alpha exactly, its paper within the packs' own grain (extended art); pixel for pixel inside the rims (borderless)", async () => {
    const { box } = STATION;
    for (const k of KEYS) {
      const bordered = await masterPixels(`m15station/${k}.png`);
      const ext = await masterPixels(`extendedartstation/${k}.png`);
      const bl = await masterPixels(`m15borderlessstation/${k}.png`);
      let alphaDiffer = 0;
      let worst = 0;
      let sum = 0;
      let n = 0;
      let blDiffer = 0;
      for (let y = box.top + 2; y < box.bottom - 2; y += 3) {
        for (let x = box.left + 2; x < box.right - 2; x += 3) {
          const i = (y * 1500 + x) * 4;
          if (ext[i + 3] !== bordered[i + 3]) alphaDiffer++;
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(ext[i + c]! - bordered[i + c]!);
            worst = Math.max(worst, d);
            sum += d;
            n++;
          }
          if (x > 118 && x < 1380) for (let c = 0; c < 4; c++) if (bl[i + c] !== bordered[i + c]) blDiffer++;
        }
      }
      expect(alphaDiffer, `extendedartstation/${k}: the wash`).toBe(0);
      // The extended-art pack's blue box differs from the accurate M15
      // pack's by up to 10 levels (mean 0.4); every other key is identical.
      expect(sum / n, `extendedartstation/${k}: the paper`).toBeLessThan(1);
      expect(worst, `extendedartstation/${k}: the paper`).toBeLessThanOrEqual(12);
      expect(blDiffer, `m15borderlessstation/${k}`).toBe(0);
    }
  }, 120_000);

  it("extended art: the picture to the side edges beside the art, the field beside the box, the black type bar with white ink — the box laid out as the bordered frame's", async () => {
    const source = card({});
    const hd = await bake(source, "hd", "ext-u");
    // The art at the card's very side edges (no rails), mid-art.
    near(px(hd, 3, 700), ART, 2, "the left edge beside the art");
    near(px(hd, 1496, 700), ART, 2, "the right edge beside the art");
    // The field beside the box: the picture.
    near(px(hd, 80, 1500), ART, 2, "the field beside the box");
    // The border below the type bar stays black.
    expect(luma(px(hd, 20, 1700))).toBeLessThan(30);
    // The type bar is dark and its ink white.
    const typeBar = region(hd, 120, 1215, 700, 1285);
    expect(typeBar.min).toBeLessThan(40);
    expect(typeBar.max).toBeGreaterThanOrEqual(240);
    // The same layout as the bordered frame: the box geometry is STATION's.
    const ext = cardStation(getFrameProfile("extendedartstation"), source, "u")!.layout;
    const bordered = cardStation(getFrameProfile("m15station"), card({ template: "m15station" }), "u")!.layout;
    expect(ext.bands).toEqual(bordered.bands);
    expect(ext.plate).toEqual(bordered.plate);
    // A tier band: the key's colour over the master's wash over the art.
    const master = await masterPixels("extendedartstation/u.png");
    const x = 1378;
    ext.bands.tiers.forEach((band, i) => {
      const y = band.y0 + 6;
      const j = (y * 1500 + x) * 4;
      const wash = over(ART, [master[j]!, master[j + 1]!, master[j + 2]!], master[j + 3]! / 255);
      near(px(hd, x, y), over(wash, STATION_COLOURS.u.tier, STATION.tierOpacity[i]!), 3, `tier ${i + 1}`);
    });
  }, 120_000);

  it("extended art, colourless: the silver artifact frame (no artifact master key: `c` IS it)", async () => {
    const source = card({ colorIdentity: [], cost: "{3}" });
    const hd = await bake(source, "hd", "ext-c");
    const master = await masterPixels("extendedartstation/c.png");
    const i = (150 * 1500 + 750) * 4;
    near(px(hd, 750, 150), [master[i]!, master[i + 1]!, master[i + 2]!], 30, "the title bar is the silver master's");
    expect(getFrameProfile("extendedartstation").artifactMasterKeys).toBeUndefined();
  }, 120_000);

  it("borderless: the picture at the top and side edges, the black bottom bar; a crowned gold card's bands in gold (its twin's key)", async () => {
    const source = card({ template: "m15borderlessstation", colorIdentity: ["red", "blue", "white"], cost: "{2}{R}{U}{W}", crown: true });
    const hd = await bake(source, "hd", "bl-m-crown");
    near(px(hd, 750, 4), ART, 2, "the top edge");
    near(px(hd, 3, 900), ART, 2, "the left edge");
    near(px(hd, 1496, 1500), ART, 2, "the right edge beside the box");
    expect(luma(px(hd, 400, 2080))).toBeLessThan(30);
    const laid = cardStation(getFrameProfile("m15borderlessstation"), source, "m-legendary")!.layout;
    const master = await masterPixels("m15borderlessstation/m-legendary.png");
    const x = 1378;
    laid.bands.tiers.forEach((band, i) => {
      const y = band.y0 + 6;
      const j = (y * 1500 + x) * 4;
      const wash = over(ART, [master[j]!, master[j + 1]!, master[j + 2]!], master[j + 3]! / 255);
      near(px(hd, x, y), over(wash, STATION_COLOURS.m.tier, STATION.tierOpacity[i]!), 3, `tier ${i + 1} in gold`);
    });
    // The plate: a dark face with white digits.
    const plate = laid.plate!;
    const face = region(hd, plate.x0 + 20, plate.y0 + 20, plate.x1 - 20, plate.y1 - 20);
    expect(face.max).toBeGreaterThanOrEqual(250);
    expect(face.min).toBeLessThan(70);
  }, 120_000);

  it("a print file with bleed draws both dresses' pieces at the print's size", async () => {
    for (const template of ["extendedartstation", "m15borderlessstation"]) {
      const source = { ...card({ template }), artUrl: await flatArtUrl() } as CardPreviewData;
      const png = await renderCardPrint(source, { ppi: 600, bleed: true, brandMark: false, watermarkText: null } as never);
      if (SAVE_DIR) fs.writeFileSync(path.join(SAVE_DIR, `${template}-print-bleed.png`), png);
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const img = { data, width: info.width, height: info.height };
      const [bx, by] = [(info.width - 1500) / 2, (info.height - 2100) / 2];
      const plate = cardStation(getFrameProfile(template as never), source, "u")!.layout.plate!;
      expect(region(img, bx + plate.x0 + 20, by + plate.y0 + 20, bx + plate.x1 - 20, by + plate.y1 - 20).max, template).toBeGreaterThanOrEqual(250);
      near(px(img, bx + 80, by + 1500), ART, 3, `${template}: the field beside the box in the print file`);
    }
  }, 240_000);
});

// The review set (local): STATION_DRESS_CASES=<json> STATION_DRESS_SAVE_DIR=<dir>.
type ReviewCase = { id: string; card: Record<string, unknown>; art?: string; presets?: RenderPreset[]; print?: boolean };
describe.skipIf(CASES_FILE === null || SAVE_DIR === null)("review bakes", () => {
  it("bakes the cases", async () => {
    const cases = JSON.parse(fs.readFileSync(CASES_FILE!, "utf8")) as ReviewCase[];
    for (const c of cases) {
      const artUrl = c.art ? `data:image/${c.art.endsWith(".png") ? "png" : "jpeg"};base64,${fs.readFileSync(c.art).toString("base64")}` : await flatArtUrl();
      const source = { ...card(c.card as never), ...(c.card as object), artUrl } as CardPreviewData;
      for (const preset of c.presets ?? ["hd"]) {
        const res = await renderCardImage(source, preset, { brandMark: false, watermarkText: null, corners: "round" });
        fs.writeFileSync(path.join(SAVE_DIR!, `${c.id}${preset === "hd" ? "" : "-750"}.png`), Buffer.from(await res.arrayBuffer()));
      }
      if (c.print) fs.writeFileSync(path.join(SAVE_DIR!, `${c.id}-print.png`), await renderCardPrint(source, { ppi: 600, bleed: true, brandMark: false, watermarkText: null } as never));
    }
  }, 1_800_000);
});
