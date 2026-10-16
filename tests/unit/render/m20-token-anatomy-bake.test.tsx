import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { crownKeyFor } from "@/lib/cards/crown";
import { M20_TOKEN_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { resetFrameAssetCacheForTests } from "@/lib/render/card-frames";
import { frameAssetPathsFor, renderCardImage, type RenderPreset } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// TODO 4.48's last pieces in the Satori BAKE, with the REAL published files
// (the m20token* masters and pair masters, the m20tokencrown bands and M15's
// plates at the manifest's sha256 — FRAMES_BUILD_DIR, else .frames-build; CI
// fetches them) and flat art, from a stubbed frames bucket that serves those
// files only. Both are ADDITIONS (opt-in per card, no layout bump):
//   • the crown: a crowned token differs from the same card with the crown
//     off ONLY inside the band's rows (0–259 of 2100), where it IS the band
//     composited over the uncrowned card — the name, type line, rules, P/T
//     and art move 0 px; keyed by the colour, the artifact templates'
//     colourless by CC's silver A crown, a pair drawn as its pair by the
//     pair's crown;
//   • the pair: a two-colour token with its switch on paints `<pair>.png`
//     and the grey colourless plate (`m15/pt/c`), never the gold `m`;
//   • every card stored before them (no `crown` / `twoColor` key) bakes
//     byte-identical to today: absent = off, a non-legendary token and the
//     2014–19 arch never draw the crown.
// The live preview's twin: tests/unit/components/m20-token-anatomy-preview.test.tsx.
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.test";
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;

/** A published file at the manifest's sha256 from the build folder, or null. */
function realFile(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!REAL[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === REAL[rel].sha256 ? bytes : null;
}
const NEEDED = [
  ...["w", "u", "m", "gw", "rg"].map((k) => `m20token/${k}.png`),
  ...["w", "m", "gw"].map((k) => `m20tokentext/${k}.png`),
  "m20tokenartifacttext/c.png",
  "m15token/w.png",
  ...["w", "u", "a", "m", "gw", "rg"].map((k) => `m20tokencrown/${k}.png`),
  ...["w", "u", "m", "c", "r"].map((k) => `m15/pt/${k}.png`),
  "m15artifact/pt/c.png",
];
const files = Object.fromEntries(NEEDED.map((rel) => [rel, realFile(rel)]));
const available = Object.values(files).every((b) => b !== null);

const ART_RGB = [40, 160, 200] as const;
let artUrl = "";
let restore: () => void = () => {};
const fetched: string[] = [];

beforeAll(async () => {
  if (!available) return;
  const art = await sharp({ create: { width: 1500, height: 2100, channels: 4, background: { r: ART_RGB[0], g: ART_RGB[1], b: ART_RGB[2], alpha: 1 } } }).png().toBuffer();
  artUrl = `data:image/png;base64,${art.toString("base64")}`;
  const { frameObjectKey, setFrameStorageForTests } = await import("@/lib/frames/frame-url");
  const manifest = { version: 1 as const, bucket: "frames", files: Object.fromEntries(NEEDED.map((key) => [key, REAL[key]])) };
  const byUrl = new Map(NEEDED.map((key) => [`${ORIGIN}/${frameObjectKey(key, REAL[key].hash)}`, [key, files[key]!] as const]));
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

function token(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Scion of the Deep",
    cost: null,
    cardType: "token",
    supertype: "Legendary Creature",
    subtypes: ["Octopus"],
    rarity: "common",
    colorIdentity: ["blue"],
    rulesText: null,
    flavorText: null,
    power: "8",
    toughness: "8",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl,
    artPosition: {},
    frameStyle: { template: "m20token", finish: "regular", crown: true },
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

function differingRows(a: Raw, b: Raw): number[] {
  const rows = new Set<number>();
  for (let i = 0; i < a.data.length; i += 1) if (a.data[i] !== b.data[i]) rows.add(Math.floor(i / 4 / a.width));
  return [...rows].sort((x, y) => x - y);
}

/** How far a crowned bake's band rows are from the band composited (straight
 *  alpha, `over`) onto the uncrowned bake, the band resized to the output's
 *  own slot box. */
async function offComposite(crowned: Raw, plain: Raw, key: string) {
  const W = crowned.width;
  const rows = Math.round((M20_TOKEN_CROWN.rect.heightPct / 100) * crowned.height);
  const { data: band } = await sharp(files[`m20tokencrown/${key}.png`]!).resize(W, rows, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 4;
      if (plain.data[o + 3] < 255) continue; // the corner cut
      const a = band[o + 3] / 255;
      for (let c = 0; c < 3; c += 1) {
        const want = band[o + c] * a + plain.data[o + c] * (1 - a);
        const d = Math.abs(crowned.data[o + c] - want);
        if (d > max) max = d;
        sum += d;
        n += 1;
      }
    }
  }
  return { max, mean: sum / n };
}

/** The mean colour of a box of a bake, in 1500 × 2100 card px. */
function meanAt(raw: Raw, x0: number, y0: number, x1: number, y1: number): number[] {
  const s = raw.width / 1500;
  const acc = [0, 0, 0];
  let n = 0;
  for (let y = Math.round(y0 * s); y < Math.round(y1 * s); y += 1) {
    for (let x = Math.round(x0 * s); x < Math.round(x1 * s); x += 1) {
      const o = (y * raw.width + x) * 4;
      for (let c = 0; c < 3; c += 1) acc[c] += raw.data[o + c];
      n += 1;
    }
  }
  return acc.map((v) => Math.round(v / n));
}

const off = (data: CardPreviewData): CardPreviewData => ({ ...data, frameStyle: { ...data.frameStyle, crown: false } });
const crownCases: Array<[string, Partial<CardPreviewData>, string]> = [
  ["blue, textless (TFDN #13)", {}, "u"],
  ["white, the regular box", { colorIdentity: ["white"], rulesText: "Flying", frameStyle: { template: "m20tokentext", finish: "regular", crown: true } }, "w"],
  [
    "colourless artifact: CC's silver A crown (TNEO #16)",
    { colorIdentity: ["colorless"], supertype: "Legendary Artifact", power: null, toughness: null, rulesText: "{T}: Draw a card.", frameStyle: { template: "m20tokenartifacttext", finish: "regular", crown: true } },
    "a",
  ],
  ["a pair drawn gold: the gold crown", { colorIdentity: ["red", "green"], frameStyle: { template: "m20token", finish: "regular", crown: true } }, "m"],
  ["a pair drawn as its pair: the pair's crown (TDMU #21)", { colorIdentity: ["red", "green"], frameStyle: { template: "m20token", finish: "regular", crown: true, twoColor: true } }, "rg"],
];
/** The band's rows at each output: 0–259 of 2100 → 0–129 of 1050. */
const SLOT = { default: 130, hd: 260 } as const;

describe.skipIf(!available)("the full-art token's crown and pairs in the bake — the real files (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each(crownCases)("%s: the %s band, inside its rows only, at 750", async (_label, over, key) => {
    const crowned = token(over);
    const template = crowned.frameStyle!.template!;
    expect(crownKeyFor({ ...crowned, colorIdentity: crowned.colorIdentity as never }, getFrameProfile(template))).toBe(key);
    expect(frameAssetPathsFor(crowned)).toContain(`/frames/m20tokencrown/${key}.png`);
    resetFrameAssetCacheForTests();
    fetched.length = 0;
    const [a, b] = [await bake(crowned, "default"), await bake(off(crowned), "default")];
    expect(fetched).toContain(`m20tokencrown/${key}.png`);
    const rows = differingRows(a, b);
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.at(-1)!).toBeLessThan(SLOT.default);
    const cmp = await offComposite(a, b, key);
    expect(cmp.mean, `mean ${cmp.mean.toFixed(2)}`).toBeLessThan(1.5);
  }, 90_000);

  it.each(crownCases.slice(0, 1))("%s: at HD the band is composited 1:1 over the uncrowned card, at CC's bounds", async (_label, over, key) => {
    const crowned = token(over);
    const [a, b] = [await bake(crowned, "hd"), await bake(off(crowned), "hd")];
    const rows = differingRows(a, b);
    // The outline's peak is CC's row 36; its dark tip over the black border
    // changes nothing, so the crown's own colour starts a few rows lower.
    expect(rows[0]).toBeGreaterThanOrEqual(36);
    expect(rows[0]).toBeLessThanOrEqual(44);
    expect(rows.at(-1)!).toBeLessThan(SLOT.hd);
    const cmp = await offComposite(a, b, key);
    expect(cmp.max, `max ${cmp.max}`).toBeLessThanOrEqual(3);
    expect(cmp.mean).toBeLessThan(0.5);
  }, 150_000);

  it("a two-colour token with its switch on paints its pair master and the grey colourless plate — never the gold", async () => {
    const pair = token({
      title: "Wolf",
      supertype: "Creature",
      subtypes: ["Wolf"],
      colorIdentity: ["green", "white"],
      rulesText: "Trample",
      frameStyle: { template: "m20tokentext", finish: "regular", twoColor: true },
    });
    expect(frameAssetPathsFor(pair)).toContain("/frames/m15/pt/c.png");
    resetFrameAssetCacheForTests();
    fetched.length = 0;
    const split = await bake(pair, "hd");
    expect(fetched).toEqual(expect.arrayContaining(["m20tokentext/gw.png", "m15/pt/c.png"]));
    expect(fetched).not.toContain("m20tokentext/m.png");
    const gold = await bake({ ...pair, frameStyle: { template: "m20tokentext", finish: "regular" } }, "hd");
    expect(differingRows(split, gold).length).toBeGreaterThan(500);
    // The name pill's rim green on the left, white on the right (40→60 %W).
    const left = meanAt(split, 200, 91, 400, 98);
    const right = meanAt(split, 1100, 91, 1300, 98);
    expect(left[1] - left[0], `left ${left}`).toBeGreaterThan(40);
    expect(Math.min(...right), `right ${right}`).toBeGreaterThan(200);
    // The type pill is the prints' neutral grey (right of "Token Creature —
    // Wolf", left of the set symbol).
    for (const x of [1000, 1150]) {
      const [r, g, b] = meanAt(split, x, 1450, x + 40, 1470);
      expect(Math.max(r, g, b) - Math.min(r, g, b), `type pill at ${x}: ${[r, g, b]}`).toBeLessThan(12);
    }
  }, 150_000);

  it("every stored card bakes as today: absent = off, a non-legendary token and the 2014–19 arch never draw the crown", async () => {
    const plain = await bake(token({ frameStyle: { template: "m20token", finish: "regular" } }), "default");
    expect(differingRows(await bake(off(token()), "default"), plain)).toEqual([]);
    const notLegendary = { supertype: "Creature" };
    expect(
      differingRows(
        await bake(token({ ...notLegendary }), "default"),
        await bake(token({ ...notLegendary, frameStyle: { template: "m20token", finish: "regular" } }), "default"),
      ),
    ).toEqual([]);
    const arch = (crown?: boolean) =>
      token({ colorIdentity: ["white"], frameStyle: { template: "m15token", finish: "regular", ...(crown === undefined ? {} : { crown }) } });
    expect(differingRows(await bake(arch(true), "default"), await bake(arch(), "default"))).toEqual([]);
    expect(frameAssetPathsFor(arch(true)).some((p) => p.includes("m20tokencrown/"))).toBe(false);
    // A pair with no switch (every stored two-colour token): the gold master.
    const storedPair = token({ colorIdentity: ["red", "green"], supertype: "Creature", frameStyle: { template: "m20token", finish: "regular" } });
    resetFrameAssetCacheForTests();
    fetched.length = 0;
    await bake(storedPair, "default");
    expect(fetched).toEqual(expect.arrayContaining(["m20token/m.png", "m15/pt/m.png"]));
    expect(fetched).not.toContain("m20token/rg.png");
    expect(fetched).not.toContain("m15/pt/c.png");
  }, 150_000);
});
