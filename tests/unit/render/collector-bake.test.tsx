import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { collectorLayout, type CollectorLayout, type CollectorTextRun } from "@/lib/cards/collector-layout";
import { COLLECTOR_ADVANCES, COLLECTOR_FACES } from "@/lib/cards/collector-metrics";
import { displayTextWidthEm } from "@/lib/cards/display-metrics";
import { rulesTextWidthEm } from "@/lib/cards/rules-metrics";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { drawnStatSlots, renderCardImage } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// TODO 4.9b — the collector line in the Satori BAKE on the real profiles, at
// both output sizes, with flat mid-grey stand-in frames (the line sits in
// the black border, which the stand-in paints grey too; a frame's pixels
// never move it). Held to the layout both renderers read
// (lib/cards/collector-layout.ts):
//   • every text run's ink sits on the layout's baseline row — the
//     number's and the set code's (the collector face), the artist's small
//     caps (the display face) and a clean download's footer text (the body
//     face) — within a pixel at HD and at 750;
//   • a display bake puts the brand mark in the © slot (ink right-aligned
//     on the slot's edge, on line 2 with a stat plate and line 1 without);
//     a clean download prints the footer text there, or nothing;
//   • a card with the key absent bakes byte-identical to one with "off":
//     both are today's footer path, exactly;
//   • the 2015 letter column sits at the brush's x, the 2023 letter first.
// The live preview's twin: tests/unit/components/collector-preview.test.tsx.
// Set COLLECTOR_BAKE_SAVE_DIR to keep the PNGs (local inspection only).
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
    getFrameOverlayDataUrl: () => null,
  };
});

const BG = 110;
const SAVE_DIR = process.env.COLLECTOR_BAKE_SAVE_DIR ?? null;

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Sheoldred, the Apocalypse",
    cost: "{2}{B}{B}",
    cardType: "creature",
    supertype: "Legendary",
    subtypes: ["Phyrexian", "Praetor"],
    rarity: "mythic",
    colorIdentity: ["black"],
    rulesText: "Deathtouch\nWhenever you draw a card, you gain 2 life.",
    flavorText: null,
    power: "4",
    toughness: "5",
    loyalty: null,
    defense: null,
    artistCredit: "Chris Rahn",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15", finish: "regular", collector: "2015" },
    setIconUrl: grey.url,
    setIconCode: null,
    setCode: "DMU",
    collectorNumber: "107/281",
    lang: "en",
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

type Baked = { data: Buffer; w: number; h: number; png: Buffer };

async function bake(data: CardPreviewData, preset: "hd" | "default", opts: { brandMark: boolean; watermarkText: string | null }, name?: string): Promise<Baked> {
  const png = Buffer.from(await (await renderCardImage(data, preset, opts)).arrayBuffer());
  if (SAVE_DIR && name) {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
    fs.writeFileSync(path.join(SAVE_DIR, `${name}-${preset}.png`), png);
  }
  const { data: raw, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: raw, w: info.width, h: info.height, png };
}

/** Rows holding light ink (the line's ink is INK_LIGHT on the grey) in a
 *  column span, as [first, lastExclusive]. */
function inkRows(b: Baked, x0: number, x1: number, y0: number, y1: number, threshold = 180): [number, number] | null {
  const rows: number[] = [];
  for (let y = Math.max(0, y0); y < Math.min(b.h, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(b.w, x1); x += 1) {
      if (b.data[(y * b.w + x) * 3] > threshold) {
        rows.push(y);
        break;
      }
    }
  }
  return rows.length ? [rows[0], rows[rows.length - 1] + 1] : null;
}

/** Columns holding light ink in a row span. */
function inkCols(b: Baked, x0: number, x1: number, y0: number, y1: number, threshold = 180): [number, number] | null {
  const cols: number[] = [];
  for (let x = Math.max(0, x0); x < Math.min(b.w, x1); x += 1) {
    for (let y = Math.max(0, y0); y < Math.min(b.h, y1); y += 1) {
      if (b.data[(y * b.w + x) * 3] > threshold) {
        cols.push(x);
        break;
      }
    }
  }
  return cols.length ? [cols[0], cols[cols.length - 1] + 1] : null;
}

function layoutOf(data: CardPreviewData, surface: { kind: "display" } | { kind: "download"; footerText: string | null }): CollectorLayout {
  const layout = getFrameProfile(data.frameStyle?.template);
  const plates = drawnStatSlots(layout, data);
  const result = collectorLayout(
    layout,
    {
      cardType: data.cardType,
      supertype: data.supertype,
      rarity: data.rarity,
      setCode: data.setCode,
      collectorNumber: data.collectorNumber,
      lang: data.lang,
      artistCredit: data.artistCredit,
      finish: data.frameStyle?.finish,
      star: data.frameStyle?.star,
      collector: data.frameStyle?.collector,
      plates,
    },
    surface,
  );
  if (!result) throw new Error("no collector layout");
  return result;
}

/** The first text run of a role. */
function run(layout: CollectorLayout, role: CollectorTextRun["role"]): CollectorTextRun {
  const found = layout.runs.find((r): r is CollectorTextRun => r.kind === "text" && r.role === role);
  if (!found) throw new Error(`no ${role} run`);
  return found;
}

/** The baseline row of a text run in a bake: the last inked row of its
 *  FIRST glyph (a digit or a capital: flat-bottomed — the slash of a
 *  "107/281" descends 0.1 em, the C overshoots a row), measured over that
 *  glyph's advance. */
function baselineOf(b: Baked, r: CollectorTextRun): number {
  const first = Array.from(r.text)[0];
  const adv =
    r.face === "collector"
      ? (COLLECTOR_ADVANCES[first] ?? 600) / 1000
      : r.face === "display"
        ? displayTextWidthEm(first)
        : rulesTextWidthEm(first);
  const x0 = Math.floor((r.xPct / 100) * b.w);
  const x1 = Math.ceil((r.xPct / 100) * b.w + adv * r.sizePct * b.w);
  const base = (r.baselinePct / 100) * b.h;
  const size = r.sizePct * b.w;
  const rows = inkRows(b, x0, x1, Math.floor(base - size), Math.ceil(base + 0.3 * size));
  if (!rows) throw new Error(`no ink for ${r.role} "${r.text}"`);
  return rows[1];
}

describe("the collector line on real bakes (TODO 4.9b)", () => {
  beforeAll(async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: BG, g: BG, b: BG, alpha: 1 } } })
      .png()
      .toBuffer();
    grey.url = `data:image/png;base64,${png.toString("base64")}`;
  });

  it.each(["hd", "default"] as const)("%s: every run's ink sits on the layout's baseline — both faces, both styles", async (preset) => {
    for (const [name, data] of [
      ["dmu-107-2015", card()],
      ["fdn-1-2023", card({ frameStyle: { template: "m15", finish: "regular", collector: "2023" }, setCode: "FDN", collectorNumber: "1", artistCredit: "Wenfei Ye" })],
    ] as const) {
      const layout = layoutOf(data, { kind: "display" });
      const b = await bake(data, preset, { brandMark: true, watermarkText: null }, name);
      for (const role of ["number", "letter", "set", "artist"] as const) {
        const r = run(layout, role);
        const expected = (r.baselinePct / 100) * b.h;
        // The bake sets a run at its whole-px size and its top at the
        // baseline less the ascent at that size, so the ink's bottom row is
        // the baseline row (a flat-bottomed glyph's ink ends at the baseline;
        // the capital C's overshoot is one row).
        expect(Math.abs(baselineOf(b, r) - expected), `${name} ${preset} ${role} "${r.text}"`).toBeLessThanOrEqual(preset === "hd" ? 1.5 : 1.5);
      }
    }
  }, 120_000);

  it("the 2015 letter sits in the column at the brush's x; the 2023 letter comes first", async () => {
    const old = card();
    const oldLayout = layoutOf(old, { kind: "display" });
    const brush = oldLayout.runs.find((r) => r.kind === "path" && r.role === "brush");
    expect(brush).toBeDefined();
    expect(run(oldLayout, "letter").xPct).toBeCloseTo(brush!.xPct, 6);
    expect(run(oldLayout, "number").xPct).toBeLessThan(run(oldLayout, "letter").xPct);
    const b = await bake(old, "hd", { brandMark: true, watermarkText: null });
    const letter = run(oldLayout, "letter");
    const cols = inkCols(b, Math.floor((letter.xPct / 100) * b.w) - 6, Math.ceil(((letter.xPct + letter.widthPct) / 100) * b.w) + 6, 1965, 2000);
    expect(cols).not.toBeNull();
    // The M's ink starts at the column (its 105-unit side bearing ≈ 3.8 px).
    expect(Math.abs(cols![0] - ((letter.xPct / 100) * b.w + 3.8))).toBeLessThanOrEqual(2);

    const modern = card({ frameStyle: { template: "m15", finish: "regular", collector: "2023" }, collectorNumber: "9" });
    const modernLayout = layoutOf(modern, { kind: "display" });
    expect(run(modernLayout, "letter").xPct).toBeLessThan(run(modernLayout, "number").xPct);
    expect(run(modernLayout, "number").text).toBe("0009");
  }, 60_000);

  it("display: the brand mark fills the © slot on line 2 with a plate, line 1 without; a clean download prints the footer text there, or nothing", async () => {
    const withPlate = card();
    const plateLayout = layoutOf(withPlate, { kind: "display" });
    expect(plateLayout.markLine).toBe(2);
    expect(plateLayout.mark.kind).toBe("brand");
    const noPlate = card({ cardType: "instant", supertype: null, subtypes: [], power: null, toughness: null, rarity: "common" });
    const noPlateLayout = layoutOf(noPlate, { kind: "display" });
    expect(noPlateLayout.markLine).toBe(1);

    const display = await bake(withPlate, "hd", { brandMark: true, watermarkText: null }, "display-plate");
    const slotRight = (plateLayout.mark.kind === "brand" ? plateLayout.mark.anchor.rightPct : 0) / 100;
    // The mark's box ends on the slot's right edge (93.54 %W = 1403 px),
    // its ink a trailing 0.02 em of tracking and the m's side bearing
    // before it, on line 2 — and nothing of it is on line 1.
    const line2 = inkCols(display, 900, 1480, 2008, 2040);
    expect(line2).not.toBeNull();
    expect(slotRight * display.w - line2![1]).toBeGreaterThanOrEqual(0);
    expect(slotRight * display.w - line2![1]).toBeLessThanOrEqual(6);
    expect(inkCols(display, 900, 1480, 1965, 1998)).toBeNull();

    const displayNoPlate = await bake(noPlate, "hd", { brandMark: true, watermarkText: null }, "display-noplate");
    const line1 = inkCols(displayNoPlate, 900, 1480, 1965, 1998);
    expect(line1).not.toBeNull();
    expect(slotRight * displayNoPlate.w - line1![1]).toBeGreaterThanOrEqual(0);
    expect(slotRight * displayNoPlate.w - line1![1]).toBeLessThanOrEqual(6);
    expect(inkCols(displayNoPlate, 900, 1480, 2008, 2040)).toBeNull();

    // A clean download: the footer text (MPlantin) right-aligned on the
    // slot, or an empty slot.
    const clean = await bake(withPlate, "hd", { brandMark: false, watermarkText: "Forged by Kesh" }, "clean-footer");
    const cleanLayout = layoutOf(withPlate, { kind: "download", footerText: "Forged by Kesh" });
    expect(cleanLayout.mark.kind).toBe("text");
    const markText = run(cleanLayout, "mark-text");
    expect(markText.face).toBe("body");
    const cleanCols = inkCols(clean, 900, 1480, 2008, 2040);
    expect(cleanCols).not.toBeNull();
    expect(slotRight * clean.w - cleanCols![1]).toBeGreaterThanOrEqual(0);
    expect(slotRight * clean.w - cleanCols![1]).toBeLessThanOrEqual(4);
    expect(Math.abs(baselineOf(clean, markText) - (markText.baselinePct / 100) * clean.h)).toBeLessThanOrEqual(1.5);
    const empty = await bake(withPlate, "hd", { brandMark: false, watermarkText: null }, "clean-empty");
    expect(layoutOf(withPlate, { kind: "download", footerText: null }).mark.kind).toBe("none");
    expect(inkCols(empty, 900, 1480, 1965, 2040)).toBeNull();
  }, 120_000);

  it("the key absent and the explicit off bake byte-identical: today's footer, the mark where it was", async () => {
    const absent = card({ frameStyle: { template: "m15", finish: "regular" } });
    const off = card({ frameStyle: { template: "m15", finish: "regular", collector: "off", star: true } });
    for (const preset of ["hd", "default"] as const) {
      const a = await bake(absent, preset, { brandMark: true, watermarkText: null }, "absent");
      const o = await bake(off, preset, { brandMark: true, watermarkText: null }, "off");
      expect(o.data.equals(a.data), preset).toBe(true);
      // Today's footer: "ART: CHRIS RAHN" in the footer band, no line 1.
      expect(inkCols(a, 90, 700, 1965, 1998), preset).toBeNull();
    }
    // …and nothing of the line on a frame with no slot, whatever the key.
    const noSlot = card({ frameStyle: { template: "m15borderless", finish: "regular", collector: "2023" } });
    expect(collectorLayout(getFrameProfile("m15borderless"), { ...noSlot, collector: "2023", plates: { pt: true, loyalty: false, defense: false } }, { kind: "display" })).toBeNull();
  }, 120_000);

  it("the ★ separator for the star flag and for a foil finish; the • otherwise", async () => {
    const dot = layoutOf(card(), { kind: "display" });
    expect(dot.runs.some((r) => r.kind === "path" && r.role === "separator")).toBe(false);
    expect(run(dot, "set").text).toBe("DMU • EN");
    const star = layoutOf(card({ frameStyle: { template: "m15", finish: "regular", collector: "2015", star: true } }), { kind: "display" });
    expect(star.runs.some((r) => r.kind === "path" && r.role === "separator")).toBe(true);
    expect(run(star, "set").text).toBe("DMU");
    expect(run(star, "language").text).toBe("EN");
    const foil = layoutOf(card({ frameStyle: { template: "m15", finish: "foil", collector: "2015" } }), { kind: "display" });
    expect(foil.runs.some((r) => r.kind === "path" && r.role === "separator")).toBe(true);
    const b = await bake(card({ frameStyle: { template: "m15", finish: "regular", collector: "2015", star: true } }), "hd", { brandMark: true, watermarkText: null }, "star");
    const sep = star.runs.find((r) => r.kind === "path" && r.role === "separator")!;
    const cols = inkCols(b, Math.floor((sep.xPct / 100) * b.w) - 2, Math.ceil(((sep.xPct + sep.widthPct) / 100) * b.w) + 2, 2005, 2035);
    expect(cols).not.toBeNull();
    expect(cols![1] - cols![0]).toBeGreaterThanOrEqual(14);
  }, 60_000);

  it("the faces' ascents the bake places by are the generated table's", () => {
    expect(COLLECTOR_FACES.collector.ascent).toBeCloseTo(0.968, 3);
    expect(COLLECTOR_FACES.display.ascent).toBeCloseTo(1917 / 2048, 3);
    expect(COLLECTOR_FACES.body.ascent).toBeCloseTo(0.774, 3);
  });
});
