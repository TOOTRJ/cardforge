import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { RENDER_PRESETS, frameAssetPathsFor, renderCardImage, type RenderPreset } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// TODO 4.27 — the Prepare frame in the Satori BAKE, on the REAL published
// masters (prepare/* at the manifest's sha256 — FRAMES_BUILD_DIR, else
// .frames-build; CI fetches them) from a stubbed frames bucket:
//   • the spell's name and type line are WHITE on the page's bars, its rules
//     dark in the page's box, and the creature's rules dark in the LEFT box —
//     each inside its own box, never across the page's outline;
//   • the master's own pieces (the page's outline, the strip under it) come
//     through untouched where no text is set;
//   • the P/T plate is M15's, on the strip; a legendary card wears M15's
//     crown band.
// PREPARE_BAKE_SAVE_DIR keeps the PNGs; PREPARE_BAKE_CASES (a JSON file of
// cases) bakes a review set there instead of asserting — local use only.
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.test";
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;
const SAVE_DIR = process.env.PREPARE_BAKE_SAVE_DIR ?? null;
const CASES_FILE = process.env.PREPARE_BAKE_CASES ?? null;

function real(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!REAL[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === REAL[rel].sha256 ? bytes : null;
}

const KEYS = ["w", "u", "b", "r", "g", "m", "c"] as const;
const WANTED = [
  ...KEYS.map((k) => `prepare/${k}.png`),
  // (M15's own masters too, where at hand: the review set bakes a card on
  // the frame it lands on today beside the Prepare frame.)
  ...KEYS.map((k) => `m15/${k}.png`),
  ...Object.keys(REAL).filter((rel) => /^(m15crown\/[a-z]+|m15\/pt\/[a-z]+)\.png$/.test(rel)),
];
const served = new Map<string, Buffer>();
for (const rel of WANTED) {
  const bytes = real(rel);
  if (bytes) served.set(rel, bytes);
}
const haveMasters = KEYS.every((k) => served.has(`prepare/${k}.png`)) && served.has("m15/pt/r.png") && served.has("m15crown/r.png");

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

/** SOS #109 Blazing Firesinger // Seething Song, as printed. */
function card(over: Partial<CardPreviewData> & { template?: string; finish?: string } = {}): CardPreviewData {
  const { template = "prepare", finish = "regular", ...rest } = over;
  return {
    title: "Blazing Firesinger",
    cost: "{2}{R}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Dwarf", "Bard"],
    rarity: "uncommon",
    colorIdentity: ["red"],
    rulesText: "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    flavorText: null,
    power: "2",
    toughness: "3",
    loyalty: null,
    defense: null,
    artistCredit: "PipGlyph",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish },
    setIconUrl: null,
    setIconCode: null,
    backFace: {
      title: "Seething Song",
      cost: "{2}{R}",
      card_type: "instant",
      subtypes: [],
      rules_text: "Add {R}{R}{R}{R}{R}.",
    },
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

describe.skipIf(!haveMasters || CASES_FILE !== null)("the Prepare frame, baked", () => {
  it("draws the spell on the page — white on its bars, dark in its box — and the creature's rules in the left box", async () => {
    const hd = await bake(card(), "hd", "r-firesinger");
    const master = await sharp(served.get("prepare/r.png")!).ensureAlpha().raw().toBuffer();
    const masterPx = (x: number, y: number) => {
      const i = (y * 1500 + x) * 4;
      return [master[i]!, master[i + 1]!, master[i + 2]!];
    };
    // The page's name and type line: white ink on the bars.
    expect(region(hd, 783, 1340, 1150, 1398).max, "the spell's name").toBeGreaterThanOrEqual(230);
    expect(region(hd, 783, 1445, 1000, 1497).max, "the spell's type line").toBeGreaterThanOrEqual(230);
    // Its rules: dark ink in the page's box, and none on the box's far right.
    expect(region(hd, 775, 1545, 1385, 1850).min, "the spell's rules").toBeLessThan(80);
    // The creature's rules: dark ink in the left box, none past it.
    expect(region(hd, 125, 1335, 735, 1925).min, "the creature's rules").toBeLessThan(80);
    // The master's own pieces where no text is set: the page's outline, the
    // strip under the page (left of the plate), the type bar's end.
    for (const [x, y, what] of [
      [747, 1600, "the page's outline"],
      [900, 1900, "the strip under the page"],
      [1395, 1500, "the pinline beside the bars"],
    ] as const) {
      const got = px(hd, x, y);
      const want = masterPx(x, y);
      for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - want[i]!), `${what}: ${got} against ${want}`).toBeLessThanOrEqual(2);
    }
    // The P/T plate is M15's, on the strip: its digits dark on its face.
    expect(region(hd, 1220, 1890, 1380, 1960).min, "the P/T digits").toBeLessThan(80);
  }, 120_000);

  it("keeps each text in its own box at 750 px too", async () => {
    const small = await bake(card({ rulesText: "Flying, vigilance\nWhenever another creature you control enters, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)" } as never), "default", "r-long-750");
    // The page's outline column stays the master's black from top to bottom.
    for (const y of [700, 760, 820, 900]) expect(luma(px(small, 373, y)), `the outline at y ${y}`).toBeLessThan(40);
  }, 120_000);

  it("warms M15's plate; a legendary card M15's crown band", () => {
    const paths = frameAssetPathsFor(card());
    expect(paths.some((p) => p.startsWith("/frames/m15/pt/"))).toBe(true);
    const crowned = frameAssetPathsFor(card({ supertype: "Legendary", frameStyle: { template: "prepare", finish: "regular", crown: true } } as never));
    expect(crowned).toContain("/frames/m15crown/r.png");
    expect(getFrameProfile("prepare").adventure?.placeholderName).toBe("Spell");
  });
});

// The review set (local): PREPARE_BAKE_CASES=<json> PREPARE_BAKE_SAVE_DIR=<dir>.
type ReviewCase = { id: string; card: Record<string, unknown>; art?: string; presets?: RenderPreset[] };
describe.skipIf(CASES_FILE === null || SAVE_DIR === null)("review bakes", () => {
  it("bakes the cases", async () => {
    const cases = JSON.parse(fs.readFileSync(CASES_FILE!, "utf8")) as ReviewCase[];
    for (const c of cases) {
      const artUrl = c.art ? `data:image/${c.art.endsWith(".png") ? "png" : "jpeg"};base64,${fs.readFileSync(c.art).toString("base64")}` : await flatArtUrl();
      const source = { ...card(c.card as never), artUrl } as CardPreviewData;
      for (const preset of c.presets ?? ["hd"]) {
        const res = await renderCardImage(source, preset, { brandMark: false, watermarkText: null, corners: "round" });
        fs.writeFileSync(path.join(SAVE_DIR!, `${c.id}${preset === "hd" ? "" : "-750"}.png`), Buffer.from(await res.arrayBuffer()));
      }
    }
  }, 1_800_000);
});
