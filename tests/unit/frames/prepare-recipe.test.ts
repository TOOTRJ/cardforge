import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { PREPARE_RECIPE as R } from "../../../scripts/lib/prepare-2026.mjs";
import provenanceJson from "@/lib/cards/frame-sources.json";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 4.27 — the Prepare frame's masters are PipGlyph's own derivation
// (scripts/build-prepare-frames.mjs), every number DATA in
// scripts/lib/prepare-2026.mjs, measured on print. This holds the recipe,
// the profile the renderers read and the published objects together:
//   • every text slot of the profile sits inside the piece of the master it
//     is printed on (the spell's name and type on their bars, its rules in
//     the page's box, the creature's rules in the left box);
//   • the recipe's pieces tile the page (the strip's blocks fill its rows,
//     the outline sits between the left box's edge and the page's box);
//   • provenance names every source the run reads, and the bucket holds a
//     PNG and a WebP of every key at 1500 × 2100;
//   • on the real masters (FRAMES_BUILD_DIR at the manifest's sha256): the
//     page is opaque, and its bars' fill is the recipe's tone.
// ---------------------------------------------------------------------------

type Entry = { hash: string; sha256: string; bytes: number; width: number; height: number };
const MANIFEST = (manifestJson as { files: Record<string, Entry> }).files;
const PROVENANCE = provenanceJson as Record<string, { source: string; converter: string; colors: Record<string, string[]>; sourceFiles: string[] }>;
const BASE = R.base as Record<string, string>;
const BARS = R.barSources as Record<string, string>;
const W = 1500;
const H = 2100;
const px = (rect: Rect) => ({ x0: (rect.leftPct * W) / 100, x1: ((rect.leftPct + rect.widthPct) * W) / 100, y0: (rect.topPct * H) / 100, y1: ((rect.topPct + rect.heightPct) * H) / 100 });

describe("the Prepare recipe", () => {
  const profile = getFrameProfile("prepare");
  const page = profile.adventure!;

  it("builds the seven keys from published masters", () => {
    expect(R.keys).toEqual(["w", "u", "b", "r", "g", "m", "c"]);
    for (const key of R.keys) {
      expect(MANIFEST[`${BASE[key]}.png`], BASE[key]).toBeDefined();
      expect(MANIFEST[`${BARS[key]}.png`], BARS[key]).toBeDefined();
    }
    // The colourless key is the artifact frame (m15/c is see-through).
    expect(R.base.c).toBe("m15artifact/c");
    // Print shows the five colours alone; m and c take the mean.
    expect(Object.keys(R.print).sort()).toEqual(["b", "g", "r", "u", "w"]);
    for (const [key, p] of Object.entries(R.print)) {
      expect(p.printings.length, key).toBeGreaterThanOrEqual(9);
      expect(p.nameTop, key).toHaveLength(10);
      expect(p.typeBottom, key).toHaveLength(12);
    }
  });

  it("prints every text where the master paints its piece", () => {
    const name = px(page.title.rect);
    const type = px(page.type.rect);
    const spell = px(page.rules.rect);
    const creature = px(profile.rules.rect);
    const centre = (r: { y0: number; y1: number }) => (r.y0 + r.y1) / 2;
    const [nameTop, nameBottom] = R.bars.name.rows;
    const [typeTop, typeBottom] = R.bars.type.rows;
    expect(centre(name)).toBeGreaterThan(nameTop + 20);
    expect(centre(name)).toBeLessThan(nameBottom - 20);
    expect(centre(type)).toBeGreaterThan(typeTop + 20);
    expect(centre(type)).toBeLessThan(typeBottom - 20);
    // The bars run from x 758 to the half-ellipse's end.
    for (const bar of [name, type]) {
      expect(bar.x0).toBeGreaterThan(R.bars.x0 + R.bars.outline);
      expect(bar.x1).toBeLessThanOrEqual(R.bars.end.cx + R.bars.end.a);
    }
    // The spell's rules inside the page's box.
    expect(spell.x0).toBeGreaterThanOrEqual(R.pageBox.cols[0]);
    expect(spell.x1).toBeLessThanOrEqual(R.pageBox.cols[1] + 0.5);
    expect(spell.y0).toBeGreaterThanOrEqual(R.pageBox.rows[0]);
    expect(spell.y1).toBeLessThanOrEqual(R.pageBox.rows[1]);
    // The creature's rules inside the left box, clear of its shaded edge.
    expect(creature.x1).toBeLessThanOrEqual(R.leftBoxEdge.toCol + R.leftBoxEdge.width - 8 + 0.5);
    expect(creature.y1).toBeLessThanOrEqual(R.leftBoxEdge.rows[1]);
  });

  it("tiles the page: the strip's blocks fill its rows, the outline sits between the boxes", () => {
    expect(R.strip.shadow.length).toBeLessThanOrEqual(R.strip.rows[1] - R.strip.rows[0] + 1);
    // The strip reads the field beside the art window (it ends at 1166 px,
    // where the type bar's end begins), inside the frame's right side.
    const blockRows = R.strip.blocks.reduce((n, b) => n + Math.abs(b.fieldCols[1] - b.fieldCols[0]) + 1, 0);
    expect(blockRows - R.strip.crossFade * (R.strip.blocks.length - 1)).toBeGreaterThanOrEqual(R.strip.rows[1] - R.strip.rows[0] + 1);
    for (const b of R.strip.blocks) {
      expect(b.sourceRow0 + (R.strip.cols[1] - R.strip.cols[0])).toBeLessThan(1166);
      // Inside the field, never its outer rim (1438..1441, owner Round 79).
      for (const c of b.fieldCols) expect(c > 1402 && c < 1438, b.fieldCols.join("..")).toBe(true);
    }
    const outlineCols = Object.keys(R.outline.left.cols).map(Number);
    expect(Math.min(...outlineCols)).toBeGreaterThanOrEqual(R.leftBoxEdge.toCol + R.leftBoxEdge.width);
    expect(Math.max(...outlineCols)).toBeLessThan(R.bars.x0);
    expect(R.rim.cols[0]).toBeGreaterThan(Math.max(...outlineCols) - 1);
    expect(R.pageBox.rows[0]).toBeGreaterThan(R.bars.type.rows[1]);
    expect(R.strip.rows[0]).toBeGreaterThan(R.pageBox.rows[1]);
  });

  it("names its sources in provenance, and the bucket holds every key", () => {
    const entry = PROVENANCE.prepare!;
    expect(entry.source).toBe("pipglyph");
    expect(entry.converter).toBe("scripts/build-prepare-frames.mjs");
    expect(Object.keys(entry.colors).sort()).toEqual([...R.keys].sort());
    expect(entry.sourceFiles).toEqual([...new Set(R.keys.flatMap((k) => [`${BASE[k]}.png`, `${BARS[k]}.png`]))].sort());
    for (const key of R.keys) {
      for (const ext of ["png", "webp"]) {
        const file = MANIFEST[`prepare/${key}.${ext}`];
        expect(file, `prepare/${key}.${ext}`).toBeDefined();
        expect([file!.width, file!.height]).toEqual([W, H]);
      }
    }
  });
});

// The real masters, where a build of them is at hand (CI fetches the bucket).
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
function master(key: string): Buffer | null {
  const rel = `prepare/${key}.png`;
  const file = path.join(BUILD, rel);
  if (!MANIFEST[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === MANIFEST[rel].sha256 ? bytes : null;
}
const haveMasters = R.keys.every((k) => master(k) !== null);

describe.skipIf(!haveMasters)("the Prepare masters", () => {
  it("are opaque over the page, the bars and the strip", async () => {
    for (const key of R.keys) {
      const { data } = await sharp(master(key)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let y = R.rim.rows[0]; y <= R.strip.rows[1]; y += 3) {
        for (let x = R.rim.cols[0]; x <= R.rim.cols[1]; x += 3) expect(data[(y * W + x) * 4 + 3], `${key} ${x},${y}`).toBe(255);
      }
    }
  });

  it("paint the bars in print's tone (the five measured keys, within 12 levels)", async () => {
    for (const [key, p] of Object.entries(R.print)) {
      const { data } = await sharp(master(key)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const median = (x0: number, x1: number, y0: number, y1: number) =>
        [0, 1, 2].map((c) => {
          const v: number[] = [];
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) v.push(data[(y * W + x) * 4 + c]!);
          return v.sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
        });
      const type = median(1100, 1385, 1450, 1496);
      for (let c = 0; c < 3; c++) expect(Math.abs(type[c]! - p.typeFill[c]!), `${key} type bar ${type} vs ${p.typeFill}`).toBeLessThanOrEqual(12);
    }
  });
});
