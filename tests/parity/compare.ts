// ---------------------------------------------------------------------------
// The preview ⇄ bake comparison (TODO 3.11) — pure pixel arithmetic, no
// imports: tests/parity/preview.parity.spec.ts runs it on a screenshot of the
// browser preview and the Satori bake of the same card, and
// tests/unit/render/parity-compare.test.ts holds it to synthetic pictures
// (a moved box must be found, and found in the right region).
//
// Two renderers never agree to the pixel: Chromium's and resvg's glyph
// rasterisers anti-alias differently and scale the 1500 px masters with
// different filters. So the comparison is per REGION (a moved pip must not
// hide in a whole-card average) and each region answers three questions:
//
//   shift   has the region's ink MOVED? The whole-pixel offset (dx, dy) of
//           the preview against the bake that best explains the pixels where
//           the two disagree — measured only on those pixels (the frame
//           around a text is the same master in both and would vote for 0).
//           "No offset is clearly better" answers 0.
//   mad     mean absolute difference of the region, 0–255, on a 3 × 3 box
//           blur (anti-aliasing noise is mostly gone, a 2 px move is not).
//   hot     the share of the region's pixels that differ by more than
//           HOT_DIFF after the blur — "how much of this region is another
//           picture", which a small moved piece in a large region still
//           raises.
//
// The whole card is also cut into small square TILES, each with its own mad:
// one inline pip 2 px from its place hardly moves the average of a rules box
// (and the box's text outvotes it in `shift`), but it more than doubles the
// difference of the tiles it sits in. The tiles also cover what no named
// region does — a crown, a stamp, the saga's rail, a turned half.
// ---------------------------------------------------------------------------

/** An RGB picture, 3 bytes per pixel, rows top to bottom. */
export type Rgb = { data: Uint8Array | Buffer; width: number; height: number };

/** A region in pixels of the compared pictures. */
export type PxRect = { x: number; y: number; w: number; h: number };

export type RegionMetrics = {
  /** Best whole-pixel offset of the preview against the bake (0 when no
   *  offset clearly beats none). Positive dx = the preview is to the RIGHT. */
  dx: number;
  dy: number;
  /** max(|dx|, |dy|). */
  shift: number;
  /** Mean absolute difference after the blur, 0–255. */
  mad: number;
  /** Share of pixels differing by more than HOT_DIFF after the blur, 0–1. */
  hot: number;
};

/** A blurred pixel differing by more than this is "another picture" there. */
export const HOT_DIFF = 48;
/** An unblurred pixel differing by more than this takes part in the shift
 *  search (with its neighbourhood). */
const ACTIVE_DIFF = 40;
/** A shift is reported only when it explains the disagreeing pixels this
 *  much better than no shift at all (SAD ratio). */
const SHIFT_GAIN = 0.8;
/** Fewer disagreeing pixels than this is nothing to place. */
const MIN_ACTIVE_PX = 24;

function luma(img: Rgb): Float32Array {
  const out = new Float32Array(img.width * img.height);
  const d = img.data;
  for (let i = 0, o = 0; i < out.length; i += 1, o += 3) out[i] = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
  return out;
}

/** 3 × 3 box blur of a single-channel picture (edges clamp). */
function blur3(src: Float32Array, width: number, height: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const l = src[row + Math.max(0, x - 1)];
      const r = src[row + Math.min(width - 1, x + 1)];
      tmp[row + x] = (l + src[row + x] + r) / 3;
    }
  }
  for (let y = 0; y < height; y += 1) {
    const up = Math.max(0, y - 1) * width;
    const down = Math.min(height - 1, y + 1) * width;
    const row = y * width;
    for (let x = 0; x < width; x += 1) out[row + x] = (tmp[up + x] + tmp[row + x] + tmp[down + x]) / 3;
  }
  return out;
}

/** What `compareRegions` works on: both pictures as luminance, raw and blurred. */
export type Prepared = {
  width: number;
  height: number;
  bake: Float32Array;
  preview: Float32Array;
  /** |bake − preview| of the blurred pictures. */
  diff: Float32Array;
};

/** Both pictures must be the same size (the caller checks and reports it). */
export function prepare(bake: Rgb, preview: Rgb): Prepared {
  if (bake.width !== preview.width || bake.height !== preview.height) {
    throw new Error(`sizes differ: bake ${bake.width}×${bake.height}, preview ${preview.width}×${preview.height}`);
  }
  const { width, height } = bake;
  const b = luma(bake);
  const p = luma(preview);
  const bb = blur3(b, width, height);
  const pb = blur3(p, width, height);
  const diff = new Float32Array(b.length);
  for (let i = 0; i < diff.length; i += 1) diff[i] = Math.abs(bb[i] - pb[i]);
  return { width, height, bake: b, preview: p, diff };
}

function clampRect(rect: PxRect, width: number, height: number): PxRect {
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  const w = Math.max(1, Math.min(width - x, Math.round(rect.w)));
  const h = Math.max(1, Math.min(height - y, Math.round(rect.h)));
  return { x, y, w, h };
}

/** mad + hot of a region. */
function difference(p: Prepared, r: PxRect): { mad: number; hot: number } {
  let sum = 0;
  let hot = 0;
  for (let y = r.y; y < r.y + r.h; y += 1) {
    const row = y * p.width;
    for (let x = r.x; x < r.x + r.w; x += 1) {
      const d = p.diff[row + x];
      sum += d;
      if (d > HOT_DIFF) hot += 1;
    }
  }
  const n = r.w * r.h;
  return { mad: sum / n, hot: hot / n };
}

/**
 * The offset of the preview against the bake inside a region, to ±`radius`
 * px. Only the pixels where the two disagree (and their neighbourhood, so a
 * moved glyph's old and new place both count) vote; `step` subsamples a large
 * region (the art window).
 */
function offset(p: Prepared, r: PxRect, radius: number, step: number): { dx: number; dy: number } {
  const { width, height, bake, preview } = p;
  // The disagreeing pixels, grown by the search radius.
  const mask = new Uint8Array(r.w * r.h);
  let active = 0;
  for (let y = 0; y < r.h; y += 1) {
    const row = (r.y + y) * width + r.x;
    for (let x = 0; x < r.w; x += 1) {
      if (Math.abs(bake[row + x] - preview[row + x]) > ACTIVE_DIFF) {
        active += 1;
        const y0 = Math.max(0, y - radius);
        const y1 = Math.min(r.h - 1, y + radius);
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(r.w - 1, x + radius);
        for (let my = y0; my <= y1; my += 1) mask.fill(1, my * r.w + x0, my * r.w + x1 + 1);
      }
    }
  }
  if (active < MIN_ACTIVE_PX) return { dx: 0, dy: 0 };
  let best = { dx: 0, dy: 0, sad: Infinity };
  let zero = Infinity;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      let sad = 0;
      for (let y = 0; y < r.h; y += step) {
        const by = r.y + y;
        const py = by + dy;
        if (py < 0 || py >= height) continue;
        for (let x = 0; x < r.w; x += step) {
          if (!mask[y * r.w + x]) continue;
          const bx = r.x + x;
          const px = bx + dx;
          if (px < 0 || px >= width) continue;
          sad += Math.abs(bake[by * width + bx] - preview[py * width + px]);
        }
      }
      if (dx === 0 && dy === 0) zero = sad;
      // Ties go to the smaller move.
      if (sad < best.sad || (sad === best.sad && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) {
        best = { dx, dy, sad };
      }
    }
  }
  if (best.sad > zero * SHIFT_GAIN) return { dx: 0, dy: 0 };
  return { dx: best.dx, dy: best.dy };
}

/** The three answers for one region. */
export function compareRegion(p: Prepared, rect: PxRect, opts: { radius: number }): RegionMetrics {
  const r = clampRect(rect, p.width, p.height);
  const { mad, hot } = difference(p, r);
  // A large region is searched on every second pixel: the art window's
  // picture has no detail finer than that, and it keeps the HD run short.
  const step = r.w * r.h > 400_000 ? 2 : 1;
  const { dx, dy } = offset(p, r, opts.radius, step);
  return { dx, dy, shift: Math.max(Math.abs(dx), Math.abs(dy)), mad, hot };
}

/** The whole picture cut into square tiles, row by row: each tile's mad.
 *  A sliver at the right or bottom edge joins no tile. */
export type TileMap = { tile: number; cols: number; rows: number; mads: number[] };

export function tileMap(p: Prepared, tile: number): TileMap {
  const cols = Math.floor(p.width / tile);
  const rows = Math.floor(p.height / tile);
  const mads: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) mads.push(difference(p, { x: col * tile, y: row * tile, w: tile, h: tile }).mad);
  }
  return { tile, cols, rows, mads };
}

/** The worst tile of a map: its mad and where it is, px. */
export function worstTile(map: TileMap): { mad: number; x: number; y: number } {
  let worst = { mad: 0, x: 0, y: 0 };
  map.mads.forEach((mad, i) => {
    if (mad > worst.mad) worst = { mad, x: (i % map.cols) * map.tile, y: Math.floor(i / map.cols) * map.tile };
  });
  return worst;
}

/** A side-by-side "where do they differ" picture: the blurred difference,
 *  white = HOT_DIFF or more. One byte per pixel (grey). */
export function differenceMap(p: Prepared): Uint8Array {
  const out = new Uint8Array(p.diff.length);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.min(255, Math.round((p.diff[i] / HOT_DIFF) * 255));
  return out;
}
