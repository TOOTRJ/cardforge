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
import { RENDER_PRESETS, frameAssetPathsFor, renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { renderCardPrint } from "@/lib/render/card-print";

// ---------------------------------------------------------------------------
// TODO 4.27a — the station frame in the Satori BAKE, on the REAL published
// masters (m15station/*, m15stationland/* at the manifest's sha256 —
// FRAMES_BUILD_DIR, else .frames-build; CI fetches them) from a stubbed
// frames bucket, over flat art so every tone can be computed:
//   • the picture runs under the whole frame: the field left of the title
//     bar IS the art, and the text box is the art under the master's wash;
//   • a tier band is the key's colour over that at 0.25 / 0.57 / 0.78, a hard
//     step on a whole px at BOTH sizes;
//   • the badge and the plate are dark faces with WHITE ink, on their band's
//     centre; no plate without a P/T (a Planet), no piece without a tier;
//   • the pieces are frame: a foil bake sheens over them, and the white ink
//     stays white above it;
//   • nothing is fetched for the pieces (inline art) and no corner plate.
// STATION_BAKE_SAVE_DIR keeps the PNGs; STATION_BAKE_CASES (a JSON file of
// cases) bakes a review set there instead of asserting — local use only.
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.test";
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;
const SAVE_DIR = process.env.STATION_BAKE_SAVE_DIR ?? null;
const CASES_FILE = process.env.STATION_BAKE_CASES ?? null;

function real(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!REAL[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === REAL[rel].sha256 ? bytes : null;
}

const KEYS = ["w", "u", "b", "r", "g", "m", "c"] as const;
const WANTED = [
  ...KEYS.map((k) => `m15station/${k}.png`),
  ...KEYS.map((k) => `m15stationland/${k}.png`),
  ...Object.keys(REAL).filter((rel) => /^(m15crown|m15holostamp)\/[a-z]+\.png$/.test(rel)),
];
const served = new Map<string, Buffer>();
for (const rel of WANTED) {
  const bytes = real(rel);
  if (bytes) served.set(rel, bytes);
}
const haveMasters = KEYS.every((k) => served.has(`m15station/${k}.png`) && served.has(`m15stationland/${k}.png`));

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

const REMINDER = (word: string, at: number | null) =>
  `Station (Tap another creature you control: Put charge counters equal to its power on this ${word}. Station only as a sorcery.${at ? ` It's an artifact creature at ${at}+.` : ""})`;

function card(over: Partial<CardPreviewData> & { template?: string; finish?: string }): CardPreviewData {
  const { template = "m15station", finish = "regular", ...rest } = over;
  const land = template === "m15stationland";
  return {
    title: land ? "Evendo, Waking Haven" : "Lumen-Class Frigate",
    cost: land ? null : "{1}{U}",
    cardType: land ? "land" : "artifact",
    supertype: null,
    subtypes: [land ? "Planet" : "Spacecraft"],
    rarity: "rare",
    colorIdentity: ["blue"],
    rulesText: land ? `{T}: Add {G}.\n${REMINDER("Planet", null)}\n12+ | {G}, {T}: Add {G} for each creature you control.` : `${REMINDER("Spacecraft", 12)}\n2+ | Other creatures you control get +1/+1.\n12+ | Flying, lifelink`,
    flavorText: null,
    power: land ? null : "3",
    toughness: land ? null : "5",
    loyalty: null,
    defense: null,
    artistCredit: "PipGlyph",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish },
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

describe.skipIf(!haveMasters || CASES_FILE !== null)("the station frame, baked", () => {
  it("the picture runs under the frame; the box is the master's wash over it; each tier a hard step in the key's colour", async () => {
    const source = card({});
    const hd = await bake(source, "hd", "u-two-tiers");
    const laid = cardStation(getFrameProfile("m15station"), source, "u")!.layout;
    expect(laid.clipped).toBe(false);
    expect(laid.bands.tiers).toHaveLength(2);
    // The field between the border and the title bar is the picture itself.
    near(px(hd, 80, 700), ART, 2, "the field");
    // The box, right of every line of text: the master's own pixel over the art.
    const master = await sharp(served.get("m15station/u.png")!).ensureAlpha().raw().toBuffer();
    const washAt = (x: number, y: number) => {
      const i = (y * 1500 + x) * 4;
      return over(ART, [master[i]!, master[i + 1]!, master[i + 2]!], master[i + 3]! / 255);
    };
    const x = 1378;
    near(px(hd, x, laid.bands.top.y0 + 30), washAt(x, laid.bands.top.y0 + 30), 2, "the top band");
    laid.bands.tiers.forEach((band, i) => {
      const y = band.y0 + 6;
      near(px(hd, x, y), over(washAt(x, y), STATION_COLOURS.u.tier, STATION.tierOpacity[i]!), 3, `tier ${i + 1}`);
      // A hard step: the row above the band's top is not this band's tone.
      const above = i === 0 ? washAt(x, band.y0 - 1) : over(washAt(x, band.y0 - 1), STATION_COLOURS.u.tier, STATION.tierOpacity[i - 1]!);
      near(px(hd, x, band.y0 - 1), above, 3, `the row above tier ${i + 1}`);
    });
    // The same edges on whole px at the 750 px size.
    const small = await bake(source, "default", "u-two-tiers-750");
    for (const band of laid.bands.tiers) {
      const [a, b] = [px(small, x / 2, band.y0 / 2 - 1), px(small, x / 2, band.y0 / 2)];
      expect(Math.abs(luma(a) - luma(b)), "a band edge at 750 px").toBeGreaterThan(8);
      near(px(small, x / 2, band.y0 / 2 + 1), b, 3, "one px into the band at 750 px");
    }
  }, 120_000);

  it("dark faces with white ink on each band's centre; a foil sheens over the pieces and the ink stays white", async () => {
    const source = card({ colorIdentity: ["red"], cost: "{2}{R}" });
    const laid = cardStation(getFrameProfile("m15station"), source, "r")!.layout;
    const plate = laid.plate!;
    expect((plate.y0 + plate.y1) / 2).toBe(laid.bands.tiers[1]!.cy);
    for (const finish of ["regular", "foil"]) {
      const hd = await bake(card({ ...source, finish } as never), "hd", `r-${finish}`);
      const face = region(hd, plate.x0 + 20, plate.y0 + 20, plate.x1 - 20, plate.y1 - 20);
      expect(face.max, `${finish}: the digits`).toBeGreaterThanOrEqual(250);
      expect(face.min, `${finish}: the plate's face`).toBeLessThan(finish === "foil" ? 110 : 70);
      for (const band of laid.bands.tiers) {
        const disc = region(hd, STATION.badge.cx - 30, band.cy - 30, STATION.badge.cx + 30, band.cy + 30);
        expect(disc.max, `${finish}: a numeral`).toBeGreaterThanOrEqual(250);
        expect(disc.min, `${finish}: a badge's face`).toBeLessThan(finish === "foil" ? 110 : 70);
      }
    }
  }, 180_000);

  it("a Planet: its own masters, a tier and its badge, never a plate; a Spacecraft with no tier draws no piece at all", async () => {
    const planet = card({ template: "m15stationland", colorIdentity: ["green"] });
    const laid = cardStation(getFrameProfile("m15stationland"), planet, "g")!;
    expect(laid.layout.plate).toBeNull();
    expect(laid.drawing.pieces.map((p) => p.kind)).toEqual(["band", "badge"]);
    const hd = await bake(planet, "hd", "planet-g");
    const band = laid.layout.bands.tiers[0]!;
    expect(region(hd, STATION.badge.cx - 30, band.cy - 30, STATION.badge.cx + 30, band.cy + 30).max).toBeGreaterThanOrEqual(250);
    // Where a plate would sit there is only the band.
    expect(region(hd, 1300, band.cy - 4, 1380, band.cy + 4).max - region(hd, 1300, band.cy - 4, 1380, band.cy + 4).min).toBeLessThan(12);

    const bare = card({ rulesText: "Flying\nWhenever this Spacecraft attacks, draw a card." });
    expect(cardStation(getFrameProfile("m15station"), bare, "u")!.drawing.pieces).toEqual([]);
    await bake(bare, "hd", "u-no-tier");
  }, 120_000);

  it("fetches nothing for the pieces and no corner plate", () => {
    const paths = frameAssetPathsFor(card({}));
    expect(paths.filter((p) => /station|\/pt\//.test(p))).toEqual([]);
  });

  it("a print file with bleed draws the pieces in the vector layer at the print's size", async () => {
    const source = { ...card({}), artUrl: await flatArtUrl() } as CardPreviewData;
    const png = await renderCardPrint(source, { ppi: 600, bleed: true, brandMark: false, watermarkText: null } as never);
    if (SAVE_DIR) fs.writeFileSync(path.join(SAVE_DIR, "u-print-bleed.png"), png);
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const img = { data, width: info.width, height: info.height };
    const [bx, by] = [(info.width - 1500) / 2, (info.height - 2100) / 2];
    const laid = cardStation(getFrameProfile("m15station"), source, "u")!.layout;
    const plate = laid.plate!;
    expect(region(img, bx + plate.x0 + 20, by + plate.y0 + 20, bx + plate.x1 - 20, by + plate.y1 - 20).max).toBeGreaterThanOrEqual(250);
    near(px(img, bx + 80, by + 700), ART, 3, "the field in the print file");
  }, 180_000);
});

// The review set (local): STATION_BAKE_CASES=<json> STATION_BAKE_SAVE_DIR=<dir>.
type ReviewCase = { id: string; card: Record<string, unknown>; art?: string; presets?: RenderPreset[]; print?: boolean; round?: boolean };
describe.skipIf(CASES_FILE === null || SAVE_DIR === null)("review bakes", () => {
  it("bakes the cases", async () => {
    const cases = JSON.parse(fs.readFileSync(CASES_FILE!, "utf8")) as ReviewCase[];
    const report: Record<string, unknown> = {};
    for (const c of cases) {
      const artUrl = c.art ? `data:image/${c.art.endsWith(".png") ? "png" : "jpeg"};base64,${fs.readFileSync(c.art).toString("base64")}` : await flatArtUrl();
      const source = { ...card(c.card as never), artUrl } as CardPreviewData;
      for (const preset of c.presets ?? ["hd"]) {
        const res = await renderCardImage(source, preset, { brandMark: false, watermarkText: null, corners: c.round === false ? "square" : "round" });
        fs.writeFileSync(path.join(SAVE_DIR!, `${c.id}${preset === "hd" ? "" : "-750"}.png`), Buffer.from(await res.arrayBuffer()));
      }
      if (c.print) fs.writeFileSync(path.join(SAVE_DIR!, `${c.id}-print.png`), await renderCardPrint(source, { ppi: 600, bleed: true, brandMark: false, watermarkText: null } as never));
      const profile = getFrameProfile(((c.card.template as string) ?? "m15station") as never);
      const laid = cardStation(profile, source, "u")?.layout;
      report[c.id] = laid ? { sizePx: laid.sizePx, rule: laid.rule, clipped: laid.clipped, tiers: laid.bands.tiers.map((b) => [b.y0, b.y1]), plate: laid.plate } : null;
    }
    fs.writeFileSync(path.join(SAVE_DIR!, "layout-report.json"), JSON.stringify(report, null, 1));
    // The drawn pieces alone, flat and bevelled (the bevel round's sheet).
    const { stationBadgeArt, stationPlateArt } = await import("@/lib/cards/station-art");
    for (const key of ["w", "u", "r"]) {
      for (const style of ["flat", "bevel"] as const) {
        const svgOf = (url: string) => decodeURIComponent(url.slice(url.indexOf(",") + 1));
        fs.writeFileSync(path.join(SAVE_DIR!, `art-badge-${key}-${style}.svg`), svgOf(stationBadgeArt(key, style)));
        fs.writeFileSync(path.join(SAVE_DIR!, `art-plate-${key}-${style}.svg`), svgOf(stationPlateArt(key, style)));
      }
    }
  }, 1_800_000);
});
