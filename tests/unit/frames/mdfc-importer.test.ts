import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import provenanceJson from "@/lib/cards/frame-sources.json";
import {
  CC_TEMPLATES,
  COLORS,
  DFC_BACK_TONE_LUMA_RAMP,
  MDFC_BACK_TONES,
  MDFC_LAND_BACK_TONES,
  builtColors,
  mdfcBackTones,
  sourceFilesFor,
  tonesFor,
} from "@/scripts/lib/cc-frames.mjs";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 5.1b — the modal bodies' importer half (scripts/lib/cc-frames.mjs):
// the four recipes over Card Conjurer's 'Modal Regular' pack (the spell
// pair copied 1:1 with `a` beside `c`'s stand-in; the land pair a PipGlyph
// recipe — the colour's modal master with its body, and on the front its
// box, REPLACED through the pack's own masks by the 2015 land tint, `c` the
// pack's grey land modal, `m` the gold tint), the backs' tone pass through
// the pack's masks — the spell backs on STX / MSH's prints, the land backs
// on ZNR / MH3's, each its own table — and the provenance. Then the MASTERS
// the bake draws, where a copy at the manifest's sha256 is on disk
// (FRAMES_BUILD_DIR, else <repo>/.frames-build; CI fetches them — a missing
// one FAILS there): the toned bars and box within ±8 luma of the prints'
// medians, the land faces' body the stone tint, the fronts untoned.
// ---------------------------------------------------------------------------

const manifest = manifestJson as { files: Record<string, { sha256: string; width: number; height: number }> };
const provenance = provenanceJson as unknown as Record<string, { colors: Record<string, string[]>; plates?: Record<string, string>; tones?: Record<string, unknown[]>; sourceFiles: string[]; notes: string[]; transforms?: string }>;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const STRICT = Boolean(process.env.CI && process.env.FRAMES_BUILD_DIR);

const FRONTS = ["m15mdfcfront", "m15mdfclandfront"] as const;
const BACKS = ["m15mdfcback", "m15mdfclandback"] as const;
const ALL = [...FRONTS, ...BACKS] as const;
const MODAL = "img/frames/modal/regular";

type Layer = { src: string; mask?: string | string[]; replace?: boolean };
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
function median(img: Img, x0: number, x1: number, y0: number, y1: number): number {
  const v: number[] = [];
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) v.push(luma(img, x, y));
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}

/** The prints' medians the tones were fitted to (scripts/lib/cc-frames.mjs
 *  MDFC_BACK_TONES / MDFC_LAND_BACK_TONES's comment): the bars' flat face
 *  and the box. */
const SPELL_PRINTS: Record<string, { bars: number; box: number }> = {
  w: { bars: 178.5, box: 217 },
  u: { bars: 106.5, box: 204 },
  b: { bars: 88, box: 177 },
  r: { bars: 107, box: 200 },
  g: { bars: 77.5, box: 193 },
  m: { bars: 133, box: 183 },
};
const LAND_PRINTS: Record<string, { bars: number; box: number }> = {
  w: { bars: 179, box: 218 },
  u: { bars: 91, box: 201 },
  b: { bars: 99, box: 189 },
  r: { bars: 99.5, box: 198 },
  g: { bars: 68.5, box: 188 },
};
/** CC's untoned backs (the same regions), to show the tone moved them. */
const CC_BACK_BARS: Record<string, number> = { w: 188.5, u: 123, b: 91, r: 90.5, g: 87.5, m: 147 };

describe("the modal bodies' recipes (TODO 5.1b)", () => {
  it("the spell pair over CC's 'Modal Regular' pack: w u b r g m + a, c the artifact stand-in, each master the whole image", () => {
    for (const t of ["m15mdfcfront", "m15mdfcback"] as const) {
      const d = def(t);
      // Since 5.1d the split pair masters too, and the hybrid dress on the front.
      const pairs = ["wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"];
      expect(builtColors(d as never)).toEqual(["a", ...COLORS, ...pairs, ...(t === "m15mdfcfront" ? pairs.map((p) => `${p}-h`) : [])]);
      expect(d.colors.c).toEqual(d.colors.a);
      expect(d.colors.c[0].src).toMatch(/\/a(b)?\.png$/);
      for (const k of ["w", "u", "b", "r", "g", "m"]) expect(d.colors[k][0].src, `${t}/${k}`).toMatch(new RegExp(`${MODAL}/${k}${t.endsWith("back") ? "b" : ""}\\.png$`));
      for (const [k, layers] of Object.entries(d.colors)) {
        if (k.length > 1) continue; // a pair master (5.1d) is its own recipe
        expect(layers).toHaveLength(1);
        expect(layers[0].mask).toBeUndefined();
      }
    }
    expect(def("m15mdfcfront").colors.w[0].src).toBe(`${MODAL}/w.png`);
    expect(def("m15mdfcback").colors.w[0].src).toBe(`${MODAL}/wb.png`);
    // No plates of their own: the front draws M15's, the back the transform
    // pack's dark set (m15dfcback/pt — MSH #18's gold plate reads 117
    // against ptM's 123).
    for (const t of ALL) expect(def(t).plates, t).toBeUndefined();
    expect(getFrameProfile("m15mdfcfront").pt?.plateAssetPathTemplate).toBe("/frames/m15/pt/{color}.png");
    expect(getFrameProfile("m15mdfcback").pt?.plateAssetPathTemplate).toBe("/frames/m15dfcback/pt/{color}.png");
  });

  it("the land pair is a PipGlyph recipe: the colour's modal master, its body (and the front's box) replaced through the pack's own masks by the 2015 land tint; c the grey land modal, m the gold tint", () => {
    for (const t of FRONTS.filter((x) => x === "m15mdfclandfront").concat(["m15mdfclandback"] as never)) {
      const d = def(t as (typeof ALL)[number]);
      expect(builtColors(d as never)).toEqual([...COLORS]);
      for (const k of ["w", "u", "b", "r", "g", "m"]) {
        const layers = d.colors[k];
        expect(layers[0], `${t}/${k} base`).toEqual({ src: `${MODAL}/${k}${t.endsWith("back") ? "b" : ""}.png` });
        expect(layers[1], `${t}/${k} body`).toEqual({ src: `img/frames/m15/new/l${k}.png`, mask: `${MODAL}/frame.svg`, replace: true });
        if (t === "m15mdfclandfront") {
          expect(layers[2], `${t}/${k} box`).toEqual({ src: `img/frames/m15/new/l${k}.png`, mask: `${MODAL}/textbox.svg`, replace: true });
          expect(layers).toHaveLength(3);
        } else {
          expect(layers).toHaveLength(2);
        }
      }
      expect(d.colors.c).toEqual([{ src: `${MODAL}/l${t.endsWith("back") ? "b" : ""}.png` }]);
    }
    // The land tints are the m15land masters' own files.
    const land = CC_TEMPLATES.m15land as unknown as Def;
    for (const k of ["w", "u", "b", "r", "g", "m"]) expect(land.colors[k][0].src, k).toBe(`img/frames/m15/new/l${k}.png`);
  });

  it("tones the backs onto the prints through the pack's Title / Type / Rules masks — each template on its own references, the fronts untoned, the artifact and grey-land stand-ins left as CC paints them", () => {
    for (const t of FRONTS) for (const k of ["a", ...COLORS]) expect(tonesFor(def(t) as never, k), `${t}/${k}`).toEqual([]);
    for (const k of ["w", "u", "b", "r", "g", "m"]) {
      const spell = tonesFor(def("m15mdfcback") as never, k) as { mask: string; gain: number; lumaRamp: number[]; region: string }[];
      // Since 5.1d the strip too (the whole tab through the pack's Flipside
      // mask), on every key but w, whose strip sits within the prints'.
      const strip = k === "w" ? [] : ["flipside strip"];
      expect(spell.map((x) => x.region)).toEqual(["title bar + housing", "type bar", "text box", ...strip]);
      expect(spell.map((x) => x.mask)).toEqual([`${MODAL}/title.svg`, "img/frames/m15/regular/m15MaskType.png", `${MODAL}/textbox.svg`, ...(strip.length ? [`${MODAL}/reminder.svg`] : [])]);
      const { bars, box, strip: stripGain } = MDFC_BACK_TONES[k as keyof typeof MDFC_BACK_TONES] as { bars: number; box: number; strip?: number };
      expect(spell.map((x) => x.gain)).toEqual([bars, bars, box, ...(stripGain !== undefined ? [stripGain] : [])]);
      expect(stripGain === undefined).toBe(k === "w");
      for (const x of spell) expect(x.lumaRamp).toEqual([...DFC_BACK_TONE_LUMA_RAMP]);
      // The fit: CC's bars × the gain lands on the print's median (±1).
      expect(Math.abs(CC_BACK_BARS[k] * bars - SPELL_PRINTS[k].bars), `${k} bars`).toBeLessThanOrEqual(1.5);
      const land = tonesFor(def("m15mdfclandback") as never, k) as { gain: number }[];
      const lt = MDFC_LAND_BACK_TONES[k as keyof typeof MDFC_LAND_BACK_TONES] as { bars: number; box: number; strip?: number };
      expect(land.map((x) => x.gain)).toEqual([lt.bars, lt.bars, lt.box, ...(lt.strip !== undefined ? [lt.strip] : [])]);
      expect(lt.strip === undefined).toBe(k === "w");
      if (k !== "m") expect(Math.abs(CC_BACK_BARS[k] * lt.bars - LAND_PRINTS[k].bars), `${k} land bars`).toBeLessThanOrEqual(1.5);
    }
    // The land backs print the bars 10–30 luma apart from the spell backs on
    // u, b and g: the two tables are not one.
    expect(MDFC_LAND_BACK_TONES.u.bars).toBeLessThan(MDFC_BACK_TONES.u.bars - 0.1);
    expect(MDFC_LAND_BACK_TONES.g.bars).toBeLessThan(MDFC_BACK_TONES.g.bars - 0.09);
    expect(MDFC_LAND_BACK_TONES.b.bars).toBeGreaterThan(MDFC_BACK_TONES.b.bars + 0.1);
    expect(MDFC_LAND_BACK_TONES.m).toBe(MDFC_BACK_TONES.m);
    // No print for the artifact back (every KHM artifact back is a coloured
    // artifact) or the grey land modal: no tone.
    expect(MDFC_BACK_TONES.a).toEqual({ bars: 1, box: 1 });
    expect(tonesFor(def("m15mdfcback") as never, "a")).toEqual([]);
    expect(tonesFor(def("m15mdfcback") as never, "c")).toEqual([]);
    expect(tonesFor(def("m15mdfclandback") as never, "c")).toEqual([]);
    expect(mdfcBackTones("zz")).toEqual([]);
  });

  it("names every Card Conjurer file a template needs, the tone masks included", () => {
    expect(sourceFilesFor(def("m15mdfcback") as never)).toEqual(
      expect.arrayContaining([`${MODAL}/wb.png`, `${MODAL}/ab.png`, `${MODAL}/title.svg`, `${MODAL}/textbox.svg`, "img/frames/m15/regular/m15MaskType.png"]),
    );
    expect(sourceFilesFor(def("m15mdfclandfront") as never)).toEqual(
      expect.arrayContaining([`${MODAL}/w.png`, `${MODAL}/l.png`, "img/frames/m15/new/lw.png", `${MODAL}/frame.svg`, `${MODAL}/textbox.svg`]),
    );
    // Since 5.1d the front's hybrid dress reads the grey Land frame's bars
    // through the Title mask, so the mask is a source file of the front too.
    expect(sourceFilesFor(def("m15mdfcfront") as never)).toContain(`${MODAL}/title.svg`);
    expect(sourceFilesFor(def("m15mdfcfront") as never)).toContain(`${MODAL}/l.png`);
  });

  it("the provenance records each template's pack, recipe, tones and notes", () => {
    for (const t of ALL) {
      const p = provenance[t];
      expect(p, t).toBeDefined();
      expect(p.notes.join("\n")).toMatch(t.includes("land") ? /modal (front|back) with its frame body/ : /Modal Regular/);
      expect(p.sourceFiles).toEqual(sourceFilesFor(def(t) as never));
    }
    expect(provenance.m15mdfcback.tones?.u).toEqual(tonesFor(def("m15mdfcback") as never, "u"));
    expect(provenance.m15mdfclandback.tones?.g).toEqual(tonesFor(def("m15mdfclandback") as never, "g"));
    expect(provenance.m15mdfclandfront.colors.w).toEqual([`${MODAL}/w.png`, `img/frames/m15/new/lw.png replacing through ${MODAL}/frame.svg`, `img/frames/m15/new/lw.png replacing through ${MODAL}/textbox.svg`]);
    expect(provenance.m15mdfclandback.transforms).toMatch(/MDFC_LAND_BACK_TONES/);
    expect(provenance.m15mdfcback.transforms).toMatch(/MDFC_BACK_TONES/);
    expect(provenance.m15mdfcfront.notes.join("\n")).toMatch(/strip is painted in the MASTER's colour/);
  });

  it("publishes every master as PNG + WebP at 1500 × 2100 — 30 keys (a beside c) and 5.1d's 30 pair masters, 116 distinct blobs", () => {
    const keys = Object.keys(manifest.files).filter((k) => k.startsWith("m15mdfc") && !k.startsWith("m15mdfccrown"));
    expect(keys).toHaveLength(120);
    expect(new Set(keys.map((k) => manifest.files[k].sha256)).size).toBe(116);
    for (const k of keys) expect([manifest.files[k].width, manifest.files[k].height], k).toEqual([1500, 2100]);
    for (const t of ALL) for (const k of builtColors(def(t) as never)) expect(manifest.files[`${t}/${k}.png`], `${t}/${k}`).toBeDefined();
    // `c` and `a` are the same bytes on the spell pair; the land pair's c is
    // its own (the grey land modal).
    for (const t of ["m15mdfcfront", "m15mdfcback"]) expect(manifest.files[`${t}/c.png`].sha256).toBe(manifest.files[`${t}/a.png`].sha256);
    for (const t of BACKS.filter((x) => x === "m15mdfclandback")) expect(manifest.files[`${t}/c.png`].sha256).not.toBe(manifest.files[`${t}/w.png`].sha256);
  });
});

describe("the built modal masters (the frames bucket)", () => {
  const spellBacks = ["w", "u", "b", "r", "g", "m"].map((k) => [k, onDisk(`m15mdfcback/${k}.png`)] as const);
  const landBacks = ["w", "u", "b", "r", "g"].map((k) => [k, onDisk(`m15mdfclandback/${k}.png`)] as const);
  const missing = [...spellBacks, ...landBacks].filter(([, f]) => !f).length;
  if (missing && STRICT) throw new Error(`${missing} modal masters missing from ${BUILD} (CI fetches them: frames-fetch.mjs)`);
  const run = missing ? it.skip : it;

  run("the spell backs' bars and box sit on the STX / MSH prints' medians (±8 luma); the land backs' on ZNR / MH3's", async () => {
    for (const [k, file] of spellBacks) {
      const img = await rgba(file!);
      const bars = (median(img, 1000, 1150, 118, 205) + median(img, 1000, 1150, 1200, 1290)) / 2;
      expect(Math.abs(bars - SPELL_PRINTS[k].bars), `m15mdfcback/${k} bars ${bars}`).toBeLessThanOrEqual(8);
      expect(Math.abs(median(img, 300, 1100, 1340, 1920) - SPELL_PRINTS[k].box), `m15mdfcback/${k} box`).toBeLessThanOrEqual(8);
      // The tone MOVED the bars: not CC's untoned master.
      expect(Math.abs(bars - CC_BACK_BARS[k]), `m15mdfcback/${k} untoned?`).toBeGreaterThan(k === "b" ? 1 : 4);
    }
    for (const [k, file] of landBacks) {
      const img = await rgba(file!);
      const bars = (median(img, 1000, 1150, 118, 205) + median(img, 1000, 1150, 1200, 1290)) / 2;
      expect(Math.abs(bars - LAND_PRINTS[k].bars), `m15mdfclandback/${k} bars ${bars}`).toBeLessThanOrEqual(8);
      expect(Math.abs(median(img, 300, 1100, 1340, 1920) - LAND_PRINTS[k].box), `m15mdfclandback/${k} box`).toBeLessThanOrEqual(8);
      // The stone land body (luma ≈ 133 on the left flank) under every
      // colour's bars — never the colour's own frame body.
      expect(Math.abs(median(img, 62, 78, 600, 1500) - 133), `m15mdfclandback/${k} body`).toBeLessThanOrEqual(8);
    }
  });

  run("the fronts are CC's untoned masters; the land fronts take the land tint's body and box", async () => {
    for (const k of ["w", "u", "b", "r", "g"]) {
      const spell = onDisk(`m15mdfcfront/${k}.png`);
      const land = onDisk(`m15mdfclandfront/${k}.png`);
      if (!spell || !land) continue;
      const s = await rgba(spell);
      const l = await rgba(land);
      // The same bars and housing (the modal master's), another body and box.
      expect(Math.abs(median(s, 1000, 1150, 118, 205) - median(l, 1000, 1150, 118, 205)), `${k} bars`).toBeLessThanOrEqual(2);
      expect(Math.abs(median(s, 80, 185, 125, 205) - median(l, 80, 185, 125, 205)), `${k} housing`).toBeLessThanOrEqual(2);
      expect(Math.abs(median(l, 62, 78, 600, 1500) - 133), `${k} land body`).toBeLessThanOrEqual(8);
      expect(Math.abs(median(l, 300, 1100, 1340, 1920) - median(s, 300, 1100, 1340, 1920)), `${k} box differs`).toBeGreaterThan(10);
      // The strip is the modal master's (the colour's dark strip) on both.
      expect(Math.abs(median(s, 100, 640, 1878, 1940) - median(l, 100, 640, 1878, 1940)), `${k} strip`).toBeLessThanOrEqual(2);
    }
  });
});
