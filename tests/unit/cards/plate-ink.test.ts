import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { PLATE_INK, plateInkRect } from "@/lib/cards/plate-ink";
import { getFrameProfile, type StatSlot } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// lib/cards/plate-ink.ts — where each stat plate master puts ink, the rules
// layout's keep-out (layout v33, TODO 3.29). Every plate a profile draws has
// an entry, and each entry is re-measured here the way
// scripts/measure-plate-ink.mjs measures it (alpha ≥ 128, united over every
// colour): git plates always, bucket plates when a sha256-verified local build
// is present (FRAMES_BUILD_DIR, else .frames-build) — like the frame edge
// contract (tests/unit/frames/edge-contract.test.ts).
// ---------------------------------------------------------------------------

const manifest = manifestJson as { files: Record<string, { sha256: string; hash: string }> };

/**
 * The bucket plates PLATE_INK was measured on — each colour's manifest hash,
 * as scripts/measure-plate-ink.mjs prints it. CI has no bucket frames to
 * re-measure a bucket plate against, so a publish → promote that swaps one
 * (the manifest pointing at another file) fails here until the plate is
 * re-measured and both tables are updated — a stale keep-out never ships
 * green (layout v33 review: moving the walker shield's ink 0.025 → 0.4 passed
 * every rules test in CI).
 */
const MEASURED_ON: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "/frames/m15/pt/{color}.png": { w: "f6527bf8c103", u: "c4d44c844b2c", b: "910d573e16d2", r: "a96b70906276", g: "9baafb7090e6", c: "aa94a0984a71", m: "21f2e51b2eac" },
  "/frames/m15artifact/pt/{color}.png": { w: "f6527bf8c103", u: "c4d44c844b2c", b: "910d573e16d2", r: "a96b70906276", g: "9baafb7090e6", c: "82954026d022", m: "21f2e51b2eac" },
  "/frames/m15borderless/pt/{color}.png": { w: "27f7c5b0b36d", u: "f5cfb86d08b1", b: "8aa1a934257b", r: "c04b88ddea3b", g: "22975809834a", c: "37051a7bc4ca", m: "d7d60b3cbd8e" },
  "/frames/m15borderlessartifact/pt/{color}.png": { w: "27f7c5b0b36d", u: "f5cfb86d08b1", b: "8aa1a934257b", r: "c04b88ddea3b", g: "22975809834a", c: "153362ead210", m: "d7d60b3cbd8e" },
  "/frames/m15devoid/pt/{color}.png": { w: "aa94a0984a71", u: "aa94a0984a71", b: "aa94a0984a71", r: "aa94a0984a71", g: "aa94a0984a71", c: "aa94a0984a71", m: "aa94a0984a71" },
  "/frames/m15pw/loyalty/{color}.png": { w: "d69d28d0134d", u: "60a78b2232c6", b: "ca6ad18941f8", r: "ba92609978fb", g: "20f3cac491c6", c: "117ad7df3f73", m: "3437adf23b51" },
  "/frames/m15snow/pt/{color}.png": { w: "f6527bf8c103", u: "c4d44c844b2c", b: "910d573e16d2", r: "a96b70906276", g: "9baafb7090e6", c: "82954026d022", m: "21f2e51b2eac" },
};

/** A plate template's bucket colours: colour key → manifest hash. */
function bucketHashes(template: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["w", "u", "b", "r", "g", "c", "m"]) {
    const entry = manifest.files[template.replace(/^\/frames\//, "").replace("{color}", key)];
    if (entry) out[key] = entry.hash;
  }
  return out;
}
const PUBLIC = path.join(process.cwd(), "public", "frames");
const BUILD = process.env.FRAMES_BUILD_DIR ?? path.join(process.cwd(), ".frames-build");
const COLORS = ["w", "u", "b", "r", "g", "c", "m"];

/** Every plate asset a profile draws. */
function plateTemplates(): Set<string> {
  const out = new Set<string>();
  const add = (slot: StatSlot | undefined) => slot?.plateAssetPathTemplate && out.add(slot.plateAssetPathTemplate);
  for (const t of FRAME_TEMPLATE_VALUES) {
    const p = getFrameProfile(t);
    [p.pt, p.loyalty, p.defense, p.secondFace?.pt].forEach(add);
  }
  return out;
}

/** The readable files of one plate's colours, or null when a bucket plate
 *  isn't available (verified) on this machine. */
function plateFiles(template: string): string[] | null {
  const files: string[] = [];
  for (const key of COLORS) {
    const rel = template.replace(/^\/frames\//, "").replace("{color}", key);
    const entry = manifest.files[rel];
    if (entry) {
      const file = path.join(BUILD, rel);
      if (!fs.existsSync(file)) return null;
      if (createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== entry.sha256) return null;
      files.push(file);
    } else if (fs.existsSync(path.join(PUBLIC, rel))) {
      files.push(path.join(PUBLIC, rel));
    }
  }
  return files.length ? files : null;
}

async function inkFractions(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let [x0, y0, x1, y1] = [info.width, info.height, -1, -1];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] < 128) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return { left: x0 / info.width, top: y0 / info.height, right: (x1 + 1) / info.width, bottom: (y1 + 1) / info.height };
}

describe("plate ink", () => {
  it("knows every plate a profile draws", () => {
    for (const template of plateTemplates()) expect(PLATE_INK[template], template).toBeDefined();
  });

  it("was measured on the bucket plates the manifest serves today (re-run measure-plate-ink.mjs when one changes)", () => {
    for (const template of Object.keys(PLATE_INK)) {
      const hashes = bucketHashes(template);
      if (Object.keys(hashes).length === 0) {
        // A plate in public/frames: re-measured below on every run.
        expect(MEASURED_ON[template], template).toBeUndefined();
        continue;
      }
      expect(hashes, template).toEqual(MEASURED_ON[template]);
    }
    // No pin for a plate the table no longer lists.
    for (const template of Object.keys(MEASURED_ON)) expect(PLATE_INK[template], template).toBeDefined();
  });

  for (const template of Object.keys(PLATE_INK)) {
    const files = plateFiles(template);
    if (!files) {
      it.skip(`${template}: plates not available here (frames bucket; set FRAMES_BUILD_DIR)`, () => {});
      continue;
    }
    it(`${template}: is the plates' own ink, every colour, rounded outward`, async () => {
      let ink = { left: 1, top: 1, right: 0, bottom: 0 };
      for (const file of files) {
        const f = await inkFractions(file);
        ink = {
          left: Math.min(ink.left, f.left),
          top: Math.min(ink.top, f.top),
          right: Math.max(ink.right, f.right),
          bottom: Math.max(ink.bottom, f.bottom),
        };
      }
      const table = PLATE_INK[template];
      expect(table.left).toBeLessThanOrEqual(ink.left + 1e-9);
      expect(table.top).toBeLessThanOrEqual(ink.top + 1e-9);
      expect(table.right).toBeGreaterThanOrEqual(ink.right - 1e-9);
      expect(table.bottom).toBeGreaterThanOrEqual(ink.bottom - 1e-9);
      for (const k of ["left", "top", "right", "bottom"] as const) expect(Math.abs(table[k] - ink[k]), k).toBeLessThan(1e-4);
    });
  }

  it("places the ink over the plate's box — the M15 plate from 1156.9 / 1864.8 HD px", () => {
    const pt = getFrameProfile("m15").pt!;
    const ink = plateInkRect(pt.plateAssetPathTemplate!, pt.plateRect!)!;
    expect(ink.leftPct * 15).toBeCloseTo(1156.9, 0);
    expect(ink.topPct * 21).toBeCloseTo(1864.8, 0);
    expect(plateInkRect("/frames/nowhere/{color}.png", pt.plateRect!)).toBeNull();
  });
});
