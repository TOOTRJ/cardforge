import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { frameColorKeysFor, frameMasterKey } from "@/components/cards/frame-layer";
import { crownKeyFor, showsCrown } from "@/lib/cards/crown";
import { M15_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { resetFrameAssetCacheForTests } from "@/lib/render/card-frames";
import { frameAssetPathsFor, renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6f (wave 2c) — the snow frames in the Satori BAKE, with the REAL
// published objects (the m15snow / m15snowland masters, plates and pair
// masters, and the m15crown bands, at the manifest's sha256 —
// FRAMES_BUILD_DIR, else .frames-build; CI fetches them) and flat art, from
// a stubbed frames bucket. At both output sizes:
//   • a crowned snow bake differs from the same card with the crown off
//     ONLY inside the band's rows (0–409 of 2100: the STANDARD band, as on
//     m15 — the snow pack's title bar sits where the M15 pack's does), and
//     in those rows it IS the band composited over the uncrowned bake;
//   • the key follows the master drawn: the colour, gold for three colours
//     or a pair drawn gold, the artifact silver for a colourless snow card
//     (its master is CC's snow ARTIFACT frame), the land grey for a
//     colourless snow land, the pair band over the pair master;
//   • the two-colour switch paints m15snow/<pair> (the white-bar pair) and
//     m15snowland/<pair>; a LAND wears a pair on the snow land frame only;
//   • absent / off / a planeswalker type bake byte-identical to today.
// The live preview's twin: tests/unit/components/crown-preview.test.tsx.
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.test";
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;
const FOLDERS = ["m15snow", "m15snowland", "m15crown"] as const;

/** Every published PNG of the snow templates and the crown bands whose
 *  local copy is at the manifest's sha. */
function realFiles(): Record<string, Buffer> | null {
  const out: Record<string, Buffer> = {};
  for (const rel of Object.keys(REAL)) {
    if (!FOLDERS.some((t) => rel.startsWith(`${t}/`)) || !rel.endsWith(".png")) continue;
    const file = path.join(BUILD, rel);
    if (!fs.existsSync(file)) return null;
    const bytes = fs.readFileSync(file);
    if (createHash("sha256").update(bytes).digest("hex") !== REAL[rel].sha256) return null;
    out[rel] = bytes;
  }
  return Object.keys(out).length > 0 ? out : null;
}
const files = realFiles();
const available = files !== null && ["m15snow/wu.png", "m15snowland/wu.png", "m15crown/wu.png", "m15crown/a.png", "m15crown/l.png"].every((k) => files[k]);

const ART_RGB = [40, 160, 200] as const;
let artUrl = "";
let restore: () => void = () => {};
const fetched: string[] = [];

beforeAll(async () => {
  if (!available || !files) return;
  const art = await sharp({ create: { width: 1500, height: 1100, channels: 4, background: { r: ART_RGB[0], g: ART_RGB[1], b: ART_RGB[2], alpha: 1 } } }).png().toBuffer();
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

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Isu the Abominable",
    cost: "{3}{U}{U}",
    cardType: "creature",
    supertype: "Legendary Snow",
    subtypes: ["Yeti"],
    rarity: "mythic",
    colorIdentity: ["blue"],
    rulesText: "You may look at the top card of your library any time.\nYou may play snow lands and cast snow spells from the top of your library.",
    flavorText: null,
    power: "5",
    toughness: "5",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl,
    artPosition: {},
    frameStyle: { template: "m15snow", finish: "regular", crown: true },
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
 *  own band box. */
async function offComposite(crowned: Raw, plain: Raw, key: string) {
  const W = crowned.width;
  const rows = Math.round((M15_CROWN.rect.heightPct / 100) * crowned.height);
  const { data: band } = await sharp(files![`m15crown/${key}.png`]!).resize(W, rows, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
  return { max, mean: sum / n, rows };
}

const off = (data: CardPreviewData): CardPreviewData => ({ ...data, frameStyle: { ...data.frameStyle, crown: false } });
const masterOf = (data: CardPreviewData) =>
  frameMasterKey(getFrameProfile(data.frameStyle?.template), data.colorIdentity as ColorIdentity[], data, data.frameStyle);
const SNOWLAND = { template: "m15snowland", finish: "regular", crown: true } as const;

/** [label, the card, the master painted, the crown band's key] */
const cases: Array<[string, Partial<CardPreviewData>, string, string]> = [
  ["legendary blue snow creature (J22 #12)", {}, "u", "u"],
  ["legendary green snow creature (PH19 #5)", { colorIdentity: ["green"], cost: "{2}{G}{G}" }, "g", "g"],
  ["legendary three-colour snow creature: gold", { colorIdentity: ["blue", "black", "red"], cost: "{2}{U}{B}{R}" }, "m", "m"],
  ["legendary snow pair, two-colour switch off: gold master, gold crown", { colorIdentity: ["blue", "black"], cost: "{3}{U}{B}" }, "m", "m"],
  [
    "legendary snow pair, two-colour switch on (KHM #224): the white-bar pair master and the split crown",
    { colorIdentity: ["blue", "black"], cost: "{3}{U}{B}", frameStyle: { template: "m15snow", finish: "regular", crown: true, twoColor: true } },
    "ub",
    "ub",
  ],
  [
    "legendary colourless snow artifact: the snow artifact frame wears the artifact silver crown",
    { cardType: "artifact", colorIdentity: ["colorless"], cost: "{3}", power: null, toughness: null },
    "c",
    "a",
  ],
  [
    "legendary colourless snow land (DMR #244 Dark Depths): the land grey crown",
    { cardType: "land", colorIdentity: ["colorless"], cost: null, power: null, toughness: null, supertype: "Legendary Snow", frameStyle: SNOWLAND },
    "c",
    "l",
  ],
  [
    "legendary green snow land: its colour",
    { cardType: "land", colorIdentity: ["green"], cost: null, power: null, toughness: null, supertype: "Legendary Snow", frameStyle: SNOWLAND },
    "g",
    "g",
  ],
];

/** The band's rows at each output: 0–409 of 2100 → 0–204 of 1050. */
const LAST_ROW = { default: 204, hd: 409 } as const;

describe.skipIf(!available)("the snow crown in the bake — the real masters and bands (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each(cases)("%s: paints the %s master under the %s band, differing from the switch off only inside the band's rows, at 750", async (_label, over, key, crownKey) => {
    const crowned = card(over);
    const template = crowned.frameStyle!.template!;
    const profile = getFrameProfile(template);
    expect(masterOf(crowned)).toBe(key);
    expect(masterOf(off(crowned))).toBe(key);
    expect(crownKeyFor({ ...crowned, colorIdentity: crowned.colorIdentity as never }, profile)).toBe(crownKey);
    expect(showsCrown({ ...off(crowned), colorIdentity: crowned.colorIdentity as never }, profile)).toBe(false);
    expect(frameColorKeysFor(profile, crowned.colorIdentity as ColorIdentity[], crowned, crowned.frameStyle)).toEqual([key]);
    expect(frameAssetPathsFor(crowned)).toContain(`/frames/m15crown/${crownKey}.png`);
    expect(frameAssetPathsFor(off(crowned)).some((p) => p.includes("m15crown/"))).toBe(false);
    resetFrameAssetCacheForTests();
    fetched.length = 0;
    const [a, b] = [await bake(crowned, "default"), await bake(off(crowned), "default")];
    expect(fetched).toContain(`m15crown/${crownKey}.png`);
    expect(fetched).toContain(`${template}/${key}.png`);
    const rows = differingRows(a, b);
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.at(-1)!).toBeLessThanOrEqual(LAST_ROW.default);
    const cmp = await offComposite(a, b, crownKey);
    expect(cmp.mean, `mean ${cmp.mean.toFixed(2)}`).toBeLessThan(1.5);
  }, 90_000);

  it.each([cases[0], cases[4], cases[6]])("%s: at HD the band is composited 1:1 over the uncrowned card — the crown's peak at row 42 on the snow bar, as on m15", async (_label, over, _key, crownKey) => {
    const crowned = card(over);
    const [a, b] = [await bake(crowned, "hd"), await bake(off(crowned), "hd")];
    const rows = differingRows(a, b);
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.at(-1)!).toBeLessThanOrEqual(LAST_ROW.hd);
    const cmp = await offComposite(a, b, crownKey);
    expect(cmp.max, `max ${cmp.max}`).toBeLessThanOrEqual(3);
    expect(cmp.mean).toBeLessThan(0.5);
    // The crown's peak: the first row at the centre column that is not the
    // master's black border (the cover strip is black too): row 42 ± 2 at HD
    // on every band (4.6a's registration, which the snow pack shares).
    let peak = -1;
    for (let y = 0; y < 80 && peak < 0; y += 1) {
      const o = (y * a.width + 750) * 4;
      if (a.data[o] + a.data[o + 1] + a.data[o + 2] > 3 * 40) peak = y;
    }
    expect(Math.abs(peak - 42), `first non-black row ${peak}`).toBeLessThanOrEqual(2);
  }, 150_000);

  it("absent, off and a planeswalker type bake byte-identical to the plain card; the switch preloads nothing extra", async () => {
    const plain = await bake(card({ frameStyle: { template: "m15snow", finish: "regular" } }), "default");
    expect(differingRows(await bake(card({ frameStyle: { template: "m15snow", finish: "regular", crown: false } }), "default"), plain)).toEqual([]);
    const walker = { cardType: "planeswalker" as const, loyalty: "4", power: null, toughness: null };
    const on = await bake(card({ ...walker, frameStyle: { template: "m15snow", finish: "regular", crown: true } }), "default");
    const without = await bake(card({ ...walker, frameStyle: { template: "m15snow", finish: "regular" } }), "default");
    expect(differingRows(on, without)).toEqual([]);
    // Not Legendary: no band, whatever the switch says.
    expect(frameAssetPathsFor(card({ supertype: "Snow" })).some((p) => p.includes("m15crown/"))).toBe(false);
  }, 120_000);

  it("the two-colour switch paints the snow pair master — a LAND only on the snow land frame; a hybrid cost falls back to the split", async () => {
    const pair = card({ supertype: "Snow", colorIdentity: ["white", "blue"], cost: "{2}{W}{U}", frameStyle: { template: "m15snow", finish: "regular", twoColor: true } });
    expect(masterOf(pair)).toBe("wu");
    expect(masterOf({ ...pair, cost: "{W/U}{W/U}" })).toBe("wu");
    expect(masterOf({ ...pair, frameStyle: { template: "m15snow", finish: "regular" } })).toBe("m");
    expect(masterOf({ ...pair, cardType: "land", cost: null })).toBe("m");
    const dual: CardPreviewData = { ...pair, cardType: "land", cost: null, power: null, toughness: null, frameStyle: { template: "m15snowland", finish: "regular", twoColor: true } };
    expect(masterOf(dual)).toBe("wu");
    resetFrameAssetCacheForTests();
    fetched.length = 0;
    const gold = await bake({ ...pair, frameStyle: { template: "m15snow", finish: "regular" } }, "default");
    const split = await bake(pair, "default");
    expect(fetched).toContain("m15snow/wu.png");
    // The whole frame between the title bar and the box's bottom ring
    // changes (the white bars, the split box and pinline: rows 85–1950 at
    // HD → 42–975 at 750); the border, the bottom bar and the art don't.
    const rows = differingRows(gold, split);
    expect(rows.length).toBeGreaterThan(200);
    expect(rows[0]).toBeGreaterThanOrEqual(42);
    expect(rows.at(-1)!).toBeLessThanOrEqual(975);
    // The gold P/T plate, as the prints have it (KHM #224 / #223 / #230):
    // the plate's face (its core, x 600–680 × rows 940–965 at 750; the
    // plate rect is 75.73 / 88.48 / 18.8 × 7.33 %) is the same gold plate
    // in both bakes — only the frame around it changed.
    let plateDiff = 0;
    for (let y = 940; y < 965; y += 1) for (let x = 600; x < 680; x += 1) {
      const o = (y * gold.width + x) * 4;
      for (let c = 0; c < 4; c += 1) if (gold.data[o + c] !== split.data[o + c]) plateDiff += 1;
    }
    expect(plateDiff).toBe(0);
    fetched.length = 0;
    await bake(dual, "default");
    expect(fetched).toContain("m15snowland/wu.png");
  }, 180_000);
});
