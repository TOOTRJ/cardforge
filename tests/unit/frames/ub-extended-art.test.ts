import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  BORDERLESS_CROWN,
  CC_COMMIT,
  CC_OVERLAY_BANDS,
  CC_SOURCE_TONES,
  CC_TEMPLATES,
  EXTENDED_CROWN_BAND,
  HOLO_STAMP_NOTCHES,
  NOTCH_FOOT,
  UB_EXTENDED_CROWN_BAND,
  UB_EXTENDED_MASK,
  UB_EXTENDED_NOTCH_BOX,
  UB_EXTENDED_PRINT_TONES,
  UB_EXTENDED_SEAM_ROWS,
  UB_EXTENDED_SOURCE_TONES,
  UB_PRINT_TONES,
  extendedCrownLayers,
  sealUbExtendedSeams,
  sourceFilesFor,
  sourceTonesOf,
  ubExtendedCrownLayers,
  ubExtendedFrameFile,
  ubExtendedPairLayers,
} from "../../../scripts/lib/cc-frames.mjs";
import { EXTENDED_ART_UB_CROWN, EXTENDED_ART_UB_HOLO_STAMP, getFrameProfile } from "@/lib/cards/template-layout";
import { UB_STAMP_HOLE } from "@/lib/cards/holo-stamp";
import { EDGE_CONTRACTS } from "@/lib/frames/edge-contract";
import manifestJson from "@/lib/frames/frame-manifest.json";
import sourcesJson from "@/lib/cards/frame-sources.json";

// ---------------------------------------------------------------------------
// TODO 4.25 — the Universes Beyond EXTENDED-ART frames (owner approval
// 2026-11-25): Card Conjurer's 'Universes Beyond (Extended art)' pack
// (`m15/ub/extended/`, 1500 × 2100 native, the REGULAR M15 pack's masks) as
// two templates, `extendedartub` and `extendedartubland` — the recipe, the
// tones onto print, the seams sealed, the floating Universes Beyond crown
// band, the triangle notch on the pack's own piece, and, where the
// published objects are on disk (FRAMES_BUILD_DIR, else .frames-build; CI
// fetches them), their pixels. Card Conjurer's files never enter git.
// (The templates, the profiles and the import: tests/unit/creator/
// ub-extended-art-frame.test.ts.)
// ---------------------------------------------------------------------------

type Layer = { src: string; mask?: string; right?: string; ramp?: number[] };
const templates = CC_TEMPLATES as unknown as Record<string, { colors: Record<string, Layer[]>; plates?: unknown; masterPass?: unknown }>;
const PAIRS = ["wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"];
const UBX = "img/frames/m15/ub/extended";
const REG = "img/frames/m15/regular";
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
type Entry = { sha256: string; width: number; height: number };
const MANIFEST = (manifestJson as { files: Record<string, Entry> }).files;
const SOURCES = sourcesJson as Record<string, { commit?: string; colors?: Record<string, string[]>; sourceFiles?: string[]; sourceTones?: unknown; notes?: string[] }>;

function published(rel: string): Buffer | null {
  const file = path.join(BUILD, rel);
  if (!MANIFEST[rel] || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return createHash("sha256").update(bytes).digest("hex") === MANIFEST[rel].sha256 ? bytes : null;
}
async function rgba(bytes: Buffer) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

describe("the recipe", () => {
  it("is the pack's whole file per key, 1500 px native — c the pack's artifact frame (no colourless frame), the land dress its land files named letter first", () => {
    const spell = templates.extendedartub;
    expect(Object.keys(spell.colors).filter((k) => k.length === 1).sort()).toEqual(["b", "c", "g", "m", "r", "u", "w"]);
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(spell.colors[key], key).toEqual([{ src: `${UBX}/${key}.png` }]);
    expect(spell.colors.c).toEqual([{ src: `${UBX}/a.png` }]);
    const land = templates.extendedartubland;
    expect(Object.keys(land.colors).filter((k) => k.length === 1).sort()).toEqual(["b", "c", "g", "m", "r", "u", "w"]);
    expect(land.colors.c).toEqual([{ src: `${UBX}/l.png` }]);
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(land.colors[key], key).toEqual([{ src: `${UBX}/${key}l.png` }]);
    // The seam pass on both. The land frame has no plates of its own (its
    // profile reads m15ub's); the spell frame its own set — the pack's
    // seven UB plates and the silver 'Artifact' plate under `a`, which its
    // colourless card paints.
    for (const def of [spell, land]) expect(typeof def.masterPass).toBe("function");
    expect(land.plates).toBeUndefined();
    expect(spell.plates).toEqual({
      ...Object.fromEntries(["w", "u", "b", "r", "g", "c", "m"].map((k) => [k, `img/frames/m15/ub/pt/${k}.png`])),
      a: "img/frames/m15/ub/pt/a.png",
    });
    expect(ubExtendedFrameFile("c")).toBe(`${UBX}/a.png`);
    expect(ubExtendedFrameFile("wl")).toBe(`${UBX}/wl.png`);
    expect(ubExtendedFrameFile("v")).toBe(`${UBX}/v.png`);
  });

  it("the pairs: 4.6b's recipe over the pack's files through ITS masks — the regular M15 pack's, the 'Super' Pinline", () => {
    expect(UB_EXTENDED_MASK).toEqual({
      border: `${REG}/m15MaskBorder.png`,
      frame: `${REG}/m15MaskFrame.png`,
      rules: `${REG}/m15MaskRules.png`,
      title: `${REG}/m15MaskTitle.png`,
      type: `${REG}/m15MaskType.png`,
      pinline: `${REG}/m15MaskPinlineSuper.png`,
    });
    expect(Object.keys(templates.extendedartub.colors).filter((k) => k.length > 1)).toEqual([...PAIRS, ...PAIRS.map((p) => `${p}-h`)]);
    expect(Object.keys(templates.extendedartubland.colors).filter((k) => k.length > 1)).toEqual(PAIRS);
    for (const pair of PAIRS) {
      expect(templates.extendedartub.colors[pair], pair).toEqual(ubExtendedPairLayers(pair, "split", "m15"));
      expect(templates.extendedartub.colors[`${pair}-h`], pair).toEqual(ubExtendedPairLayers(pair, "hybrid", "m15"));
      expect(templates.extendedartubland.colors[pair], pair).toEqual(ubExtendedPairLayers(pair, "split", "land"));
    }
    expect(ubExtendedPairLayers("rw", "split", "m15")).toEqual([
      { src: `${UBX}/m.png` },
      { src: `${UBX}/r.png`, right: `${UBX}/w.png`, ramp: [45, 57], mask: `${REG}/m15MaskRules.png` },
      { src: `${UBX}/r.png`, right: `${UBX}/w.png`, ramp: [40, 60], mask: `${REG}/m15MaskPinlineSuper.png` },
    ]);
    expect(ubExtendedPairLayers("gu", "hybrid", "m15")).toEqual([
      { src: `${UBX}/g.png`, right: `${UBX}/u.png`, ramp: [44, 57] },
      { src: `${UBX}/g.png`, right: `${UBX}/u.png`, ramp: [45, 57], mask: `${REG}/m15MaskRules.png` },
      { src: `${UBX}/l.png`, mask: `${REG}/m15MaskTitle.png` },
      { src: `${UBX}/l.png`, mask: `${REG}/m15MaskType.png` },
      { src: `${UBX}/g.png`, right: `${UBX}/u.png`, ramp: [40, 60], mask: `${REG}/m15MaskPinlineSuper.png` },
    ]);
    expect(ubExtendedPairLayers("bg", "split", "land")).toEqual([
      { src: `${UBX}/l.png` },
      { src: `${UBX}/bl.png`, right: `${UBX}/gl.png`, ramp: [45, 57], mask: `${REG}/m15MaskRules.png` },
      { src: `${UBX}/bl.png`, right: `${UBX}/gl.png`, ramp: [40, 60], mask: `${REG}/m15MaskPinlineSuper.png` },
    ]);
    // Every file the two templates read is the pack's, its UB plates or the
    // regular pack's masks.
    for (const t of ["extendedartub", "extendedartubland"]) {
      for (const file of sourceFilesFor(templates[t] as never)) expect(file, t).toMatch(/^img\/frames\/m15\/(ub\/extended\/[a-z]+|ub\/pt\/[a-z]|regular\/m15Mask[A-Za-z]+)\.png$/);
    }
  });
});

describe("the tones onto print", () => {
  it("carry the bordered family's tone pass over — the pack's paint IS the accurate pack's — and add the blue title bar", () => {
    expect(UB_EXTENDED_PRINT_TONES.g).toEqual({ title: UB_PRINT_TONES.g.title });
    expect(UB_EXTENDED_PRINT_TONES.m).toEqual({ title: UB_PRINT_TONES.m.title, rules: UB_PRINT_TONES.m.rules });
    expect(UB_EXTENDED_PRINT_TONES.l).toEqual({ title: UB_PRINT_TONES.l.title, rules: UB_PRINT_TONES.l.rules });
    expect(UB_EXTENDED_PRINT_TONES.u).toEqual({ title: { from: [166, 208, 239], to: [180, 210, 238] } });
    // No type-bar tone: the extended frame's type bar is black.
    for (const tones of Object.values(UB_EXTENDED_PRINT_TONES)) expect(Object.keys(tones)).not.toContain("type");
    // Every tone is ≥ 9 levels off on some channel — the rule a tone is made by.
    for (const [letter, tones] of Object.entries(UB_EXTENDED_PRINT_TONES)) {
      for (const [region, tone] of Object.entries(tones as Record<string, { from: number[]; to: number[] }>)) {
        expect(Math.max(...tone.from.map((v, c) => Math.abs(v - tone.to[c]))), `${letter}/${region}`).toBeGreaterThanOrEqual(9);
      }
    }
  });

  it("tone seven files of the pack — each colour with its land tint, the gold land with the gold, the land grey — through its own masks, and no other", () => {
    expect(Object.keys(UB_EXTENDED_SOURCE_TONES).sort()).toEqual(["g", "gl", "l", "m", "ml", "u", "ul"].map((f) => `${UBX}/${f}.png`).sort());
    for (const [file, tone] of Object.entries(UB_EXTENDED_SOURCE_TONES)) {
      expect(sourceTonesOf(file), file).toBe(tone);
      for (const [region, mask] of Object.entries((tone as { masks: Record<string, string> }).masks)) {
        expect(mask, `${file} ${region}`).toBe(UB_EXTENDED_MASK[region as keyof typeof UB_EXTENDED_MASK]);
      }
    }
    for (const f of ["w", "b", "r", "a", "wl", "bl", "rl", "v"]) expect(sourceTonesOf(`${UBX}/${f}.png`), f).toBeNull();
    // The bordered family's own table is untouched.
    expect(Object.keys(CC_SOURCE_TONES).every((file) => file.startsWith("img/frames/m15/new/ub/"))).toBe(true);
  });
});

describe("the seams", () => {
  it("are sealed outside the art slot's rows only, colour kept: the window and the type bar's shade as drawn", () => {
    expect(UB_EXTENDED_SEAM_ROWS).toEqual({ from: 176, to: 1319 });
    const W = 4;
    const H = 1400;
    const buf = Buffer.alloc(W * H * 4);
    const set = (x: number, y: number, rgba: number[]) => buf.set(rgba, (y * W + x) * 4);
    // Opaque frame outside the window's rows, a clear window inside them…
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) set(x, y, [0, 0, 0, y >= 176 && y < 1319 ? 0 : 255]);
    // …and five pixels to judge.
    set(0, 160, [200, 190, 150, 143]);
    set(1, 175, [10, 20, 30, 0]);
    set(2, 176, [1, 2, 3, 40]);
    set(3, 1318, [4, 5, 6, 0]);
    set(0, 1319, [7, 8, 9, 98]);
    const note = sealUbExtendedSeams(buf, W, H);
    const px = (x: number, y: number) => [...buf.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];
    expect(px(0, 160)).toEqual([200, 190, 150, 255]);
    expect(px(1, 175)).toEqual([10, 20, 30, 255]);
    expect(px(2, 176)).toEqual([1, 2, 3, 40]);
    expect(px(3, 1318)).toEqual([4, 5, 6, 0]);
    expect(px(0, 1319)).toEqual([7, 8, 9, 255]);
    expect(note).toMatch(/^3 seam px outside rows 176–1318 made opaque/);
    expect(() => sealUbExtendedSeams(Buffer.alloc(8), W, H)).toThrow();
  });

  it("the rows left as drawn are the art slot's rows (176.19–1317.96 px at HD), each one of them", () => {
    const slot = getFrameProfile("extendedartub").artSlot;
    expect(Math.floor((slot.topPct / 100) * 2100)).toBe(UB_EXTENDED_SEAM_ROWS.from);
    expect(UB_EXTENDED_SEAM_ROWS.to - 1).toBeGreaterThanOrEqual(Math.ceil(((slot.topPct + slot.heightPct) / 100) * 2100));
    expect(UB_EXTENDED_SEAM_ROWS.to - 1).toBeLessThanOrEqual(Math.ceil(((slot.topPct + slot.heightPct) / 100) * 2100) + 1);
  });
});

describe("the crown band", () => {
  it("is the extended crown's recipe over the Universes Beyond floating crowns, keyed as the slot", () => {
    const def = (CC_OVERLAY_BANDS as unknown as Record<string, { band: unknown; keys: string[]; layers: (key: string) => Layer[] }>).extendedartubcrown;
    expect(def.band).toBe(UB_EXTENDED_CROWN_BAND);
    expect([...def.keys]).toEqual([...EXTENDED_ART_UB_CROWN.keys]);
    expect(UB_EXTENDED_CROWN_BAND).toMatchObject({ cover: EXTENDED_CROWN_BAND.cover, crown: EXTENDED_CROWN_BAND.crown, outline: EXTENDED_CROWN_BAND.outline, rows: 260 });
    const floating = "img/frames/m15/ub/crowns/floating";
    // Never the pack's grey `c` crown: the spell frame maps c → a, the land
    // frame c → l, so nothing draws it (and the build makes none).
    expect(UB_EXTENDED_CROWN_BAND.keys).not.toContain("c");
    expect(() => ubExtendedCrownLayers("c")).toThrow();
    for (const key of ["w", "a", "l"]) {
      const layers = ubExtendedCrownLayers(key);
      const m15 = extendedCrownLayers("w");
      expect(layers.map((l) => l.src), key).toEqual([BORDERLESS_CROWN.eraseSrc, `${floating}/${key}.png`, BORDERLESS_CROWN.outlineSrc]);
      expect(layers.map((l) => (l as unknown as { at: unknown }).at)).toEqual(m15.map((l) => (l as unknown as { at: unknown }).at));
    }
    expect(ubExtendedCrownLayers("rw")[1]).toMatchObject({ src: `${floating}/r.png`, right: `${floating}/w.png`, ramp: [...BORDERLESS_CROWN.ramp] });
    expect(() => ubExtendedCrownLayers("v")).toThrow();
  });
});

describe("the triangle notch", () => {
  const def = (HOLO_STAMP_NOTCHES as unknown as Record<string, { shape: { src: string; size: { width: number; height: number }; bounds: unknown; nativeSize?: unknown }; keys: string[]; barOf: Record<string, string>; barSharedBy: Record<string, string[]>; barSample: { x: number; rows: number[] }; triangle: unknown; cutMarginPx: number }>).extendedartubholostamp;

  it("is the pack's own U piece, 1:1 at the slot's box, keyed as the slot, tinted from the new masters' pinline", () => {
    expect(def.shape.src).toBe("img/frames/m15/ub/regular/stamp/u.png");
    expect(def.shape.nativeSize).toBeUndefined();
    expect(UB_EXTENDED_NOTCH_BOX).toEqual({ x: 638, y: 1891, width: 224, height: 102 });
    expect(def.shape.size).toEqual({ width: 224, height: 102 });
    expect(def.shape.bounds).toEqual(EXTENDED_ART_UB_HOLO_STAMP.rect);
    expect([...def.keys]).toEqual([...EXTENDED_ART_UB_HOLO_STAMP.keys]);
    expect(def.triangle).toBe(UB_STAMP_HOLE);
    expect(def.cutMarginPx).toBe(2);
    expect(def.barSample).toMatchObject({ x: 750, rows: [1939, 1947] });
    expect(def.barOf.c).toBe("extendedartub/c");
    expect(def.barOf.l).toBe("extendedartubland/c");
    for (const pair of PAIRS) {
      expect(def.barOf[pair]).toBe(`extendedartub/${pair}`);
      expect(def.barSharedBy[pair]).toEqual([`extendedartub/${pair}-h`, `extendedartubland/${pair}`]);
    }
    // Both feet at row 1944, on the piece's solid rim.
    expect(NOTCH_FOOT.extendedartubholostamp).toEqual({ y: 53, runs: [[20, 42], [183, 204]] });
  });
});

describe("the edge contract", () => {
  it("is the extended frame's with the art at the side edges from 11.3 to 56.95 %H — the type bar's shade starts higher here", () => {
    for (const t of ["extendedartub", "extendedartubland"]) {
      expect(EDGE_CONTRACTS[t as keyof typeof EDGE_CONTRACTS], t).toEqual({
        top: { kind: "border" },
        right: { kind: "art", except: [[0, 11.3], [56.95, 100]] },
        bottom: { kind: "border" },
        left: { kind: "art", except: [[0, 11.3], [56.95, 100]] },
      });
    }
  });
});

describe("the provenance", () => {
  it("names the pinned commit, the pack's files and the tones for every new folder", () => {
    for (const folder of ["extendedartub", "extendedartubland", "extendedartubcrown", "extendedartubholostamp"]) {
      const entry = SOURCES[folder];
      expect(entry, folder).toBeDefined();
      expect(entry.commit, folder).toBe(CC_COMMIT);
    }
    expect(Object.keys(SOURCES.extendedartub.colors ?? {})).toHaveLength(27);
    expect(Object.keys(SOURCES.extendedartubland.colors ?? {})).toHaveLength(17);
    expect(Object.keys(SOURCES.extendedartubcrown.colors ?? {})).toHaveLength(18);
    // The spell frame's own plates: the pack's seven UB plates and its
    // silver 'Artifact' plate under `a` (the land frame draws m15ub's).
    const ptDir = "img/frames/m15/ub/pt";
    expect((SOURCES.extendedartub as { plates?: Record<string, string> }).plates).toEqual({
      ...Object.fromEntries(["w", "u", "b", "r", "g", "c", "m"].map((k) => [k, `${ptDir}/${k}.png`])),
      a: `${ptDir}/a.png`,
    });
    expect((SOURCES.extendedartubland as { plates?: unknown }).plates).toBeUndefined();
    expect(Object.keys(SOURCES.extendedartubholostamp.colors ?? {})).toHaveLength(18);
    expect(SOURCES.extendedartub.sourceTones).toBeDefined();
  });
});

// The published objects, read where they are on disk at the manifest's sha256.
describe("the published masters", () => {
  const MASTERS = [
    ...["w", "u", "b", "r", "g", "c", "m", ...PAIRS, ...PAIRS.map((p) => `${p}-h`)].map((k) => `extendedartub/${k}.png`),
    ...["w", "u", "b", "r", "g", "c", "m", ...PAIRS].map((k) => `extendedartubland/${k}.png`),
  ];

  it("every master, crown band and notch is in the manifest at its size", () => {
    for (const rel of MASTERS) expect(MANIFEST[rel], rel).toMatchObject({ width: 1500, height: 2100 });
    for (const key of EXTENDED_ART_UB_CROWN.keys) expect(MANIFEST[`extendedartubcrown/${key}.png`], key).toMatchObject({ width: 1500, height: 260 });
    for (const key of EXTENDED_ART_UB_HOLO_STAMP.keys) expect(MANIFEST[`extendedartubholostamp/${key}.png`], key).toMatchObject({ width: 224, height: 102 });
    // No `c` crown is published (nothing draws it).
    expect(MANIFEST["extendedartubcrown/c.png"]).toBeUndefined();
    // The spell frame's plates: m15ub's seven, byte for byte, and the silver
    // artifact plate under `a` — m15ubartifact's `c`, byte for byte.
    for (const key of ["w", "u", "b", "r", "g", "c", "m"]) {
      for (const ext of ["png", "webp"]) expect(MANIFEST[`extendedartub/pt/${key}.${ext}`]?.sha256, `${key}.${ext}`).toBe(MANIFEST[`m15ub/pt/${key}.${ext}`]?.sha256);
    }
    for (const ext of ["png", "webp"]) expect(MANIFEST[`extendedartub/pt/a.${ext}`]?.sha256, ext).toBe(MANIFEST[`m15ubartifact/pt/c.${ext}`]?.sha256);
    expect(MANIFEST["extendedartub/pt/a.png"]?.sha256).not.toBe(MANIFEST["m15ub/pt/c.png"]?.sha256);
    for (const rel of Object.keys(MANIFEST).filter((k) => /^extendedartub/.test(k) && k.endsWith(".png"))) {
      expect(MANIFEST[rel.replace(/\.png$/, ".webp")], rel).toBeDefined();
    }
  });

  it("opaque outside the art slot's rows (the seams sealed) but the corner cut; the window see-through", async () => {
    let checked = 0;
    for (const rel of MASTERS) {
      const bytes = published(rel);
      if (!bytes) continue;
      const { data } = await rgba(bytes);
      let open = 0;
      for (let y = 0; y < 2100; y += 1) {
        if (y >= UB_EXTENDED_SEAM_ROWS.from && y < UB_EXTENDED_SEAM_ROWS.to) continue;
        for (let x = 0; x < 1500; x += 1) {
          const cx = x < 66 ? 66 - x : x > 1433 ? x - 1433 : 0;
          const cy = y < 66 ? 66 - y : y > 2033 ? y - 2033 : 0;
          if (cx > 0 && cy > 0) continue;
          if (data[(y * 1500 + x) * 4 + 3] !== 255) open += 1;
        }
      }
      expect(open, rel).toBe(0);
      for (const [x, y] of [[750, 700], [10, 700], [1490, 700]]) expect(data[(y * 1500 + x) * 4 + 3], `${rel} (${x}, ${y})`).toBe(0);
      checked += 1;
    }
    if (checked === 0) console.warn("ub-extended-art: no published master on disk (FRAMES_BUILD_DIR) — pixel checks skipped");
  });

  it("the toned title bars read the prints' centre; an untoned one the pack's own", async () => {
    // The tone pass's method: the per-channel median of the bar's paper, the
    // brightest 5 % and the darker 40 % left out.
    const read = (data: Buffer) => {
      const px: number[][] = [];
      for (let y = 118; y < 198; y += 2) {
        for (let x = 140; x < 1360; x += 2) {
          const o = (y * 1500 + x) * 4;
          px.push([data[o], data[o + 1], data[o + 2], 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]]);
        }
      }
      px.sort((a, b) => a[3] - b[3]);
      const kept = px.slice(Math.floor(px.length * 0.4), Math.floor(px.length * 0.95));
      return [0, 1, 2].map((c) => kept.map((p) => p[c]).sort((a, b) => a - b)[Math.floor(kept.length / 2)]);
    };
    const cases: Array<[string, number[]]> = [
      ["extendedartub/g.png", UB_PRINT_TONES.g.title.to],
      ["extendedartub/m.png", UB_PRINT_TONES.m.title.to],
      ["extendedartub/u.png", [180, 210, 238]],
      ["extendedartubland/c.png", UB_PRINT_TONES.l.title.to],
      ["extendedartubland/g.png", UB_PRINT_TONES.g.title.to],
      ["extendedartub/w.png", [222, 217, 200]],
    ];
    for (const [rel, want] of cases) {
      const bytes = published(rel);
      if (!bytes) continue;
      const got = read((await rgba(bytes)).data);
      for (let c = 0; c < 3; c += 1) expect(Math.abs(got[c] - want[c]), `${rel} ${got} vs ${want}`).toBeLessThanOrEqual(2);
    }
  });

  it("every WebP's alpha is its PNG's", async () => {
    for (const rel of ["extendedartub/w.png", "extendedartub/rw-h.png", "extendedartubland/bg.png", "extendedartubcrown/wu.png", "extendedartubholostamp/m.png"]) {
      const png = published(rel);
      const webp = published(rel.replace(/\.png$/, ".webp"));
      if (!png || !webp) continue;
      const a = (await rgba(png)).data;
      const b = (await rgba(webp)).data;
      let differ = 0;
      for (let p = 3; p < a.length; p += 4) if (a[p] !== b[p]) differ += 1;
      expect(differ, rel).toBe(0);
    }
  });

  it("the notch's foot meets each master's pinline at both feet, and the triangle is cut clear", async () => {
    for (const key of ["w", "u", "m", "c"]) {
      const notch = published(`extendedartubholostamp/${key}.png`);
      const master = published(`extendedartub/${key}.png`);
      if (!notch || !master) continue;
      const n = (await rgba(notch)).data;
      const m = (await rgba(master)).data;
      const foot = NOTCH_FOOT.extendedartubholostamp;
      for (const [x0, x1] of foot.runs) {
        for (let x = x0; x <= x1; x += 1) {
          const no = (foot.y * 224 + x) * 4;
          const mo = ((1891 + foot.y) * 1500 + 638 + x) * 4;
          for (let c = 0; c < 3; c += 1) expect(Math.abs(n[no + c] - m[mo + c]), `${key} foot x ${x}`).toBeLessThanOrEqual(2);
        }
      }
      // The hole's centre is clear.
      expect(n[((1950 - 1891) * 224 + (750 - 638)) * 4 + 3], key).toBe(0);
    }
  });
});
