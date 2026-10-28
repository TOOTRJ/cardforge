import satori from "satori";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { mainRulesLayout } from "@/lib/cards/rules-box";
import { linePositions } from "@/lib/cards/rules-layout";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { RulesBoxBake, RENDER_PRESETS, renderCardImage } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// Layout v74 on real bakes (TODO 3.19 / 3.25): the flavor bar as the layout
// places it, its ends faded; a zero-blur outline (OUTLINE_SHADOW) ringing
// its text on every side — the name, the type line and the P/T of the
// Ghostfire showcase, whose masters are in git (offline bakes). Until v74
// Satori merged the outline's four layers into one filter and the
// rasteriser kept the last: a one-sided up-left shadow (measured ~6 : 1
// above : below on the footer, the new-frames review 2026-09-26).
// ---------------------------------------------------------------------------

const lum = (p: readonly number[]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];

type Bake = { w: number; h: number; px: (x: number, y: number) => number[] };

async function decode(png: Buffer): Promise<Bake> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    w: info.width,
    h: info.height,
    px: (x, y) => {
      const i = (y * info.width + x) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    },
  };
}

function ghostfire(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Probe the Outline",
    cost: null,
    cardType: "creature",
    supertype: null,
    subtypes: ["Spirit"],
    rarity: "mythic",
    colorIdentity: ["colorless"],
    rulesText: "Vigilance",
    flavorText: null,
    power: "4",
    toughness: "4",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "tarkirghostfire", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
    ...over,
  } as CardPreviewData;
}

async function bake(card: CardPreviewData, preset: keyof typeof RENDER_PRESETS = "hd"): Promise<Bake> {
  const res = await renderCardImage(card, preset, { brandMark: false, watermarkText: null });
  return decode(Buffer.from(await res.arrayBuffer()));
}

/** How often a white glyph pixel in `rect` has outline-black `d` px away
 *  on each side. */
function ring(b: Bake, rect: Rect, d: number) {
  const [x0, x1] = [Math.ceil((rect.leftPct / 100) * b.w) + d, Math.floor(((rect.leftPct + rect.widthPct) / 100) * b.w) - d];
  const [y0, y1] = [Math.ceil((rect.topPct / 100) * b.h) + d, Math.floor(((rect.topPct + rect.heightPct) / 100) * b.h) - d];
  const sides = { above: [0, -d], below: [0, d], left: [-d, 0], right: [d, 0] } as const;
  const hits = { above: 0, below: 0, left: 0, right: 0 };
  let glyph = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (lum(b.px(x, y)) < 225) continue;
      glyph += 1;
      for (const [side, [dx, dy]] of Object.entries(sides) as [keyof typeof hits, readonly [number, number]][]) {
        if (lum(b.px(x + dx, y + dy)) < 20) hits[side] += 1;
      }
    }
  }
  return { glyph, hits };
}

describe("3.25 — a zero-blur outline rings its text on every side in the bake (layout v74)", () => {
  const G = getFrameProfile("tarkirghostfire");

  for (const [name, rect] of [
    ["the name", G.title.rect],
    ["the type line", G.type.rect],
    ["the P/T", G.pt!.rect],
  ] as const) {
    it(`${name}: every side ringed at HD, 2 px out (1 px at 750 — the bands)`, async () => {
      // (The P/T's few small digits at 750 leave too few px for a 1 px ring
      // to read black under antialiasing: the stored HD bake holds it.)
      const presets = name === "the P/T" ? ([["hd", 2]] as const) : ([["hd", 2], ["default", 1]] as const);
      for (const [preset, d] of presets) {
        const { glyph, hits } = ring(await bake(ghostfire(), preset), rect, d);
        expect(glyph, `${name} ${preset}`).toBeGreaterThan(preset === "hd" ? 300 : 60);
        const counts = Object.values(hits);
        // Every side carries the outline, and none more than twice another
        // (the one-sided bake had ~0 below and right).
        expect(Math.min(...counts), `${name} ${preset} ${JSON.stringify(hits)}`).toBeGreaterThan(preset === "hd" ? 80 : 20);
        expect(Math.max(...counts) / Math.min(...counts), `${name} ${preset} ${JSON.stringify(hits)}`).toBeLessThan(2.5);
      }
    }, 60_000);
  }
});

describe("3.19 — the flavor bar in the bake: where the layout puts it, 96 % of the column, faded ends (layout v74)", () => {
  it("draws a 4 px bar at HD (2 at 750), dark in the middle, clear at both ends", async () => {
    const fonts = [{ name: "MPlantin", data: readFileSync("public/fonts/mplantin.ttf"), weight: 400 as const, style: "normal" as const }];
    const layout = mainRulesLayout({ layout: getFrameProfile("m15"), rulesText: "Flying", flavorText: "Up.", aspect: 7 / 5, show: {} });
    for (const [target, [w, h]] of [
      ["hd", [1500, 2100]],
      ["default", [750, 1050]],
    ] as const) {
      const svg = await satori(
        <div style={{ display: "flex", position: "relative", width: w, height: h, background: "#ffffff" }}>
          {RulesBoxBake({ layout, target, colorHex: "#000000" })}
        </div>,
        { width: w, height: h, fonts },
      );
      const b = await decode(await sharp(Buffer.from(svg)).flatten({ background: "#ffffff" }).png().toBuffer());
      const bar = linePositions(layout, target).bar!;
      expect(bar.height).toBe(target === "hd" ? 4 : 2);
      const mid = Math.round(bar.left + bar.width / 2);
      // Its rows (Yoga sets the box on whole px): exactly `height` rows of
      // ink in its middle — 0.3 of black over white — paper around them.
      const rows: number[] = [];
      for (let y = Math.floor(bar.top) - 3; y <= Math.ceil(bar.top + bar.height) + 3; y += 1) {
        const l = lum(b.px(mid, y));
        if (Math.abs(l - 255 * 0.7) < 6) rows.push(y);
        else expect(l, `${target} row ${y}`).toBeGreaterThan(250);
      }
      expect(rows, target).toHaveLength(bar.height);
      expect(rows[rows.length - 1] - rows[0] + 1).toBe(bar.height);
      expect(Math.abs(rows[0] - bar.top)).toBeLessThanOrEqual(1);
      // Faded ends: lighter near each end than in the middle, clear past it.
      const row = rows[Math.floor(rows.length / 2)];
      expect(lum(b.px(bar.left + 1, row))).toBeGreaterThan(245);
      expect(lum(b.px(bar.left + bar.width - 2, row))).toBeGreaterThan(245);
      expect(lum(b.px(bar.left + Math.round(bar.width * 0.05), row))).toBeGreaterThan(lum(b.px(mid, row)) + 20);
      expect(lum(b.px(bar.left - 2, row))).toBeGreaterThan(250);
      expect(lum(b.px(bar.left + bar.width + 1, row))).toBeGreaterThan(250);
    }
  }, 60_000);
});
