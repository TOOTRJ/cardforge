// ---------------------------------------------------------------------------
// Set Symbol Studio — background removal with NO model (owner 2026-11-06,
// the spike's pick: https://claude.ai/artifact/HyGfnPGNHUAAkjFczWUxiA).
//
// One pure module on RGBA arrays, so the browser's live preview and the
// server's save run the SAME code (the server again, on the stored source,
// whatever the browser showed). Four ways to find the background, one
// control in the UI:
//
//   * edges   — flood fill from the border through pixels near the border's
//               colour: flat backgrounds (FLUX is told to draw on white);
//               a background colour trapped INSIDE the shape stays.
//   * colour  — the border's colour(s) removed everywhere: checkerboards
//               baked into a PNG, holes inside the shape.
//   * drawing — a drawing or a photo of one on paper: the paper's light is
//               fitted (a quadratic surface over the bright pixels), what
//               is darker than it is ink, blobs touching the border (the
//               page's shadow, the table) are dropped.
//   * alpha   — the file's own transparency, kept as it is.
//   * auto    — picks one of the four from the picture (autoCutoutMode).
//
// `tolerance` (0–100) always means "how much counts as background": higher
// removes more. Every mode then drops specks and keeps the file's alpha.
//
// Client-safe: no Node or DOM imports.
// ---------------------------------------------------------------------------

export type RgbaImage = {
  width: number;
  height: number;
  /** width × height × 4 bytes, RGBA, not premultiplied. */
  data: Uint8Array | Uint8ClampedArray;
};

export const CUTOUT_MODES = ["auto", "edges", "colour", "drawing", "alpha"] as const;
export type CutoutMode = (typeof CUTOUT_MODES)[number];
/** A mode the pipeline runs (auto resolved). */
export type ResolvedCutoutMode = Exclude<CutoutMode, "auto">;

export const DEFAULT_TOLERANCE = 35;

export type CutoutOptions = { mode: CutoutMode; tolerance: number };

/** A coverage mask: one byte a pixel, 0 = background, 255 = symbol. */
export type Mask = { width: number; height: number; data: Uint8Array };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 0..1 smooth ramp from `lo` to `hi`. */
function ramp(v: number, lo: number, hi: number): number {
  if (hi <= lo) return v >= hi ? 1 : 0;
  const t = clamp01((v - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
}

const MAX_RGB_DIST = Math.sqrt(3 * 255 * 255);

function colourDistance(data: RgbaImage["data"], i: number, c: readonly [number, number, number]): number {
  const dr = data[i] - c[0];
  const dg = data[i + 1] - c[1];
  const db = data[i + 2] - c[2];
  return Math.sqrt(dr * dr + dg * dg + db * db) / MAX_RGB_DIST;
}

/** The pixels on the image's outer ring, as byte offsets (each once). */
function borderOffsets(width: number, height: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < width; x += 1) {
    out.push(x * 4);
    if (height > 1) out.push(((height - 1) * width + x) * 4);
  }
  for (let y = 1; y < height - 1; y += 1) {
    out.push(y * width * 4);
    if (width > 1) out.push((y * width + width - 1) * 4);
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The border's typical colour (per-channel median of its opaque pixels). */
export function borderColour(img: RgbaImage): [number, number, number] {
  const offsets = borderOffsets(img.width, img.height).filter((i) => img.data[i + 3] >= 128);
  const pick = offsets.length > 0 ? offsets : borderOffsets(img.width, img.height);
  return [
    median(pick.map((i) => img.data[i])),
    median(pick.map((i) => img.data[i + 1])),
    median(pick.map((i) => img.data[i + 2])),
  ];
}

/** Up to two background colours from the border (a checkerboard has two):
 *  a 2-means split of the border pixels, a cluster kept when it holds at
 *  least 15 % of them and the two are really different. */
export function borderColours(img: RgbaImage): Array<[number, number, number]> {
  const offsets = borderOffsets(img.width, img.height).filter((i) => img.data[i + 3] >= 128);
  if (offsets.length === 0) return [borderColour(img)];
  const first = borderColour(img);
  // Seed the second centre with the border pixel farthest from the first.
  let far = offsets[0];
  let farDist = -1;
  for (const i of offsets) {
    const d = colourDistance(img.data, i, first);
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  if (farDist < 0.12) return [first];
  let a: [number, number, number] = first;
  let b: [number, number, number] = [img.data[far], img.data[far + 1], img.data[far + 2]];
  let shareA = 1;
  for (let round = 0; round < 6; round += 1) {
    const sumA = [0, 0, 0];
    const sumB = [0, 0, 0];
    let nA = 0;
    let nB = 0;
    for (const i of offsets) {
      const toA = colourDistance(img.data, i, a);
      const toB = colourDistance(img.data, i, b);
      const sum = toA <= toB ? sumA : sumB;
      sum[0] += img.data[i];
      sum[1] += img.data[i + 1];
      sum[2] += img.data[i + 2];
      if (toA <= toB) nA += 1;
      else nB += 1;
    }
    if (nA > 0) a = [sumA[0] / nA, sumA[1] / nA, sumA[2] / nA];
    if (nB > 0) b = [sumB[0] / nB, sumB[1] / nB, sumB[2] / nB];
    shareA = nA / offsets.length;
  }
  const apart = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / MAX_RGB_DIST > 0.12;
  if (!apart) return [first];
  const kept: Array<[number, number, number]> = [];
  if (shareA >= 0.15) kept.push(a);
  if (1 - shareA >= 0.15) kept.push(b);
  return kept.length > 0 ? kept : [first];
}

/** Share of pixels the file itself makes see-through. */
function transparentShare(img: RgbaImage): number {
  let clear = 0;
  const n = img.width * img.height;
  for (let p = 0; p < n; p += 1) if (img.data[p * 4 + 3] < 128) clear += 1;
  return n === 0 ? 0 : clear / n;
}

/** Which mode `auto` runs for this picture: the file's own transparency
 *  when it has some, edge fill for a flat border, the drawing mode for a
 *  light uneven one (paper), else the colour key. */
export function autoCutoutMode(img: RgbaImage): ResolvedCutoutMode {
  if (transparentShare(img) > 0.02) return "alpha";
  const offsets = borderOffsets(img.width, img.height);
  const centre = borderColour(img);
  const spread = offsets.reduce((sum, i) => sum + colourDistance(img.data, i, centre), 0) / Math.max(1, offsets.length);
  if (spread < 0.05) return "edges";
  const light = 0.299 * centre[0] + 0.587 * centre[1] + 0.114 * centre[2];
  if (light > 150) return "drawing";
  return "colour";
}

/** The distance under which a pixel is background, and the soft band's top,
 *  for a tolerance of 0–100. */
function distanceBand(tolerance: number): { lo: number; hi: number } {
  const t = clamp01(tolerance / 100);
  const lo = 0.02 + t * 0.45;
  return { lo, hi: lo + 0.04 + t * 0.06 };
}

function edgesAlpha(img: RgbaImage, tolerance: number): Uint8Array {
  const { width, height, data } = img;
  const bg = borderColour(img);
  const { lo, hi } = distanceBand(tolerance);
  const alpha = new Uint8Array(width * height).fill(255);
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (const offset of borderOffsets(width, height)) {
    const p = offset / 4;
    if (seen[p]) continue;
    if (data[offset + 3] < 128 || colourDistance(data, offset, bg) < hi) {
      seen[p] = 1;
      queue[tail++] = p;
    }
  }
  while (head < tail) {
    const p = queue[head++];
    const i = p * 4;
    alpha[p] = data[i + 3] < 128 ? 0 : Math.round(255 * ramp(colourDistance(data, i, bg), lo, hi));
    // Only a pixel that is clearly background spreads the fill further:
    // the soft edge band is painted, never crossed.
    if (alpha[p] > 127) continue;
    const x = p % width;
    const y = (p - x) / width;
    const next = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
    for (const q of next) {
      if (q < 0 || seen[q]) continue;
      const j = q * 4;
      if (data[j + 3] < 128 || colourDistance(data, j, bg) < hi) {
        seen[q] = 1;
        queue[tail++] = q;
      }
    }
  }
  return alpha;
}

function colourAlpha(img: RgbaImage, tolerance: number): Uint8Array {
  const { width, height, data } = img;
  const colours = borderColours(img);
  const { lo, hi } = distanceBand(tolerance);
  const alpha = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p += 1) {
    const i = p * 4;
    let best = 1;
    for (const c of colours) best = Math.min(best, colourDistance(data, i, c));
    alpha[p] = Math.round(255 * ramp(best, lo, hi));
  }
  return alpha;
}

/** Solve a small dense linear system (Gaussian elimination, partial pivot). */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= n; c += 1) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

const luminance = (data: RgbaImage["data"], i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

/** The paper's lighting: L(x, y) ≈ a + bx + cy + dx² + exy + fy², fitted by
 *  least squares to the bright pixels (three rounds, each keeping the
 *  pixels no darker than the last fit). Coordinates are 0..1. */
export function fitLighting(img: RgbaImage): (x: number, y: number) => number {
  const { width, height, data } = img;
  const step = Math.max(1, Math.round(Math.max(width, height) / 96));
  const samples: Array<{ x: number; y: number; l: number }> = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      samples.push({ x: x / Math.max(1, width - 1), y: y / Math.max(1, height - 1), l: luminance(data, (y * width + x) * 4) });
    }
  }
  const terms = (x: number, y: number) => [1, x, y, x * x, x * y, y * y];
  let coeffs: number[] = [median(samples.map((s) => s.l)), 0, 0, 0, 0, 0];
  const evaluate = (c: number[], x: number, y: number) => terms(x, y).reduce((sum, t, k) => sum + t * c[k], 0);
  for (let round = 0; round < 3; round += 1) {
    const keep = samples.filter((s) => s.l >= evaluate(coeffs, s.x, s.y) - 14);
    if (keep.length < 12) break;
    const ata = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
    const atb = new Array<number>(6).fill(0);
    for (const s of keep) {
      const t = terms(s.x, s.y);
      for (let i = 0; i < 6; i += 1) {
        atb[i] += t[i] * s.l;
        for (let j = 0; j < 6; j += 1) ata[i][j] += t[i] * t[j];
      }
    }
    const next = solve(ata, atb);
    if (!next) break;
    coeffs = next;
  }
  return (x, y) => evaluate(coeffs, x, y);
}

function drawingAlpha(img: RgbaImage, tolerance: number): Uint8Array {
  const { width, height, data } = img;
  const light = fitLighting(img);
  const t = clamp01(tolerance / 100);
  const threshold = 0.06 + t * 0.4;
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const paper = Math.max(1, light(x / Math.max(1, width - 1), y / Math.max(1, height - 1)));
      const darkness = (paper - luminance(data, p * 4)) / paper;
      alpha[p] = Math.round(255 * ramp(darkness, threshold - 0.04, threshold + 0.04));
    }
  }
  dropBorderBlobs({ width, height, data: alpha });
  return alpha;
}

/** 8-connected components of `mask ≥ 128`: a label per pixel (0 = none)
 *  and each label's pixel count. */
export function components(mask: Mask): { labels: Int32Array; sizes: number[]; touchesBorder: boolean[] } {
  const { width, height, data } = mask;
  const labels = new Int32Array(width * height);
  const sizes: number[] = [0];
  const touchesBorder: boolean[] = [false];
  const stack = new Int32Array(width * height);
  let next = 1;
  for (let start = 0; start < width * height; start += 1) {
    if (labels[start] || data[start] < 128) continue;
    let top = 0;
    stack[top++] = start;
    labels[start] = next;
    let size = 0;
    let border = false;
    while (top > 0) {
      const p = stack[--top];
      size += 1;
      const x = p % width;
      const y = (p - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border = true;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (labels[q] || data[q] < 128) continue;
          labels[q] = next;
          stack[top++] = q;
        }
      }
    }
    sizes.push(size);
    touchesBorder.push(border);
    next += 1;
  }
  return { labels, sizes, touchesBorder };
}

/** The drawing mode's page edge: ink blobs that touch the border are the
 *  table or a shadow — dropped, unless one is the symbol itself (the
 *  biggest blob, holding most of the ink). In place. */
function dropBorderBlobs(mask: Mask): void {
  const { labels, sizes, touchesBorder } = components(mask);
  const total = sizes.reduce((a, b) => a + b, 0);
  let biggest = 0;
  for (let k = 1; k < sizes.length; k += 1) if (sizes[k] > sizes[biggest]) biggest = k;
  const drop = new Set<number>();
  for (let k = 1; k < sizes.length; k += 1) {
    if (!touchesBorder[k]) continue;
    if (k === biggest && sizes[k] > total * 0.5) continue;
    drop.add(k);
  }
  if (drop.size === 0) return;
  for (let p = 0; p < labels.length; p += 1) {
    if (drop.has(labels[p])) mask.data[p] = 0;
  }
  // The soft fringe of a dropped blob (below 128, unlabelled) next to it.
  for (let p = 0; p < labels.length; p += 1) {
    if (mask.data[p] === 0 || mask.data[p] >= 128) continue;
    const x = p % mask.width;
    const near = [p - 1, p + 1, p - mask.width, p + mask.width].some(
      (q) => q >= 0 && q < labels.length && Math.abs((q % mask.width) - x) <= 1 && drop.has(labels[q]),
    );
    if (near) mask.data[p] = 0;
  }
}

/** How far (px) a soft pixel may sit from a kept shape and still be its
 *  anti-aliased edge. */
const SOFT_EDGE_REACH = 3;

/** Drop specks: components smaller than 0.15 % of the picture, or under
 *  2 % of the biggest one — and every soft pixel (under 128) that is not
 *  within SOFT_EDGE_REACH of a kept shape: a dropped speck's fringe, or a
 *  faint smudge that never reached 128 (it would widen the symbol's bounds
 *  and shrink it in every file). In place. */
export function dropSpecks(mask: Mask): void {
  const { width, height } = mask;
  const { labels, sizes } = components(mask);
  const biggest = Math.max(0, ...sizes);
  const floor = Math.max(width * height * 0.0015, biggest * 0.02);
  const drop = new Uint8Array(sizes.length);
  for (let k = 1; k < sizes.length; k += 1) if (sizes[k] < floor) drop[k] = 1;
  const kept = new Uint8Array(width * height);
  for (let p = 0; p < labels.length; p += 1) {
    if (drop[labels[p]]) mask.data[p] = 0;
    else if (labels[p]) kept[p] = 1;
  }
  // Near a kept shape = the kept pixels dilated by a square of SOFT_EDGE_REACH
  // (one horizontal pass, then one vertical).
  const across = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    let last = -Infinity;
    for (let x = 0; x < width; x += 1) {
      if (kept[y * width + x]) last = x;
      if (x - last <= SOFT_EDGE_REACH) across[y * width + x] = 1;
    }
    last = Infinity;
    for (let x = width - 1; x >= 0; x -= 1) {
      if (kept[y * width + x]) last = x;
      if (last - x <= SOFT_EDGE_REACH) across[y * width + x] = 1;
    }
  }
  const near = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) {
    let last = -Infinity;
    for (let y = 0; y < height; y += 1) {
      if (across[y * width + x]) last = y;
      if (y - last <= SOFT_EDGE_REACH) near[y * width + x] = 1;
    }
    last = Infinity;
    for (let y = height - 1; y >= 0; y -= 1) {
      if (across[y * width + x]) last = y;
      if (last - y <= SOFT_EDGE_REACH) near[y * width + x] = 1;
    }
  }
  for (let p = 0; p < mask.data.length; p += 1) {
    if (mask.data[p] < 128 && !near[p]) mask.data[p] = 0;
  }
}

/**
 * The symbol's coverage mask for `img` under `options`, after speck
 * clean-up, with the file's own transparency kept. `mode` says which mode
 * ran (auto resolved).
 */
export function cutOut(img: RgbaImage, options: CutoutOptions): { mask: Mask; mode: ResolvedCutoutMode } {
  const mode: ResolvedCutoutMode = options.mode === "auto" ? autoCutoutMode(img) : options.mode;
  const tolerance = Math.max(0, Math.min(100, Number.isFinite(options.tolerance) ? options.tolerance : DEFAULT_TOLERANCE));
  const n = img.width * img.height;
  let alpha: Uint8Array;
  if (mode === "edges") alpha = edgesAlpha(img, tolerance);
  else if (mode === "colour") alpha = colourAlpha(img, tolerance);
  else if (mode === "drawing") alpha = drawingAlpha(img, tolerance);
  else alpha = new Uint8Array(n).fill(255);
  for (let p = 0; p < n; p += 1) alpha[p] = Math.round((alpha[p] * img.data[p * 4 + 3]) / 255);
  const mask: Mask = { width: img.width, height: img.height, data: alpha };
  dropSpecks(mask);
  return { mask, mode };
}

/** The symbol's bounding box (pixels with coverage ≥ 32), or null when the
 *  cut-out left nothing. */
export function maskBounds(mask: Mask): { x: number; y: number; width: number; height: number } | null {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[y * mask.width + x] < 32) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Share of the picture the symbol covers (coverage ≥ 128). */
export function coverageShare(mask: Mask): number {
  let on = 0;
  for (const v of mask.data) if (v >= 128) on += 1;
  return mask.data.length === 0 ? 0 : on / mask.data.length;
}
