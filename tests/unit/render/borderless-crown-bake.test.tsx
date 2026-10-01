import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { frameColorKeysFor, frameMasterKey } from "@/components/cards/frame-layer";
import { crownKeyFor, showsCrown } from "@/lib/cards/crown";
import { getFrameProfile } from "@/lib/cards/template-layout";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { resetFrameAssetCacheForTests } from "@/lib/render/card-frames";
import { frameAssetPathsFor, renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6f (wave 2a) — the borderless floating crown and the pinline-split
// pair in the Satori BAKE, with the REAL published masters (m15borderless /
// m15borderlessartifact at the manifest's sha256 — FRAMES_BUILD_DIR, else
// .frames-build; CI fetches them) from a stubbed frames bucket, flat art.
// The crown is no overlay band here but the master's crowned twin
// (`<key>-legendary`, FrameProfile.crownMasters): the bake preloads and paints
// that file for a Legendary card with the switch on, and the plain master
// otherwise. At both output sizes:
//   • a crowned bake differs from the same card with the crown off ONLY above
//     12.4 %H (the outline's last row, 259 / 2100): the title, type line, art
//     window, text box and every slot move 0 px;
//   • absent / off / a planeswalker type bake byte-identical to today;
//   • the pair (twoColor on) paints `<pair>` — the hybrid cost `<pair>-h` —
//     and with the crown too `<pair>-legendary`; a pair drawn gold (the switch
//     off) wears the gold crown `m-legendary`;
//   • the artifact dress's colourless card paints `c-legendary`: CC's artifact
//     crown on the artifact frame;
//   • foil keeps the crown inside its mask (the twin IS the master).
// The live preview's twin: tests/unit/components/crown-preview.test.tsx.
// ---------------------------------------------------------------------------

const ORIGIN = "https://frames.test";
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const REAL = (manifestJson as { files: Record<string, Entry> }).files;
const TEMPLATES = ["m15borderless", "m15borderlessartifact"] as const;

/** Every published PNG of the two templates (masters, twins, plates) whose
 *  local copy is at the manifest's sha. */
function realFiles(): Record<string, Buffer> | null {
  const out: Record<string, Buffer> = {};
  for (const rel of Object.keys(REAL)) {
    if (!TEMPLATES.some((t) => rel.startsWith(`${t}/`)) || !rel.endsWith(".png")) continue;
    const file = path.join(BUILD, rel);
    if (!fs.existsSync(file)) return null;
    const bytes = fs.readFileSync(file);
    if (createHash("sha256").update(bytes).digest("hex") !== REAL[rel].sha256) return null;
    out[rel] = bytes;
  }
  return Object.keys(out).length > 0 ? out : null;
}
const files = realFiles();
const available = files !== null && ["m15borderless/b-legendary.png", "m15borderless/wu-h-legendary.png", "m15borderlessartifact/c-legendary.png"].every((k) => files[k]);

const ART_RGB = [40, 160, 200] as const;
let artUrl = "";
let restore: () => void = () => {};
const fetched: string[] = [];

async function png(w: number, h: number, rgb: readonly number[], alpha = 1) {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha } } })
    .png()
    .toBuffer();
}

beforeAll(async () => {
  if (!available || !files) return;
  artUrl = `data:image/png;base64,${(await png(1500, 2100, ART_RGB)).toString("base64")}`;
  const { frameObjectKey, setFrameStorageForTests } = await import("@/lib/frames/frame-url");
  const manifest = {
    version: 1 as const,
    bucket: "frames",
    files: Object.fromEntries(Object.keys(files).map((key) => [key, REAL[key]])),
  };
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
    title: "Sung Jin-Woo, Shadow Monarch",
    cost: "{3}{B}{B}",
    cardType: "creature",
    supertype: "Legendary",
    subtypes: ["Human", "Warrior"],
    rarity: "mythic",
    colorIdentity: ["black"],
    rulesText: "Menace\nWhenever a creature dies, create a 2/2 black Shadow creature token.",
    flavorText: null,
    power: "5",
    toughness: "5",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl,
    artPosition: {},
    frameStyle: { template: "m15borderless", finish: "regular", crown: true },
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

const off = (data: CardPreviewData): CardPreviewData => ({ ...data, frameStyle: { ...data.frameStyle, crown: false } });
const masterOf = (data: CardPreviewData) =>
  frameMasterKey(getFrameProfile(data.frameStyle?.template), data.colorIdentity as ColorIdentity[], data, data.frameStyle);

const cases: Array<[string, Partial<CardPreviewData>, string, string]> = [
  ["legendary black creature", {}, "b-legendary", "b"],
  ["legendary three-colour creature (gold)", { colorIdentity: ["white", "blue", "black"], cost: "{W}{U}{B}" }, "m-legendary", "m"],
  ["legendary pair, two-colour switch off (gold)", { colorIdentity: ["white", "blue"], cost: "{1}{W}{U}" }, "m-legendary", "m"],
  [
    "legendary pair, two-colour switch on (the split pinline and crown)",
    { colorIdentity: ["white", "blue"], cost: "{1}{W}{U}", frameStyle: { template: "m15borderless", finish: "regular", crown: true, twoColor: true } },
    "wu-legendary",
    "wu",
  ],
  [
    "legendary hybrid pair, two-colour switch on (the grey-barred dress and its crown)",
    { colorIdentity: ["white", "blue"], cost: "{W/U}{W/U}", frameStyle: { template: "m15borderless", finish: "regular", crown: true, twoColor: true } },
    "wu-h-legendary",
    "wu",
  ],
  ["legendary colourless creature (the see-through frame's crown)", { colorIdentity: ["colorless"], cost: "{10}" }, "c-legendary", "c"],
  [
    "legendary colourless artifact (the artifact dress: CC's artifact crown)",
    { cardType: "artifact", colorIdentity: ["colorless"], cost: "{3}", power: null, toughness: null, frameStyle: { template: "m15borderlessartifact", finish: "regular", crown: true } },
    "c-legendary",
    "c",
  ],
  [
    "legendary blue artifact (its colour)",
    { cardType: "artifact", colorIdentity: ["blue"], cost: "{1}{U}", frameStyle: { template: "m15borderlessartifact", finish: "regular", crown: true } },
    "u-legendary",
    "u",
  ],
];

/** The outline's last row at HD (259 / 2100 = 12.33 %H); 130 at 750 × 1050. */
const LAST_ROW = { default: 130, hd: 259 } as const;

describe.skipIf(!available)("the borderless crown in the bake — the real twins (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each(cases)("%s: paints the %s master, differing from the switch off only above the outline's last row, at 750", async (_label, over, key, crownKey) => {
    const crowned = card(over);
    const template = crowned.frameStyle!.template!;
    expect(masterOf(crowned)).toBe(key);
    expect(masterOf(off(crowned))).toBe(key.replace(/-legendary$/, ""));
    expect(crownKeyFor({ ...crowned, colorIdentity: crowned.colorIdentity as never }, getFrameProfile(template))).toBe(crownKey);
    expect(showsCrown({ ...off(crowned), colorIdentity: crowned.colorIdentity as never }, getFrameProfile(template))).toBe(false);
    // The master the bake preloads (preloadFrame reads frameColorKeysFor);
    // no crown band joins the asset list on these frames.
    expect(frameColorKeysFor(getFrameProfile(template), crowned.colorIdentity as ColorIdentity[], crowned, crowned.frameStyle)).toEqual([key]);
    expect(frameAssetPathsFor(crowned).some((p) => p.includes("m15crown/"))).toBe(false);
    // A cold frame cache: the bake must fetch the twin's own object.
    resetFrameAssetCacheForTests();
    fetched.length = 0;
    const [a, b] = [await bake(crowned, "default"), await bake(off(crowned), "default")];
    expect(fetched).toContain(`${template}/${key}.png`);
    const rows = differingRows(a, b);
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.at(-1)!).toBeLessThanOrEqual(LAST_ROW.default);
  }, 90_000);

  it.each(cases.slice(0, 4))("%s: at HD too, and the twin's pixels land 1:1 — the crown's peak at row 40 of the card", async (_label, over, key) => {
    const crowned = card(over);
    const [a, b] = [await bake(crowned, "hd"), await bake(off(crowned), "hd")];
    const rows = differingRows(a, b);
    expect(rows.length).toBeGreaterThan(100);
    expect(rows[0]).toBeGreaterThanOrEqual(36);
    expect(rows.at(-1)!).toBeLessThanOrEqual(LAST_ROW.hd);
    // The crown's peak: the first row at the centre column that is not the
    // flat art (CC's 0.0191 × 2100 = 40.11; the outline from 36.12).
    let peak = -1;
    for (let y = 0; y < 60 && peak < 0; y += 1) {
      const o = (y * a.width + 750) * 4;
      if (Math.abs(a.data[o] - ART_RGB[0]) + Math.abs(a.data[o + 1] - ART_RGB[1]) + Math.abs(a.data[o + 2] - ART_RGB[2]) > 24) peak = y;
    }
    expect(Math.abs(peak - 36), `${key} first non-art row ${peak}`).toBeLessThanOrEqual(1);
  }, 150_000);

  it("absent, off and a planeswalker type bake byte-identical to the plain card; the switch preloads nothing extra", async () => {
    const plain = await bake(card({ frameStyle: { template: "m15borderless", finish: "regular" } }), "default");
    expect(differingRows(await bake(card({ frameStyle: { template: "m15borderless", finish: "regular", crown: false } }), "default"), plain)).toEqual([]);
    const walker = { cardType: "planeswalker" as const, loyalty: "4", power: null, toughness: null };
    const on = await bake(card({ ...walker, frameStyle: { template: "m15borderless", finish: "regular", crown: true } }), "default");
    const without = await bake(card({ ...walker, frameStyle: { template: "m15borderless", finish: "regular" } }), "default");
    expect(differingRows(on, without)).toEqual([]);
    // Not Legendary: the plain master, whatever the switch says.
    expect(masterOf(card({ supertype: null }))).toBe("b");
    expect(frameColorKeysFor(getFrameProfile("m15borderless"), ["black"], card({ supertype: null }), { crown: true })).toEqual(["b"]);
  }, 120_000);

  it("the pair without the crown paints the pair master (and the hybrid cost its grey-barred dress)", async () => {
    const pair = card({ supertype: null, colorIdentity: ["white", "blue"], cost: "{1}{W}{U}", frameStyle: { template: "m15borderless", finish: "regular", twoColor: true } });
    expect(masterOf(pair)).toBe("wu");
    expect(masterOf({ ...pair, cost: "{W/U}{W/U}" })).toBe("wu-h");
    expect(masterOf({ ...pair, frameStyle: { template: "m15borderless", finish: "regular" } })).toBe("m");
    // The artifact dress has no hybrid masters: a hybrid cost falls back to
    // the split, like m15artifact.
    expect(masterOf({ ...pair, cardType: "artifact", cost: "{W/U}{W/U}", frameStyle: { template: "m15borderlessartifact", finish: "regular", twoColor: true } })).toBe("wu");
    const gold = await bake({ ...pair, frameStyle: { template: "m15borderless", finish: "regular" } }, "default");
    const split = await bake(pair, "default");
    const rows = differingRows(gold, split);
    // Only the pinline rings differ: the title ring (85–236) and the type /
    // box ring (1166–1947) at HD → 42–118 and 583–974 at 750.
    expect(rows.length).toBeGreaterThan(20);
    for (const y of rows) expect((y >= 42 && y <= 118) || (y >= 583 && y <= 974), `row ${y}`).toBe(true);
  }, 120_000);

  it("foil: the crowned foil bake differs from the plain foil bake only above the outline's last row", async () => {
    const crowned = card({ frameStyle: { template: "m15borderless", finish: "foil", crown: true } });
    const [a, b] = [await bake(crowned, "default"), await bake(off(crowned), "default")];
    const rows = differingRows(a, b);
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.at(-1)!).toBeLessThanOrEqual(LAST_ROW.default);
  }, 120_000);
});
