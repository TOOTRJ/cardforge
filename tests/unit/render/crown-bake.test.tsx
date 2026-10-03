import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { applyCardCornerMask, cardCornerRadiusPx } from "@/lib/cards/card-corner";
import { crownKeyFor } from "@/lib/cards/crown";
import { M15_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { RENDER_PRESETS, frameAssetPathsFor, renderCardImage, type RenderPreset } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// TODO 4.6a — the legendary crown in the Satori BAKE on the real profiles,
// with the REAL published crown bands (m15crown/*.png at the manifest's
// sha256 — FRAMES_BUILD_DIR, else .frames-build; CI fetches them) over
// stand-in masters (flat mid-grey, corners cut) and flat art, from a stubbed
// frames bucket. At both output sizes:
//   • a crowned bake differs from the same card with the crown switched off
//     ONLY inside the band's rows (0–409 of 2100) — the title, type line,
//     art, text box and every slot move 0 px;
//   • in those rows it IS the band composited over the uncrowned bake: 1:1 at
//     HD (±2 levels of blending), resampled at 750 (the same picture);
//   • the band follows the card's colour (the pinline of the master drawn) —
//     a two-colour card drawn as its pair master (4.6b) wears the split band;
//   • absent / off / a planeswalker / a token bake byte-identical to today;
//   • foil and etched sparkle on the crown (it is inside their masks);
//   • square print output keeps black corners.
// The live preview's twin: tests/unit/components/crown-preview.test.tsx.
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.test";
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;

/** The published band's bytes when a copy at the manifest's sha is here. */
function realBand(key: string): Buffer | null {
  const rel = `m15crown/${key}.png`;
  const file = path.join(BUILD, rel);
  if (!REAL[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === REAL[rel].sha256 ? bytes : null;
}
const BAND_KEYS = ["w", "u", "m", "c", "a", "l", "g", "wu", "br"];
const bands = Object.fromEntries(BAND_KEYS.map((k) => [k, realBand(k)]));
const available = BAND_KEYS.every((k) => bands[k] !== null);

const MASTER_RGB = [110, 110, 110] as const;
const ART_RGB = [40, 160, 200] as const;
let artUrl = "";
let restore: () => void = () => {};
const fetched: string[] = [];

async function png(w: number, h: number, rgb: readonly number[], alpha = 1) {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha } } })
    .png()
    .toBuffer();
}

/** A stand-in master: flat grey, the art window clear, corners cut. */
async function master(template: string) {
  const { width: W, height: H } = RENDER_PRESETS.hd;
  const data = Buffer.alloc(W * H * 4);
  for (let p = 0; p < W * H; p += 1) data.set([...MASTER_RGB, 255], p * 4);
  const art = getFrameProfile(template).artSlot;
  const x0 = Math.round((art.leftPct / 100) * W) + 8;
  const y0 = Math.round((art.topPct / 100) * H) + 8;
  const x1 = Math.round(((art.leftPct + art.widthPct) / 100) * W) - 8;
  const y1 = Math.round(((art.topPct + art.heightPct) / 100) * H) - 8;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) data[(y * W + x) * 4 + 3] = 0;
  applyCardCornerMask(data, W, H, cardCornerRadiusPx(W, H));
  return sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

beforeAll(async () => {
  if (!available) return;
  artUrl = `data:image/png;base64,${(await png(1200, 900, ART_RGB)).toString("base64")}`;
  const plate = await png(377, 206, [90, 90, 90]);
  const files: Record<string, Buffer> = {};
  // …and the pair masters a two-colour card paints with its switch on (4.6b).
  for (const [template, keys] of Object.entries({ m15: ["w", "u", "m", "c", "g", "wu", "wu-h"], m15artifact: ["c", "u"], m15land: ["w", "c", "m", "br"] })) {
    const bytes = await master(template);
    for (const key of keys) {
      files[`${template}/${key}.png`] = bytes;
      files[`${template}/pt/${key}.png`] = plate;
    }
  }
  for (const key of BAND_KEYS) files[`m15crown/${key}.png`] = bands[key]!;
  const { frameObjectKey, setFrameStorageForTests } = await import("@/lib/frames/frame-url");
  const { resetFrameAssetCacheForTests } = await import("@/lib/render/card-frames");
  const manifest = {
    version: 1 as const,
    bucket: "frames",
    files: Object.fromEntries(
      Object.entries(files).map(([key, buf]) => {
        const sha256 = createHash("sha256").update(buf).digest("hex");
        return [key, { hash: sha256.slice(0, 12), sha256, bytes: buf.length, width: 1, height: 1 }];
      }),
    ),
  };
  const byUrl = new Map(
    Object.entries(files).map(([key, buf]) => [`${ORIGIN}/${frameObjectKey(key, manifest.files[key].hash)}`, [key, buf] as const]),
  );
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
    title: "Kesh",
    cost: "{2}{W}",
    cardType: "creature",
    supertype: "Legendary",
    subtypes: ["Dwarf"],
    rarity: "rare",
    colorIdentity: ["white"],
    rulesText: null,
    flavorText: null,
    power: "3",
    toughness: "4",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl,
    artPosition: {},
    frameStyle: { template: "m15", finish: "regular", crown: true },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

type Raw = { data: Buffer; width: number; height: number };
async function bake(data: CardPreviewData, preset: RenderPreset, corners: "round" | "square" = "round"): Promise<Raw> {
  const res = await renderCardImage({ ...data, artUrl }, preset, { brandMark: false, watermarkText: null, corners });
  const { data: px, info } = await sharp(Buffer.from(await res.arrayBuffer()))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: px, width: info.width, height: info.height };
}

function differingRows(a: Raw, b: Raw): number[] {
  const rows = new Set<number>();
  for (let i = 0; i < a.data.length; i += 1) if (a.data[i] !== b.data[i]) rows.add(Math.floor(i / 4 / a.width));
  return [...rows].sort((x, y) => x - y);
}

/** How far a crowned bake's band rows are from the band composited (straight
 *  alpha, `over`) onto the uncrowned bake — the band resized to the output's
 *  own band box. */
async function offComposite(crowned: Raw, plain: Raw, key: string) {
  const W = crowned.width;
  const rows = Math.round((M15_CROWN.rect.heightPct / 100) * crowned.height);
  const { data: band } = await sharp(bands[key]!).resize(W, rows, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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

const cases: Array<[string, Partial<CardPreviewData>, string]> = [
  ["legendary white creature (m15)", {}, "w"],
  ["legendary three-colour creature (gold)", { colorIdentity: ["white", "blue", "black"], cost: "{W}{U}{B}" }, "m"],
  ["legendary two-colour creature, two-colour switch off (drawn gold: the gold crown)", { colorIdentity: ["white", "blue"], cost: "{1}{W}{U}" }, "m"],
  [
    "legendary two-colour creature, two-colour switch on (the pair master: the split crown)",
    { colorIdentity: ["white", "blue"], cost: "{1}{W}{U}", frameStyle: { template: "m15", finish: "regular", crown: true, twoColor: true } },
    "wu",
  ],
  [
    "legendary hybrid creature, two-colour switch on (the hybrid master: the same split crown)",
    { colorIdentity: ["white", "blue"], cost: "{W/U}{W/U}", frameStyle: { template: "m15", finish: "regular", crown: true, twoColor: true } },
    "wu",
  ],
  [
    "legendary two-colour land, two-colour switch on (the land pair: the split crown)",
    { cardType: "land", colorIdentity: ["black", "red"], cost: null, power: null, toughness: null, frameStyle: { template: "m15land", finish: "regular", crown: true, twoColor: true } },
    "br",
  ],
  ["legendary colourless creature (m15's see-through grey)", { colorIdentity: ["colorless"], cost: "{10}" }, "c"],
  [
    "legendary colourless artifact (m15artifact: silver)",
    { cardType: "artifact", colorIdentity: ["colorless"], cost: "{5}", power: null, toughness: null, frameStyle: { template: "m15artifact", finish: "regular", crown: true } },
    "a",
  ],
  [
    "legendary blue artifact (its colour)",
    { cardType: "artifact", colorIdentity: ["blue"], cost: "{1}{U}", frameStyle: { template: "m15artifact", finish: "regular", crown: true } },
    "u",
  ],
  [
    "legendary white land (its colour)",
    { cardType: "land", colorIdentity: ["white"], cost: null, power: null, toughness: null, frameStyle: { template: "m15land", finish: "regular", crown: true } },
    "w",
  ],
  [
    "legendary colourless land (the land grey)",
    { cardType: "land", colorIdentity: ["colorless"], cost: null, power: null, toughness: null, frameStyle: { template: "m15land", finish: "regular", crown: true } },
    "l",
  ],
];

const off = (data: CardPreviewData): CardPreviewData => ({ ...data, frameStyle: { ...data.frameStyle, crown: false } });

describe.skipIf(!available)("the crown in the bake — the real bands (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each(cases)("%s: the %s band, and nothing below its rows, at 750", async (_label, over, key) => {
    const crowned = card(over);
    expect(crownKeyFor({ ...crowned, colorIdentity: crowned.colorIdentity as never }, getFrameProfile(crowned.frameStyle?.template))).toBe(key);
    expect(frameAssetPathsFor(crowned)).toContain(`/frames/m15crown/${key}.png`);
    fetched.length = 0;
    const [a, b] = [await bake(crowned, "default"), await bake(off(crowned), "default")];
    const rows = differingRows(a, b);
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.at(-1)!).toBeLessThan(205); // 410 / 2100 of 1050
    const cmp = await offComposite(a, b, key);
    expect(cmp.mean, `mean ${cmp.mean.toFixed(2)}`).toBeLessThan(1.5);
  }, 60_000);

  it.each(cases.filter(([, , key]) => ["w", "m", "a", "l"].includes(key)).slice(0, 4))(
    "%s: at HD the band is composited 1:1 over the uncrowned card",
    async (_label, over, key) => {
      const crowned = card(over);
      const [a, b] = [await bake(crowned, "hd"), await bake(off(crowned), "hd")];
      const rows = differingRows(a, b);
      expect(rows.at(-1)!).toBeLessThan(410);
      const cmp = await offComposite(a, b, key);
      expect(cmp.max, `max ${cmp.max}`).toBeLessThanOrEqual(3);
      expect(cmp.mean).toBeLessThan(0.5);
      // The crown's peak: the first non-black row at the centre column is
      // row 42 ± 2 (FDN's digital renders: 2.00 %H).
      let peak = -1;
      for (let y = 0; y < 410 && peak < 0; y += 1) {
        const o = (y * a.width + 750) * 4;
        if (a.data[o] + a.data[o + 1] + a.data[o + 2] > 120) peak = y;
      }
      expect(Math.abs(peak - 42), `peak ${peak}`).toBeLessThanOrEqual(2);
    },
    120_000,
  );

  it("absent, off, a planeswalker and a token bake byte-identical to the uncrowned card", async () => {
    const plain = await bake(card({ frameStyle: { template: "m15", finish: "regular" } }), "default");
    expect(differingRows(await bake(card({ frameStyle: { template: "m15", finish: "regular", crown: false } }), "default"), plain)).toEqual([]);
    for (const cardType of ["planeswalker", "token"] as const) {
      const on = await bake(card({ cardType, frameStyle: { template: "m15", finish: "regular", crown: true } }), "default");
      const without = await bake(card({ cardType, frameStyle: { template: "m15", finish: "regular" } }), "default");
      expect(differingRows(on, without), cardType).toEqual([]);
    }
    // A template that draws no crown (devoid, owner round 20): the switch
    // changes nothing. (The snow frames draw the band since 4.6f wave 2c:
    // tests/unit/render/snow-crown-bake.test.tsx.)
    const devoid = { template: "m15devoid" as const, finish: "regular" as const };
    fetched.length = 0;
    expect(frameAssetPathsFor(card({ frameStyle: { ...devoid, crown: true } })).some((p) => p.includes("m15crown"))).toBe(false);
  }, 120_000);

  it.each(["foil", "etched"] as const)("%s: the crown takes the finish, inside the band's rows only", async (finish) => {
    const crowned = card({ frameStyle: { template: "m15", finish, crown: true } });
    const [a, b] = [await bake(crowned, "default"), await bake(off(crowned), "default")];
    const rows = differingRows(a, b);
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.at(-1)!).toBeLessThan(205);
    // The finish shows on the crown: the crowned foil/etched band rows are
    // not the crowned regular bake's.
    const regular = await bake(card({ frameStyle: { template: "m15", finish: "regular", crown: true } }), "default");
    expect(differingRows(a, regular).filter((row) => row < 205).length).toBeGreaterThan(20);
  }, 120_000);

  it("square print output keeps black corners over the crown's cover", async () => {
    const sq = await bake(card(), "hd", "square");
    for (const [x, y] of [
      [0, 0],
      [1499, 0],
      [70, 4],
      [1430, 4],
      [750, 10],
    ]) {
      const o = (y * sq.width + x) * 4;
      expect([sq.data[o], sq.data[o + 1], sq.data[o + 2], sq.data[o + 3]], `(${x}, ${y})`).toEqual([0, 0, 0, 255]);
    }
  }, 60_000);
});
