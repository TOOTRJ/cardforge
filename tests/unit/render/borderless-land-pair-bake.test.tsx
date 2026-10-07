import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { frameColorKeysFor, frameMasterKey } from "@/components/cards/frame-layer";
import { getFrameProfile } from "@/lib/cards/template-layout";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { resetFrameAssetCacheForTests } from "@/lib/render/card-frames";
import { frameAssetPathsFor, renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { shareCrossings } from "@/scripts/lib/pair-ramp.mjs";
import type { ColorIdentity, FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.56 — the borderless land's two-colour pair in the Satori BAKE, with
// the REAL published masters (m15borderlessland at the manifest's sha256 —
// FRAMES_BUILD_DIR, else .frames-build; CI fetches them) from a stubbed
// frames bucket, flat art. Opt-in per card (FrameStyle.twoColor):
//   • a two-colour land with the switch on paints `<pair>` — the grey land
//     bars over a split pinline and box — and fetches that object; the same
//     land with no key, or the switch off, paints the gold `m` it always
//     did, byte for byte (the stored look: 6 production pairs on 2026-10-06);
//   • a mono, a three-colour and a plain "multicolor" land bake
//     byte-identical with the switch on;
//   • measured on the HD bake like the prints: the title ring, the type ring
//     and the box split at 41.2 / 50.0 / 58.8 %W (the prints: 41.3 / 50.2 /
//     58.9 and 40.9 / 49.8 / 59.0), untilted, the first colour on the left;
//   • the foil's sheen is masked by the pair master too.
// The live preview's twin: tests/unit/components/two-colour-preview.test.tsx
// (the shared table, tests/unit/render/two-colour-cases.ts).
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.test";
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;
const TEMPLATE = "m15borderlessland";

/** Every published PNG of the template whose local copy is at the manifest's sha. */
function realFiles(): Record<string, Buffer> | null {
  const out: Record<string, Buffer> = {};
  for (const rel of Object.keys(REAL)) {
    if (!rel.startsWith(`${TEMPLATE}/`) || !rel.endsWith(".png")) continue;
    const file = path.join(BUILD, rel);
    if (!fs.existsSync(file)) return null;
    const bytes = fs.readFileSync(file);
    if (createHash("sha256").update(bytes).digest("hex") !== REAL[rel].sha256) return null;
    out[rel] = bytes;
  }
  return Object.keys(out).length > 0 ? out : null;
}
const files = realFiles();
const available = files !== null && ["m.png", "c.png", "w.png", "wu.png", "br.png", "gw.png"].every((k) => files[`${TEMPLATE}/${k}`]);

const ART_RGB = [40, 160, 200] as const;
let artUrl = "";
let restore: () => void = () => {};
const fetched: string[] = [];

beforeAll(async () => {
  if (!available || !files) return;
  const art = await sharp({ create: { width: 1500, height: 2100, channels: 4, background: { r: ART_RGB[0], g: ART_RGB[1], b: ART_RGB[2], alpha: 1 } } })
    .png()
    .toBuffer();
  artUrl = `data:image/png;base64,${art.toString("base64")}`;
  const { frameObjectKey, setFrameStorageForTests } = await import("@/lib/frames/frame-url");
  const manifest = { version: 1 as const, bucket: "frames", files: Object.fromEntries(Object.keys(files).map((key) => [key, REAL[key]])) };
  const byUrl = new Map(Object.entries(files).map(([key, buf]) => [`${ORIGIN}/${frameObjectKey(key, REAL[key].hash)}`, [key, buf] as const]));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const hit = byUrl.get(String(input));
      if (!hit) throw new Error(`unexpected fetch: ${input}`);
      fetched.push(hit[0]);
      return new Response(new Uint8Array(hit[1]), { status: 200, headers: { "content-type": "image/png" } });
    }),
  );
  restore = setFrameStorageForTests({ manifest, origin: ORIGIN });
  resetFrameAssetCacheForTests();
}, 60_000);

afterAll(() => {
  restore();
  vi.unstubAllGlobals();
});

function land(colorIdentity: ColorIdentity[], frameStyle: Partial<FrameStyle> = {}, over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "",
    cost: null,
    cardType: "land",
    supertype: null,
    subtypes: [],
    rarity: "rare",
    colorIdentity,
    rulesText: null,
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl,
    artPosition: {},
    frameStyle: { template: TEMPLATE, finish: "regular", ...frameStyle },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

type Raw = { data: Buffer; width: number; height: number };
async function bake(data: CardPreviewData, preset: RenderPreset): Promise<Raw> {
  const res = await renderCardImage({ ...data, artUrl }, preset, { brandMark: false, watermarkText: null, corners: "round" });
  const { data: px, info } = await sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: px, width: info.width, height: info.height };
}
const same = (a: Raw, b: Raw) => a.width === b.width && a.height === b.height && a.data.equals(b.data);
function differingRows(a: Raw, b: Raw): number[] {
  const rows = new Set<number>();
  for (let i = 0; i < a.data.length; i += 1) if (a.data[i] !== b.data[i]) rows.add(Math.floor(i / 4 / a.width));
  return [...rows].sort((x, y) => x - y);
}
const masterOf = (data: CardPreviewData) =>
  frameMasterKey(getFrameProfile(data.frameStyle?.template), data.colorIdentity as ColorIdentity[], data, data.frameStyle);
const px = (img: Raw, x: number, y: number) => [img.data[(y * img.width + x) * 4], img.data[(y * img.width + x) * 4 + 1], img.data[(y * img.width + x) * 4 + 2]];

describe.skipIf(!available)("the borderless land's pair in the bake — the real masters (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each([
    ["white", "blue", "wu"],
    ["red", "black", "br"],
    ["white", "green", "gw"],
  ] as const)("a %s / %s land with the switch on paints and fetches `%s`; with no key or the switch off, the gold `m` it always did — byte for byte", async (a, b, key) => {
    const on = land([a, b], { twoColor: true });
    const stored = land([a, b]);
    const off = land([a, b], { twoColor: false });
    expect(masterOf(on)).toBe(key);
    expect(masterOf(stored)).toBe("m");
    expect(masterOf(off)).toBe("m");
    expect(frameColorKeysFor(getFrameProfile(TEMPLATE), on.colorIdentity as ColorIdentity[], on, on.frameStyle)).toEqual([key]);
    // No overlay, no plate: the master is the card's only frame asset.
    expect(frameAssetPathsFor(on).filter((p) => p.includes("/frames/"))).toEqual([]);
    resetFrameAssetCacheForTests();
    fetched.length = 0;
    const [pair, gold, goldOff] = [await bake(on, "default"), await bake(stored, "default"), await bake(off, "default")];
    expect(fetched).toContain(`${TEMPLATE}/${key}.png`);
    expect(fetched).toContain(`${TEMPLATE}/m.png`);
    expect(same(gold, goldOff)).toBe(true);
    // The pair differs from the gold land only where the frame draws: the
    // title bar and its ring (rows 85–236 at HD → 42–118 at 750) and the
    // type bar, the box and their ring (1165–1947 → 582–974: Card
    // Conjurer's gold frame draws its type-bar ring one row higher than the
    // grey and the colour frames).
    const rows = differingRows(pair, gold);
    expect(rows.length).toBeGreaterThan(300);
    for (const y of rows) expect((y >= 42 && y <= 118) || (y >= 582 && y <= 974), `row ${y}`).toBe(true);
    // The bars (the title bar's flat interior at 750: row 80, away from the
    // split): the pair's is the colourless land's grey, 156/151/144 at α 179
    // over the flat art; the stored look's the gold bar, 173/136/52.
    const over = (tint: readonly number[]) => tint.map((v, c) => (v * 179 + ART_RGB[c] * (255 - 179)) / 255);
    const bar = px(pair, 150, 80);
    const goldBar = px(gold, 150, 80);
    over([156, 151, 144]).forEach((want, c) => expect(Math.abs(bar[c] - want), `pair bar ${bar.join(",")}`).toBeLessThanOrEqual(3));
    over([173, 136, 52]).forEach((want, c) => expect(Math.abs(goldBar[c] - want), `gold bar ${goldBar.join(",")}`).toBeLessThanOrEqual(3));
  }, 120_000);

  it("a mono, a three-colour and a plain multicolor land bake byte-identical with the switch on — and so does every stored shape with it absent", async () => {
    for (const colours of [["green"], ["colorless"], ["white", "blue", "black"], ["multicolor"]] as ColorIdentity[][]) {
      const [withKey, without] = [await bake(land(colours, { twoColor: true }), "default"), await bake(land(colours), "default")];
      expect(same(withKey, without), colours.join()).toBe(true);
    }
    // The AI's stored pair (the colour words, then "multicolor") is a pair:
    // gold with no key, the pair master with the switch.
    const ai = ["blue", "black", "multicolor"] as ColorIdentity[];
    expect(masterOf(land(ai))).toBe("m");
    expect(masterOf(land(ai, { twoColor: true }))).toBe("ub");
    // The crown switch draws nothing on this frame (no crowned twin).
    const legend = { supertype: "Legendary" };
    expect(same(await bake(land(["white", "blue"], { twoColor: true, crown: true } as Partial<FrameStyle>, legend), "default"), await bake(land(["white", "blue"], { twoColor: true }, legend), "default"))).toBe(true);
  }, 180_000);

  it.each([
    [["white", "blue"], "wu"],
    [["black", "red"], "br"],
    [["green", "blue"], "gu"],
  ] as const)("measured on the HD bake like the prints (%s, master %s): the rings and the box split 41.2 / 50.0 / 58.8 hundredths of the width, untilted, the first colour on the left", async (colours, key) => {
    const img = await bake(land([...colours] as ColorIdentity[], { twoColor: true }), "hd");
    expect([img.width, img.height]).toEqual([1500, 2100]);
    expect(masterOf(land([...colours] as ColorIdentity[], { twoColor: true }))).toBe(key);
    const crossingsAt = (y: number) => {
      const left = px(img, 300, y);
      const right = px(img, 1200, y);
      const d = right.map((v, c) => v - left[c]);
      const n2 = d.reduce((t, v) => t + v * v, 0);
      expect(n2, `row ${y}: the two ends differ`).toBeGreaterThan(100);
      const shares = Array.from({ length: img.width }, (_, x) => (x < 300 ? 0 : x > 1200 ? 1 : px(img, x, y).reduce((t, v, c) => t + (v - left[c]) * d[c], 0) / n2));
      return shareCrossings(shares) as number[];
    };
    // The title bar's top ring, the type bar's top ring, the box (no text).
    const rows = [94, 1175, 1600].map(crossingsAt);
    for (const got of rows) {
      [41.2, 50.0, 58.8].forEach((want, i) => expect(Math.abs(got[i] - want), `${key}: ${got.map((v) => v.toFixed(2)).join(" / ")}`).toBeLessThanOrEqual(0.5));
      // …which is the prints' ring (41.3 / 50.2 / 58.9) and box (40.9 /
      // 49.8 / 59.0) within ±1.0 %W.
      [41.3, 50.2, 58.9].forEach((print, i) => expect(Math.abs(got[i] - print)).toBeLessThanOrEqual(1.0));
      [40.9, 49.8, 59.0].forEach((print, i) => expect(Math.abs(got[i] - print)).toBeLessThanOrEqual(1.0));
    }
    expect(Math.abs(rows[0][1] - rows[1][1]), "tilt between the title and type rings").toBeLessThanOrEqual(0.2);
    expect(Math.abs(rows[0][1] - rows[2][1]), "the box against the pinline").toBeLessThanOrEqual(0.3);
    // The bars are one grey from end to end (no split there).
    const [l, r] = [px(img, 300, 160), px(img, 1200, 160)];
    expect(Math.max(...l.map((v, c) => Math.abs(v - r[c])))).toBeLessThanOrEqual(2);
  }, 150_000);

  it("foil: the sheen is masked by the pair master — the foil pair differs from the foil gold land only where the frame draws", async () => {
    resetFrameAssetCacheForTests();
    fetched.length = 0;
    const pair = await bake(land(["white", "blue"], { twoColor: true, finish: "foil" }), "default");
    const gold = await bake(land(["white", "blue"], { finish: "foil" }), "default");
    expect(fetched).toContain(`${TEMPLATE}/wu.png`);
    const rows = differingRows(pair, gold);
    expect(rows.length).toBeGreaterThan(300);
    for (const y of rows) expect((y >= 42 && y <= 118) || (y >= 582 && y <= 974), `row ${y}`).toBe(true);
    // …and the foil really draws over the regular bake.
    expect(same(pair, await bake(land(["white", "blue"], { twoColor: true }), "default"))).toBe(false);
  }, 120_000);
});
