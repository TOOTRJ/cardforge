import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import provenanceJson from "@/lib/cards/frame-sources.json";
import {
  CC_COMMIT,
  CC_OVERLAY_BANDS,
  CC_TEMPLATES,
  CROWN_BAND,
  DFC_CROWN_CUTS,
  DFC_CROWN_KEYS,
  DFC_CROWN_SHADE_KNEE,
  DFC_CROWN_TWIN_SIZE,
  DFC_CROWN_WELLS,
  DFC_PAIR_BODIES,
  DFC_BACK_TONES,
  MDFC_BACK_TONES,
  OUT_W,
  builtColors,
  cutCrownBand,
  cutCrownFindings,
  cutCrownRecipe,
  cutCrownSourceFiles,
  dfcPairBackTones,
  dfcPairLayers,
  fitWellCircle,
  isRampedGain,
  pairOfMasterKey,
  placeTwin,
  rampedGainRow,
  sourceFilesFor,
  textureColumn,
  toneMasked,
  tonesFor,
  twinLegLuma,
  twinLetterFor,
} from "@/scripts/lib/cc-frames.mjs";
import { PAIR_RAMPS, TWO_COLOR_PAIRS, rampShare } from "@/scripts/lib/pair-ramp.mjs";
import { DFC_CROWN_LEFT, DFC_CROWN_RIGHT, MDFC_CROWN, M15_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import { frameAnatomyOf, normalizeAnatomy, resolveFrameOverlays, resolveTwoColor } from "@/lib/cards/anatomy";
import { CROWN_REFERENCES } from "@/lib/cards/crown";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 5.1d — crowns and two-colour frames on the double-faced bodies, the
// modal back strips toned (scripts/lib/cc-frames.mjs; docs/FRAMES.md
// "Crowns and pairs on the double-faced bodies"):
//   • the pair masters: 4.6b's "m15" recipe over each body's OWN pack files
//     and masks — the gold frame whole, the box and the pinline lerped from
//     the two colour frames across the untilted 45→57 / 40→60 ramps; the
//     hybrid dress on the modal front alone; a BACK's box toned at the two
//     colours' gains lerped across the rules ramp (toneMasked's ramped gain);
//   • the cut crown bands: the published m15crown band, cut round the well
//     through CC's DFC crown twin's alpha (the band's leg texture filling the
//     annulus the band has no pixels for), the band byte for byte elsewhere;
//   • the strip tones on the modal backs (the 5.1b skeptic's finding);
//   • what the profiles declare, what the save keeps, what the renderers
//     resolve (the rider above the crown).
// The built masters and pieces are checked where a copy at the manifest's
// sha256 is on disk (FRAMES_BUILD_DIR, else .frames-build; CI fetches them —
// a missing one FAILS there); the twin's alpha where the Card Conjurer cache
// is (a local build machine only).
// ---------------------------------------------------------------------------

const manifest = manifestJson as { files: Record<string, { sha256: string; width: number; height: number }> };
const provenance = provenanceJson as unknown as Record<string, { colors: Record<string, string[]>; tones?: Record<string, unknown[]>; sourceFiles: string[]; notes: string[]; bands?: Record<string, string>; kind?: string }>;
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const STRICT = Boolean(process.env.CI && process.env.FRAMES_BUILD_DIR);
const CC_CACHE = process.env.CC_CACHE ?? path.join(os.homedir(), ".cache", "pipglyph-cc", CC_COMMIT);

const SPELL_BODIES = ["m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15mdfcfront", "m15mdfcback"] as const;
const CROWNED_BODIES = ["m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15dfclandfront", "m15mdfcfront", "m15mdfcback"] as const;
const CROWN_FOLDERS = ["m15dfccrown", "m15dfccrownright", "m15mdfccrown"] as const;
const TRANSFORM = "img/frames/m15/transform/regular";
const MODAL = "img/frames/modal/regular";

type Layer = { src: string; right?: string; ramp?: number[]; mask?: string };
const def = (t: string) => (CC_TEMPLATES as Record<string, unknown>)[t] as { colors: Record<string, Layer[]>; tones?: unknown };

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
const px = (img: Img, x: number, y: number) => { const o = (y * img.w + x) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]]; };
const luma = (p: number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
function median(img: Img, x0: number, x1: number, y0: number, y1: number, step = 2): number {
  const v: number[] = [];
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) v.push(luma(px(img, x, y)));
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}
/** The second colour's share along a row band of `img` between two anchor
 *  columns, projected on the anchors' colour difference (the sheet's
 *  method), and where it crosses 10 / 50 / 90 % (%W). */
function crossings(img: Img, y0: number, y1: number, left: [number, number], right: [number, number]) {
  const mean = (x0: number, x1: number) => { const m = [0, 0, 0]; let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x < x1; x++) { const p = px(img, x, y); m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; n++; } return m.map((c) => c / n); };
  const L = mean(...left), R = mean(...right);
  const dv = R.map((c, i) => c - L[i]); const dd = dv.reduce((a, c) => a + c * c, 0);
  const s: number[] = [];
  for (let x = 0; x < img.w; x++) { let acc = 0; for (let y = y0; y <= y1; y++) { const p = px(img, x, y); acc += ((p[0] - L[0]) * dv[0] + (p[1] - L[1]) * dv[1] + (p[2] - L[2]) * dv[2]) / dd; } s.push(Math.min(1, Math.max(0, acc / (y1 - y0 + 1)))); }
  const at = (lvl: number) => { for (let x = 300; x < 1200; x++) if (s[x] >= lvl) return ((x + 0.5) / img.w) * 100; return null; };
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9), contrast: Math.sqrt(dd) };
}

describe("the pair recipes of the double-faced bodies (5.1d / 5.12)", () => {
  it("the five spell bodies build the split dress from their own pack files and masks, the modal front the hybrid too; the land pair none", () => {
    for (const body of SPELL_BODIES) {
      const keys = builtColors(def(body) as never);
      for (const pair of TWO_COLOR_PAIRS) expect(keys, `${body}/${pair}`).toContain(pair);
      const hybrid = body === "m15mdfcfront";
      for (const pair of TWO_COLOR_PAIRS) expect(keys.includes(`${pair}-h`), `${body}/${pair}-h`).toBe(hybrid);
    }
    for (const body of ["m15dfclandfront", "m15dfclandback", "m15mdfclandfront", "m15mdfclandback"]) {
      expect(builtColors(def(body) as never).some((k) => pairOfMasterKey(k) !== null), body).toBe(false);
    }
    expect(Object.keys(DFC_PAIR_BODIES).sort()).toEqual([...SPELL_BODIES].sort());
  });

  it("a split pair master: the gold frame whole, the box lerped through the Rules mask across 45→57, the pinline through the Pinline mask across 40→60 — first colour on the left", () => {
    const wu = dfcPairLayers("m15dfcfront", "wu", "split");
    expect(wu).toEqual([
      { src: `${TRANSFORM}/frontM.png` },
      { src: `${TRANSFORM}/frontW.png`, right: `${TRANSFORM}/frontU.png`, ramp: [...PAIR_RAMPS.rules], mask: `${TRANSFORM}/maskRulesFront.png` },
      { src: `${TRANSFORM}/frontW.png`, right: `${TRANSFORM}/frontU.png`, ramp: [...PAIR_RAMPS.pinline], mask: `${TRANSFORM}/maskPinlineFront.png` },
    ]);
    expect(dfcPairLayers("m15dfcback", "rg", "split")).toEqual([
      { src: `${TRANSFORM}/new/backM.png` },
      { src: `${TRANSFORM}/new/backR.png`, right: `${TRANSFORM}/new/backG.png`, ramp: [45, 57], mask: "img/frames/m15/regular/m15MaskRules.png" },
      { src: `${TRANSFORM}/new/backR.png`, right: `${TRANSFORM}/new/backG.png`, ramp: [40, 60], mask: `${TRANSFORM}/new/maskPinlineBack.png` },
    ]);
    expect(dfcPairLayers("m15dfcbackleft", "ub", "split")[2]).toEqual({ src: `${TRANSFORM}/backU.png`, right: `${TRANSFORM}/backB.png`, ramp: [40, 60], mask: `${TRANSFORM}/maskPinlineBack.png` });
    expect(dfcPairLayers("m15mdfcback", "br", "split")).toEqual([
      { src: `${MODAL}/mb.png` },
      { src: `${MODAL}/bb.png`, right: `${MODAL}/rb.png`, ramp: [45, 57], mask: `${MODAL}/textbox.svg` },
      { src: `${MODAL}/bb.png`, right: `${MODAL}/rb.png`, ramp: [40, 60], mask: `${MODAL}/pinline.svg` },
    ]);
    // The CC_TEMPLATES entries carry exactly these layers under the pair keys.
    expect(def("m15dfcfront").colors.wu).toEqual(wu);
    expect(def("m15mdfcback").colors.br).toEqual(dfcPairLayers("m15mdfcback", "br", "split"));
  });

  it("the modal front's hybrid dress: the two fronts lerped across 44→57, CC's grey Land frame's bars (the housing's fill with them), the split box and pinline", () => {
    expect(dfcPairLayers("m15mdfcfront", "wu", "hybrid")).toEqual([
      { src: `${MODAL}/w.png`, right: `${MODAL}/u.png`, ramp: [...PAIR_RAMPS.frame] },
      { src: `${MODAL}/w.png`, right: `${MODAL}/u.png`, ramp: [45, 57], mask: `${MODAL}/textbox.svg` },
      { src: `${MODAL}/l.png`, mask: `${MODAL}/title.svg` },
      { src: `${MODAL}/l.png`, mask: "img/frames/m15/regular/m15MaskType.png" },
      { src: `${MODAL}/w.png`, right: `${MODAL}/u.png`, ramp: [40, 60], mask: `${MODAL}/pinline.svg` },
    ]);
    expect(() => dfcPairLayers("m15dfcfront", "wu", "hybrid")).toThrow(/no hybrid dress/);
    expect(() => dfcPairLayers("m15dfclandfront", "wu", "split")).toThrow(/builds no pair masters/);
  });

  it("a pair BACK's tones: the gold bars (and the modal strip) at m's gains, the box at the two colours' box gains lerped across the rules ramp", () => {
    const t = dfcPairBackTones("m15dfcback", "wu") as { mask: string; gain: unknown; region: string }[];
    expect(t.map((x) => x.region)).toEqual(["title bar", "type bar", "text box"]);
    expect(t[0].gain).toBe(DFC_BACK_TONES.m.bars);
    expect(t[2].gain).toEqual({ left: DFC_BACK_TONES.w.box, right: DFC_BACK_TONES.u.box, ramp: [45, 57] });
    const modal = dfcPairBackTones("m15mdfcback", "rg") as { mask: string; gain: unknown; region: string }[];
    expect(modal.map((x) => x.region)).toEqual(["title bar + housing", "type bar", "text box", "flipside strip"]);
    expect(modal[3].gain).toBe(MDFC_BACK_TONES.m.strip);
    expect(modal[2].gain).toEqual({ left: MDFC_BACK_TONES.r.box, right: MDFC_BACK_TONES.g.box, ramp: [45, 57] });
    // tonesFor answers the pair's tones for a pair key and the colour's otherwise.
    expect(tonesFor(def("m15dfcback") as never, "wu")).toEqual(dfcPairBackTones("m15dfcback", "wu"));
    expect((tonesFor(def("m15dfcback") as never, "w") as { gain: number }[]).map((x) => x.gain)).toEqual([DFC_BACK_TONES.w.bars, DFC_BACK_TONES.w.bars, DFC_BACK_TONES.w.box]);
    // A front has no tones, a pair front neither.
    expect(tonesFor(def("m15dfcfront") as never, "wu")).toEqual([]);
    expect(() => dfcPairBackTones("m15dfcfront", "wu")).toThrow();
  });

  it("toneMasked's ramped gain: the left gain up to the ramp, the right from its end, lerped between — on a flat image through a full mask", () => {
    const W = 100, H = 2;
    const src = Buffer.alloc(W * H * 4); for (let p = 0; p < W * H; p++) src.set([100, 100, 100, 255], p * 4);
    const mask = Buffer.alloc(W * H * 4, 255);
    const gain = { left: 1.0, right: 1.5, ramp: [45, 57] as [number, number] };
    expect(isRampedGain(gain)).toBe(true);
    expect(isRampedGain(1.2)).toBe(false);
    const row = rampedGainRow(gain, W);
    expect(row[0]).toBe(1);
    expect(row[W - 1]).toBe(1.5);
    expect(row[50]).toBeCloseTo(1 + 0.5 * rampShare(50.5, [45, 57]), 9);
    const out = toneMasked(src, W, H, mask, { gain, lumaRamp: [215, 245] });
    expect(px({ data: out, w: W, h: H }, 10, 0)).toEqual([100, 100, 100, 255]);
    expect(px({ data: out, w: W, h: H }, 90, 0)).toEqual([150, 150, 150, 255]);
    expect(px({ data: out, w: W, h: H }, 51, 1)[0]).toBe(Math.round(100 * row[51]));
    // A number is a flat gain still.
    expect(px({ data: toneMasked(src, W, H, mask, { gain: 1.2 }), w: W, h: H }, 0, 0)).toEqual([120, 120, 120, 255]);
    expect(() => toneMasked(src, W, H, mask, { gain: { left: -1, right: 1, ramp: [40, 60] } as never })).toThrow();
  });

  it("the modal back strips take a gain through the Flipside mask on u b r g and m, fitted to the prints; w untouched", () => {
    for (const [table, targets] of [
      [MDFC_BACK_TONES, { u: 220.0, b: 221.0, r: 230.3, g: 228.9, m: 233.0 }],
      [tonesFor(def("m15mdfclandback") as never, "u") ? (CC_TEMPLATES.m15mdfclandback as never as { tones: (k: string) => { gain: number }[] }) : null, null],
    ] as const) {
      if (!targets) continue;
      const cc: Record<string, number[]> = { u: [188, 214, 231], b: [181, 173, 171], r: [242, 203, 183], g: [189, 207, 198], m: [219, 194, 134] };
      for (const [k, target] of Object.entries(targets)) {
        const strip = (table as Record<string, { strip?: number }>)[k].strip!;
        const built = cc[k].map((c) => Math.min(255, Math.round(c * strip)));
        expect(Math.abs(luma(built) - target), `${k}: ${luma(built)} vs ${target}`).toBeLessThanOrEqual(1.5);
      }
    }
    expect((MDFC_BACK_TONES.w as { strip?: number }).strip).toBeUndefined();
    const landU = tonesFor(def("m15mdfclandback") as never, "u") as { mask: string; region: string; gain: number }[];
    expect(landU.at(-1)).toMatchObject({ mask: `${MODAL}/reminder.svg`, region: "flipside strip" });
    expect(Math.abs(luma([188, 214, 231].map((c) => Math.min(255, Math.round(c * landU.at(-1)!.gain)))) - 230.7)).toBeLessThanOrEqual(1.5);
    expect((tonesFor(def("m15mdfclandback") as never, "w") as { region: string }[]).map((x) => x.region)).not.toContain("flipside strip");
    // The provenance records the strip tone.
    expect(provenance.m15mdfcback.tones?.b).toEqual(tonesFor(def("m15mdfcback") as never, "b"));
    expect(sourceFilesFor(def("m15mdfcback") as never)).toContain(`${MODAL}/reminder.svg`);
  });
});

describe("the cut crown bands (5.1d)", () => {
  it("three folders cut the published m15crown band: the LEFT well (the transform front, land front and 2016–22 back), the RIGHT well (the ▼ back), the modal housing — 18 keys each, never c", () => {
    expect(Object.keys(DFC_CROWN_CUTS)).toEqual([...CROWN_FOLDERS]);
    expect([...DFC_CROWN_KEYS]).toEqual(["w", "u", "b", "r", "g", "m", "a", "l", ...TWO_COLOR_PAIRS]);
    for (const folder of CROWN_FOLDERS) {
      expect(CC_OVERLAY_BANDS[folder].keys).toBe(DFC_CROWN_KEYS);
      expect(CC_OVERLAY_BANDS[folder].band).toBe(CROWN_BAND);
      expect(CC_OVERLAY_BANDS[folder].cut).toBe(DFC_CROWN_CUTS[folder]);
    }
    expect(cutCrownRecipe("m15dfccrown", "w")).toEqual({ band: "m15crown/w", twin: "img/frames/m15/transform/crowns/regular/w.png", well: DFC_CROWN_WELLS.left });
    expect(cutCrownRecipe("m15dfccrownright", "a").twin).toBe("img/frames/m15/transform/crowns/regular/new/a.png");
    expect(cutCrownRecipe("m15mdfccrown", "l").twin).toBe("img/frames/modal/crowns/regular/l.png");
    // A pair reads the twin of the colour whose half the well is in.
    expect(twinLetterFor("rg", DFC_CROWN_WELLS.left)).toBe("r");
    expect(twinLetterFor("rg", DFC_CROWN_WELLS.right)).toBe("g");
    expect(twinLetterFor("rg", DFC_CROWN_WELLS.modal)).toBe("r");
    expect(() => twinLetterFor("c", DFC_CROWN_WELLS.left)).toThrow();
    expect(cutCrownSourceFiles("m15dfccrownright")).toEqual(["w", "u", "b", "r", "g", "m", "a", "l"].map((k) => `img/frames/m15/transform/crowns/regular/new/${k}.png`).sort());
    // The profiles' slots list the importer's keys and the folders' paths.
    for (const [slot, folder] of [[DFC_CROWN_LEFT, "m15dfccrown"], [DFC_CROWN_RIGHT, "m15dfccrownright"], [MDFC_CROWN, "m15mdfccrown"]] as const) {
      expect([...slot.keys]).toEqual([...DFC_CROWN_KEYS]);
      expect(slot.assetPathTemplate).toBe(`/frames/${folder}/{key}.png`);
      expect(slot.rect).toEqual(M15_CROWN.rect);
      expect(slot.anatomy).toBe("crown");
    }
  });

  it("the texture columns mirror-tile the band's leg from the region's inner edge", () => {
    const left = DFC_CROWN_WELLS.left;
    const w = left.texture.x1 - left.texture.x0;
    expect(textureColumn(left.region.x0, left)).toBe(left.texture.x0);
    expect(textureColumn(left.region.x0 + w - 1, left)).toBe(left.texture.x1 - 1);
    expect(textureColumn(left.region.x0 + w, left)).toBe(left.texture.x1 - 1);
    expect(textureColumn(left.region.x0 + 2 * w, left)).toBe(left.texture.x0);
    const right = DFC_CROWN_WELLS.right;
    expect(textureColumn(right.region.x1 - 1, right)).toBe(right.texture.x1 - 1);
    expect(textureColumn(right.region.x1 - 1 - w, right)).toBe(right.texture.x0);
  });

  it("cutCrownBand on a synthetic band and twin: the twin's alpha inside the region, the band outside (the wrap included), the circle clear, the fill the leg's texture", () => {
    const W = OUT_W, ROWS = CROWN_BAND.rows;
    const well = DFC_CROWN_WELLS.left;
    // A band: opaque red crown (a leg at x 40–92 and a top band rows 42–96,
    // a wrap rows 222–235) over a black cover on rows 0–102.
    const band = Buffer.alloc(W * ROWS * 4);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const cover = y < 102;
      const crown = (x >= 40 && x < 92 && y >= 42) || (y >= 42 && y <= 96 && x >= 40 && x < 1460) || (y >= 222 && y <= 235 && x >= 92 && x < 1460);
      if (crown) band.set([200 - (x % 7), 40, 30, 255], o);
      else if (cover) band.set([0, 0, 0, 255], o);
    }
    // A twin: an opaque crown at rows 42–232 over x 41–1458, a circular hole
    // at (144, 160) r 61 and a bar hole from x 228, rows 97–221, with a dark
    // 2 px outline round the circle.
    const twinRaw = Buffer.alloc(DFC_CROWN_TWIN_SIZE.width * DFC_CROWN_TWIN_SIZE.height * 4);
    for (let ty = 0; ty < DFC_CROWN_TWIN_SIZE.height; ty++) for (let tx = 0; tx < DFC_CROWN_TWIN_SIZE.width; tx++) {
      const x = tx + 41, y = ty + 40;
      const o = (ty * DFC_CROWN_TWIN_SIZE.width + tx) * 4;
      if (y < 42 || y > 232) continue;
      const d = Math.hypot(x + 0.5 - 144, y + 0.5 - 160.5);
      if (d < 61) continue;
      if (x >= 228 && y >= 97 && y <= 221) continue;
      const outline = d < 63.5;
      twinRaw.set(outline ? [10, 5, 5, 255] : [220, 60, 40, 255], o);
    }
    const twin = placeTwin(twinRaw, ROWS);
    const circle = fitWellCircle(twin, well, W)!;
    expect(circle).not.toBeNull();
    expect(Math.abs(circle.cx - 144)).toBeLessThan(0.75);
    expect(Math.abs(circle.cy - 160.5)).toBeLessThan(0.75);
    expect(Math.abs(circle.r - 61)).toBeLessThan(0.75);
    expect(circle.maxErr).toBeLessThan(1);
    const ref = twinLegLuma(twin, well, W);
    expect(ref).toBeCloseTo(luma([220, 60, 40]), 3);
    const { piece } = cutCrownBand(band, twin, well, W, ROWS);
    const f = cutCrownFindings(piece, band, twin, well, circle, W, ROWS);
    expect(f.failures).toEqual([]);
    expect(f.outsideDiff).toBe(0);
    expect(f.alphaDiff).toBe(0);
    expect(f.circleLeak).toBe(0);
    const img = { data: piece, w: W, h: ROWS };
    // Inside the circle: clear; at the bar hole: clear; round the well on a
    // crown pixel: the leg's texture (unshaded where the twin is bright),
    // the twin's dark outline darkens it below the knee.
    expect(px(img, 144, 160)[3]).toBe(0);
    expect(px(img, 230, 150)[3]).toBe(0);
    const annulus = px(img, 215, 120);
    expect(annulus[3]).toBe(255);
    expect(annulus[0]).toBeGreaterThanOrEqual(193);
    expect(annulus[0]).toBeLessThanOrEqual(200);
    expect(annulus[1]).toBe(40);
    const rim = px(img, 144, 160 - 62);
    expect(rim[3]).toBe(255);
    expect(luma(rim)).toBeLessThan(luma(annulus) * (luma([10, 5, 5]) / ref) / DFC_CROWN_SHADE_KNEE + 2);
    // The wrap rows (below the region) are the band's: at x 300 (outside the
    // region's columns) and at x 100 (inside them) alike.
    expect(px(img, 300, 234)).toEqual(px({ data: band, w: W, h: ROWS }, 300, 234));
    expect(px(img, 100, 234)).toEqual(px({ data: band, w: W, h: ROWS }, 100, 234));
    // A modal well (no circle rows): no circle, the same cut otherwise.
    const modal = { ...DFC_CROWN_WELLS.modal, region: { ...DFC_CROWN_WELLS.modal.region } };
    expect(fitWellCircle(twin, modal, W)).toBeNull();
    const m = cutCrownBand(band, twin, modal, W, ROWS);
    expect(m.circle).toBeNull();
    const mf = cutCrownFindings(m.piece, band, twin, modal, m.circle, W, ROWS);
    expect(mf.failures).toEqual([]);
    // …and the leg left of `keep.x1` keeps the band's own pixels under the twin's alpha.
    expect(px({ data: m.piece, w: W, h: ROWS }, 50, 120).slice(0, 3)).toEqual(px({ data: band, w: W, h: ROWS }, 50, 120).slice(0, 3));
  });
});

describe("what the profiles declare and the save keeps (5.1d)", () => {
  it("the crown on every DFC body with a printed legendary face — never the ▼ land back or the modal land pair; the pairs on the five spell bodies, the hybrid dress on the modal front alone", () => {
    for (const t of CROWNED_BODIES) expect(frameAnatomyOf(t).crown, t).toBe(true);
    for (const t of ["m15dfclandback", "m15mdfclandfront", "m15mdfclandback"]) expect(frameAnatomyOf(t).crown, t).toBe(false);
    expect(frameAnatomyOf("m15dfcfront").twoColor).toEqual(["split"]);
    expect(frameAnatomyOf("m15dfcback").twoColor).toEqual(["split"]);
    expect(frameAnatomyOf("m15dfcbackleft").twoColor).toEqual(["split"]);
    expect(frameAnatomyOf("m15mdfcfront").twoColor).toEqual(["split", "hybrid"]);
    expect(frameAnatomyOf("m15mdfcback").twoColor).toEqual(["split"]);
    for (const t of ["m15dfclandfront", "m15dfclandback", "m15mdfclandfront", "m15mdfclandback"]) expect(frameAnatomyOf(t).twoColor, t).toEqual([]);
    // No holoStamp on any DFC body, ever.
    for (const t of FRAME_TEMPLATE_VALUES.filter((x) => x.startsWith("m15dfc") || x.startsWith("m15mdfc"))) expect(frameAnatomyOf(t).stamp, t).toBe(false);
    // The crown slot per body: the left well's on the faces whose well is at
    // the left, the right well's on the ▼ back, the housing's on the modal
    // spell pair — the colourless key the artifact stand-in's silver, the
    // land front's the land grey; the rider AFTER the crown.
    const crownOf = (t: string) => (getFrameProfile(t).overlays ?? []).find((o) => o.anatomy === "crown")!;
    expect(crownOf("m15dfcfront")).toEqual({ ...DFC_CROWN_LEFT, keyMap: { c: "a" } });
    expect(crownOf("m15dfcbackleft")).toEqual({ ...DFC_CROWN_LEFT, keyMap: { c: "a" } });
    expect(crownOf("m15dfclandfront")).toEqual({ ...DFC_CROWN_LEFT, keyMap: { c: "l" } });
    expect(crownOf("m15dfcback")).toEqual({ ...DFC_CROWN_RIGHT, keyMap: { c: "a" } });
    expect(crownOf("m15mdfcfront")).toEqual({ ...MDFC_CROWN, keyMap: { c: "a" } });
    expect(crownOf("m15mdfcback")).toEqual({ ...MDFC_CROWN, keyMap: { c: "a" } });
    for (const t of ["m15dfcfront", "m15dfclandfront", "m15dfcbackleft"]) {
      expect((getFrameProfile(t).overlays ?? []).map((o) => o.anatomy), t).toEqual(["crown", "dfcIcon"]);
    }
  });

  it("the save keeps the switches where the body draws them and drops them elsewhere; a pair back resolves its pair master and the pair's crown, a land back neither", () => {
    for (const t of ["m15dfcfront", "m15dfcback", "m15dfcbackleft", "m15mdfcfront", "m15mdfcback"]) {
      expect(normalizeAnatomy({ template: t, crown: true, twoColor: true }, t, "creature"), t).toEqual({ template: t, crown: true, twoColor: true });
    }
    expect(normalizeAnatomy({ template: "m15dfclandfront", crown: true, twoColor: true }, "m15dfclandfront", "land")).toEqual({ template: "m15dfclandfront", crown: true });
    for (const t of ["m15dfclandback", "m15mdfclandfront", "m15mdfclandback"]) {
      expect(normalizeAnatomy({ template: t, crown: true, twoColor: true }, t, "land"), t).toEqual({ template: t });
    }
    // A legendary two-colour BACK on the ▼ back: the pair master and the
    // pair's crown from the right-well folder (MID #246's back prints both).
    const back = getFrameProfile("m15dfcback");
    const facts = { colors: ["red", "green"] as const, cost: null, cardType: "creature", supertype: "Legendary", colorKey: "m" };
    expect(resolveTwoColor(back, { twoColor: true }, facts)).toEqual({ pair: "rg", dress: "split", masterKey: "rg" });
    expect(resolveFrameOverlays(back, { crown: true, twoColor: true }, facts)).toEqual([
      { anatomy: "crown", rect: M15_CROWN.rect, key: "rg", path: "/frames/m15dfccrownright/rg.png" },
    ]);
    // …gold with the switch off; the artifact silver for a colourless artifact back.
    expect(resolveFrameOverlays(back, { crown: true }, facts)[0].key).toBe("m");
    expect(resolveFrameOverlays(back, { crown: true }, { ...facts, colors: ["colorless"], colorKey: "c" })[0].key).toBe("a");
    // The transform front: the crown THEN the rider, the rider keyed by the family's glyph.
    const front = getFrameProfile("m15dfcfront");
    const drawn = resolveFrameOverlays(front, { crown: true, twoColor: true }, { ...facts, dfc: { role: "front", icon: "sunmoon" } });
    expect(drawn.map((o) => [o.anatomy, o.key])).toEqual([["crown", "rg"], ["dfcIcon", "sun"]]);
    // A hybrid-cost two-colour modal front wears the hybrid dress and the pair's crown; the transform front (split only) its split.
    const modal = getFrameProfile("m15mdfcfront");
    expect(resolveTwoColor(modal, { twoColor: true }, { ...facts, colors: ["white", "blue"], cost: "{W/U}{W/U}" })).toEqual({ pair: "wu", dress: "hybrid", masterKey: "wu-h" });
    expect(resolveTwoColor(front, { twoColor: true }, { ...facts, colors: ["white", "blue"], cost: "{W/U}{W/U}" })).toEqual({ pair: "wu", dress: "split", masterKey: "wu" });
    // The land back (no pairs): gold, and no crown at all.
    const landBack = getFrameProfile("m15dfclandback");
    expect(resolveTwoColor(landBack, { twoColor: true }, { ...facts, cardType: "land" })).toBeNull();
    expect(resolveFrameOverlays(landBack, { crown: true }, { ...facts, cardType: "land", colorKey: "c" })).toEqual([]);
  });

  it("CROWN_REFERENCES names a crowned print per declared body and colour where one exists — a back body's on the printing's back face", () => {
    for (const t of CROWNED_BODIES) expect(Object.keys(CROWN_REFERENCES[t] ?? {}).length, t).toBeGreaterThan(0);
    expect(Object.keys(CROWN_REFERENCES.m15dfcfront!).sort()).toEqual(["a", "b", "bg", "br", "g", "gw", "m", "r", "rg", "rw", "u", "ub", "ur", "w", "wb", "wu"]);
    expect(CROWN_REFERENCES.m15dfcfront!.rg).toMatchObject({ set: "mid", collectorNumber: "246" });
    expect(CROWN_REFERENCES.m15dfcbackleft!.rg).toMatchObject({ set: "mid", collectorNumber: "246" });
    expect(CROWN_REFERENCES.m15dfcback!.g).toMatchObject({ set: "mom", collectorNumber: "190" });
    expect(CROWN_REFERENCES.m15dfclandfront!.c).toMatchObject({ set: "slx", collectorNumber: "9" });
    expect(CROWN_REFERENCES.m15mdfcfront!.b).toMatchObject({ set: "khm", collectorNumber: "112" });
    expect(CROWN_REFERENCES.m15mdfcback!.m).toMatchObject({ set: "khm", collectorNumber: "168" });
    for (const t of ["m15dfclandback", "m15mdfclandfront", "m15mdfclandback"]) expect(CROWN_REFERENCES[t as never], t).toBeUndefined();
  });
});

describe("the published masters and pieces (the frames bucket)", () => {
  const pairKeys = (body: string) => builtColors(def(body) as never).filter((k) => pairOfMasterKey(k) !== null);
  const masters = SPELL_BODIES.flatMap((body) => pairKeys(body).map((k) => [body, k, onDisk(`${body}/${k}.png`)] as const));
  const pieces = CROWN_FOLDERS.flatMap((folder) => DFC_CROWN_KEYS.map((k) => [folder, k, onDisk(`${folder}/${k}.png`)] as const));
  const bands = DFC_CROWN_KEYS.map((k) => [k, onDisk(`m15crown/${k}.png`)] as const);
  const missing = [...masters, ...pieces].filter(([, , f]) => !f).length + bands.filter(([, f]) => !f).length;
  if (missing && STRICT) throw new Error(`${missing} 5.1d masters / pieces missing from ${BUILD} (CI fetches them: frames-fetch.mjs)`);
  const run = missing ? it.skip : it;

  it("the manifest lists every pair master and every cut piece, PNG and WebP, at their sizes — and no pair of the land pair", () => {
    for (const [body, k] of masters) for (const ext of ["png", "webp"]) expect(manifest.files[`${body}/${k}.${ext}`], `${body}/${k}.${ext}`).toMatchObject({ width: 1500, height: 2100 });
    for (const [folder, k] of pieces) for (const ext of ["png", "webp"]) expect(manifest.files[`${folder}/${k}.${ext}`], `${folder}/${k}.${ext}`).toMatchObject({ width: 1500, height: CROWN_BAND.rows });
    for (const key of Object.keys(manifest.files)) {
      const [t, name] = key.split("/");
      if (["m15dfclandfront", "m15dfclandback", "m15mdfclandfront", "m15mdfclandback"].includes(t)) expect(pairOfMasterKey(name.replace(/\.(png|webp)$/, "")), key).toBeNull();
    }
    expect(masters).toHaveLength(60);
    expect(pieces).toHaveLength(54);
    for (const folder of CROWN_FOLDERS) {
      expect(provenance[folder]?.kind).toBe("overlay");
      expect(provenance[folder]?.bands?.w).toBe("m15crown/w.png");
      expect(provenance[folder]?.sourceFiles).toEqual(cutCrownSourceFiles(folder));
    }
  });

  run("a split pair master is the gold master but for the box and the pinline, which are the two colour masters' lerped across the ramps — the title ring splits at 40→60, 50 % centred", async () => {
    for (const [body, pair] of [["m15dfcfront", "wu"], ["m15dfcback", "rg"], ["m15dfcbackleft", "ub"], ["m15mdfcfront", "wu"], ["m15mdfcback", "br"]] as const) {
      const img = await rgba(onDisk(`${body}/${pair}.png`)!);
      const gold = await rgba(onDisk(`${body}/m.png`)!);
      const [a, b] = pair.split("");
      const A = await rgba(onDisk(`${body}/${a}.png`)!);
      const B = await rgba(onDisk(`${body}/${b}.png`)!);
      // The bars (gold on every split master; toned on a back like m's) and
      // the frame body are the gold master's.
      expect(Math.abs(median(img, 1000, 1150, 118, 205) - median(gold, 1000, 1150, 118, 205)), `${body}/${pair} title bar`).toBeLessThanOrEqual(1);
      expect(Math.abs(median(img, 1000, 1150, 1200, 1290) - median(gold, 1000, 1150, 1200, 1290)), `${body}/${pair} type bar`).toBeLessThanOrEqual(1);
      expect(px(img, 70, 700), `${body}/${pair} body`).toEqual(px(gold, 70, 700));
      // Left of the box ramp the box is the first colour's (toned like it), right of it the second's (±6: a back's lerped gain).
      expect(Math.abs(median(img, 300, 600, 1400, 1850) - median(A, 300, 600, 1400, 1850)), `${body}/${pair} box left`).toBeLessThanOrEqual(6);
      expect(Math.abs(median(img, 900, 1200, 1400, 1850) - median(B, 900, 1200, 1400, 1850)), `${body}/${pair} box right`).toBeLessThanOrEqual(6);
      // The title ring splits across 40→60 %W, centred on 50 (the sheet's
      // projection on the two anchors; the Innistrad prints read 45.5 / 51 /
      // 56, the 2023+ ones 42 / 50 / 58).
      const c = crossings(img, 89, 100, [180, 330], [1170, 1320]);
      if (c.contrast > 60) {
        expect(c.p50!, `${body}/${pair} 50 %`).toBeGreaterThan(48.5);
        expect(c.p50!, `${body}/${pair} 50 %`).toBeLessThan(51.5);
        expect(c.p10!, `${body}/${pair} 10 %`).toBeGreaterThan(40);
        expect(c.p90!, `${body}/${pair} 90 %`).toBeLessThan(60.5);
      }
    }
  }, 120_000);

  run("the modal front's hybrid dress wears CC's grey Land bars and the lerped frame body", async () => {
    const img = await rgba(onDisk("m15mdfcfront/wu-h.png")!);
    const l = await rgba(onDisk("m15mdfclandfront/c.png")!); // CC's l.png is the grey land modal: its bars
    const w = await rgba(onDisk("m15mdfcfront/w.png")!);
    const u = await rgba(onDisk("m15mdfcfront/u.png")!);
    expect(Math.abs(median(img, 1000, 1150, 118, 205) - median(l, 1000, 1150, 118, 205))).toBeLessThanOrEqual(2);
    // The body left of the frame ramp is white's, right of it blue's.
    expect(px(img, 70, 700)).toEqual(px(w, 70, 700));
    expect(px(img, 1430, 700)).toEqual(px(u, 1430, 700));
  });

  run("the toned modal back strips land within ±2 luma of their reference prints; w and the fronts untouched", async () => {
    const fill = (img: Img) => { const v: number[] = []; for (const y of [1872, 1874, 1876, 1938, 1940, 1942]) for (let x = 110; x < 640; x += 2) v.push(luma(px(img, x, y))); v.sort((a, b) => a - b); return v[v.length >> 1]; };
    // Read inside the tab (rows 1878–1884 and 1936–1942, x 120–480 at HD): STX
    // #147 / #148 + KHM #112 / #159 / #151 and KHM #168's gold back.
    const SPELL = { u: 220.0, b: 221.0, r: 230.3, g: 228.9, m: 233.0 };
    const LAND = { u: 230.7, b: 212.4, r: 227.8, g: 218.1 };
    for (const [k, target] of Object.entries(SPELL)) expect(Math.abs(fill(await rgba(onDisk(`m15mdfcback/${k}.png`)!)) - target), `m15mdfcback/${k}`).toBeLessThanOrEqual(2);
    for (const [k, target] of Object.entries(LAND)) expect(Math.abs(fill(await rgba(onDisk(`m15mdfclandback/${k}.png`)!)) - target), `m15mdfclandback/${k}`).toBeLessThanOrEqual(2);
    expect(Math.abs(fill(await rgba(onDisk("m15mdfcback/w.png")!)) - 238.1)).toBeLessThanOrEqual(1);
    expect(Math.abs(fill(await rgba(onDisk("m15mdfcfront/u.png")!)) - 118)).toBeLessThanOrEqual(40); // a front strip is dark: never toned up
  });

  run("a cut piece is the published band outside the well region; inside, its alpha hole is a circle the ring fits and the fill is the band's leg", async () => {
    for (const [folder, k] of [["m15dfccrown", "r"], ["m15dfccrown", "rg"], ["m15dfccrownright", "g"], ["m15dfccrownright", "ub"], ["m15mdfccrown", "b"], ["m15mdfccrown", "wu"]] as const) {
      const piece = await rgba(onDisk(`${folder}/${k}.png`)!);
      const band = await rgba(onDisk(`m15crown/${k}.png`)!);
      const well = DFC_CROWN_CUTS[folder].well;
      const circle = fitWellCircle(piece.data, well, OUT_W);
      if (well.circleRows) {
        // The piece's own hole (the twin's alpha) is the well's circle.
        expect(circle!.maxErr, `${folder}/${k} fit`).toBeLessThanOrEqual(1.5);
        expect(circle!.r).toBeGreaterThan(55);
        expect(circle!.r).toBeLessThan(66);
        expect(px(piece, Math.round(circle!.cx), Math.round(circle!.cy))[3]).toBe(0);
      } else {
        expect(circle).toBeNull();
        // The modal housing: clear at its centre and at its tip's row.
        expect(px(piece, 133, 160)[3]).toBe(0);
        expect(px(piece, 70, 160)[3]).toBe(0);
      }
      let outside = 0;
      let opaque = 0;
      let exact = 0;
      for (let y = 0; y < piece.h; y++) for (let x = 0; x < piece.w; x++) {
        const o = (y * piece.w + x) * 4;
        const inRegion = x >= well.region.x0 && x < well.region.x1 && y >= well.region.y0 && y <= well.region.y1;
        if (!inRegion) {
          if (piece.data[o] !== band.data[o] || piece.data[o + 1] !== band.data[o + 1] || piece.data[o + 2] !== band.data[o + 2] || piece.data[o + 3] !== band.data[o + 3]) outside++;
          continue;
        }
        // Inside: an opaque pixel is the band's own texture at the tiled
        // column (or its own pixel left of `keep.x1`), at most darkened by
        // the twin's outline — never brighter, and most of them untouched.
        if (piece.data[o + 3] < 250) continue;
        const srcX = well.keep && x < well.keep.x1 && band.data[o + 3] >= 250 ? x : textureColumn(x, well);
        const so = (y * band.w + srcX) * 4;
        opaque++;
        let same = true;
        for (let c = 0; c < 3; c++) {
          expect(piece.data[o + c], `${folder}/${k} (${x},${y}) channel ${c}`).toBeLessThanOrEqual(band.data[so + c] + 1);
          if (piece.data[o + c] !== band.data[so + c]) same = false;
        }
        if (same) exact++;
      }
      expect(outside, `${folder}/${k} outside the well`).toBe(0);
      expect(opaque).toBeGreaterThan(5000);
      expect(exact / opaque, `${folder}/${k}: ${exact} of ${opaque} fill px untouched`).toBeGreaterThan(0.6);
    }
  }, 120_000);

  const cache = fs.existsSync(path.join(CC_CACHE, "img/frames/m15/transform/crowns/regular/w.png")) && fs.existsSync(path.join(CC_CACHE, "img/frames/modal/crowns/regular/w.png"));
  (missing || !cache ? it.skip : it)("with the Card Conjurer cache: inside the well region a piece's alpha is the twin's, and a fresh cut reproduces the published piece byte for byte", async () => {
    for (const [folder, k] of [["m15dfccrown", "w"], ["m15dfccrownright", "m"], ["m15mdfccrown", "gu"]] as const) {
      const recipe = cutCrownRecipe(folder, k);
      const twinRaw = await sharp(path.join(CC_CACHE, recipe.twin)).ensureAlpha().raw().toBuffer();
      const twin = placeTwin(twinRaw, CROWN_BAND.rows);
      const band = await rgba(onDisk(`m15crown/${k}.png`)!);
      const { piece, circle } = cutCrownBand(band.data, twin, recipe.well, OUT_W, CROWN_BAND.rows);
      const findings = cutCrownFindings(piece, band.data, twin, recipe.well, circle, OUT_W, CROWN_BAND.rows);
      expect(findings.failures, `${folder}/${k}`).toEqual([]);
      const published = await rgba(onDisk(`${folder}/${k}.png`)!);
      expect(Buffer.compare(piece, published.data), `${folder}/${k} reproduces`).toBe(0);
    }
  }, 120_000);
});
