import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  CC_TEMPLATES,
  EXPEDITION_BFZ,
  EXPEDITION_BFZ_PINLINE_MASK,
  EXPEDITION_ZNR,
  expeditionBfzFile,
  expeditionZnrFile,
} from "../../../scripts/lib/cc-frames.mjs";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS } from "@/lib/frames/edge-contract";
import { ART_WINDOW_KNOWN_FAILURES } from "@/lib/frames/art-window";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 1 (owner-approved 2026-10-21; layout v61): the Zendikar
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

  it("expeditionlandbfz: the land frame for c, gold for m, a colour in the land frame's PINLINE alone (as EXP's duals print it)", () => {
    const def = templates.expeditionlandbfz;
    expect(Object.keys(def.colors).sort()).toEqual([...KEYS].sort());
    expect(def.colors.c).toEqual([{ src: `${EXPEDITION_BFZ}/expeditionFrameL.png` }]);
    expect(def.colors.m).toEqual([{ src: `${EXPEDITION_BFZ}/expeditionFrameM.png` }]);
    for (const key of ["w", "u", "b", "r", "g"]) {
      expect(def.colors[key], key).toEqual([
        { src: expeditionBfzFile("l") },
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

  it("expeditionland: the art on the window + panel, dark ink, the type line on 1794, the symbol at the prints' right end", () => {
    const p = getFrameProfile("expeditionland");
    expect(p.hideCost).toBe(true);
    const art = px(p.artSlot);
    expect([art.left, art.top, art.right, art.bottom].map((v) => Math.round(v * 1000) / 1000)).toEqual([59, 228, 1441, 1713]);
    for (const slot of [p.title, p.type, p.rules]) expect(slot.colorHex).toBe("#17120c");
    expect(p.rules.backdropHex).toBeUndefined();
    expect(p.rules.vAlign).toBe("center");
    expect(p.title.fit).toBe("measured");
    expect(p.type.fit).toBe("measured");
    const sym = px(p.symbolRect!);
    expect(Math.round(sym.right)).toBe(1419);
    expect(Math.round((sym.top + sym.bottom) / 2)).toBe(1772);
    const rules = px(p.rules.rect);
    expect([rules.left, rules.top, rules.right, rules.bottom].map((v) => Math.round(v))).toEqual([141, 1208, 1365, 1702]);
  });

  it("expeditionlandbfz: the same anatomy on the EXP masters' rows", () => {
    const p = getFrameProfile("expeditionlandbfz");
    expect(p.hideCost).toBe(true);
    const art = px(p.artSlot);
    expect([art.left, art.top, art.right, art.bottom].map((v) => Math.round(v * 1000) / 1000)).toEqual([112, 231, 1388, 1702]);
    expect(p.title).toEqual(getFrameProfile("expeditionland").title);
    const sym = px(p.symbolRect!);
    expect(Math.round(sym.right)).toBe(1371);
    expect(Math.round((sym.top + sym.bottom) / 2)).toBe(1776);
    const rules = px(p.rules.rect);
    expect([rules.left, rules.top, rules.right, rules.bottom].map((v) => Math.round(v))).toEqual([131, 1262, 1365, 1694]);
    // The type band sits 4 px lower than the ZNE one (1798 against 1794).
    expect(px(p.type.rect).top - px(getFrameProfile("expeditionland").type.rect).top).toBeCloseTo(4, 6);
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
    const webp = published(`${key}.webp`);
    if (!webp) return;
    const w = await sharp(webp).ensureAlpha().raw().toBuffer();
    let diff = 0;
    for (let i = 3; i < data.length; i += 4) diff = Math.max(diff, Math.abs(data[i] - w[i]));
    expect(diff, `${key} WebP alpha`).toBeLessThanOrEqual(2);
  });
});
