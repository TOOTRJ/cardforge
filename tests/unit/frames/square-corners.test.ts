import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cardCornerRadiusPx } from "@/lib/cards/card-corner";
import {
  BORDER_BLACK_RGB,
  CORNER_NAMES,
  ROOT_BACKDROP_RGB,
  SQUARE_CORNERS,
  artCoversCorner,
  squareCornerFills,
  squareCornerKind,
  type CornerName,
} from "@/lib/frames/square-corners";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { FRAME_MASTER_KEYS } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 3.26 review — what a SQUARE output (print, the Square PNG) shows
// outside the card corner's arc must be the card's border there: the border
// black where the master's edge band is black, the root's #101015 where the
// band is see-through (the rings — a #000 cap there was a seam), and the
// master's own pixels where its design runs into the corner. The table in
// lib/frames/square-corners.ts is held to every master here: git masters
// everywhere, frames-bucket masters when a local build is present
// (FRAMES_BUILD_DIR, else <repo>/.frames-build) and matches the manifest.
// ---------------------------------------------------------------------------

describe("the square-corner table", () => {
  it("names only real templates", () => {
    for (const template of Object.keys(SQUARE_CORNERS)) {
      expect(FRAME_TEMPLATE_VALUES as readonly string[], template).toContain(template);
    }
  });

  it("is border black by default, root on the rings, design on top of Bloomburrow / LOTR / Tarkir draconic", () => {
    expect(squareCornerKind("m15", "w", "tl")).toBe("border");
    expect(squareCornerKind("retro", "b", "br")).toBe("border");
    for (const c of CORNER_NAMES) expect(squareCornerKind("battle", "r", c)).toBe("root");
    for (const t of ["bloomburrow", "lotr", "tarkirdraconic"]) {
      expect(CORNER_NAMES.map((c) => squareCornerKind(t, "g", c))).toEqual(["frame", "frame", "root", "root"]);
    }
    // expeditionland: only the see-through-band keys.
    expect(squareCornerKind("expeditionland", "b", "tl")).toBe("root");
    expect(squareCornerKind("expeditionland", "w", "tl")).toBe("border");
  });

  it("keeps the art in a corner the art slot covers, and paints the rest", () => {
    const art = { topPct: 0, leftPct: 0, widthPct: 100, heightPct: 92.24 }; // m15borderless
    expect(CORNER_NAMES.map((c) => artCoversCorner(art, c))).toEqual([true, true, false, false]);
    expect(squareCornerFills("m15borderless", art, { left: "g", right: "g" })).toEqual([
      null,
      null,
      BORDER_BLACK_RGB,
      BORDER_BLACK_RGB,
    ]);
    const full = { topPct: 0, leftPct: 0, widthPct: 100, heightPct: 100 };
    expect(squareCornerFills("fullartland", full, { left: "w", right: "w" })).toEqual([null, null, null, null]);
    expect(squareCornerFills("tarkirdragon", null, { left: "u", right: "r" })).toEqual([
      ROOT_BACKDROP_RGB,
      ROOT_BACKDROP_RGB,
      ROOT_BACKDROP_RGB,
      ROOT_BACKDROP_RGB,
    ]);
    // A split's halves each answer for their own side.
    expect(squareCornerFills("expeditionland", null, { left: "b", right: "w" })).toEqual([
      ROOT_BACKDROP_RGB,
      BORDER_BLACK_RGB,
      ROOT_BACKDROP_RGB,
      BORDER_BLACK_RGB,
    ]);
  });
});

const manifest = manifestJson as { files: Record<string, { sha256: string }> };
const PUBLIC = path.join(process.cwd(), "public", "frames");
const BUILD = process.env.FRAMES_BUILD_DIR ?? path.join(process.cwd(), ".frames-build");

function mastersOf(template: string): Array<{ key: string; file: string; bucket: boolean }> {
  const out: Array<{ key: string; file: string; bucket: boolean }> = [];
  for (const key of FRAME_MASTER_KEYS) {
    const rel = `${template}/${key}.png`;
    const entry = manifest.files[rel];
    if (entry) {
      const file = path.join(BUILD, rel);
      if (!fs.existsSync(file)) continue;
      const sha = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      if (sha === entry.sha256) out.push({ key, file, bucket: true });
      continue;
    }
    const file = path.join(PUBLIC, rel);
    if (fs.existsSync(file)) out.push({ key, file, bucket: false });
  }
  return out;
}

const luma = (d: Uint8Array, o: number) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

/** What a master shows at one corner: its edge band just past the corner
 *  box (both edges, rows / columns 0–3), and how much of the region fully
 *  outside the arc it paints opaque. */
function cornerOf(data: Uint8Array, w: number, h: number, corner: CornerName) {
  const r = cardCornerRadiusPx(w, h);
  const n = Math.ceil(r);
  const fx = corner === "tr" || corner === "br";
  const fy = corner === "bl" || corner === "br";
  const off = (lx: number, ly: number) => ((fy ? h - 1 - ly : ly) * w + (fx ? w - 1 - lx : lx)) * 4;
  const bandAlpha: number[] = [];
  const bandLuma: number[] = [];
  for (let a = n + 4; a < n + 28; a += 1) {
    for (let t = 0; t < 4; t += 1) {
      for (const o of [off(a, t), off(t, a)]) {
        bandAlpha.push(data[o + 3]);
        bandLuma.push(luma(data, o));
      }
    }
  }
  let outside = 0;
  let outsideOpaque = 0;
  let outsideColoured = 0;
  for (let ly = 0; ly < n; ly += 1) {
    for (let lx = 0; lx < n; lx += 1) {
      if (Math.hypot(r - lx - 0.5, r - ly - 0.5) - r < 0.5) continue;
      outside += 1;
      const o = off(lx, ly);
      if (data[o + 3] < 128) continue;
      if (data[o + 3] >= 252) outsideOpaque += 1;
      const chroma = Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2]);
      if (luma(data, o) > 48 && chroma > 40) outsideColoured += 1;
    }
  }
  return { bandAlpha: median(bandAlpha), bandLuma: median(bandLuma), outside, outsideOpaque, outsideColoured };
}

describe("every master's square corners are what the table says", () => {
  const bucketTemplates = new Set(Object.keys(manifest.files).map((k) => k.split("/")[0]));
  for (const template of FRAME_TEMPLATE_VALUES) {
    const masters = mastersOf(template);
    if (masters.length === 0) {
      it.skip(`${template}: masters not available here (frames bucket; set FRAMES_BUILD_DIR)`, () => {});
      continue;
    }
    const art = getFrameProfile(template).artSlot;
    it(`${template}${bucketTemplates.has(template) ? " (bucket)" : ""}: ${masters.map((m) => m.key).join(" ")}`, async () => {
      for (const m of masters) {
        const { data, info } = await sharp(m.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        for (const corner of CORNER_NAMES) {
          if (artCoversCorner(art, corner)) continue; // the art fills it
          const kind = squareCornerKind(template, m.key, corner);
          const c = cornerOf(data, info.width, info.height, corner);
          const where = `${template}/${m.key} ${corner} (${kind}): band α ${c.bandAlpha} luma ${Math.round(c.bandLuma)}, outside ${c.outsideOpaque}/${c.outside} opaque`;
          if (kind !== "frame") {
            // A fill covers everything outside the arc: only border, paper
            // or nothing may be there — never coloured design (that corner
            // would be "frame", and its free Square rendered live).
            expect(c.outsideColoured, where).toBe(0);
          }
          if (kind === "border") {
            // The border runs black to the corner: the fill is its colour.
            expect(c.bandAlpha, where).toBeGreaterThanOrEqual(252);
            expect(c.bandLuma, where).toBeLessThanOrEqual(24);
          } else if (kind === "root") {
            // The band is see-through: the card's border there IS #101015.
            expect(c.bandAlpha, where).toBeLessThanOrEqual(13);
          } else {
            // Design runs into the corner: the master paints all of it.
            expect(c.outsideOpaque, where).toBe(c.outside);
          }
        }
      }
    });
  }
});
