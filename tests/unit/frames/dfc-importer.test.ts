import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import provenanceJson from "@/lib/cards/frame-sources.json";
import {
  CC_RIDERS,
  CC_TEMPLATES,
  COLORS,
  DFC_BACK_TONES,
  DFC_BACK_TONE_LUMA_RAMP,
  DFC_ICON_FILES,
  DFC_ICON_SIZE,
  applyTone,
  builtColors,
  dfcBackTones,
  sourceFilesFor,
  toneMasked,
  tonesFor,
} from "@/scripts/lib/cc-frames.mjs";
import { DFC_ICON_GLYPH_KEYS } from "@/lib/cards/dfc-icons";
import { DFC_ICON_RIDER, getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 5.1a — the transform bodies' importer half (scripts/lib/cc-frames.mjs):
// the five recipes over Card Conjurer's 'Transform' packs (the `a` master
// built beside `c`'s stand-in, the land pair one master under every key, the
// dark back plates once), the backs' tone pass through the pack's masks —
// per key, the bars' and the box's gains fitted on the prints, a luma ramp
// that keeps the well's white ring and the ▼ — and the rider set (the 12
// glyphs at 220 px, lowercase keys = the profile's slot keys). Then the
// MASTERS the bake draws, where a copy at the manifest's sha256 is on disk
// (FRAMES_BUILD_DIR, else <repo>/.frames-build; CI fetches them — a missing
// one FAILS there): the toned bars and box within ±8 luma of the prints'
// medians, the plates the pack's own, the riders a clear-cornered disc.
// ---------------------------------------------------------------------------

const manifest = manifestJson as { files: Record<string, { sha256: string; width: number; height: number }> };
const provenance = provenanceJson as Record<string, { colors: Record<string, string[]>; plates?: Record<string, string>; tones?: unknown; kind?: string; sourceFiles: string[]; notes: string[] }>;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const STRICT = Boolean(process.env.CI && process.env.FRAMES_BUILD_DIR);

const FRONTS = ["m15dfcfront", "m15dfclandfront"] as const;
const BACKS = ["m15dfcback", "m15dfcbackleft", "m15dfclandback"] as const;
const ALL = [...FRONTS, ...BACKS] as const;

type Layer = { src: string; mask?: string | string[] };
type Def = { colors: Record<string, Layer[]>; tones?: unknown; plates?: Record<string, string> };
const def = (t: (typeof ALL)[number]) => CC_TEMPLATES[t] as unknown as Def;

function onDisk(rel: string): string | null {
  const entry = manifest.files[rel];
  if (!entry) throw new Error(`the manifest has no ${rel}`);
  const file = path.join(BUILD, rel);
  if (!fs.existsSync(file)) return null;
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex") === entry.sha256 ? file : null;
}

async function rgba(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
type Img = Awaited<ReturnType<typeof rgba>>;
const luma = (img: Img, x: number, y: number) => {
  const o = (y * img.w + x) * 4;
  return 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2];
};
/** The median luma of a box, every other pixel. */
function median(img: Img, x0: number, x1: number, y0: number, y1: number): number {
  const v: number[] = [];
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) v.push(luma(img, x, y));
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}

/** The prints' medians the tones were fitted to (scripts/lib/cc-frames.mjs
 *  DFC_BACK_TONES's comment): the bars' flat face and the box. */
const PRINTS: Record<string, { bars: number; box: number }> = {
  w: { bars: 156, box: 203 },
  u: { bars: 96, box: 191 },
  b: { bars: 79, box: 160 },
  r: { bars: 97, box: 182 },
  g: { bars: 67, box: 176 },
  m: { bars: 137, box: 187 },
  a: { bars: 126, box: 181 },
  c: { bars: 126, box: 181 },
  l: { bars: 155, box: 209 },
};

describe("the transform bodies' recipes (TODO 5.1a)", () => {
  it("five templates over CC's 'Transform' packs: w u b r g m + a, c the artifact stand-in; the land pair one master under every key", () => {
    for (const t of ["m15dfcfront", "m15dfcback", "m15dfcbackleft"] as const) {
      const d = def(t);
      expect(builtColors(d as never)).toEqual(["a", ...COLORS]);
      // `c` and `a` are the same file: the pack's 'Artifact Frame'.
      expect(d.colors.c).toEqual(d.colors.a);
      expect(d.colors.c[0].src).toMatch(/A\.png$/);
      for (const k of ["w", "u", "b", "r", "g", "m"]) expect(d.colors[k][0].src, `${t}/${k}`).toMatch(new RegExp(`${k.toUpperCase()}\\.png$`));
      expect(d.colors.w).toHaveLength(1);
    }
    expect(def("m15dfcfront").colors.w[0].src).toBe("img/frames/m15/transform/regular/frontW.png");
    expect(def("m15dfcback").colors.w[0].src).toBe("img/frames/m15/transform/regular/new/backW.png");
    expect(def("m15dfcbackleft").colors.w[0].src).toBe("img/frames/m15/transform/regular/backW.png");
    for (const t of ["m15dfclandfront", "m15dfclandback"] as const) {
      const d = def(t);
      expect(builtColors(d as never)).toEqual([...COLORS]);
      const srcs = new Set(COLORS.map((k) => d.colors[k][0].src));
      expect(srcs.size).toBe(1);
    }
    expect(def("m15dfclandfront").colors.c[0].src).toBe("img/frames/m15/transform/regular/frontL.png");
    expect(def("m15dfclandback").colors.c[0].src).toBe("img/frames/m15/transform/regular/new/backL.png");
    // Every master is CC's whole image, no mask (the pieces are the master's).
    for (const t of ALL) for (const layers of Object.values(def(t).colors)) for (const l of layers) expect(l.mask, t).toBeUndefined();
  });

  it("the dark back plates once (m15dfcback/pt, the pack's pt<K>.png, c → the artifact plate); the fronts and the 2016–22 back draw others' plates", () => {
    const plates = def("m15dfcback").plates!;
    expect(Object.keys(plates).sort()).toEqual([...COLORS].sort());
    for (const k of ["w", "u", "b", "r", "g", "m"]) expect(plates[k]).toBe(`img/frames/m15/transform/regular/pt${k.toUpperCase()}.png`);
    expect(plates.c).toBe("img/frames/m15/transform/regular/ptA.png");
    for (const t of ["m15dfcfront", "m15dfcbackleft", "m15dfclandfront", "m15dfclandback"] as const) expect(def(t).plates, t).toBeUndefined();
    expect(getFrameProfile("m15dfcbackleft").pt?.plateAssetPathTemplate).toBe("/frames/m15dfcback/pt/{color}.png");
    expect(getFrameProfile("m15dfcfront").pt?.plateAssetPathTemplate).toBe("/frames/m15/pt/{color}.png");
  });

  it("tones the backs onto the prints, per key, through the pack's Title / Type / Rules masks — the fronts untouched", () => {
    for (const t of FRONTS) expect(tonesFor(def(t) as never, "w")).toEqual([]);
    for (const t of ["m15dfcback", "m15dfcbackleft"] as const) {
      for (const k of ["a", ...COLORS]) {
        const tones = tonesFor(def(t) as never, k) as { mask: string; gain: number; lumaRamp: number[]; region: string }[];
        expect(tones.map((x) => x.region)).toEqual(["title bar", "type bar", "text box"]);
        const { bars, box } = DFC_BACK_TONES[k as keyof typeof DFC_BACK_TONES];
        expect(tones.map((x) => x.gain)).toEqual([bars, bars, box]);
        for (const x of tones) expect(x.lumaRamp).toEqual([...DFC_BACK_TONE_LUMA_RAMP]);
        expect(tones[1].mask).toBe("img/frames/m15/regular/m15MaskType.png");
        expect(tones[2].mask).toBe("img/frames/m15/regular/m15MaskRules.png");
      }
      // The pack's own Title mask: the 2016–22 pack's covers its left well,
      // the ▼ back's its right one.
      expect((tonesFor(def(t) as never, "g") as { mask: string }[])[0].mask).toBe(
        t === "m15dfcback" ? "img/frames/m15/transform/regular/new/maskTitle.png" : "img/frames/m15/transform/regular/maskTitle.png",
      );
      // The tone masks are source files (fetched, recorded).
      expect(sourceFilesFor(def(t) as never)).toContain("img/frames/m15/regular/m15MaskRules.png");
    }
    // The land back: the land key's gains whatever the colour key.
    for (const k of COLORS) expect((tonesFor(def("m15dfclandback") as never, k) as { gain: number }[]).map((x) => x.gain)).toEqual([DFC_BACK_TONES.l.bars, DFC_BACK_TONES.l.bars, DFC_BACK_TONES.l.box]);
    // The fit: the gains land each key's CC median on the prints' (the
    // comment's numbers): CC bars W 168 U 118 B 91 R 78 G 81 M 130 A 143 L 127,
    // boxes W 196 U 201 B 170 R 172 G 186 M 205 A 180 L 158.
    const cc = { w: [168, 196], u: [118, 201], b: [91, 170], r: [78, 172], g: [81, 186], m: [130, 205], a: [143, 180], l: [127, 158] } as const;
    for (const [k, [bars, box]] of Object.entries(cc)) {
      const t = DFC_BACK_TONES[k as keyof typeof DFC_BACK_TONES];
      expect(Math.abs(bars * t.bars - PRINTS[k].bars), `${k} bars`).toBeLessThanOrEqual(2);
      expect(Math.abs(box * t.box - PRINTS[k].box), `${k} box`).toBeLessThanOrEqual(2);
    }
    expect(DFC_BACK_TONES.c).toEqual(DFC_BACK_TONES.a);
    expect(() => dfcBackTones("x", "zz")).toThrow(/no tone/);
  });

  it("toneMasked: multiplies through the mask's coverage, fades to ×1 across the luma ramp (the white ring stays), keeps alpha, refuses a bad tone", () => {
    const w = 4;
    const h = 1;
    // Pixels: a dark bar (80), a bright highlight (230), the white ring (255), a clear pixel.
    const buf = Buffer.from([80, 80, 80, 255, 230, 230, 230, 255, 255, 255, 255, 255, 80, 80, 80, 0]);
    const mask = Buffer.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const out = toneMasked(buf, w, h, mask, { gain: 0.5, lumaRamp: [215, 245] });
    expect([out[0], out[1], out[2], out[3]]).toEqual([40, 40, 40, 255]);
    // 230 sits half-way up the ramp (smoothstep 0.5): the gain is halved.
    expect(out[4]).toBeGreaterThan(115);
    expect(out[4]).toBeLessThan(230);
    expect([out[8], out[9], out[10]]).toEqual([255, 255, 255]);
    // A clear pixel is left alone; an uncovered pixel too.
    expect(Array.from(out.subarray(12, 16))).toEqual([80, 80, 80, 0]);
    const half = Buffer.from([0, 0, 0, 255, 0, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 255]);
    const partial = toneMasked(buf, w, h, half, { gain: 0.5, lumaRamp: [215, 245] });
    expect(partial[0]).toBe(40);
    expect(partial[8]).toBe(255);
    // Half covered AND half-way up the ramp: a quarter of the darkening
    // (230 × (1 − 0.5 × 0.5 × 0.5) = 201).
    expect(Array.from(partial.subarray(4, 8))).toEqual([201, 201, 201, 255]);
    // applyTone dispatches a masked tone through the masks map.
    const viaApply = applyTone(buf, w, h, { mask: "m", gain: 0.5, lumaRamp: [215, 245] }, { m: mask });
    expect(Array.from(viaApply)).toEqual(Array.from(out));
    expect(() => toneMasked(buf, w, h, mask, { gain: -1 })).toThrow(/bad tone/);
    expect(() => toneMasked(buf, w, h, Buffer.alloc(4), { gain: 0.5 })).toThrow(/not 4x1/);
    expect(() => applyTone(buf, w, h, { mask: "missing", gain: 0.5 }, {})).toThrow();
  });

  it("the rider set: the 12 glyphs a printing wears, lowercase, at 220 px — the profile's slot keys and the glyph map's", () => {
    expect(Object.keys(CC_RIDERS)).toEqual(["dfcicon"]);
    expect(CC_RIDERS.dfcicon.size).toBe(DFC_ICON_SIZE);
    expect(DFC_ICON_SIZE).toBe(220);
    expect(Object.keys(DFC_ICON_FILES)).toEqual([...DFC_ICON_GLYPH_KEYS]);
    expect([...DFC_ICON_RIDER.keys]).toEqual([...DFC_ICON_GLYPH_KEYS]);
    for (const [key, src] of Object.entries(DFC_ICON_FILES)) {
      expect(key).toBe(key.toLowerCase());
      expect(src).toMatch(/^img\/frames\/m15\/transform\/icons\/[A-Za-z]+\.(png|svg)$/);
    }
    // CC's Lesson and Hammer have no DFC printing.
    expect(Object.values(DFC_ICON_FILES).some((f) => /lesson|hammer/i.test(f))).toBe(false);
  });

  it("provenance records the five templates, the rider set, the per-key tones and the masks", () => {
    for (const t of ALL) {
      expect(provenance[t], t).toBeDefined();
      expect(Object.keys(provenance[t].colors).sort(), t).toEqual([...builtColors(def(t) as never)].sort());
      expect(provenance[t].sourceFiles, t).toEqual(sourceFilesFor(def(t) as never));
    }
    for (const t of BACKS) {
      const tones = provenance[t].tones as Record<string, { gain: number }[]>;
      expect(Object.keys(tones).sort(), t).toEqual([...builtColors(def(t) as never)].sort());
      expect(tones.w.map((x) => x.gain)).toEqual((tonesFor(def(t) as never, "w") as { gain: number }[]).map((x) => x.gain));
    }
    expect(provenance.m15dfcback.plates).toEqual(def("m15dfcback").plates);
    expect(provenance.dfcicon.kind).toBe("rider");
    expect(Object.keys(provenance.dfcicon.colors)).toEqual([...DFC_ICON_GLYPH_KEYS]);
    expect(provenance.dfcicon.sourceFiles).toEqual([...Object.values(DFC_ICON_FILES)].sort());
  });

  it("the manifest lists every master, the dark plates and the riders, PNG and WebP, at their sizes", () => {
    for (const t of ALL) {
      for (const key of builtColors(def(t) as never)) {
        for (const ext of ["png", "webp"]) {
          const entry = manifest.files[`${t}/${key}.${ext}`];
          expect(entry, `${t}/${key}.${ext}`).toBeDefined();
          expect([entry.width, entry.height]).toEqual([1500, 2100]);
        }
      }
    }
    for (const key of COLORS) {
      for (const ext of ["png", "webp"]) {
        const entry = manifest.files[`m15dfcback/pt/${key}.${ext}`];
        expect(entry, `m15dfcback/pt/${key}.${ext}`).toBeDefined();
        expect([entry.width, entry.height]).toEqual([285, 156]);
      }
    }
    for (const t of ["m15dfcfront", "m15dfcbackleft", "m15dfclandfront", "m15dfclandback"]) {
      expect(Object.keys(manifest.files).some((k) => k.startsWith(`${t}/pt/`)), t).toBe(false);
    }
    for (const key of DFC_ICON_GLYPH_KEYS) {
      for (const ext of ["png", "webp"]) {
        const entry = manifest.files[`dfcicon/${key}.${ext}`];
        expect(entry, `dfcicon/${key}.${ext}`).toBeDefined();
        expect([entry.width, entry.height]).toEqual([220, 220]);
      }
    }
    // The `a` and `c` masters are one file; the land pair's seven are one.
    for (const t of ["m15dfcfront", "m15dfcback", "m15dfcbackleft"]) expect(manifest.files[`${t}/a.png`].sha256).toBe(manifest.files[`${t}/c.png`].sha256);
    for (const t of ["m15dfclandfront", "m15dfclandback"]) expect(new Set(COLORS.map((k) => manifest.files[`${t}/${k}.png`].sha256)).size).toBe(1);
  });
});

describe("the transform masters the bake draws (bucket copies on disk)", () => {
  const present = ALL.every((t) => builtColors(def(t) as never).every((k) => onDisk(`${t}/${k}.png`)));
  if (!present && !STRICT) {
    it.skip("the masters are not on disk (frames bucket; set FRAMES_BUILD_DIR)", () => {});
    return;
  }

  it.each(["m15dfcback", "m15dfcbackleft"] as const)("%s: every key's bars and box sit within ±8 luma of the prints' medians, the body untouched", async (t) => {
    for (const k of ["a", ...COLORS]) {
      const file = onDisk(`${t}/${k}.png`);
      expect(file, `${t}/${k}`).not.toBeNull();
      const img = await rgba(file!);
      const bars = (median(img, 1000, 1150, 118, 205) + median(img, 1000, 1150, 1200, 1290)) / 2;
      const box = median(img, 300, 1100, 1340, 1920);
      expect(Math.abs(bars - PRINTS[k].bars), `${t}/${k} bars ${bars}`).toBeLessThanOrEqual(8);
      expect(Math.abs(box - PRINTS[k].box), `${t}/${k} box ${box}`).toBeLessThanOrEqual(8);
      // The well's white ring (the ▼ back's at the right, the other's at the
      // left) is left white, and the frame body keeps CC's tone (G 116).
      const ring = t === "m15dfcback" ? luma(img, 1297, 167) : luma(img, 85, 167);
      expect(ring, `${t}/${k} ring`).toBeGreaterThan(245);
      if (k === "g") expect(Math.abs(median(img, 62, 76, 600, 1100) - 116)).toBeLessThanOrEqual(2);
    }
  }, 120_000);

  it("the land back: FIN #31's light tan bars and cream box; the fronts' bars are CC's (light, untouched)", async () => {
    const land = await rgba(onDisk("m15dfclandback/c.png")!);
    const bars = (median(land, 1000, 1150, 118, 205) + median(land, 1000, 1150, 1200, 1290)) / 2;
    expect(Math.abs(bars - PRINTS.l.bars)).toBeLessThanOrEqual(8);
    expect(Math.abs(median(land, 300, 1100, 1340, 1920) - PRINTS.l.box)).toBeLessThanOrEqual(8);
    const front = await rgba(onDisk("m15dfcfront/g.png")!);
    expect(Math.abs(median(front, 1000, 1150, 118, 205) - 199)).toBeLessThanOrEqual(3);
    expect(Math.abs(median(front, 300, 1100, 1340, 1920) - 226)).toBeLessThanOrEqual(3);
  }, 60_000);

  it("the dark plates are the pack's own (285 × 156, interior W 160 U 95 B 85 R 75 G 69 M 122, c the artifact's 112); the riders a clear-cornered disc with a white glyph", async () => {
    const interior: Record<string, number> = { w: 160, u: 95, b: 85, r: 75, g: 69, m: 122, c: 112 };
    for (const k of COLORS) {
      const file = onDisk(`m15dfcback/pt/${k}.png`);
      expect(file, k).not.toBeNull();
      const img = await rgba(file!);
      expect([img.w, img.h]).toEqual([285, 156]);
      expect(Math.abs(median(img, 40, 240, 40, 110) - interior[k]), k).toBeLessThanOrEqual(3);
    }
    for (const key of DFC_ICON_GLYPH_KEYS) {
      const file = onDisk(`dfcicon/${key}.png`);
      expect(file, key).not.toBeNull();
      const img = await rgba(file!);
      expect([img.w, img.h]).toEqual([220, 220]);
      expect(img.data[3], `${key} corner`).toBe(0);
      expect(luma(img, 110, 6), `${key} disc`).toBeLessThan(20);
      expect(img.data[(6 * 220 + 110) * 4 + 3]).toBe(255);
      // Some white in the glyph.
      let white = 0;
      for (let y = 40; y < 180; y += 2) for (let x = 40; x < 180; x += 2) if (luma(img, x, y) > 240) white += 1;
      expect(white, key).toBeGreaterThan(50);
    }
  }, 60_000);
});
