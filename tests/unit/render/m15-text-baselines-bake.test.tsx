import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { RENDER_PRESETS } from "@/lib/render/card-image";
import { getFrameProfile, type TextSlot } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 4.20, layout v32 on REAL bakes: the family's names and type lines grow
// to the one M15-era size and keep their baselines (TextSlot.dy), the Card
// Conjurer masters' type line lands on the prints' (1259.6 px at HD on 22
// 2023+ prints), and the planeswalker's name stays centred on its plate.
// The v31 numbers are the same probe baked at df4f3d7 (measured the same
// way, TODO 4.20 profiles evidence). Every frame asset is a flat mid-grey
// stand-in — a band's text position does not depend on its frame — so the
// probe's ink is the only mark in its band; the set symbol is an uploaded
// grey square (invisible) and there is no cost. The probe "EEEEEE" has flat
// bars top and bottom: its last inked row is the baseline, its first the
// cap top.
// ---------------------------------------------------------------------------

const grey = vi.hoisted(() => ({ url: "" }));

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async () => {},
    preloadFrameAssets: async () => {},
    getFrameDataUrl: () => grey.url,
    getPlateDataUrlForPath: () => grey.url,
    getFrameAssetDataUrl: () => null,
  };
});

const PROBE = "EEEEEE";
const BG = 128;

function probe(template: string): CardPreviewData {
  return {
    title: PROBE,
    cost: null,
    cardType: null,
    supertype: null,
    subtypes: [PROBE],
    rarity: "rare",
    colorIdentity: ["white"],
    rulesText: null,
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish: "regular" },
    setIconUrl: grey.url,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
  } as unknown as CardPreviewData;
}

type Baked = { lum: Float32Array; w: number; h: number };

async function bake(template: string, preset: "hd" | "default"): Promise<Baked> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const png = Buffer.from(
    await (await renderCardImage(probe(template), preset, { brandMark: false, watermarkText: null })).arrayBuffer(),
  );
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = new Float32Array(info.width * info.height);
  for (let i = 0; i < lum.length; i += 1) lum[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
  return { lum, w: info.width, h: info.height };
}

function lumOf(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/** The probe's cap top and baseline in a band, px from the card's top. */
function measure(b: Baked, slot: TextSlot): { capTop: number; baseline: number } {
  const r = slot.rect;
  const ink = lumOf(slot.colorHex);
  const h = (r.heightPct / 100) * b.h;
  const y0 = Math.max(0, Math.floor((r.topPct / 100) * b.h - 0.12 * h));
  const y1 = Math.min(b.h, Math.ceil(((r.topPct + r.heightPct) / 100) * b.h + 0.12 * h));
  const x0 = Math.max(0, Math.floor((r.leftPct / 100) * b.w));
  const x1 = Math.min(b.w, Math.ceil(((r.leftPct + r.widthPct) / 100) * b.w));
  const rows: number[] = [];
  for (let y = y0; y < y1; y += 1) {
    let sum = 0;
    for (let x = x0; x < x1; x += 1) {
      const l = b.lum[y * b.w + x];
      sum += Math.min(1, Math.max(0, ink < BG ? (BG - l) / (BG - ink) : (l - BG) / (ink - BG)));
    }
    rows.push(sum);
  }
  const half = Math.max(...rows) / 2;
  const first = rows.findIndex((v) => v >= half);
  const last = rows.length - 1 - [...rows].reverse().findIndex((v) => v >= half);
  expect(first, "probe ink found").toBeGreaterThan(0);
  expect(last, "probe ink inside the band").toBeLessThan(rows.length - 1);
  return { capTop: y0 + first, baseline: y0 + last + 1 };
}

/** The 2023+ prints' type-line baseline at HD (4.20 print review, n = 22). */
const PRINT_TYPE_BASELINE_HD = 1259.6;
/** The 2014–19 token prints' type-line baseline at HD (TODO 4.49 (d):
 *  fifteen prints, TDOM / TM19 / TBFZ / TWAR / TMH1 / TKLD / TC18 / TEMN,
 *  1797–1803). */
const TOKEN_PRINT_TYPE_BASELINE_HD = 1800.4;

describe("M15-era display sizes on real bakes (layout v32)", () => {
  beforeAll(async () => {
    const png = await sharp({
      create: { width: 16, height: 16, channels: 4, background: { r: BG, g: BG, b: BG, alpha: 1 } },
    })
      .png()
      .toBuffer();
    grey.url = `data:image/png;base64,${png.toString("base64")}`;
  });

  // [template, v31 name baseline, v31 type baseline, HD px]. Every one keeps
  // its baseline within 1 px (the bake moves text in whole pixels).
  const KEPT: [string, number | null, number | null][] = [
    ["m15", 189, null],
    ["extendedart", 189, 1264],
    ["saga", 185, 1845],
    ["flip", 188, 587],
    // Its type line moved onto the prints' in TODO 4.49 (d) (below).
    ["m15token", 189, null],
    ["fullart", null, 1608],
    ["aftermath", 191, 805],
  ];

  it.each(KEPT)("%s: the grown name and type line keep their v31 baselines", async (template, title, type) => {
    const p = getFrameProfile(template);
    const b = await bake(template, "hd");
    for (const [slot, v31, size] of [
      [p.title, title, p.title.sizePct],
      [p.type, type, p.type.sizePct],
    ] as const) {
      if (v31 === null) continue;
      const m = measure(b, slot);
      expect(Math.abs(m.baseline - v31), `${template} baseline ${m.baseline}`).toBeLessThanOrEqual(1);
      // …at the grown size: Beleren's caps are 1434/2048 em (±1.5 px of ink).
      expect(Math.abs(m.baseline - m.capTop - (1434 / 2048) * size * b.w), `${template} caps`).toBeLessThanOrEqual(1.5);
    }
  });

  it("puts the Card Conjurer masters' type line on the prints' baseline (was 4 px low)", async () => {
    for (const template of ["m15", "m15artifact", "m15borderless"]) {
      const m = measure(await bake(template, "hd"), getFrameProfile(template).type);
      expect(Math.abs(m.baseline - PRINT_TYPE_BASELINE_HD), `${template} ${m.baseline}`).toBeLessThanOrEqual(1);
      expect(m.baseline).toBeLessThan(1264 - 3); // v31: 1264
    }
    // …and at the default size (750 px): v31 printed it at 631.
    const m = measure(await bake("m15", "default"), getFrameProfile("m15").type);
    expect(Math.abs(m.baseline - PRINT_TYPE_BASELINE_HD / 2)).toBeLessThanOrEqual(1);
  });

  it("puts the 2014–19 token's type line on the prints' baseline (TODO 4.49 (d); v31–v33: 1797)", async () => {
    for (const template of ["m15token", "m15tokenartifact"]) {
      const m = measure(await bake(template, "hd"), getFrameProfile(template).type);
      expect(Math.abs(m.baseline - TOKEN_PRINT_TYPE_BASELINE_HD), `${template} ${m.baseline}`).toBeLessThanOrEqual(1);
      expect(m.baseline).toBeGreaterThan(1797 + 2);
    }
    const m = measure(await bake("m15token", "default"), getFrameProfile("m15token").type);
    expect(Math.abs(m.baseline - TOKEN_PRINT_TYPE_BASELINE_HD / 2)).toBeLessThanOrEqual(1);
  });

  it("keeps the planeswalker's grown name centred where its v31 name was (133.6 px, level with the pips) and its type line on M15's", async () => {
    const p = getFrameProfile("m15pw");
    const b = await bake("m15pw", "hd");
    const name = measure(b, p.title);
    expect(Math.abs((name.capTop + name.baseline) / 2 - 133.6), `caps centre ${(name.capTop + name.baseline) / 2}`).toBeLessThanOrEqual(1);
    expect(name.baseline - name.capTop).toBeGreaterThan(54); // 80 px caps (v31: 64 px, 45)
    const type = measure(b, p.type);
    expect(Math.abs(type.baseline - PRINT_TYPE_BASELINE_HD)).toBeLessThanOrEqual(1); // v31: 1250
  });

  it("leaves the full-art basics' name and type line exactly where they printed", async () => {
    const p = getFrameProfile("m15fullartland");
    const b = await bake("m15fullartland", "hd");
    expect(measure(b, p.title).baseline).toBe(188);
    expect(measure(b, p.type).baseline).toBe(1854);
  });

  it("bakes at the preset sizes it was measured at", () => {
    expect(RENDER_PRESETS.hd).toEqual({ width: 1500, height: 2100 });
  });
});
