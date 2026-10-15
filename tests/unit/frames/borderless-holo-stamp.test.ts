import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import {
  ARCH_LIFT_PX,
  BLACK_BAR_TOP,
  BORDERLESS_NOTCH_BOX,
  BORDERLESS_STAMP_FOLDERS,
  archLiftAt,
  bestCover,
  buildBorderlessNotch,
  liftError,
  pinlineTop,
} from "@/scripts/lib/borderless-stamp.mjs";
import { resolveHoloStamp } from "@/lib/cards/anatomy";
import { M15BORDERLESS_HOLO_STAMP_KEEP_OUT, M15_HOLO_STAMP_KEEP_OUT, M15_HOLO_STAMP_OVAL } from "@/lib/cards/holo-stamp";
import {
  M15BORDERLESSLAND_HOLO_STAMP,
  M15BORDERLESSSTATION_HOLO_STAMP,
  M15BORDERLESS_HOLO_STAMP,
  M15_COLLECTOR,
  getFrameProfile,
} from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 4.9d (owner Round 66, 2026-10-14) — the holofoil stamp's notch on the
// borderless frames: PipGlyph's own derivation (scripts/build-borderless-
// stamp.mjs, the printed arch in scripts/lib/borderless-stamp.mjs). Each
// piece is its master's own pinline LIFTED along the printed arch: the layer
// that, over the master, shows the bevel, the rim and the black under them
// moved up, while the box above keeps its own pixels. Held here:
//   • the recipe is the profiles' slots (box, keys, oval, keep-out);
//   • the arch: symmetric, 32.6 px at the centre, nothing past x 662–838;
//   • the cover: exact wherever covering can do it, transparent where the
//     master already shows the target, the box never moved;
//   • the manifest lists every key, PNG and WebP, at 180 × 52; provenance
//     names the master of every key and no Card Conjurer piece;
//   • when the published objects are on disk at the manifest's sha256
//     (FRAMES_BUILD_DIR, else .frames-build): every piece IS the recipe over
//     its published master, byte for byte, its WebP's alpha the PNG's, and
//     it lands within the recipe's tolerance of the lifted master.
// ---------------------------------------------------------------------------

type Entry = { sha256: string; width: number; height: number };
const files = (manifestJson as { files: Record<string, Entry> }).files;
/** Where the published objects may be on disk: FRAMES_BUILD_DIR (CI's
 *  fetched cache — PNGs only), the builder's .frames-build (PNG + WebP). */
const DIRS = [
  ...(process.env.FRAMES_BUILD_DIR ? [path.resolve(process.env.FRAMES_BUILD_DIR)] : []),
  path.join(process.cwd(), ".frames-build"),
  path.join(process.cwd(), ".frames-cache"),
];
const provenance = JSON.parse(fs.readFileSync("lib/cards/frame-sources.json", "utf8")) as Record<
  string,
  { source: string; converter: string; colors: Record<string, string[]>; sourceFiles: string[]; notes: string[] }
>;

function onDisk(rel: string): Buffer | null {
  if (!files[rel]) return null;
  for (const dir of DIRS) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    if (createHash("sha256").update(bytes).digest("hex") === files[rel].sha256) return bytes;
  }
  return null;
}

const SLOTS = {
  m15borderlessholostamp: M15BORDERLESS_HOLO_STAMP,
  m15borderlesslandholostamp: M15BORDERLESSLAND_HOLO_STAMP,
  m15borderlessstationholostamp: M15BORDERLESSSTATION_HOLO_STAMP,
} as const;

describe("the recipe is the profiles' slots", () => {
  it("one box, the folder's keys, M15's oval; the borderless keep-out (M15's on the bevel-less station box)", () => {
    const box = BORDERLESS_NOTCH_BOX;
    for (const [folder, slot] of Object.entries(SLOTS)) {
      expect(slot.anatomy).toBe("holoStamp");
      if (slot.anatomy !== "holoStamp") continue;
      expect(slot.rect.leftPct).toBeCloseTo((box.x / 1500) * 100, 10);
      expect(slot.rect.topPct).toBeCloseTo((box.y / 2100) * 100, 10);
      expect(slot.rect.widthPct).toBeCloseTo((box.width / 1500) * 100, 10);
      expect(slot.rect.heightPct).toBeCloseTo((box.height / 2100) * 100, 10);
      expect(slot.assetPathTemplate).toBe(`/frames/${folder}/{key}.png`);
      expect([...slot.keys].sort()).toEqual(Object.keys(BORDERLESS_STAMP_FOLDERS[folder as keyof typeof BORDERLESS_STAMP_FOLDERS].keys).sort());
      const keepOut = folder === "m15borderlessstationholostamp" ? M15_HOLO_STAMP_KEEP_OUT : M15BORDERLESS_HOLO_STAMP_KEEP_OUT;
      expect(slot.stamp).toEqual({ shape: "oval", oval: M15_HOLO_STAMP_OVAL, keepOut });
    }
    // Even HD px: the 750 bake halves the box exactly.
    for (const v of Object.values(box)) expect(v % 2).toBe(0);
  });

  it("the four borderless entries draw it (the artifact's colourless key is the silver `a`) with M15's collector slot; the walkers wait for the owner", () => {
    const facts = (colorKey: string, over: Record<string, unknown> = {}) =>
      ({ colorKey, colors: [colorKey === "c" ? "colorless" : "blue"], rarity: "rare", cost: "{2}{U}", cardType: "creature", supertype: null, ...over }) as Parameters<typeof resolveHoloStamp>[2];
    const pathOf = (template: string, colorKey: string, over: Record<string, unknown> = {}, style: Record<string, unknown> = {}) =>
      resolveHoloStamp(getFrameProfile(template), { stamp: "auto", ...style }, facts(colorKey, over))?.notch.path ?? null;
    expect(pathOf("m15borderless", "u")).toBe("/frames/m15borderlessholostamp/u.png");
    expect(pathOf("m15borderless", "c")).toBe("/frames/m15borderlessholostamp/c.png");
    expect(pathOf("m15borderlessartifact", "c", { cardType: "artifact" })).toBe("/frames/m15borderlessholostamp/a.png");
    expect(pathOf("m15borderlessartifact", "r", { cardType: "artifact" })).toBe("/frames/m15borderlessholostamp/r.png");
    expect(pathOf("m15borderlessland", "g", { cardType: "land" })).toBe("/frames/m15borderlesslandholostamp/g.png");
    expect(pathOf("m15borderlessstation", "c", { cardType: "artifact" })).toBe("/frames/m15borderlessstationholostamp/c.png");
    // A pair drawn as its pair master asks for the pair's piece (either dress).
    expect(pathOf("m15borderless", "m", { colors: ["white", "blue"], cost: "{W}{U}" }, { twoColor: true })).toBe("/frames/m15borderlessholostamp/wu.png");
    // A common on "auto": no stamp (an oval frame).
    expect(pathOf("m15borderless", "u", { rarity: "common" })).toBeNull();
    for (const t of ["m15borderless", "m15borderlessartifact", "m15borderlessland", "m15borderlessstation"]) {
      expect(getFrameProfile(t).collector, t).toEqual(M15_COLLECTOR);
    }
    for (const t of ["m15borderlesspw", "m15borderlesspwtall"]) {
      expect(getFrameProfile(t).collector, t).toBeUndefined();
      expect((getFrameProfile(t).overlays ?? []).some((o) => o.anatomy === "holoStamp"), t).toBe(false);
    }
  });
});

describe("the arch and the cover", () => {
  it("the arch is symmetric about x 750, 32.6 px at the centre, falling to nothing past x 662–838", () => {
    expect(archLiftAt(749)).toBeCloseTo(32.6, 1);
    for (let d = 0; d < 100; d += 1) expect(archLiftAt(749 - d)).toBeCloseTo(archLiftAt(750 + d), 10);
    for (let x = 750; x < 900; x += 1) expect(archLiftAt(x + 1)).toBeLessThanOrEqual(archLiftAt(x) + 1e-9);
    expect(archLiftAt(661)).toBe(0);
    expect(archLiftAt(838)).toBe(0);
    expect(archLiftAt(BORDERLESS_NOTCH_BOX.x)).toBe(0);
    expect(archLiftAt(BORDERLESS_NOTCH_BOX.x + BORDERLESS_NOTCH_BOX.width - 1)).toBe(0);
    expect(ARCH_LIFT_PX.at(-1)).toBe(0);
  });

  it("covering is exact where it can be, clear where the master already shows the target", () => {
    // A bevel (white at α .84) over a box (black at α .5): exact.
    const box = [0, 0, 0, 0.5];
    const bevel = [0.84 * 0.81, 0.84 * 0.81, 0.84 * 0.81, 0.84];
    const cover = bestCover(box, bevel);
    const a = cover[3] / 255;
    for (const art of [0, 0.5, 1]) {
      const want = bevel[0] + (1 - bevel[3]) * art;
      const got = (cover[0] / 255) * a + (1 - a) * (box[0] + (1 - box[3]) * art);
      expect(Math.abs(got - want) * 255).toBeLessThan(1);
    }
    // The same pixel wanted: nothing.
    expect(bestCover(box, box)[3]).toBe(0);
  });

  it("over a synthetic master: the bar lifted, the box untouched, both feet clear, nothing outside the box", () => {
    const W = 1500;
    const m = Buffer.alloc(W * 2100 * 4);
    const put = (x: number, y: number, p: number[]) => m.set(p, (y * W + x) * 4);
    for (let x = 600; x < 900; x += 1) {
      // A textured translucent box, a bevel, the rim, the black bar.
      for (let y = 1880; y < 1930; y += 1) put(x, y, [(x * 7 + y * 13) % 60, 30, 40, 128]);
      for (let y = 1930; y < 1937; y += 1) put(x, y, [207, 207, 207, 215]);
      for (let y = 1937; y < BLACK_BAR_TOP; y += 1) put(x, y, [0, 117, 190, 255]);
      for (let y = BLACK_BAR_TOP; y < 2000; y += 1) put(x, y, [0, 0, 0, 255]);
    }
    expect(pinlineTop(m, W, 750)).toBe(1930);
    const { piece, outside } = buildBorderlessNotch(m, W);
    expect(outside).toBe(0);
    const box = BORDERLESS_NOTCH_BOX;
    const at = (x: number, y: number) => [...piece.subarray(((y - box.y) * box.width + (x - box.x)) * 4, ((y - box.y) * box.width + (x - box.x)) * 4 + 4)];
    // Feet: clear.
    for (let y = box.y; y < box.y + box.height; y += 1) {
      expect(at(box.x, y)[3]).toBe(0);
      expect(at(box.x + box.width - 1, y)[3]).toBe(0);
    }
    // The centre column: box above (clear), the bevel and the rim moved up
    // 32.6 rows, then black down to the bar.
    expect(at(750, 1896)[3]).toBe(0);
    expect(at(750, 1910)).toEqual([0, 117, 190, 255]);
    expect(at(750, 1930)).toEqual([0, 0, 0, 255]);
    expect(at(750, 1947)).toEqual([0, 0, 0, 255]);
    // The textured box is never moved: at x 700 (lifted 22.6 rows, the
    // bevel's top at 1907.4) the box rows above it are clear.
    for (let y = box.y; y < 1906; y += 1) expect(at(700, y)[3]).toBe(0);
    expect(liftError(m, W, piece).worst).toBeLessThanOrEqual(1);
  });
});

describe("published to the frames bucket (dev; promoted by the owner)", () => {
  it("lists every key, PNG and WebP, at the piece's size", () => {
    let n = 0;
    for (const [folder, def] of Object.entries(BORDERLESS_STAMP_FOLDERS)) {
      for (const key of Object.keys(def.keys)) {
        for (const ext of ["png", "webp"]) {
          const entry = files[`${folder}/${key}.${ext}`];
          expect(entry, `${folder}/${key}.${ext}`).toBeDefined();
          expect([entry.width, entry.height]).toEqual([BORDERLESS_NOTCH_BOX.width, BORDERLESS_NOTCH_BOX.height]);
          n += 1;
        }
      }
    }
    // 18 + 17 + 7 keys, PNG and WebP.
    expect(n).toBe(84);
    expect(Object.keys(files).filter((k) => /^m15borderless(land|station)?holostamp\//.test(k))).toHaveLength(84);
  });

  it("provenance: PipGlyph's own build, every key's master named, no Card Conjurer piece", () => {
    for (const [folder, def] of Object.entries(BORDERLESS_STAMP_FOLDERS)) {
      const p = provenance[folder];
      expect(p, folder).toBeDefined();
      expect(p.source).toBe("pipglyph");
      expect(p.converter).toBe("scripts/build-borderless-stamp.mjs");
      expect(Object.keys(p.colors).sort()).toEqual(Object.keys(def.keys).sort());
      for (const [key, rel] of Object.entries(def.keys)) {
        expect(p.colors[key][0]).toContain(`${rel}.png (published, sha256 ${files[`${rel}.png`].sha256.slice(0, 12)})`);
        for (const other of (def.sharedBy as Record<string, string[]>)[key] ?? []) expect(p.colors[key].join(" ")).toContain(`${other}.png`);
      }
      expect(p.sourceFiles.every((f) => /^m15borderless(artifact|land|station)?\/[a-z-]+\.png$/.test(f))).toBe(true);
      expect(p.notes.join(" ")).toMatch(/no CC piece and no scan/);
    }
  });

  const pieces = Object.entries(BORDERLESS_STAMP_FOLDERS).flatMap(([folder, def]) =>
    Object.entries(def.keys).map(([key, rel]) => [folder, key, rel] as const),
  );
  const available = pieces.every(([folder, key, rel]) => onDisk(`${folder}/${key}.png`) && onDisk(`${rel}.png`));

  describe.skipIf(!available)("the published pieces (set FRAMES_BUILD_DIR if skipped)", () => {
    it.each(pieces)("%s/%s is the recipe over %s, byte for byte (and its WebP's alpha the PNG's, where the WebP is on disk)", async (folder, key, rel) => {
      const master = await sharp(onDisk(`${rel}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const { piece } = buildBorderlessNotch(master.data, master.info.width);
      const png = await sharp(onDisk(`${folder}/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([png.info.width, png.info.height]).toEqual([BORDERLESS_NOTCH_BOX.width, BORDERLESS_NOTCH_BOX.height]);
      expect(Buffer.compare(png.data, piece)).toBe(0);
      const webpBytes = onDisk(`${folder}/${key}.webp`);
      if (webpBytes) {
        const webp = await sharp(webpBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        for (let i = 3; i < png.data.length; i += 4) {
          if (webp.data[i] !== png.data[i]) throw new Error(`${folder}/${key}.webp alpha differs at byte ${i}`);
        }
      }
      expect(liftError(master.data, master.info.width, png.data).worst).toBeLessThanOrEqual(5);
    });
  });
});
