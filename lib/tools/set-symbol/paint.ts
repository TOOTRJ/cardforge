// ---------------------------------------------------------------------------
// Set Symbol Studio — one cut-out symbol, painted the way a printed set
// symbol is: the four rarity looks, the watermark, the "plain" picture.
//
//   common    black ink (#0f0f12) with a pale keyline — as printed
//   uncommon  polished silver, dark keyline
//   rare      gold, dark keyline
//   mythic    orange-red, dark keyline
//   watermark the shape alone in WATERMARK_INK, no keyline (the card draws
//             a custom watermark at its own opacity)
//   plain     the maker's own colours when they kept them, else the common
//
// The metallic looks are a three-stop gradient down and across the shape
// (light top-left → dark bottom-right), the tones RARITY_INK's in the
// middle. Pure and client-safe: the browser's preview and the server's
// stored files run the same code.
// ---------------------------------------------------------------------------

import { RARITY_INK } from "@/lib/brand/constants";
import { WATERMARK_INK } from "@/lib/cards/watermark";
import type { Mask, RgbaImage } from "./cutout";
import { maskBounds } from "./cutout";

export const RARITY_LOOKS = ["common", "uncommon", "rare", "mythic"] as const;
export type RarityLook = (typeof RARITY_LOOKS)[number];
export type SymbolLook = RarityLook | "watermark" | "plain";

/** Side of a stored set-icon file (the card draws it at ~70 px HD). */
export const SYMBOL_PX = 512;
/** Side of the stored watermark (drawn across the rules box). */
export const WATERMARK_PX = 1024;
/** Empty border around the shape, a share of the side: room for the
 *  keyline, and the card's symbol box sees the shape, not the canvas. */
export const SYMBOL_MARGIN = 0.07;
/** Keyline width, a share of the side (≈ 18 px at 512). */
export const KEYLINE_SHARE = 0.035;

type Rgb = readonly [number, number, number];

function hex(value: string): Rgb {
  const v = value.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

const DARK_KEYLINE = hex("#0f0f12");
const PALE_KEYLINE = hex("#e6e0d1");

/** The three gradient stops of each metallic look (light, mid, dark). */
export const RARITY_GRADIENTS: Record<Exclude<RarityLook, "common">, readonly [string, string, string]> = {
  uncommon: ["#e6e9ef", RARITY_INK.uncommon, "#5f6370"],
  rare: ["#f7e19a", RARITY_INK.rare, "#7a5a1e"],
  mythic: ["#ffb36b", RARITY_INK.mythic, "#8a2312"],
};

export const LOOK_KEYLINE: Record<RarityLook, string> = {
  common: "#e6e0d1",
  uncommon: "#0f0f12",
  rare: "#0f0f12",
  mythic: "#0f0f12",
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function gradientAt(stops: readonly [Rgb, Rgb, Rgb], t: number): Rgb {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  if (c <= 0.5) {
    const k = c / 0.5;
    return [lerp(stops[0][0], stops[1][0], k), lerp(stops[0][1], stops[1][1], k), lerp(stops[0][2], stops[1][2], k)];
  }
  const k = (c - 0.5) / 0.5;
  return [lerp(stops[1][0], stops[2][0], k), lerp(stops[1][1], stops[2][1], k), lerp(stops[1][2], stops[2][2], k)];
}

/** Bilinear sample of a premultiplied RGBA buffer (Float32, 4 per px). */
function samplePremultiplied(src: Float32Array, w: number, h: number, x: number, y: number, out: number[]): void {
  const fx = Math.max(0, Math.min(w - 1, x - 0.5));
  const fy = Math.max(0, Math.min(h - 1, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  for (let c = 0; c < 4; c += 1) {
    const a = src[(y0 * w + x0) * 4 + c];
    const b = src[(y0 * w + x1) * 4 + c];
    const d = src[(y1 * w + x0) * 4 + c];
    const e = src[(y1 * w + x1) * 4 + c];
    out[c] = lerp(lerp(a, b, tx), lerp(d, e, tx), ty);
  }
}

/**
 * The cut-out (`img`'s colours under `mask`'s coverage) cropped to the
 * shape, centred in a square with `margin` of air on each side (a share of
 * the side; SYMBOL_MARGIN for a set symbol, Pip Forge's glyph sits further
 * in), resampled to `size` × `size` (4 × 4 supersampling of premultiplied
 * colour). Null when the mask holds nothing.
 */
export function fitSquare(img: RgbaImage, mask: Mask, size: number, margin = SYMBOL_MARGIN): RgbaImage | null {
  const box = maskBounds(mask);
  if (!box) return null;
  const { width: w, height: h } = img;
  const pre = new Float32Array(w * h * 4);
  for (let p = 0; p < w * h; p += 1) {
    const a = mask.data[p] / 255;
    pre[p * 4] = img.data[p * 4] * a;
    pre[p * 4 + 1] = img.data[p * 4 + 1] * a;
    pre[p * 4 + 2] = img.data[p * 4 + 2] * a;
    pre[p * 4 + 3] = a;
  }
  const side = Math.max(box.width, box.height) / (1 - 2 * margin);
  const originX = box.x + box.width / 2 - side / 2;
  const originY = box.y + box.height / 2 - side / 2;
  const scale = side / size;
  const out = new Uint8ClampedArray(size * size * 4);
  const sample = [0, 0, 0, 0];
  const SS = 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const srcX = originX + (x + (sx + 0.5) / SS) * scale;
          const srcY = originY + (y + (sy + 0.5) / SS) * scale;
          if (srcX < 0 || srcY < 0 || srcX >= w || srcY >= h) continue;
          samplePremultiplied(pre, w, h, srcX, srcY, sample);
          r += sample[0];
          g += sample[1];
          b += sample[2];
          a += sample[3];
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      const i = (y * size + x) * 4;
      if (alpha > 0) {
        out[i] = r / n / alpha;
        out[i + 1] = g / n / alpha;
        out[i + 2] = b / n / alpha;
      }
      out[i + 3] = Math.round(alpha * 255);
    }
  }
  return { width: size, height: size, data: out };
}

/** 1-D squared Euclidean distance transform (Felzenszwalb–Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Distance (px) from every pixel to the nearest pixel with alpha ≥ 128. */
export function distanceToShape(img: RgbaImage): Float64Array {
  const { width: w, height: h } = img;
  const INF = 1e12;
  const grid = new Float64Array(w * h);
  for (let p = 0; p < w * h; p += 1) grid[p] = img.data[p * 4 + 3] >= 128 ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y += 1) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x += 1) grid[y * w + x] = Math.sqrt(d[x]);
  }
  return grid;
}

/**
 * `fitted` (fitSquare's output) painted in `look`. `keepColours` is the
 * maker's choice for the PLAIN look only: their picture's own colours.
 */
export function paintSymbol(fitted: RgbaImage, look: SymbolLook, keepColours = false): RgbaImage {
  const { width: w, height: h, data } = fitted;
  const out = new Uint8ClampedArray(w * h * 4);
  if (look === "plain" && keepColours) {
    out.set(data);
    return { width: w, height: h, data: out };
  }
  if (look === "watermark") {
    const ink = hex(WATERMARK_INK);
    for (let p = 0; p < w * h; p += 1) {
      out[p * 4] = ink[0];
      out[p * 4 + 1] = ink[1];
      out[p * 4 + 2] = ink[2];
      out[p * 4 + 3] = data[p * 4 + 3];
    }
    return { width: w, height: h, data: out };
  }
  const rarity: RarityLook = look === "plain" ? "common" : look;
  const keyline = rarity === "common" ? PALE_KEYLINE : DARK_KEYLINE;
  const stops =
    rarity === "common" ? null : (RARITY_GRADIENTS[rarity].map(hex) as unknown as readonly [Rgb, Rgb, Rgb]);
  const flat = hex(RARITY_INK.common);
  const radius = Math.max(1, Math.min(w, h) * KEYLINE_SHARE);
  const distance = distanceToShape(fitted);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      const shape = data[p * 4 + 3] / 255;
      // The keyline: the shape grown by `radius`, its outer edge one
      // pixel soft. The shape's own soft edge lies over it.
      const ring = Math.max(shape, Math.max(0, Math.min(1, radius + 0.5 - distance[p])));
      if (ring <= 0) continue;
      const fill = stops ? gradientAt(stops, (0.35 * x) / w + (0.65 * y) / h) : flat;
      const i = p * 4;
      out[i] = lerp(keyline[0], fill[0], shape);
      out[i + 1] = lerp(keyline[1], fill[1], shape);
      out[i + 2] = lerp(keyline[2], fill[2], shape);
      out[i + 3] = Math.round(ring * 255);
    }
  }
  return { width: w, height: h, data: out };
}

/** Box-average `img`'s alpha down to `size` × `size`. */
function alphaAt(img: RgbaImage, size: number): Float32Array {
  const out = new Float32Array(size * size);
  const counts = new Float32Array(size * size);
  for (let y = 0; y < img.height; y += 1) {
    const oy = Math.min(size - 1, Math.floor((y * size) / img.height));
    for (let x = 0; x < img.width; x += 1) {
      const ox = Math.min(size - 1, Math.floor((x * size) / img.width));
      out[oy * size + ox] += img.data[(y * img.width + x) * 4 + 3] / 255;
      counts[oy * size + ox] += 1;
    }
  }
  for (let k = 0; k < out.length; k += 1) out[k] = counts[k] ? out[k] / counts[k] : 0;
  return out;
}

/**
 * How well the shape survives at the size a card prints it (`size` px —
 * 16 for a set symbol on a 750 px card; Pip Forge asks 16 and 24 of a
 * pip): the shape thresholded at 64 px against the same shape after a trip
 * through `size` px, as intersection over union. 1 = nothing lost; under
 * LEGIBILITY_WARN the studio says details vanish.
 */
export function legibilityScore(fitted: RgbaImage, size = 16): number {
  const FINE = 64;
  const fine = alphaAt(fitted, FINE);
  const coarse = alphaAt(fitted, size);
  let inter = 0;
  let union = 0;
  for (let y = 0; y < FINE; y += 1) {
    for (let x = 0; x < FINE; x += 1) {
      const a = fine[y * FINE + x] >= 0.5;
      const b = coarse[Math.floor((y * size) / FINE) * size + Math.floor((x * size) / FINE)] >= 0.5;
      if (a && b) inter += 1;
      if (a || b) union += 1;
    }
  }
  return union === 0 ? 0 : Math.round((inter / union) * 1000) / 1000;
}

export const LEGIBILITY_WARN = 0.82;
