// ---------------------------------------------------------------------------
// Registered, masked alignment scoring for the frame-compare tool.
//
// The old score was a raw greyscale mean-abs-diff on two unregistered
// images: a uniform 1–2 px scan offset read as error in every slot, the
// art window (≈40% of the card, always different) dominated the overall
// number, and a slot nudged onto a flat region scored LOWER — the number
// could not be trusted as a target. This module:
//
//   1. turns both images into EDGE maps (Sobel magnitude) — frame geometry
//      is pinlines, plates and box edges, not fill colour;
//   2. REGISTERS the scan to our render globally by cross-correlating the
//      row/column edge projections (art window masked), so a crop/print
//      offset of the scan never counts against a slot;
//   3. scores the FRAME (art, text and stat interiors masked) and each slot
//      as an edge mean-abs-diff after registration — lower is better;
//   4. for each slot, searches a small window for the shift that best
//      matches the scan and reports it as the suggested NUDGE in percent of
//      the card — that is the number the layout editor should apply.
//
// Pure TypeScript over Uint8Array greyscale buffers (no sharp, no DOM) so
// it is unit-tested with synthetic frames of known offsets.
// ---------------------------------------------------------------------------

export type Gray = { width: number; height: number; data: Uint8Array };

export type Rect = {
  topPct: number;
  leftPct: number;
  widthPct: number;
  heightPct: number;
};

export type SlotKind = "art" | "text" | "stat" | "box";

export type AlignSlot = { path: string; rect: Rect; kind: SlotKind };

export type RectPx = { x0: number; y0: number; x1: number; y1: number };

export type SlotScore = {
  /** Edge mean-abs-diff (0–100) inside the slot after global registration. */
  score: number;
  /** The same measure at the best local shift — what the slot would score
   *  after applying the suggested nudge. */
  best: number;
  /** Suggested nudge for OUR layout, in percent of the card: move the slot
   *  right by dxPct / down by dyPct to land on the printed one. */
  dxPct: number;
  dyPct: number;
};

export type AlignResult = {
  global: {
    /** Where the scan sits relative to our render, in pixels of the grid
     *  (positive = the scan's content is right/down of ours). */
    dxPx: number;
    dyPx: number;
    dxPct: number;
    dyPct: number;
    /** Normalised cross-correlation of the projections at the chosen
     *  shift (1 = identical structure). */
    confidence: number;
  };
  /** Frame-only edge diff (0–100): art, text and stat interiors masked. */
  overall: number;
  perSlot: Record<string, SlotScore>;
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Card-percent rect → clamped integer pixel box on a width×height grid. */
export function rectToPx(rect: Rect, width: number, height: number): RectPx {
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
  const x0 = clamp(Math.round((rect.leftPct / 100) * width), width);
  const y0 = clamp(Math.round((rect.topPct / 100) * height), height);
  const x1 = clamp(Math.round(((rect.leftPct + rect.widthPct) / 100) * width), width);
  const y1 = clamp(Math.round(((rect.topPct + rect.heightPct) / 100) * height), height);
  return { x0, y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
}

/** Shrink a pixel box by a fraction of the card width on every side. */
function shrinkPx(box: RectPx, width: number, marginPct: number): RectPx {
  const m = Math.round((marginPct / 100) * width);
  return {
    x0: Math.min(box.x1, box.x0 + m),
    y0: Math.min(box.y1, box.y0 + m),
    x1: Math.max(box.x0, box.x1 - m),
    y1: Math.max(box.y0, box.y1 - m),
  };
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/** 3×3 Sobel magnitude, scaled into 0–255. Border pixels are 0. */
export function edgeMagnitude(img: Gray): Gray {
  const { width, height, data } = img;
  const out = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const tl = data[i - width - 1];
      const t = data[i - width];
      const tr = data[i - width + 1];
      const l = data[i - 1];
      const r = data[i + 1];
      const bl = data[i + width - 1];
      const b = data[i + width];
      const br = data[i + width + 1];
      const gx = -tl - 2 * l - bl + tr + 2 * r + br;
      const gy = -tl - 2 * t - tr + bl + 2 * b + br;
      // An axis-aligned step edge gives |g| = 4·255 on one axis; /4 puts
      // it at 255 (diagonals saturate, which is fine for pinlines).
      const m = (Math.abs(gx) + Math.abs(gy)) / 4;
      out[i] = m > 255 ? 255 : m;
    }
  }
  return { width, height, data: out };
}

// ---------------------------------------------------------------------------
// Masks — 1 = counted, 0 = ignored
// ---------------------------------------------------------------------------

/** A mask that ignores the given pixel boxes. */
export function maskExcluding(
  width: number,
  height: number,
  boxes: RectPx[],
): Uint8Array {
  const mask = new Uint8Array(width * height).fill(1);
  for (const box of boxes) {
    for (let y = box.y0; y < box.y1; y += 1) {
      mask.fill(0, y * width + box.x0, y * width + box.x1);
    }
  }
  return mask;
}

/** Grow a pixel box by `px` on every side (clamped to the grid). */
function dilatePx(box: RectPx, px: number, width: number, height: number): RectPx {
  return {
    x0: Math.max(0, box.x0 - px),
    y0: Math.max(0, box.y0 - px),
    x1: Math.min(width, box.x1 + px),
    y1: Math.min(height, box.y1 + px),
  };
}

/** Boxes that legitimately differ between our render and the scan: the art
 *  windows (grown by the search window — a scan's art crop never lands
 *  exactly on ours); text and stat interiors shrunk by a margin so the
 *  painted box EDGES still count. */
export function contentBoxes(
  slots: AlignSlot[],
  width: number,
  height: number,
  artDilatePx = 0,
): RectPx[] {
  const boxes: RectPx[] = [];
  for (const slot of slots) {
    const px = rectToPx(slot.rect, width, height);
    if (slot.kind === "art") boxes.push(dilatePx(px, artDilatePx, width, height));
    else if (slot.kind === "text" || slot.kind === "stat") {
      boxes.push(shrinkPx(px, width, 0.6));
    }
  }
  return boxes;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Sum of edge values per column ("x") or per row ("y"), masked. */
export function projection(
  edges: Gray,
  axis: "x" | "y",
  mask?: Uint8Array,
): Float64Array {
  const { width, height, data } = edges;
  const out = new Float64Array(axis === "x" ? width : height);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const i = row + x;
      if (mask && mask[i] === 0) continue;
      out[axis === "x" ? x : y] += data[i];
    }
  }
  return out;
}

/** Normalised cross-correlation of a[i] against b[i + shift] over the
 *  overlap (mean-centred). 1 = same shape. */
function ncc(a: Float64Array, b: Float64Array, shift: number): number {
  const n = a.length;
  let count = 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i += 1) {
    const j = i + shift;
    if (j < 0 || j >= n) continue;
    sumA += a[i];
    sumB += b[j];
    count += 1;
  }
  if (count < 8) return -1;
  const meanA = sumA / count;
  const meanB = sumB / count;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i += 1) {
    const j = i + shift;
    if (j < 0 || j >= n) continue;
    const da = a[i] - meanA;
    const db = b[j] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

/** The shift s in [-maxShift, maxShift] with the highest correlation of
 *  a[i] against b[i + s]: positive means b's structure sits s samples to
 *  the RIGHT (or below) a's. */
export function bestShift1D(
  a: Float64Array,
  b: Float64Array,
  maxShift: number,
): { shift: number; score: number } {
  let best = { shift: 0, score: ncc(a, b, 0) };
  for (let s = -maxShift; s <= maxShift; s += 1) {
    if (s === 0) continue;
    const score = ncc(a, b, s);
    if (score > best.score) best = { shift: s, score };
  }
  return best;
}

/** Translate an image by (dx, dy) with zero fill. */
export function shiftImage(img: Gray, dx: number, dy: number): Gray {
  const { width, height, data } = img;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sy = y - dy;
    if (sy < 0 || sy >= height) continue;
    const x0 = Math.max(0, dx);
    const x1 = Math.min(width, width + dx);
    if (x1 <= x0) continue;
    out.set(data.subarray(sy * width + (x0 - dx), sy * width + (x1 - dx)), y * width + x0);
  }
  return { width, height, data: out };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Mean |a − b| over a pixel box (masked), 0–100. Pixels of b are read at
 *  (x + dx, y + dy), so a positive dx compares a against b's content to
 *  the right — the same convention as bestShift1D. */
export function regionDiff(
  a: Gray,
  b: Gray,
  box: RectPx,
  mask?: Uint8Array,
  dx = 0,
  dy = 0,
): number {
  const { width, height } = a;
  let sum = 0;
  let count = 0;
  for (let y = box.y0; y < box.y1; y += 1) {
    const by = y + dy;
    if (by < 0 || by >= height) continue;
    for (let x = box.x0; x < box.x1; x += 1) {
      const bx = x + dx;
      if (bx < 0 || bx >= width) continue;
      const i = y * width + x;
      if (mask && mask[i] === 0) continue;
      sum += Math.abs(a.data[i] - b.data[by * width + bx]);
      count += 1;
    }
  }
  return count === 0 ? 0 : Math.round((sum / count / 255) * 1000) / 10;
}

/** Coarse-to-fine search of the (dx, dy) in ±maxShift that minimises the
 *  edge diff of a's box against b. */
export function bestShift2D(
  a: Gray,
  b: Gray,
  box: RectPx,
  maxShift: number,
  mask?: Uint8Array,
): { dx: number; dy: number; diff: number } {
  let best = { dx: 0, dy: 0, diff: regionDiff(a, b, box, mask, 0, 0) };
  const coarse = Math.max(1, Math.round(maxShift / 5));
  for (let dy = -maxShift; dy <= maxShift; dy += coarse) {
    for (let dx = -maxShift; dx <= maxShift; dx += coarse) {
      if (dx === 0 && dy === 0) continue;
      const diff = regionDiff(a, b, box, mask, dx, dy);
      if (diff < best.diff) best = { dx, dy, diff };
    }
  }
  const { dx: cx, dy: cy } = best;
  for (let dy = cy - coarse; dy <= cy + coarse; dy += 1) {
    for (let dx = cx - coarse; dx <= cx + coarse; dx += 1) {
      if (Math.abs(dx) > maxShift || Math.abs(dy) > maxShift) continue;
      if (dx === cx && dy === cy) continue;
      const diff = regionDiff(a, b, box, mask, dx, dy);
      if (diff < best.diff) best = { dx, dy, diff };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The whole pipeline
// ---------------------------------------------------------------------------

export function alignAndScore(input: {
  ours: Gray;
  scan: Gray;
  slots: AlignSlot[];
  /** Search window for the global and per-slot shifts, % of card width. */
  searchPct?: number;
  /** Printed details our master doesn't draw (the holo stamp's pinline arch
   *  on a borderless rare, 4.9 — scoreExclusionsFor), left out of the
   *  registration, the frame score and every slot score (grown by the
   *  search window, like the art). */
  exclude?: Rect[];
}): AlignResult {
  const { ours, scan, slots } = input;
  const { width, height } = ours;
  if (scan.width !== width || scan.height !== height) {
    throw new Error("alignAndScore: images must share one grid");
  }
  const searchPct = input.searchPct ?? 3;
  const maxShift = Math.max(1, Math.round((searchPct / 100) * width));

  const edgesOurs = edgeMagnitude(ours);
  const edgesScan = edgeMagnitude(scan);

  // Global registration on the frame structure: art masked, text kept (the
  // bars around it dominate the projections).
  const excludeBoxes = (input.exclude ?? []).map((rect) =>
    dilatePx(rectToPx(rect, width, height), maxShift, width, height),
  );
  const excludeMask = excludeBoxes.length > 0 ? maskExcluding(width, height, excludeBoxes) : undefined;
  const artBoxes = slots
    .filter((s) => s.kind === "art")
    .map((s) => dilatePx(rectToPx(s.rect, width, height), maxShift, width, height));
  const artMask = maskExcluding(width, height, [...artBoxes, ...excludeBoxes]);
  const gx = bestShift1D(
    projection(edgesOurs, "x", artMask),
    projection(edgesScan, "x", artMask),
    maxShift,
  );
  const gy = bestShift1D(
    projection(edgesOurs, "y", artMask),
    projection(edgesScan, "y", artMask),
    maxShift,
  );
  // Bring the scan onto our grid.
  const aligned = shiftImage(edgesScan, -gx.shift, -gy.shift);

  const frameMask = maskExcluding(
    width,
    height,
    [...contentBoxes(slots, width, height, maxShift), ...excludeBoxes],
  );
  const overall = regionDiff(
    edgesOurs,
    aligned,
    { x0: 0, y0: 0, x1: width, y1: height },
    frameMask,
  );

  const perSlot: Record<string, SlotScore> = {};
  for (const slot of slots) {
    const box = rectToPx(slot.rect, width, height);
    if (box.x1 - box.x0 < 2 || box.y1 - box.y0 < 2) continue;
    const score = regionDiff(edgesOurs, aligned, box, excludeMask);
    if (slot.kind === "art") {
      perSlot[slot.path] = { score, best: score, dxPct: 0, dyPct: 0 };
      continue;
    }
    const local = bestShift2D(edgesOurs, aligned, box, maxShift, excludeMask);
    perSlot[slot.path] = {
      score,
      best: local.diff,
      dxPct: Math.round((local.dx / width) * 1000) / 10,
      dyPct: Math.round((local.dy / height) * 1000) / 10,
    };
  }

  return {
    global: {
      dxPx: gx.shift,
      dyPx: gy.shift,
      dxPct: Math.round((gx.shift / width) * 1000) / 10,
      dyPct: Math.round((gy.shift / height) * 1000) / 10,
      confidence: Math.round(Math.min(gx.score, gy.score) * 100) / 100,
    },
    overall,
    perSlot,
  };
}

/** Which kind of content a profile slot path holds — decides masking and
 *  whether a nudge is searched. */
export function slotKindFor(path: string): SlotKind {
  if (path === "artSlot" || path.endsWith(".artSlot")) return "art";
  if (
    path === "pt" ||
    path === "loyalty" ||
    path === "defense" ||
    path.endsWith(".pt")
  ) {
    return "stat";
  }
  if (path === "costRect" || path === "symbolRect") return "box";
  return "text";
}

/** Where Scryfall's holo-stamp prints on a borderless rare or mythic (4.32):
 *  the oval sits in an ARCH of the rules-box pinline (x ≈ 656–850 px on 1500,
 *  top ≈ 1905 px against the straight pinline at ≈ 1945; FRA #447, FDN #292;
 *  print review 2026-09-26), with the stamp below it in the bottom bar. Our
 *  Card Conjurer master's pinline is straight — 4.9's stamp overlay must draw
 *  the arch — so until then the score leaves this box out. */
export const HOLO_STAMP_ARCH: Rect = { topPct: 90, leftPct: 42.67, widthPct: 14.67, heightPct: 5.24 };

/** The printed details a template's master doesn't draw, left out of its
 *  alignment score (alignAndScore's `exclude`). */
export function scoreExclusionsFor(template: string): Rect[] {
  return template === "m15borderless" || template === "m15borderlessartifact" ? [HOLO_STAMP_ARCH] : [];
}
