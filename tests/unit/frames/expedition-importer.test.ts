import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_TEMPLATES,
  EXPEDITION_BFZ,
  EXPEDITION_BFZ_PANEL_GAIN,
  EXPEDITION_BFZ_PINLINE_MASK,
  EXPEDITION_ZNR,
  EXPEDITION_ZNR_RECUT,
  expeditionBfzFile,
  expeditionZnrFile,
  shiftBlocksRgba8,
} from "../../../scripts/lib/cc-frames.mjs";
import { EXPEDITION_ZNR_LOWER_DOWN_PX, EXPEDITION_ZNR_TITLE_UP_PX, getFrameProfile } from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 1 (owner-approved 2026-10-21; layout v62): the Zendikar
// Expeditions from Card Conjurer — `expeditionland` re-sourced from 'ZNR
// Expeditions (2020)' (the ZNE look its prints wear) and the new
// `expeditionlandbfz` from 'BFZ Expeditions (2015)' (the EXP look) — the
// recipes, the profiles that ride the masters and, where the published
// masters are on disk (FRAMES_BUILD_DIR, else .frames-build; CI fetches
// them), their pixels.
// ---------------------------------------------------------------------------

type Layer = { src: string; mask?: string };
const templates = CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; plates?: unknown; transforms?: string }>;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { sha256: string };
const MANIFEST = (manifestJson as { files: Record<string, Entry> }).files;
const KEYS = ["w", "u", "b", "r", "g", "c", "m"];

function published(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!MANIFEST[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === MANIFEST[rel].sha256 ? bytes : null;
}

describe("the Expedition recipes", () => {
  it("expeditionland: the ZNR pack's colour frames whole, the 'Colorless Frame' for c, native 1500 × 2100", () => {
    const def = templates.expeditionland;
    expect(Object.keys(def.colors).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) expect(def.colors[key], key).toEqual([{ src: `${EXPEDITION_ZNR}/expeditionNewFrame${key.toUpperCase()}.png` }]);
    expect(expeditionZnrFile("c")).toBe("img/frames/expedition/znr/expeditionNewFrameC.png");
    expect(def.plates).toBeUndefined();
    expect(def.transforms).toMatch(/no resample/);
  });

  it("expeditionland: two whole blocks onto the ZNE prints through the pack's flat rows — the title block 4 px up, the lower block 11 px down", () => {
    const def = templates.expeditionland as unknown as { shift: unknown };
    expect(def.shift).toBe(EXPEDITION_ZNR_RECUT);
    expect(EXPEDITION_ZNR_RECUT.axis).toBe("y");
    expect(EXPEDITION_ZNR_RECUT.blocks).toEqual([
      { from: 60, to: 730, by: -4 },
      { from: 777, to: 1939, by: 11 },
    ]);
    // The profile rides the same numbers.
    expect(EXPEDITION_ZNR_RECUT.blocks[0]!.by).toBe(-EXPEDITION_ZNR_TITLE_UP_PX);
    expect(EXPEDITION_ZNR_RECUT.blocks[1]!.by).toBe(EXPEDITION_ZNR_LOWER_DOWN_PX);
    // Whole rows, byte for byte: a block lands where it says; the flat
    // zones between stretch or shrink (a zone that isn't flat throws).
    const W = 4, H = 2100;
    const img = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) {
      const flat = y < 60 || (y >= 730 && y < 777) || y >= 1939;
      for (let x = 0; x < W; x++) img.writeUInt32LE(flat ? (y < 60 ? 1 : y < 777 ? 2 : 3) : y * 16 + x, (y * W + x) * 4);
    }
    const out = shiftBlocksRgba8(img, W, H, EXPEDITION_ZNR_RECUT);
    expect(out.readUInt32LE((200 - 4) * W * 4)).toBe(200 * 16);
    expect(out.readUInt32LE((1800 + 11) * W * 4)).toBe(1800 * 16);
    const bumpy = Buffer.from(img);
    bumpy.writeUInt32LE(99, 750 * W * 4);
    expect(() => shiftBlocksRgba8(bumpy, W, H, EXPEDITION_ZNR_RECUT)).toThrow(/not flat/);
  });

  it("expeditionlandbfz: the land frame for c, gold for m, a colour in the land frame's PINLINE alone (as EXP's duals print it), the panel lifted onto print's opacity", () => {
    const def = templates.expeditionlandbfz as unknown as { colors: Record<string, (Layer & { gain?: number })[]>; plates?: unknown };
    expect(Object.keys(def.colors).sort()).toEqual([...KEYS].sort());
    // α 128 → 166 (≈ 0.65, the twelve EXP prints' median).
    expect(EXPEDITION_BFZ_PANEL_GAIN).toBe(166 / 128);
    expect(Math.round(128 * EXPEDITION_BFZ_PANEL_GAIN)).toBe(166);
    expect(def.colors.c).toEqual([{ src: `${EXPEDITION_BFZ}/expeditionFrameL.png`, gain: EXPEDITION_BFZ_PANEL_GAIN }]);
    expect(def.colors.m).toEqual([{ src: `${EXPEDITION_BFZ}/expeditionFrameM.png`, gain: EXPEDITION_BFZ_PANEL_GAIN }]);
    for (const key of ["w", "u", "b", "r", "g"]) {
      expect(def.colors[key], key).toEqual([
        { src: expeditionBfzFile("l"), gain: EXPEDITION_BFZ_PANEL_GAIN },
        { src: expeditionBfzFile(key), mask: EXPEDITION_BFZ_PINLINE_MASK },
      ]);
    }
    expect(EXPEDITION_BFZ_PINLINE_MASK).toBe("img/frames/expedition/bfz/expeditionMaskPinline.png");
    expect(def.plates).toBeUndefined();
  });
});

describe("the profiles on the new masters", () => {
  const px = (r: { topPct: number; leftPct: number; widthPct: number; heightPct: number }) => ({
    left: (r.leftPct / 100) * 1500,
    top: (r.topPct / 100) * 2100,
    right: ((r.leftPct + r.widthPct) / 100) * 1500,
    bottom: ((r.topPct + r.heightPct) / 100) * 2100,
  });

  it("expeditionland: every slot rides the re-cut — the art on the window + panel, the name band 4 px up, the type line on 1805, the symbol at the prints' right end and height", () => {
    const p = getFrameProfile("expeditionland");
    expect(p.hideCost).toBe(true);
    const art = px(p.artSlot);
    expect([art.left, art.top, art.right, art.bottom].map((v) => Math.round(v * 1000) / 1000)).toEqual([59, 224, 1441, 1724]);
    expect(px(p.title.rect).top).toBeCloseTo(px(getFrameProfile("m15").title.rect).top - 4, 6);
    expect(px(p.type.rect).top - px(getFrameProfile("expeditionlandbfz").type.rect).top).toBeCloseTo(7, 6);
    for (const slot of [p.title, p.type, p.rules]) expect(slot.colorHex).toBe("#17120c");
    expect(p.rules.backdropHex).toBeUndefined();
    expect(p.rules.vAlign).toBe("center");
    expect(p.title.fit).toBe("measured");
    expect(p.type.fit).toBe("measured");
    const sym = px(p.symbolRect!);
    expect(Math.round(sym.right)).toBe(1419);
    expect(Math.round((sym.top + sym.bottom) / 2)).toBe(1783);
    const rules = px(p.rules.rect);
    expect([rules.left, rules.top, rules.right, rules.bottom].map((v) => Math.round(v))).toEqual([141, 1219, 1365, 1713]);
  });

  it("expeditionlandbfz: the same anatomy on the EXP masters' rows", () => {
    const p = getFrameProfile("expeditionlandbfz");
    expect(p.hideCost).toBe(true);
    const art = px(p.artSlot);
    expect([art.left, art.top, art.right, art.bottom].map((v) => Math.round(v * 1000) / 1000)).toEqual([112, 231, 1388, 1702]);
    // M15's name band (EXP's bars are not re-cut), the text 2 px up.
    expect(p.title.rect).toEqual(getFrameProfile("m15").title.rect);
    expect(p.title.dy).toBe(getFrameProfile("expeditionland").title.dy);
    const sym = px(p.symbolRect!);
    expect(Math.round(sym.right)).toBe(1371);
    expect(Math.round((sym.top + sym.bottom) / 2)).toBe(1776);
    const rules = px(p.rules.rect);
    expect([rules.left, rules.top, rules.right, rules.bottom].map((v) => Math.round(v))).toEqual([131, 1262, 1365, 1694]);
  });

  it("both are black-bordered all round, with no known edge or art-window failure", () => {
    for (const t of ["expeditionland", "expeditionlandbfz"]) {
      expect(EDGE_CONTRACTS[t], t).toEqual(EDGE_CONTRACTS.m15);
      expect(ART_WINDOW_KNOWN_FAILURES[t], t).toBeUndefined();
    }
  });

  it("the masters left git: no public/frames folder; every key in the manifest", () => {
    for (const t of ["expeditionland", "expeditionlandbfz"]) {
      expect(fs.existsSync(path.join(process.cwd(), "public", "frames", t)), t).toBe(false);
      for (const key of KEYS) {
        expect(MANIFEST[`${t}/${key}.png`], `${t}/${key}.png`).toBeDefined();
        expect(MANIFEST[`${t}/${key}.webp`], `${t}/${key}.webp`).toBeDefined();
      }
    }
  });
});

const masters = ["expeditionland", "expeditionlandbfz"].flatMap((t) => KEYS.map((key) => [`${t}/${key}`, published(`${t}/${key}.png`)] as const));
describe.skipIf(masters.some(([, buf]) => buf === null))("the published Expedition masters (set FRAMES_BUILD_DIR if skipped)", () => {
  it.each(masters)("%s: 1500 × 2100, the black ring opaque, the window clear, the panel translucent; the WebP's alpha is the PNG's", async (key, buf) => {
    const { data, info } = await sharp(buf!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1500, 2100]);
    const at = (x: number, y: number) => data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4);
    // The black border on all four sides.
    for (const [x, y] of [[20, 1000], [1480, 1000], [750, 20], [750, 2080]]) {
      const [r, g, b, a] = at(x, y);
      expect(a, `${key} ${x},${y}`).toBe(255);
      expect(Math.max(r, g, b), `${key} ${x},${y}`).toBeLessThanOrEqual(16);
    }
    // The window clear, the rules panel a light translucent white.
    expect(at(750, 700)[3], `${key} window`).toBe(0);
    const panel = at(750, 1450);
    expect(panel[3], `${key} panel α`).toBeGreaterThanOrEqual(100);
    expect(panel[3], `${key} panel α`).toBeLessThanOrEqual(200);
    expect(Math.min(panel[0], panel[1], panel[2]), `${key} panel colour`).toBeGreaterThanOrEqual(200);
    // EXP's panel lifted onto print (α 166 ≈ 0.65); ZNE's as the pack draws it.
    expect(panel[3], `${key} panel α`).toBe(key.startsWith("expeditionlandbfz/") ? 166 : 153);
    // The ZNE re-cut (column 750): the window opens at 236 (the pack's 240)
    // and the panel ends at 1722 (the pack's 1711), the bar opaque below it.
    if (!key.startsWith("expeditionlandbfz/")) {
      expect(at(750, 236)[3], `${key} window top`).toBe(0);
      expect(at(750, 234)[3], `${key} above the window`).toBe(255);
      expect(at(750, 1720)[3], `${key} panel foot`).toBeLessThan(250);
      expect(at(750, 1730)[3], `${key} type bar`).toBe(255);
    }
    const webp = published(`${key}.webp`);
    if (!webp) return;
    const w = await sharp(webp).ensureAlpha().raw().toBuffer();
    let diff = 0;
    for (let i = 3; i < data.length; i += 4) diff = Math.max(diff, Math.abs(data[i] - w[i]));
    expect(diff, `${key} WebP alpha`).toBeLessThanOrEqual(2);
  });
});
