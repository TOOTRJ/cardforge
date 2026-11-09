// ---------------------------------------------------------------------------
// Pip Forge — from FLUX's black-on-white drawing to a pip that reads at card
// size. Pure, on RGBA arrays (the server stores what this paints; nothing
// here touches Node or the DOM):
//
//   1. glyphMask — the white keyed away EVERYWHERE (Set Symbol Studio's
//      `colour` cut-out, lib/tools/set-symbol/cutout.ts: a hole in the
//      glyph is a hole), specks dropped; a drawing that came back as a
//      solid badge with the glyph cut into it (FLUX's habit even when told
//      "no circle") is turned inside out; holes too small to survive at
//      16 px are filled.
//   2. fitGlyph — the glyph centred with its longer side GLYPH_OF_DISC of
//      the disc (the five mana symbols' glyphs sit at about that size),
//      black on transparent, GLYPH_PX square: the stored glyph file.
//   3. cleanGlyph — the legibility gate: the glyph at 16 and 24 px against
//      itself at 64 (Set Symbol Studio's measure, legibilityScore). Short of
//      the bar its strokes are thickened, a step at a time; still short, the
//      caller asks for a simpler drawing (or refunds).
//   4. paintPip — our own disc, edge to edge in PIP_PX (the custom-pip
//      format: the renderers draw a custom pip round-cropped to its box),
//      in the chosen colour, the glyph in the ink with the higher contrast.
//
// Client-safe.
// ---------------------------------------------------------------------------

import {
  components,
  coverageShare,
  cutOut,
  maskBounds,
  type Mask,
  type RgbaImage,
} from "@/lib/tools/set-symbol/cutout";
import { distanceToShape, fitSquare, legibilityScore } from "@/lib/tools/set-symbol/paint";
import { inkFor, normaliseHex, type Legibility } from "./model";

/** The stored pip's side (the custom-pip format, lib/pips/actions.ts). */
export const PIP_PX = 256;
/** The stored glyph's side (twice the pip: a recolour paints from it). */
export const GLYPH_PX = 512;
/** The glyph's longer side, a share of the disc's diameter. */
export const GLYPH_OF_DISC = 0.62;
const GLYPH_MARGIN = (1 - GLYPH_OF_DISC) / 2;

/** The bars a glyph must clear at each preview size (intersection over
 *  union against itself at 64 px; 1 = nothing lost). */
export const LEGIBILITY_MIN: Legibility = { at16: 0.6, at24: 0.72 };

/** Stroke growth per thickening step, a share of GLYPH_PX (≈ 6 px at 512,
 *  3 px on the stored pip), and how many steps are tried. */
const THICKEN_SHARE = 0.012;
const THICKEN_STEPS = 2;

/** The cut-out the glyph is keyed with: the white, wherever it is. */
const GLYPH_CUT = { mode: "colour", tolerance: 40 } as const;

/** A badge — FLUX's coin with the glyph cut into it — is a silhouette
 *  (the shape with its holes filled) this close to a circle (intersection
 *  over union with the circle its box holds)… */
const BADGE_ROUNDNESS = 0.95;
/** …mostly ink (a bold ring is not a badge: its hole is most of it)… */
const BADGE_INK = 0.6;
/** …with holes of at least this share of its box. */
const BADGE_HOLES = 0.03;
/** Holes under this share of the glyph's box are filled: under a pixel at
 *  16 px, they would only speckle. */
const TINY_HOLE = 0.006;

/** Background regions enclosed by the glyph: label per pixel and sizes. */
function holesOf(mask: Mask): { labels: Int32Array; sizes: number[]; touchesBorder: boolean[] } {
  const inverted: Mask = { width: mask.width, height: mask.height, data: new Uint8Array(mask.data.length) };
  for (let p = 0; p < mask.data.length; p += 1) inverted.data[p] = 255 - mask.data[p];
  return components(inverted);
}

/** The glyph's coverage mask from FLUX's drawing, or null when nothing
 *  usable is left. */
export function glyphMask(source: RgbaImage): Mask | null {
  const { mask } = cutOut(source, GLYPH_CUT);
  const share = coverageShare(mask);
  if (share < 0.002 || share > 0.9) return null;
  let box = maskBounds(mask);
  if (!box) return null;
  const boxArea = box.width * box.height;
  // A badge: the glyph is the holes. Our disc IS the coin, so a round
  // silhouette with the glyph cut into it is turned inside out; any other
  // shape with holes (a skull's eyes, a ring) is the glyph as drawn.
  {
    const { labels, touchesBorder } = holesOf(mask);
    const inside = new Uint8Array(mask.data.length);
    let holeArea = 0;
    for (let p = 0; p < labels.length; p += 1) {
      const k = labels[p];
      if (k && !touchesBorder[k]) {
        inside[p] = 1;
        holeArea += 1;
      }
    }
    const aspect = box.width / box.height;
    if (holeArea / boxArea >= BADGE_HOLES && aspect > 0.85 && aspect < 1.18) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const rx = box.width / 2;
      const ry = box.height / 2;
      let silhouette = 0;
      let ink = 0;
      let both = 0;
      let either = 0;
      for (let y = box.y; y < box.y + box.height; y += 1) {
        for (let x = box.x; x < box.x + box.width; x += 1) {
          const p = y * mask.width + x;
          const shape = mask.data[p] >= 128 || inside[p] === 1;
          const round = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
          if (shape) silhouette += 1;
          if (mask.data[p] >= 128) ink += 1;
          if (shape && round) both += 1;
          if (shape || round) either += 1;
        }
      }
      if (either > 0 && both / either >= BADGE_ROUNDNESS && ink / silhouette >= BADGE_INK) {
        // The holes, with the badge's soft inner edge as their own.
        const flipped = new Uint8Array(mask.data.length);
        for (let p = 0; p < mask.data.length; p += 1) {
          if (inside[p]) flipped[p] = 255 - mask.data[p];
          else if (mask.data[p] < 255 && mask.data[p] > 0) {
            const x = p % mask.width;
            const near = [p - 1, p + 1, p - mask.width, p + mask.width].some(
              (q) => q >= 0 && q < inside.length && Math.abs((q % mask.width) - x) <= 1 && inside[q],
            );
            if (near) flipped[p] = 255 - mask.data[p];
          }
        }
        mask.data.set(flipped);
        box = maskBounds(mask);
        if (!box) return null;
      }
    }
  }

  // Holes too small to survive at card size are filled.
  const area = box.width * box.height;
  const { labels, sizes, touchesBorder } = holesOf(mask);
  const fill = new Uint8Array(sizes.length);
  for (let k = 1; k < sizes.length; k += 1) if (!touchesBorder[k] && sizes[k] < area * TINY_HOLE) fill[k] = 1;
  for (let p = 0; p < labels.length; p += 1) if (fill[labels[p]]) mask.data[p] = 255;
  return mask;
}

/** The glyph placed for the pip: black on transparent, `size` square, its
 *  longer side GLYPH_OF_DISC of the square. Null when the mask is empty. */
export function fitGlyph(source: RgbaImage, mask: Mask, size = GLYPH_PX): RgbaImage | null {
  const fitted = fitSquare(source, mask, size, GLYPH_MARGIN);
  if (!fitted) return null;
  const out = new Uint8ClampedArray(fitted.data.length);
  for (let p = 3; p < out.length; p += 4) out[p] = fitted.data[p];
  return { width: fitted.width, height: fitted.height, data: out };
}

/** `glyph` with its strokes grown by `px` (its soft edge kept). */
export function thickenGlyph(glyph: RgbaImage, px: number): RgbaImage {
  const distance = distanceToShape(glyph);
  const out = new Uint8ClampedArray(glyph.data.length);
  for (let p = 0; p < glyph.width * glyph.height; p += 1) {
    const grown = Math.max(0, Math.min(1, px + 0.5 - distance[p]));
    out[p * 4 + 3] = Math.max(glyph.data[p * 4 + 3], Math.round(grown * 255));
  }
  return { width: glyph.width, height: glyph.height, data: out };
}

export function glyphLegibility(glyph: RgbaImage): Legibility {
  return { at16: legibilityScore(glyph, 16), at24: legibilityScore(glyph, 24) };
}

export function passesLegibility(legibility: Legibility): boolean {
  return legibility.at16 >= LEGIBILITY_MIN.at16 && legibility.at24 >= LEGIBILITY_MIN.at24;
}

export type CleanGlyph = {
  glyph: RgbaImage;
  legibility: Legibility;
  passed: boolean;
  /** Thickening steps it took (0 = as drawn). */
  thickened: number;
};

/** The drawing's glyph, made to read at card size where it can. Null when
 *  the drawing holds no usable glyph at all. */
export function cleanGlyph(source: RgbaImage): CleanGlyph | null {
  const mask = glyphMask(source);
  if (!mask) return null;
  const base = fitGlyph(source, mask);
  if (!base) return null;
  let best: CleanGlyph | null = null;
  for (let step = 0; step <= THICKEN_STEPS; step += 1) {
    const glyph = step === 0 ? base : thickenGlyph(base, step * THICKEN_SHARE * GLYPH_PX);
    const legibility = glyphLegibility(glyph);
    best = { glyph, legibility, passed: passesLegibility(legibility), thickened: step };
    if (best.passed) return best;
  }
  return best;
}

/** A stored glyph file's pixels as a glyph (its alpha is the glyph). */
export function glyphFromRgba(img: RgbaImage): RgbaImage {
  const out = new Uint8ClampedArray(img.data.length);
  for (let p = 3; p < out.length; p += 4) out[p] = img.data[p];
  return { width: img.width, height: img.height, data: out };
}

function rgbOf(hex: string): [number, number, number] {
  const v = normaliseHex(hex) ?? "#000000";
  return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
}

/**
 * The pip: `glyph` (GLYPH_PX square, placed by fitGlyph) on a disc of
 * `disc` filling the square edge to edge, in `inkFor(disc)`; painted at the
 * glyph's size and averaged down to `size` (premultiplied 2 × 2 when the
 * glyph is twice the pip).
 */
export function paintPip(glyph: RgbaImage, disc: string, size = PIP_PX): RgbaImage {
  const { width: w, height: h, data } = glyph;
  const fill = rgbOf(disc);
  const ink = rgbOf(inkFor(disc));
  const radius = Math.min(w, h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  // Premultiplied colour and alpha at the glyph's size.
  const big = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cover = Math.max(0, Math.min(1, radius - d + 0.5));
      if (cover <= 0) continue;
      const p = y * w + x;
      const g = data[p * 4 + 3] / 255;
      const i = p * 4;
      big[i] = (fill[0] + (ink[0] - fill[0]) * g) * cover;
      big[i + 1] = (fill[1] + (ink[1] - fill[1]) * g) * cover;
      big[i + 2] = (fill[2] + (ink[2] - fill[2]) * g) * cover;
      big[i + 3] = cover;
    }
  }
  const out = new Uint8ClampedArray(size * size * 4);
  const sx = w / size;
  const sy = h / size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy += 1) {
        for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx += 1) {
          const i = (yy * w + xx) * 4;
          r += big[i];
          g += big[i + 1];
          b += big[i + 2];
          a += big[i + 3];
          n += 1;
        }
      }
      if (!n || a <= 0) continue;
      const i = (y * size + x) * 4;
      out[i] = r / a;
      out[i + 1] = g / a;
      out[i + 2] = b / a;
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return { width: size, height: size, data: out };
}
