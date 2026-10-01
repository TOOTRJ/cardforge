import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { crownKeyFor } from "@/lib/cards/crown";
import { EXTENDED_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { resetFrameAssetCacheForTests } from "@/lib/render/card-frames";
import { frameAssetPathsFor, renderCardImage, type RenderPreset } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// TODO 4.6f (wave 2b) — the extended-art crown in the Satori BAKE, with the
// REAL published bands (extendedcrown/<key>.png at the manifest's sha256 —
// FRAMES_BUILD_DIR, else .frames-build; CI fetches them) over the real
// extendedart masters (MSE-built, read from public/frames) and flat art, from
// a stubbed frames bucket that serves the bands only. At both output sizes:
//   • a crowned bake differs from the same card with the crown switched off
//     ONLY inside the slot's rows (10–269 of 2100: the band 10 px below CC's
//     bounds) — the title, type line, art and every slot move 0 px;
//   • in those rows it IS the band composited over the uncrowned bake (1:1
//     at HD, ±3 levels of blending);
//   • the key follows the colour — a pair wears gold (no pair masters);
//   • absent / off / a planeswalker type bake byte-identical to today.
// The live preview's twin: tests/unit/components/crown-preview.test.tsx.
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.test";
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;
const KEYS = ["w", "u", "b", "r", "g", "m", "c"];

function realBand(key: string): Buffer | null {
  const rel = `extendedcrown/${key}.png`;
  const file = path.join(BUILD, rel);
  if (!REAL[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === REAL[rel].sha256 ? bytes : null;
}
const bands = Object.fromEntries(KEYS.map((k) => [k, realBand(k)]));
const available = KEYS.every((k) => bands[k] !== null);

const ART_RGB = [40, 160, 200] as const;
let artUrl = "";
let restore: () => void = () => {};
const fetched: string[] = [];

beforeAll(async () => {
  if (!available) return;
  const art = await sharp({ create: { width: 1500, height: 1100, channels: 4, background: { r: ART_RGB[0], g: ART_RGB[1], b: ART_RGB[2], alpha: 1 } } }).png().toBuffer();
  artUrl = `data:image/png;base64,${art.toString("base64")}`;
  const { frameObjectKey, setFrameStorageForTests } = await import("@/lib/frames/frame-url");
  const files = Object.fromEntries(KEYS.map((k) => [`extendedcrown/${k}.png`, bands[k]!]));
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

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Arahbo, the First Fang",
    cost: "{2}{W}",
    cardType: "creature",
    supertype: "Legendary",
    subtypes: ["Cat", "Avatar"],
    rarity: "mythic",
    colorIdentity: ["white"],
    rulesText: "Other Cats you control get +1/+1.\nWhenever Arahbo or another nontoken Cat you control enters, create a 1/1 white Cat creature token.",
    flavorText: null,
    power: "2",
    toughness: "2",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl,
    artPosition: {},
    frameStyle: { template: "extendedart", finish: "regular", crown: true },
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

/** How far a crowned bake's slot rows are from the band composited (straight
 *  alpha, `over`) onto the uncrowned bake, the band resized to the output's
 *  own slot box. */
async function offComposite(crowned: Raw, plain: Raw, key: string) {
  const W = crowned.width;
  const top = Math.round((EXTENDED_CROWN.rect.topPct / 100) * crowned.height);
  const rows = Math.round((EXTENDED_CROWN.rect.heightPct / 100) * crowned.height);
  const { data: band } = await sharp(bands[key]!).resize(W, rows, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 4;
      const p = ((y + top) * W + x) * 4;
      if (plain.data[p + 3] < 255) continue; // the corner cut
      const a = band[o + 3] / 255;
      for (let c = 0; c < 3; c += 1) {
        const want = band[o + c] * a + plain.data[p + c] * (1 - a);
        const d = Math.abs(crowned.data[p + c] - want);
        if (d > max) max = d;
        sum += d;
        n += 1;
      }
    }
  }
  return { max, mean: sum / n, top, rows };
}

const cases: Array<[string, Partial<CardPreviewData>, string]> = [
  ["legendary white creature", {}, "w"],
  ["legendary blue creature", { colorIdentity: ["blue"], cost: "{2}{U}" }, "u"],
  ["legendary three-colour creature (gold)", { colorIdentity: ["white", "blue", "black"], cost: "{W}{U}{B}" }, "m"],
  ["legendary pair, two-colour on: gold (this frame draws no pair masters)", { colorIdentity: ["white", "blue"], cost: "{1}{W}{U}", frameStyle: { template: "extendedart", finish: "regular", crown: true, twoColor: true } }, "m"],
  ["legendary colourless creature (the grey crown)", { colorIdentity: ["colorless"], cost: "{10}" }, "c"],
];
const off = (data: CardPreviewData): CardPreviewData => ({ ...data, frameStyle: { ...data.frameStyle, crown: false } });
/** The slot's rows at each output: 10–269 of 2100 → 5–134 of 1050. */
const SLOT = { default: [5, 135], hd: [10, 270] } as const;

describe.skipIf(!available)("the extended-art crown in the bake — the real bands (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each(cases)("%s: the %s band, inside the slot's rows only, at 750", async (_label, over, key) => {
    const crowned = card(over);
    expect(crownKeyFor({ ...crowned, colorIdentity: crowned.colorIdentity as never }, getFrameProfile("extendedart"))).toBe(key);
    expect(frameAssetPathsFor(crowned)).toContain(`/frames/extendedcrown/${key}.png`);
    resetFrameAssetCacheForTests();
    fetched.length = 0;
    const [a, b] = [await bake(crowned, "default"), await bake(off(crowned), "default")];
    expect(fetched).toContain(`extendedcrown/${key}.png`);
    const rows = differingRows(a, b);
    expect(rows.length).toBeGreaterThan(40);
    expect(rows[0]).toBeGreaterThanOrEqual(SLOT.default[0]);
    expect(rows.at(-1)!).toBeLessThan(SLOT.default[1]);
    const cmp = await offComposite(a, b, key);
    expect(cmp.mean, `mean ${cmp.mean.toFixed(2)}`).toBeLessThan(1.5);
  }, 90_000);

  it.each(cases.slice(0, 2))("%s: at HD the band is composited 1:1 over the uncrowned card, 10 px below CC's bounds", async (_label, over, key) => {
    const crowned = card(over);
    const [a, b] = [await bake(crowned, "hd"), await bake(off(crowned), "hd")];
    const rows = differingRows(a, b);
    expect(rows[0]).toBeGreaterThanOrEqual(SLOT.hd[0] + 36);
    expect(rows.at(-1)!).toBeLessThan(SLOT.hd[1]);
    const cmp = await offComposite(a, b, key);
    expect(cmp.max, `max ${cmp.max}`).toBeLessThanOrEqual(3);
    expect(cmp.mean).toBeLessThan(0.5);
    // The outline's peak is CC's row 36, shifted by the slot's 10 px — and
    // its dark tip over the master's black top border changes no pixel, so
    // the first row that differs is where the crown's own colour begins
    // (rows 46–50 on every master).
    expect(rows[0]).toBeGreaterThanOrEqual(46);
    expect(rows[0]).toBeLessThanOrEqual(50);
  }, 150_000);

  it("absent, off and a planeswalker type bake byte-identical to the plain card", async () => {
    const plain = await bake(card({ frameStyle: { template: "extendedart", finish: "regular" } }), "default");
    expect(differingRows(await bake(card({ frameStyle: { template: "extendedart", finish: "regular", crown: false } }), "default"), plain)).toEqual([]);
    const walker = { cardType: "planeswalker" as const, loyalty: "4", power: null, toughness: null };
    const on = await bake(card({ ...walker, frameStyle: { template: "extendedart", finish: "regular", crown: true } }), "default");
    const without = await bake(card({ ...walker, frameStyle: { template: "extendedart", finish: "regular" } }), "default");
    expect(differingRows(on, without)).toEqual([]);
    expect(frameAssetPathsFor(card({ supertype: null })).some((p) => p.includes("extendedcrown/"))).toBe(false);
  }, 120_000);
});
