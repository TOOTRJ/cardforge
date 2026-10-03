import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { resolveHoloStamp } from "@/lib/cards/anatomy";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
import { M15_HOLO_STAMP_KEEP_OUT, M15_HOLO_STAMP_OVAL, holoStampArtRect } from "@/lib/cards/holo-stamp";
import { HOLO_STAMP_OVAL_ART } from "@/lib/cards/holo-stamp-art";
import { mainRulesLayout } from "@/lib/cards/rules-box";
import { M15PW_HOLO_STAMP, M15_HOLO_STAMP, getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { RENDER_PRESETS, frameAssetPathsFor, renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { NOTCH_FOOT } from "@/scripts/lib/cc-frames.mjs";
import { STAMP_ARCH_RULES } from "@/tests/visual/matrix";

// ---------------------------------------------------------------------------
// TODO 4.9c — the holofoil stamp in the Satori BAKE on the real profiles,
// with the REAL published masters and notch pieces (m15/*, m15holostamp/*,
// m15pwholostamp/* at the manifest's sha256 — FRAMES_BUILD_DIR, else
// .frames-build; CI fetches them) from a stubbed frames bucket, flat art. At
// both output sizes:
//   • a stamped bake differs from the same card with the key ABSENT only
//     inside the notch slot's rows (the arch and the oval) — every other row
//     is byte-identical, so nothing above the bottom border moves;
//   • in the notch rect, outside the oval's art rect, it IS the notch piece
//     composited over the plain bake (±3 levels: 1:1 at HD);
//   • the oval's art rect holds our silver bitmap — light at its centre, the
//     notch's black at its margin — above the sheens: a foil bake's oval
//     centre equals the regular bake's, while its notch rows do sparkle;
//   • the notch follows the master's key: the colour, a colourless
//     artifact's silver "a", a colourless land's taupe "l", a coloured
//     land's colour, every devoid key's grey "c", a snow frame's colour, the
//     walker's own piece;
//   • a card drawn as its PAIR master (the 4.9c follow-up) takes the
//     pair's notch on the split and the hybrid dress, on m15artifact and
//     m15land too: at HD the piece 1:1 over the pair master, its rim foot
//     the master's own bar at every column of both feet (the bar is a
//     40→60 %W ramp; the stamped bake equals the plain one there), and the
//     arch keep-out applies as on a mono card;
//   • absent, "none", "auto" on a common, a token and an emblem bake
//     byte-identical to the key-absent card; "oval" on a common and an
//     imported "triangle" on an oval frame both draw the frame's oval;
//   • a full rules box steps down for the arch (the keep-out) while a short
//     block never moves;
//   • frameAssetPathsFor lists the notch only while the stamp is drawn.
// The live preview's twin: tests/unit/components/holo-stamp-preview.test.tsx.
// Set HOLO_STAMP_BAKE_SAVE_DIR to keep the PNGs (local inspection only).
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.test";
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;
const SAVE_DIR = process.env.HOLO_STAMP_BAKE_SAVE_DIR ?? null;

/** A published object's bytes when a copy at the manifest's sha is here. */
function real(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!REAL[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === REAL[rel].sha256 ? bytes : null;
}

const MASTERS = [
  "m15/w", "m15/u", "m15/b", "m15/r", "m15/g", "m15/m", "m15/c", "m15/wu", "m15/gw-h",
  "m15artifact/c", "m15artifact/u", "m15artifact/ur", "m15land/c", "m15land/g", "m15land/bg",
  "m15snow/r", "m15snowland/c", "m15devoid/u", "m15pw/w", "m15pw/c",
  "m15token/g",
  "m15/pt/w", "m15/pt/u", "m15/pt/b", "m15/pt/r", "m15/pt/g", "m15/pt/m", "m15/pt/c",
  "m15artifact/pt/c", "m15artifact/pt/u", "m15artifact/pt/m", "m15snow/pt/r", "m15devoid/pt/u", "m15pw/loyalty/w", "m15pw/loyalty/c",
];
const NOTCHES = ["w", "u", "b", "r", "g", "m", "a", "l", "c", "wu", "gw", "ur", "bg"].map((k) => `m15holostamp/${k}`).concat(["w", "c"].map((k) => `m15pwholostamp/${k}`));
const objects = Object.fromEntries([...MASTERS, ...NOTCHES].map((rel) => [rel, real(`${rel}.png`)]));
const available = Object.values(objects).every((b) => b !== null);

let artUrl = "";
let restore: () => void = () => {};

async function png(w: number, h: number, rgb: readonly number[]) {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } } })
    .png()
    .toBuffer();
}

beforeAll(async () => {
  if (!available) return;
  artUrl = `data:image/png;base64,${(await png(1200, 900, [40, 160, 200])).toString("base64")}`;
  const files: Record<string, Buffer> = Object.fromEntries(Object.entries(objects).map(([rel, buf]) => [`${rel}.png`, buf!]));
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
    title: "Kesh, Emberforge Warden",
    cost: "{2}{B}{B}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Phyrexian", "Praetor"],
    rarity: "mythic",
    colorIdentity: ["black"],
    rulesText: "Deathtouch\nWhenever you draw a card, you gain 2 life.",
    flavorText: null,
    power: "4",
    toughness: "5",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl,
    artPosition: {},
    frameStyle: { template: "m15", finish: "regular", stamp: "auto" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

type Raw = { data: Buffer; width: number; height: number };
async function bake(data: CardPreviewData, preset: RenderPreset, opts: { brandMark?: boolean; name?: string } = {}): Promise<Raw> {
  const res = await renderCardImage({ ...data, artUrl }, preset, { brandMark: opts.brandMark ?? true, watermarkText: null, corners: "round" });
  const bytes = Buffer.from(await res.arrayBuffer());
  if (SAVE_DIR && opts.name) {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
    fs.writeFileSync(path.join(SAVE_DIR, `${opts.name}-${preset}.png`), bytes);
  }
  const { data: px, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: px, width: info.width, height: info.height };
}

const withoutKey = (data: CardPreviewData): CardPreviewData => {
  const { stamp: _stamp, ...rest } = data.frameStyle ?? {};
  void _stamp;
  return { ...data, frameStyle: rest };
};

function differingRows(a: Raw, b: Raw): number[] {
  const rows = new Set<number>();
  for (let i = 0; i < a.data.length; i += 1) if (a.data[i] !== b.data[i]) rows.add(Math.floor(i / 4 / a.width));
  return [...rows].sort((x, y) => x - y);
}

function box(rect: Rect, raw: Raw) {
  return {
    x0: Math.round((rect.leftPct / 100) * raw.width),
    y0: Math.round((rect.topPct / 100) * raw.height),
    x1: Math.round(((rect.leftPct + rect.widthPct) / 100) * raw.width),
    y1: Math.round(((rect.topPct + rect.heightPct) / 100) * raw.height),
  };
}

const px = (raw: Raw, x: number, y: number) => {
  const o = (y * raw.width + x) * 4;
  return [raw.data[o], raw.data[o + 1], raw.data[o + 2], raw.data[o + 3]];
};

/** How far a stamped bake's notch rect (outside the oval's art rect) is
 *  from the notch piece composited (straight alpha) onto the plain bake,
 *  the piece resized to the output's own slot box. */
async function offComposite(stamped: Raw, plain: Raw, piece: Buffer, slot: Rect, artRect: Rect) {
  const b = box(slot, stamped);
  const a = box(artRect, stamped);
  const W = b.x1 - b.x0;
  const H = b.y1 - b.y0;
  const { data: notch } = await sharp(piece).resize(W, H, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const cx = b.x0 + x;
      const cy = b.y0 + y;
      if (cx >= a.x0 - 1 && cx < a.x1 + 1 && cy >= a.y0 - 1 && cy < a.y1 + 1) continue; // our oval (and its edge)
      const o = (cy * stamped.width + cx) * 4;
      const no = (y * W + x) * 4;
      const alpha = notch[no + 3] / 255;
      for (let c = 0; c < 3; c += 1) {
        const want = notch[no + c] * alpha + plain.data[o + c] * (1 - alpha);
        const d = Math.abs(stamped.data[o + c] - want);
        if (d > max) max = d;
        sum += d;
        n += 1;
      }
    }
  }
  return { max, mean: sum / n };
}

const ART = holoStampArtRect(M15_HOLO_STAMP_OVAL);

/** The visual matrix's "@stamp-arch" text: its fitted last line enters the
 *  arch on m15 (tests/visual/matrix.ts STAMP_ARCH_RULES). */
const ARCH_RULES = STAMP_ARCH_RULES;

/** Two-colour cards drawn as their pair masters (FrameStyle.twoColor on, a
 *  stored pair): the four masters one pair notch serves. */
const PAIR_CARDS: Record<"split" | "hybrid" | "artifact" | "land", Partial<CardPreviewData>> = {
  split: { rarity: "rare", colorIdentity: ["white", "blue"], cost: "{1}{W}{U}", frameStyle: { template: "m15", finish: "regular", twoColor: true, stamp: "auto" } },
  hybrid: { rarity: "rare", colorIdentity: ["green", "white"], cost: "{G/W}{G/W}", frameStyle: { template: "m15", finish: "regular", twoColor: true, stamp: "auto" } },
  artifact: {
    rarity: "mythic",
    cardType: "artifact",
    colorIdentity: ["blue", "red"],
    cost: "{U}{R}",
    power: null,
    toughness: null,
    frameStyle: { template: "m15artifact", finish: "regular", twoColor: true, stamp: "auto" },
  },
  land: {
    rarity: "rare",
    cardType: "land",
    colorIdentity: ["black", "green"],
    cost: null,
    power: null,
    toughness: null,
    frameStyle: { template: "m15land", finish: "regular", twoColor: true, stamp: "auto" },
  },
};

type Case = [string, Partial<CardPreviewData>, string, string];
const cases: Case[] = [
  ["mythic black creature on m15", {}, "m15holostamp", "b"],
  ["rare white creature", { rarity: "rare", colorIdentity: ["white"], cost: "{2}{W}" }, "m15holostamp", "w"],
  ["rare gold creature", { rarity: "rare", colorIdentity: ["white", "blue", "black"], cost: "{W}{U}{B}" }, "m15holostamp", "m"],
  ["rare colourless creature (m15's grey)", { rarity: "rare", colorIdentity: ["colorless"], cost: "{7}" }, "m15holostamp", "c"],
  [
    "rare colourless artifact (the artifact silver)",
    { rarity: "rare", cardType: "artifact", colorIdentity: ["colorless"], cost: "{3}", power: null, toughness: null, frameStyle: { template: "m15artifact", finish: "regular", stamp: "auto" } },
    "m15holostamp",
    "a",
  ],
  [
    "rare blue artifact (its colour)",
    { rarity: "rare", cardType: "artifact", colorIdentity: ["blue"], cost: "{1}{U}", power: null, toughness: null, frameStyle: { template: "m15artifact", finish: "regular", stamp: "auto" } },
    "m15holostamp",
    "u",
  ],
  [
    "rare colourless land (the land taupe)",
    { rarity: "rare", cardType: "land", colorIdentity: ["colorless"], cost: null, power: null, toughness: null, frameStyle: { template: "m15land", finish: "regular", stamp: "auto" } },
    "m15holostamp",
    "l",
  ],
  [
    "rare green land (its colour)",
    { rarity: "rare", cardType: "land", colorIdentity: ["green"], cost: null, power: null, toughness: null, frameStyle: { template: "m15land", finish: "regular", stamp: "auto" } },
    "m15holostamp",
    "g",
  ],
  [
    "rare red snow creature (M15's red notch)",
    { rarity: "rare", colorIdentity: ["red"], cost: "{2}{R}", supertype: "Snow", frameStyle: { template: "m15snow", finish: "regular", stamp: "auto" } },
    "m15holostamp",
    "r",
  ],
  [
    "rare colourless snow land (the land taupe)",
    { rarity: "rare", cardType: "land", colorIdentity: ["colorless"], cost: null, power: null, toughness: null, supertype: "Snow", frameStyle: { template: "m15snowland", finish: "regular", stamp: "auto" } },
    "m15holostamp",
    "l",
  ],
  [
    "rare blue devoid creature (every devoid key: the grey notch)",
    { rarity: "rare", colorIdentity: ["blue"], cost: "{3}{U}", frameStyle: { template: "m15devoid", finish: "regular", stamp: "auto" } },
    "m15holostamp",
    "c",
  ],
  // The pair frames (the 4.9c follow-up): the pair's notch over the pair
  // master — the gold-split dress, the hybrid dress (the same piece: the
  // bar under the notch is the same pixels), an artifact pair, a land pair.
  ["rare W|U creature drawn as its pair master", PAIR_CARDS.split, "m15holostamp", "wu"],
  ["rare G|W hybrid creature (the hybrid dress)", PAIR_CARDS.hybrid, "m15holostamp", "gw"],
  ["mythic U|R artifact pair", PAIR_CARDS.artifact, "m15holostamp", "ur"],
  ["rare B|G land pair", PAIR_CARDS.land, "m15holostamp", "bg"],
];

const walker = (over: Partial<CardPreviewData> = {}): CardPreviewData =>
  card({
    title: "Karn, Scion of Urza",
    cardType: "planeswalker",
    supertype: "Legendary",
    subtypes: ["Karn"],
    rarity: "mythic",
    colorIdentity: ["colorless"],
    cost: "{4}",
    power: null,
    toughness: null,
    loyalty: "5",
    rulesText: "+1: Reveal the top two cards of your library.\n−1: Put a card exiled with Karn into your hand.\n−2: Create a 0/0 colorless Construct artifact creature token.",
    frameStyle: { template: "m15pw", finish: "regular", stamp: "auto" },
    ...over,
  });

describe.skipIf(!available)("the holofoil stamp in the bake — the real masters and notch pieces (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each(cases)("%s: the %s/%s notch and the oval, nothing else moves, at 750", async (label, over, folder, key) => {
    const name = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const stamped = card(over);
    const resolved = resolveHoloStamp(getFrameProfile(stamped.frameStyle?.template), stamped.frameStyle, {
      colors: stamped.colorIdentity,
      cost: stamped.cost,
      cardType: stamped.cardType,
      supertype: stamped.supertype,
      rarity: stamped.rarity,
      colorKey: pickFrameColorKey(stamped.colorIdentity),
    });
    expect(resolved?.notch.path).toBe(`/frames/${folder}/${key}.png`);
    const on = await bake(stamped, "default", { name });
    const off = await bake(withoutKey(stamped), "default", { name: `${name}-off` });
    const slot = box(M15_HOLO_STAMP.rect, on);
    const rows = differingRows(on, off);
    expect(rows.length).toBeGreaterThan(20);
    expect(rows[0]).toBeGreaterThanOrEqual(slot.y0 - 1);
    expect(rows[rows.length - 1]).toBeLessThanOrEqual(slot.y1 + 1);
    // The notch piece over the plain bake, outside our oval (the 750 bake
    // resamples the piece 2:1 — the edges differ from sharp's resampling
    // by up to ~40 levels, the mean stays ≈ 1; the HD test holds 1:1).
    const fit = await offComposite(on, off, objects[`${folder}/${key}`]!, M15_HOLO_STAMP.rect, ART);
    expect(fit.max, `max ${fit.max} mean ${fit.mean.toFixed(2)}`).toBeLessThanOrEqual(48);
    expect(fit.mean).toBeLessThanOrEqual(1.5);
    // The oval: silver at its centre, the notch's black at its margin (the
    // art rect's first column at 750 is the margin's 1.5 px).
    const a = box(ART, on);
    const centre = px(on, Math.round((a.x0 + a.x1) / 2), Math.round((a.y0 + a.y1) / 2));
    expect(centre[0] + centre[1] + centre[2]).toBeGreaterThan(3 * 120);
    const margin = px(on, a.x0, Math.round((a.y0 + a.y1) / 2));
    expect(margin[0] + margin[1] + margin[2]).toBeLessThan(60);
  }, 60_000);

  it("at HD the notch is the piece 1:1 over the master, and the oval bitmap sits at its art rect", async () => {
    const stamped = card();
    const on = await bake(stamped, "hd", { name: "mythic-black-hd" });
    const off = await bake(withoutKey(stamped), "hd", { name: "mythic-black-hd-off" });
    const slot = box(M15_HOLO_STAMP.rect, on);
    expect(slot).toEqual({ x0: 654, y0: 1899, x1: 846, y1: 1995 });
    const rows = differingRows(on, off);
    expect(rows[0]).toBeGreaterThanOrEqual(slot.y0 - 1);
    expect(rows[rows.length - 1]).toBeLessThanOrEqual(slot.y1 + 1);
    const fit = await offComposite(on, off, objects["m15holostamp/b"]!, M15_HOLO_STAMP.rect, ART);
    expect(fit.max, `max ${fit.max} mean ${fit.mean.toFixed(2)}`).toBeLessThanOrEqual(8);
    expect(fit.mean).toBeLessThanOrEqual(0.5);
    // The art rect: the oval 683–817 × 1926–1993 grown by 3 px.
    expect(box(ART, on)).toEqual({ x0: 680, y0: 1923, x1: 820, y1: 1996 });
    // The bitmap itself, scaled 2:1 to the rect, is what the bake drew
    // inside the oval — resvg and sharp resample its fine sheen lines
    // differently (a few levels on the mean, more on single pixels), and
    // the margin is the notch's black (the oval's edge is never a seam).
    const { data: art, info } = await sharp(Buffer.from(HOLO_STAMP_OVAL_ART.dataUri.split(",")[1], "base64"))
      .resize(140, 73, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let max = 0;
    let sum = 0;
    let n = 0;
    for (let y = 10; y < info.height - 10; y += 1) {
      for (let x = 15; x < info.width - 15; x += 1) {
        const o = (y * info.width + x) * 4;
        if (art[o + 3] < 255) continue;
        const have = px(on, 680 + x, 1923 + y);
        for (let c = 0; c < 3; c += 1) {
          const d = Math.abs(have[c] - art[o + c]);
          max = Math.max(max, d);
          sum += d;
          n += 1;
        }
      }
    }
    expect(max).toBeLessThanOrEqual(40);
    expect(sum / n).toBeLessThanOrEqual(4);
    expect(px(on, 681, 1959).slice(0, 3)).toEqual([0, 0, 0]);
    expect(px(on, 750, 1924).slice(0, 3)).toEqual([0, 0, 0]);
    const centre = px(on, 750, 1959);
    expect(centre[0] + centre[1] + centre[2]).toBeGreaterThan(3 * 120);
  }, 60_000);

  it("the walker takes its own piece (the colourless walker's grey, the white walker's white), 7 px higher", async () => {
    const walkers: Array<[Partial<CardPreviewData>, string]> = [
      [{}, "c"],
      [{ colorIdentity: ["white"], cost: "{3}{W}" }, "w"],
    ];
    for (const [over, key] of walkers) {
      const stamped = walker(over);
      const resolved = resolveHoloStamp(getFrameProfile("m15pw"), stamped.frameStyle, {
        colors: stamped.colorIdentity,
        cardType: "planeswalker",
        rarity: "mythic",
        colorKey: pickFrameColorKey(stamped.colorIdentity),
      });
      expect(resolved?.notch.path).toBe(`/frames/m15pwholostamp/${key}.png`);
      expect(resolved?.oval.topPct).toBeCloseTo(M15_HOLO_STAMP_OVAL.topPct - (7 / 2100) * 100, 6);
      const on = await bake(stamped, "default", { name: `walker-${key}` });
      const off = await bake(withoutKey(stamped), "default");
      const slot = box(M15PW_HOLO_STAMP.rect, on);
      const rows = differingRows(on, off);
      expect(rows.length).toBeGreaterThan(20);
      expect(rows[0]).toBeGreaterThanOrEqual(slot.y0 - 1);
      expect(rows[rows.length - 1]).toBeLessThanOrEqual(slot.y1 + 1);
    }
  }, 60_000);

  it("the pair notch at HD: the piece 1:1 over the pair master, its foot the master's bar at every column of both feet, the keep-out on", async () => {
    // The foot columns NOTCH_FOOT reads (piece px → card px at HD), on both
    // feet: each stands on its own side of the bar's 40→60 %W ramp.
    const foot = NOTCH_FOOT.m15holostamp;
    const slot = { x0: 654, y0: 1899 };
    for (const [label, over, key] of [
      ["split", PAIR_CARDS.split, "wu"],
      ["hybrid", PAIR_CARDS.hybrid, "gw"],
      ["artifact", PAIR_CARDS.artifact, "ur"],
      ["land", PAIR_CARDS.land, "bg"],
    ] as const) {
      const stamped = card(over);
      const resolved = resolveHoloStamp(getFrameProfile(stamped.frameStyle?.template), stamped.frameStyle, {
        colors: stamped.colorIdentity,
        cost: stamped.cost,
        cardType: stamped.cardType,
        supertype: stamped.supertype,
        rarity: stamped.rarity,
        colorKey: pickFrameColorKey(stamped.colorIdentity),
      });
      expect(resolved?.notch.path, label).toBe(`/frames/m15holostamp/${key}.png`);
      expect(resolved?.keepOut, label).toEqual(M15_HOLO_STAMP_KEEP_OUT);
      const on = await bake(stamped, "hd", { name: `pair-${label}-hd` });
      const off = await bake(withoutKey(stamped), "hd", { name: `pair-${label}-hd-off` });
      const rows = differingRows(on, off);
      expect(rows.length, label).toBeGreaterThan(40);
      expect(rows[0], label).toBeGreaterThanOrEqual(slot.y0 - 1);
      expect(rows[rows.length - 1], label).toBeLessThanOrEqual(1995 + 1);
      const fit = await offComposite(on, off, objects[`m15holostamp/${key}`]!, M15_HOLO_STAMP.rect, ART);
      expect(fit.max, `${label}: max ${fit.max} mean ${fit.mean.toFixed(2)}`).toBeLessThanOrEqual(8);
      expect(fit.mean, label).toBeLessThanOrEqual(0.5);
      // No seam: at the foot row, every solid-rim column of both feet is the
      // plain bake's own bar pixel (the piece's rim there IS the bar).
      let seam = 0;
      for (const [x0, x1] of foot.runs) {
        for (let x = x0; x <= x1; x += 1) {
          const a = px(on, slot.x0 + x, slot.y0 + foot.y);
          const b = px(off, slot.x0 + x, slot.y0 + foot.y);
          for (let c = 0; c < 3; c += 1) seam = Math.max(seam, Math.abs(a[c] - b[c]));
        }
      }
      expect(seam, `${label}: the foot differs from the bar by ${seam}`).toBeLessThanOrEqual(1);
      // …and the two feet are NOT one colour: the left stands on the first
      // colour's side of the ramp, the right on the second's.
      const left = px(on, slot.x0 + foot.runs[0][0] + 2, slot.y0 + foot.y);
      const right = px(on, slot.x0 + foot.runs[1][1] - 2, slot.y0 + foot.y);
      expect(Math.max(...[0, 1, 2].map((c) => Math.abs(left[c] - right[c]))), label).toBeGreaterThan(20);
    }
  }, 240_000);

  it("a full rules box on a pair steps down for the arch like a mono card", async () => {
    const stamped = card({ ...PAIR_CARDS.split, rulesText: ARCH_RULES });
    const on = await bake(stamped, "default", { name: "pair-full-box" });
    const off = await bake(withoutKey(stamped), "default");
    const rows = differingRows(on, off);
    const rulesTop = Math.round((getFrameProfile("m15").rules.rect.topPct / 100) * on.height);
    expect(rows[0]).toBeLessThan(rulesTop + 40);
  }, 60_000);

  it("absent, Never, Auto on a common, a token and an emblem bake byte-identical to the key-absent card", async () => {
    const plain = await bake(withoutKey(card()), "default");
    const none = await bake(card({ frameStyle: { template: "m15", finish: "regular", stamp: "none" } }), "default");
    expect(Buffer.compare(none.data, plain.data)).toBe(0);
    for (const rarity of ["common", "uncommon"] as const) {
      const on = await bake(card({ rarity }), "default");
      const off = await bake(withoutKey(card({ rarity })), "default");
      expect(Buffer.compare(on.data, off.data), `auto on a ${rarity}`).toBe(0);
    }
    // A token on its token frame (no notch declared) and a token TYPE on
    // m15 (never a stamp), an emblem: each equal to itself with the key
    // absent. (A card drawn as its pair master draws the pair's notch since
    // the 4.9c follow-up — the pair cases above.)
    for (const [label, data] of [
      ["token on m15token", card({ cardType: "token", rarity: "rare", colorIdentity: ["green"], cost: null, frameStyle: { template: "m15token", finish: "regular", stamp: "oval" } })],
      ["token type on m15", card({ cardType: "token", rarity: "rare", frameStyle: { template: "m15", finish: "regular", stamp: "oval" } })],
      ["emblem type on m15", card({ cardType: "emblem", rarity: "rare", frameStyle: { template: "m15", finish: "regular", stamp: "oval" } })],
    ] as const) {
      const on = await bake(data, "default");
      const off = await bake(withoutKey(data), "default");
      expect(Buffer.compare(on.data, off.data), label).toBe(0);
    }
  }, 120_000);

  it("Always on a common and an imported triangle on an oval frame both draw the frame's oval", async () => {
    const plain = await bake(withoutKey(card({ rarity: "common" })), "default");
    const always = await bake(card({ rarity: "common", frameStyle: { template: "m15", finish: "regular", stamp: "oval" } }), "default", { name: "common-always" });
    const triangle = await bake(card({ rarity: "common", frameStyle: { template: "m15", finish: "regular", stamp: "triangle" } }), "default");
    expect(Buffer.compare(always.data, plain.data)).not.toBe(0);
    expect(Buffer.compare(always.data, triangle.data)).toBe(0);
  }, 60_000);

  it("the notch is inside the foil mask and the oval stays outside it", async () => {
    const foil = (stamp: "auto" | undefined) =>
      card({ frameStyle: stamp ? { template: "m15", finish: "foil", stamp } : { template: "m15", finish: "foil" } });
    const on = await bake(foil("auto"), "default", { name: "mythic-black-foil" });
    const off = await bake(foil(undefined), "default");
    const regular = await bake(card(), "default");
    const slot = box(M15_HOLO_STAMP.rect, on);
    const rows = differingRows(on, off);
    expect(rows[0]).toBeGreaterThanOrEqual(slot.y0 - 1);
    expect(rows[rows.length - 1]).toBeLessThanOrEqual(slot.y1 + 1);
    // The oval's interior is the same pixels on the foil and the regular
    // bake: the sheen never tints it.
    const a = box(ART, on);
    let max = 0;
    for (let y = a.y0 + 12; y < a.y1 - 12; y += 1) {
      for (let x = a.x0 + 20; x < a.x1 - 20; x += 1) {
        const p = px(on, x, y);
        const q = px(regular, x, y);
        for (let c = 0; c < 3; c += 1) max = Math.max(max, Math.abs(p[c] - q[c]));
      }
    }
    expect(max).toBeLessThanOrEqual(1);
  }, 60_000);

  it("a full rules box steps down for the arch; a short block never moves", async () => {
    const profile = getFrameProfile("m15");
    const full = ARCH_RULES;
    const show = { pt: true, loyalty: false, defense: false, secondFacePt: false };
    const without = mainRulesLayout({ layout: profile, rulesText: full, flavorText: null, aspect: 7 / 5, show });
    const withArch = mainRulesLayout({ layout: profile, rulesText: full, flavorText: null, aspect: 7 / 5, show: { ...show, stamp: M15_HOLO_STAMP_KEEP_OUT } });
    // Without the arch the last line's ink ends at 1910 px, across x
    // 132–839 — into the arch (x 655–845 from 1905); with it the ladder
    // steps 50 → 48 px and the block clears it.
    expect(Math.round(without.sizePct * 1500)).toBe(50);
    expect(Math.round(withArch.sizePct * 1500)).toBe(48);
    const shortWithout = mainRulesLayout({ layout: profile, rulesText: "Deathtouch", flavorText: null, aspect: 7 / 5, show });
    const shortWith = mainRulesLayout({ layout: profile, rulesText: "Deathtouch", flavorText: null, aspect: 7 / 5, show: { ...show, stamp: M15_HOLO_STAMP_KEEP_OUT } });
    // The same size, lines and placement; only the input's keep-out list differs.
    const strip = (l: typeof shortWith) => ({ ...l, input: { ...l.input, keepOuts: undefined } });
    expect(strip(shortWith)).toEqual(strip(shortWithout));
    // …and in the bake: the full box's rows differ, the stamp drawn.
    const stamped = card({ rulesText: full });
    const on = await bake(stamped, "default", { name: "full-box" });
    const off = await bake(withoutKey(stamped), "default", { name: "full-box-off" });
    const rows = differingRows(on, off);
    const rulesTop = Math.round((profile.rules.rect.topPct / 100) * on.height);
    expect(rows[0]).toBeLessThan(rulesTop + 40);
  }, 60_000);

  it("frameAssetPathsFor lists the notch only while the stamp is drawn", () => {
    expect(frameAssetPathsFor(card())).toContain("/frames/m15holostamp/b.png");
    expect(frameAssetPathsFor(withoutKey(card()))).not.toContain("/frames/m15holostamp/b.png");
    expect(frameAssetPathsFor(card({ rarity: "common" }))).not.toContain("/frames/m15holostamp/b.png");
    expect(frameAssetPathsFor(walker())).toContain("/frames/m15pwholostamp/c.png");
    // A pair card preloads the pair's notch (its plate beside it; the
    // masters come through the bucket loader).
    expect(frameAssetPathsFor(card(PAIR_CARDS.split))).toEqual(["/frames/m15/pt/m.png", "/frames/m15holostamp/wu.png"]);
    expect(frameAssetPathsFor(card(PAIR_CARDS.hybrid))).toEqual(["/frames/m15/pt/c.png", "/frames/m15holostamp/gw.png"]);
    expect(frameAssetPathsFor(withoutKey(card(PAIR_CARDS.split)))).toEqual(["/frames/m15/pt/m.png"]);
    expect(frameAssetPathsFor(card({ frameStyle: { template: "m15", finish: "regular", stamp: "none" } }))).not.toContain("/frames/m15holostamp/b.png");
    expect(RENDER_PRESETS.hd.width).toBe(1500);
  });
});
