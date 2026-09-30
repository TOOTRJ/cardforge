import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { setFrameStorageForTests } from "@/lib/frames/frame-url";
import { frameAssetPathsFor, renderCardImage } from "@/lib/render/card-image";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// TODO 4.6b — the pair masters, REALLY baked (Satori, HD) and measured where
// the design measured the prints (design 2026-09-29 §1.2; 47 prints for the
// pinline, 37 for the text box):
//   • pinline at 10.8 and 55.9 %H: 10 / 50 / 90 % of the second colour within
//     ±1.5 %W of 42.2 / 50.3 / 58.8, and no tilt (|Δ50| ≤ 0.4 %W);
//   • text box, and a hybrid's OUTER frame band above the title bar: each
//     pixel de-shaded against the same pixel of the two single-colour bakes
//     (so the texture cancels), within ±1.0 %W of the prints measured the
//     same way — 45.9 / 50.6 / 55.3 (FDN, text-free rows) and 45.1 / 50.3 /
//     55.6 (TLA ×10; the 4.6 review, 2026-09-29: the first masters split the
//     frame band like the pinline, 42 / 50 / 58, and the box at 47.2 / 52 /
//     56.8);
//   • the first canonical colour on the left; gold bars on the gold-split and
//     artifact dresses, grey bars on the hybrid and land ones.
// The bucket masters are read from a local build (FRAMES_BUILD_DIR, else
// <repo>/.frames-build; CI fetches them, docs/FRAMES.md "Bucket masters in
// CI"), each object checked against the manifest's sha256 and served over
// loopback to the bake's real loader; without them the suite is skipped.
// ---------------------------------------------------------------------------

type Entry = { hash: string; sha256: string };
const files = (manifestJson as { files: Record<string, Entry> }).files;
const BUILD = process.env.FRAMES_BUILD_DIR ?? path.join(process.cwd(), ".frames-build");

function localObject(key: string): Buffer | null {
  const file = path.join(BUILD, key);
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === files[key]?.sha256 ? bytes : null;
}

function card(over: Partial<CardPreviewData>): CardPreviewData {
  return {
    title: "Pair Probe",
    cost: "{2}{W}{U}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Bird"],
    rarity: "rare",
    colorIdentity: ["white", "blue"],
    rulesText: null,
    flavorText: null,
    power: "2",
    toughness: "3",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15", twoColor: true },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

const CARDS = {
  goldWU: card({}),
  hybridUR: card({ colorIdentity: ["blue", "red"], cost: "{U/R}{U/R}" }),
  landWU: card({
    cardType: "land",
    subtypes: [],
    cost: null,
    power: null,
    toughness: null,
    frameStyle: { template: "m15land", twoColor: true },
  }),
  artifactWU: card({ supertype: "Artifact", cost: "{1}{W}{W}{U}{U}", frameStyle: { template: "m15artifact", twoColor: true } }),
  goldBG: card({ colorIdentity: ["black", "green"], cost: "{1}{B}{G}" }),
  // The single-colour bakes a pair's split is de-shaded against.
  monoW: card({ colorIdentity: ["white"], cost: "{2}{W}", frameStyle: { template: "m15" } }),
  monoU: card({ colorIdentity: ["blue"], cost: "{2}{U}", frameStyle: { template: "m15" } }),
  monoR: card({ colorIdentity: ["red"], cost: "{2}{R}", frameStyle: { template: "m15" } }),
  landW: card({ colorIdentity: ["white"], cardType: "land", subtypes: [], cost: null, power: null, toughness: null, frameStyle: { template: "m15land" } }),
  landU: card({ colorIdentity: ["blue"], cardType: "land", subtypes: [], cost: null, power: null, toughness: null, frameStyle: { template: "m15land" } }),
  artifactW: card({ colorIdentity: ["white"], supertype: "Artifact", cost: "{2}{W}", frameStyle: { template: "m15artifact" } }),
  artifactU: card({ colorIdentity: ["blue"], supertype: "Artifact", cost: "{2}{U}", frameStyle: { template: "m15artifact" } }),
};

/** Every bucket object a bake of these cards reads (masters, plates). */
function objectsNeeded(): string[] {
  const keys = new Set<string>();
  for (const c of Object.values(CARDS)) {
    for (const p of frameAssetPathsFor(c)) keys.add(p.replace(/^\/frames\//, ""));
  }
  keys.add("m15/wu.png");
  keys.add("m15/ur-h.png");
  keys.add("m15land/wu.png");
  keys.add("m15artifact/wu.png");
  keys.add("m15/bg.png");
  return [...keys].filter((key) => files[key]);
}

const available = objectsNeeded().every((key) => localObject(key) !== null);

type Raw = { data: Buffer; width: number; height: number };
const baked: Partial<Record<keyof typeof CARDS, Raw>> = {};
const sizes: Partial<Record<keyof typeof CARDS, [number, number]>> = {};
let server: http.Server | null = null;
let restore = () => {};

beforeAll(async () => {
  if (!available) return;
  server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
    const m = /^(.*)\.([0-9a-f]{12})(\.[a-z]+)$/.exec(rel);
    const key = m ? `${m[1]}${m[3]}` : rel;
    const bytes = files[key] && (!m || m[2] === files[key].hash) ? localObject(key) : null;
    if (!bytes) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "image/png" });
    res.end(bytes);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as { port: number };
  restore = setFrameStorageForTests({ origin: `http://127.0.0.1:${port}` });
  for (const [name, data] of Object.entries(CARDS)) {
    const res = await renderCardImage(data, "hd", { brandMark: false, watermarkText: null });
    const png = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(png).metadata();
    sizes[name as keyof typeof CARDS] = [meta.width ?? 0, meta.height ?? 0];
    // Measured at the prints' own size (Scryfall's 744 × 1040 PNG), so the
    // smoothing windows are the ones the design's print survey used.
    const { data: px, info } = await sharp(png)
      .flatten({ background: "#ffffff" })
      .resize(744, 1040, { fit: "fill", kernel: "lanczos3" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    baked[name as keyof typeof CARDS] = { data: px, width: info.width, height: info.height };
  }
}, 600_000);

afterAll(async () => {
  restore();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

/** Per-column median RGB over rows [y0, y1] %H — or, with `brightest`,
 *  over each column's brightest pixels only (the text box: no ink, no
 *  texture shadows), as the print survey measured them. */
function columnProfile(raw: Raw, y0Pct: number, y1Pct: number, brightest = false): number[][] {
  const y0 = Math.round((y0Pct / 100) * raw.height);
  const y1 = Math.max(Math.round((y1Pct / 100) * raw.height), y0 + 1);
  const out: number[][] = [];
  for (let x = 0; x < raw.width; x += 1) {
    let rows: number[][] = [];
    for (let y = y0; y < y1; y += 1) {
      const i = (y * raw.width + x) * 3;
      rows.push([raw.data[i], raw.data[i + 1], raw.data[i + 2]]);
    }
    if (brightest) {
      const lum = rows.map((p) => (p[0] + p[1] + p[2]) / 3);
      const sorted = [...lum].sort((a, b) => a - b);
      const threshold = sorted[Math.floor(0.8 * (sorted.length - 1))] - 2;
      rows = rows.filter((_, k) => lum[k] >= threshold);
    }
    out.push(median3(rows));
  }
  return out;
}

function median3(cols: number[][]): number[] {
  return [0, 1, 2].map((c) => {
    const v = cols.map((p) => p[c]).sort((a, b) => a - b);
    const mid = v.length / 2;
    return v.length % 2 ? v[Math.floor(mid)] : (v[mid - 1] + v[mid]) / 2;
  });
}

/** The split along a profile, the print survey's way (crowns/ramps_all.py,
 *  boxramp.py): its two sides' colours (`ref`), the second colour's share
 *  projected on the line between them, smoothed over 9 px, and the first x
 *  in `range` where it reaches 10 / 50 / 90 % and holds `hold` px on. */
function split(
  prof: number[][],
  { ref = [[0.1, 0.22], [0.78, 0.9]], range = [0.2, 0.8], hold = 6 }: { ref?: number[][]; range?: number[]; hold?: number } = {},
) {
  const W = prof.length;
  const left = median3(prof.slice(Math.round(ref[0][0] * W), Math.round(ref[0][1] * W)));
  const right = median3(prof.slice(Math.round(ref[1][0] * W), Math.round(ref[1][1] * W)));
  const v = right.map((r, c) => r - left[c]);
  const n = v.reduce((k, x) => k + x * x, 0);
  const t = prof.map((p) => p.reduce((k, x, c) => k + (x - left[c]) * v[c], 0) / n);
  const s = t.map((_, x) => {
    let sum = 0;
    for (let k = x - 4; k <= x + 4; k += 1) sum += k >= 0 && k < W ? t[k] : 0;
    return sum / 9;
  });
  const at = [0.1, 0.5, 0.9].map((level) => {
    for (let x = Math.round(range[0] * W); x < Math.round(range[1] * W); x += 1) {
      if (s[x] >= level && s[Math.min(x + hold, W - 1)] >= level) return (100 * x) / W;
    }
    return NaN;
  });
  return { left, right, contrast: Math.sqrt(n), at };
}

function expectWithin(at: number[], target: number[], tol: number, label: string) {
  at.forEach((x, i) => expect(Math.abs(x - target[i]), `${label} ${[10, 50, 90][i]} %: ${x.toFixed(1)} vs ${target[i]}`).toBeLessThanOrEqual(tol));
}

const PINLINE = [42.2, 50.3, 58.8];
/** The prints, de-shaded (pair-ramp.mjs PAIR_RAMPS): the text box's
 *  text-free rows on FDN, and a hybrid's frame band on TLA ×10. */
const TEXT_BOX = [45.9, 50.6, 55.3];
const HYBRID_FRAME_BAND = [45.1, 50.3, 55.6];

/** The share of the second colour per column, each pixel of rows
 *  [y0, y1] %H read as (1 − s)·a + s·b against the SAME pixel of the two
 *  single-colour bakes (least squares over the rows; columns where a and b
 *  are alike give no reading), and the first x in 30–70 %W where it
 *  reaches 10 / 50 / 90 %. */
function deshaded(pair: Raw, a: Raw, b: Raw, y0Pct: number, y1Pct: number): number[] {
  const W = pair.width;
  const num = new Float64Array(W);
  const den = new Float64Array(W);
  for (let y = Math.round((y0Pct / 100) * pair.height); y <= Math.round((y1Pct / 100) * pair.height); y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 3;
      let dot = 0;
      let n2 = 0;
      for (let c = 0; c < 3; c += 1) {
        const d = b.data[i + c] - a.data[i + c];
        dot += (pair.data[i + c] - a.data[i + c]) * d;
        n2 += d * d;
      }
      if (n2 < 144) continue;
      num[x] += dot;
      den[x] += n2;
    }
  }
  return [0.1, 0.5, 0.9].map((level) => {
    for (let x = Math.round(0.3 * W); x < Math.round(0.7 * W); x += 1) {
      if (den[x] > 0 && num[x] / den[x] >= level) return ((x + 0.5) / W) * 100;
    }
    return NaN;
  });
}
const pinTop = (raw: Raw) => split(columnProfile(raw, 10.78, 10.94));
const pinType = (raw: Raw) => split(columnProfile(raw, 55.9, 56.12));
const box = (raw: Raw) =>
  split(columnProfile(raw, 63.5, 90.5, true), { ref: [[0.1, 0.2], [0.8, 0.88]], range: [0.25, 0.75], hold: 8 });
const chroma = ([r, g, b]: number[]) => Math.max(r, g, b) - Math.min(r, g, b);
const patch = (raw: Raw, xPct: number, yPct: number) => median3(columnProfile(raw, yPct - 0.15, yPct + 0.15).slice(Math.round((xPct / 100) * raw.width) - 6, Math.round((xPct / 100) * raw.width) + 6));

describe.skipIf(!available)("the pair masters, baked at HD and measured like the prints", () => {
  it.each(["goldWU", "hybridUR", "landWU", "artifactWU", "goldBG"] as const)(
    "%s: the pinline splits where the prints do, untilted",
    (name) => {
      const raw = baked[name]!;
      expect(sizes[name]).toEqual([1500, 2100]);
      const top = pinTop(raw);
      const type = pinType(raw);
      expect(top.contrast, "a real split").toBeGreaterThan(40);
      expectWithin(top.at, PINLINE, 1.5, `${name} pinline 10.8 %H`);
      expectWithin(type.at, PINLINE, 1.5, `${name} pinline 55.9 %H`);
      expect(Math.abs(type.at[1] - top.at[1]), `${name} tilt`).toBeLessThanOrEqual(0.4);
    },
    60_000,
  );

  it.each([
    ["goldWU", "monoW", "monoU"],
    ["hybridUR", "monoU", "monoR"],
    ["landWU", "landW", "landU"],
    ["artifactWU", "artifactW", "artifactU"],
  ] as const)("%s: the text box splits where the prints do (de-shaded)", (name, a, b) => {
    const raw = baked[name]!;
    expect(box(raw).contrast, "a real split").toBeGreaterThan(15);
    expectWithin(deshaded(raw, baked[a]!, baked[b]!, 64, 90), TEXT_BOX, 1.0, `${name} text box`);
  });

  it("the hybrid's OUTER frame band above the title bar splits where the prints do — steeper than its pinline (de-shaded)", () => {
    const raw = baked.hybridUR!;
    for (const [y0, y1] of [
      [2.95, 3.55],
      [3.55, 4.15],
    ]) {
      expectWithin(deshaded(raw, baked.monoU!, baked.monoR!, y0, y1), HYBRID_FRAME_BAND, 1.0, `hybrid frame band ${y0}–${y1} %H`);
    }
  });

  it("the first canonical colour is on the LEFT: white | blue, blue | red, black | green", () => {
    const blueish = ([r, , b]: number[]) => b > r + 40;
    const whiteish = ([r, g, b]: number[]) => Math.min(r, g, b) > 200;
    const redish = ([r, , b]: number[]) => r > b + 60;
    const greenish = ([r, g]: number[]) => g > r + 20;
    const wu = pinTop(baked.goldWU!);
    expect(whiteish(wu.left) && blueish(wu.right), JSON.stringify(wu)).toBe(true);
    const ur = pinTop(baked.hybridUR!);
    expect(blueish(ur.left) && redish(ur.right), JSON.stringify(ur)).toBe(true);
    const bg = pinTop(baked.goldBG!);
    expect(Math.max(...bg.left) < 90 && greenish(bg.right), JSON.stringify(bg)).toBe(true);
  });

  it("gold bars on the gold-split and artifact dresses; grey bars on the hybrid and land ones", () => {
    // The title bar at 5.2 %H, 60–75 %W (right of the name).
    const title = (raw: Raw) => patch(raw, 68, 5.25);
    expect(chroma(title(baked.goldWU!)), "gold").toBeGreaterThan(30);
    expect(chroma(title(baked.artifactWU!)), "gold").toBeGreaterThan(30);
    expect(chroma(title(baked.hybridUR!)), "grey").toBeLessThan(15);
    expect(chroma(title(baked.landWU!)), "grey").toBeLessThan(15);
  });

  it("the hybrid's OUTER frame splits too (blue left, red right); the gold-split's stays gold", () => {
    const frameL = (raw: Raw) => patch(raw, 5.5, 35);
    const frameR = (raw: Raw) => patch(raw, 94.5, 35);
    const [r1, , b1] = frameL(baked.hybridUR!);
    const [r2, , b2] = frameR(baked.hybridUR!);
    expect(b1 > r1 + 40 && r2 > b2 + 40, JSON.stringify([frameL(baked.hybridUR!), frameR(baked.hybridUR!)])).toBe(true);
    // Gold both sides on the gold-split dress (the frame is m.png).
    for (const side of [frameL(baked.goldWU!), frameR(baked.goldWU!)]) {
      const [r, g, b] = side;
      expect(r > b + 30 && g > b + 10, JSON.stringify(side)).toBe(true);
    }
  });
});
