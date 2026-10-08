// ---------------------------------------------------------------------------
// print-cut.mjs — two importer steps the 1997 frame needed (TODO 4.10a; era
// design 2026-10-06, proof 1 of 2026-10-07), generic and free of any pack's
// data (scripts/lib/seventh-1997.mjs holds the Seventh recipes; cc-frames.mjs
// re-exports both):
//
//   1. the PIECEWISE-LINEAR RE-CUT — a drawing moved onto the prints EDGE BY
//      EDGE. A block move (recutBand, recutBlockUp, shiftBlocksRgba8) slides
//      whole rows through a flat zone; one scale per axis moves every edge by
//      the same rule. Neither puts six edges per axis where six prints'
//      edges are when each is off by its own amount (Card Conjurer's Seventh
//      against the 1996–2003 prints: − 6.5 … + 9.0 px, and the text box's
//      edges differ BY COLOUR). Here each axis is one piecewise-linear map
//      through its anchors (an edge's place in the source → its place on the
//      prints), slope 1 outside the outermost anchors; the columns have two
//      maps — the art rows' and the text-box rows' — lerped across the type
//      band, so the window and the box each take their own left and right.
//      Resampled once, Catmull-Rom, premultiplied.
//
//   2. the REGION TONE with an OFFSET — toneMasked / toneRegion multiply a
//      region's colour by a gain. A gain is the wrong tool where a region's
//      mean has to move and its contrast must not (the Seventh black frame
//      needs × 1.23 / 1.77 / 1.43: its grain doubles and the highlights turn
//      mint). Here a region is toned
//        out = (in − from) × k + to        per channel   (an "affine" region)
//      — `from` the region's mean in the drawing, `to` the prints' mean,
//      `k` the prints' texture contrast over the drawing's — or, where no
//      `k` is given (a bevel side, a trim side, a ring), by the plain
//      per-channel gain to ÷ from.
//
// Both work on raw 8-bit RGBA and return new buffers. Pure JS, no sharp: the
// same bytes on every machine.
// ---------------------------------------------------------------------------

/**
 * The inverse map of a piecewise-linear re-cut along one axis: for each
 * output coordinate 0 … n − 1, the SOURCE coordinate it reads. `anchors` is
 * a list of `[from, to]` — an edge at `from` in the source lands at `to` —
 * in any order; linear between neighbours, slope 1 beyond the first and the
 * last (the border and the bleed are never stretched).
 */
export function piecewiseMap(anchors, n) {
  if (!Array.isArray(anchors) || anchors.length < 2) throw new Error("piecewiseMap: at least two anchors");
  const sorted = [...anchors].sort((a, b) => a[1] - b[1]);
  for (let i = 1; i < sorted.length; i += 1) {
    if (!(sorted[i][1] > sorted[i - 1][1]) || !(sorted[i][0] > sorted[i - 1][0])) {
      throw new Error(`piecewiseMap: anchors must keep their order (${JSON.stringify(sorted[i - 1])} then ${JSON.stringify(sorted[i])})`);
    }
  }
  const out = new Float64Array(n);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let seg = 0;
  for (let x = 0; x < n; x += 1) {
    if (x <= first[1]) out[x] = first[0] + (x - first[1]);
    else if (x >= last[1]) out[x] = last[0] + (x - last[1]);
    else {
      while (sorted[seg + 1][1] < x) seg += 1;
      const [s0, d0] = sorted[seg];
      const [s1, d1] = sorted[seg + 1];
      out[x] = s0 + ((x - d0) / (d1 - d0)) * (s1 - s0);
    }
  }
  return out;
}

/** The largest and smallest local stretch of a map (output px per source
 *  px) between its anchors — what a recipe's notes and tests quote. */
export function stretchRange(anchors) {
  const sorted = [...anchors].sort((a, b) => a[1] - b[1]);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < sorted.length; i += 1) {
    const s = (sorted[i][1] - sorted[i - 1][1]) / (sorted[i][0] - sorted[i - 1][0]);
    min = Math.min(min, s);
    max = Math.max(max, s);
  }
  return { min, max };
}

/**
 * A re-cut's maps on a `width × height` image. `cut`:
 *   y        anchors of the rows;
 *   xUpper   anchors of the columns on the rows above `lerpRows[0]` (the art
 *            window's left and right);
 *   xLower   … on the rows below `lerpRows[1]` (the text box's);
 *   lerpRows the OUTPUT rows across which the two column maps are lerped
 *            (the type band: no vertical line crosses it but the outer
 *            frame's, which both maps place alike).
 */
export function cutMaps(cut, width, height) {
  const { y, xUpper, xLower = xUpper, lerpRows = [0, 1] } = cut;
  const [y0, y1] = lerpRows;
  if (!(y1 > y0)) throw new Error(`cutMaps: bad lerp rows ${lerpRows}`);
  const share = new Float64Array(height);
  for (let r = 0; r < height; r += 1) share[r] = Math.min(1, Math.max(0, (r - y0) / (y1 - y0)));
  return {
    width,
    height,
    srcY: piecewiseMap(y, height),
    upper: piecewiseMap(xUpper, width),
    lower: piecewiseMap(xLower, width),
    share,
  };
}

// Catmull-Rom weights of the four taps at −1, 0, 1, 2 for a fraction t.
function crWeights(t, w) {
  const t2 = t * t;
  const t3 = t2 * t;
  w[0] = -0.5 * t3 + t2 - 0.5 * t;
  w[1] = 1.5 * t3 - 2.5 * t2 + 1;
  w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  w[3] = 0.5 * t3 - 0.5 * t2;
}

/** Resample `channels` interleaved float planes through the maps: rows
 *  first, then columns (each row its own lerp of the two column maps);
 *  taps clamped to the image. */
function resample(src, channels, { width, height, srcY, upper, lower, share }) {
  const w = new Float64Array(4);
  const rows = new Float32Array(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    const f = Math.floor(srcY[y]);
    crWeights(srcY[y] - f, w);
    const o = y * width * channels;
    for (let k = 0; k < 4; k += 1) {
      const sy = Math.min(height - 1, Math.max(0, f + k - 1));
      const s = sy * width * channels;
      const wk = w[k];
      if (wk === 0) continue;
      for (let i = 0; i < width * channels; i += 1) rows[o + i] += src[s + i] * wk;
    }
  }
  const out = new Float32Array(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    const t = share[y];
    const row = y * width * channels;
    for (let x = 0; x < width; x += 1) {
      const sx = upper[x] * (1 - t) + lower[x] * t;
      const f = Math.floor(sx);
      crWeights(sx - f, w);
      const o = row + x * channels;
      for (let k = 0; k < 4; k += 1) {
        const s = row + Math.min(width - 1, Math.max(0, f + k - 1)) * channels;
        const wk = w[k];
        for (let c = 0; c < channels; c += 1) out[o + c] += rows[s + c] * wk;
      }
    }
  }
  return out;
}

/** Re-cut an 8-bit RGBA image through `maps` (cutMaps). Premultiplied
 *  through the resample, so a clear art window never bleeds its colour into
 *  the frame's edge. Returns a new Buffer. */
export function recutPiecewise(buf, maps) {
  const { width, height } = maps;
  const n = width * height;
  if (buf.length !== n * 4) throw new Error(`recutPiecewise: the image is not ${width}x${height} RGBA`);
  const pm = new Float32Array(n * 4);
  for (let p = 0; p < n; p += 1) {
    const o = p * 4;
    const a = buf[o + 3] / 255;
    pm[o] = buf[o] * a;
    pm[o + 1] = buf[o + 1] * a;
    pm[o + 2] = buf[o + 2] * a;
    pm[o + 3] = buf[o + 3];
  }
  const res = resample(pm, 4, maps);
  const out = Buffer.alloc(n * 4);
  for (let p = 0; p < n; p += 1) {
    const o = p * 4;
    const al = Math.min(255, Math.max(0, res[o + 3]));
    if (al > 0.5) {
      const inv = 1 / Math.max(al / 255, 1e-4);
      for (let c = 0; c < 3; c += 1) out[o + c] = Math.min(255, Math.max(0, Math.round(res[o + c] * inv)));
    }
    out[o + 3] = Math.round(al);
  }
  return out;
}

/** Flatten a master's already-cut card corners onto black, in the four
 *  `reach` px squares at the card's corners: a source whose corners were
 *  rounded before (the MSE gold) would carry that arc INTO the card when it
 *  is moved; the importer cuts the one corner again after the re-cut.
 *  Returns a new Buffer. */
export function squareCornersOnBlack(buf, width, height, reach = 96) {
  const out = Buffer.from(buf);
  for (const [x0, y0] of [
    [0, 0],
    [width - reach, 0],
    [0, height - reach],
    [width - reach, height - reach],
  ]) {
    for (let y = y0; y < y0 + reach; y += 1) {
      for (let x = x0; x < x0 + reach; x += 1) {
        const o = (y * width + x) * 4;
        const a = out[o + 3];
        if (a === 255) continue;
        for (let c = 0; c < 3; c += 1) out[o + c] = Math.round((out[o + c] * a) / 255);
        out[o + 3] = 255;
      }
    }
  }
  return out;
}

/** Re-cut one float plane (a region's coverage, 0 … 1) through `maps`;
 *  clamped to 0 … 1. */
export function recutPlane(plane, maps) {
  const res = resample(plane, 1, maps);
  for (let i = 0; i < res.length; i += 1) res[i] = res[i] < 0 ? 0 : res[i] > 1 ? 1 : res[i];
  return res;
}

/** A plane's coverage as bytes (what a region is stored and applied as). */
export function planeToBytes(plane) {
  const out = new Uint8Array(plane.length);
  for (let i = 0; i < plane.length; i += 1) out[i] = Math.round(Math.min(1, Math.max(0, plane[i])) * 255);
  return out;
}

/** A solid rectangle's coverage: 1 on columns x0 … x1 − 1, rows y0 … y1 − 1. */
export function rectPlane([x0, y0, x1, y1], width, height) {
  const m = new Float32Array(width * height);
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y += 1) m.fill(1, y * width + Math.max(0, x0), y * width + Math.min(width, x1));
  return m;
}

/** The four sides (L, T, R, B) of the ring between an outer rectangle and
 *  an inner one, split on the mitres: a ring pixel belongs to the side it is
 *  nearest, measured as a share of that side's width. */
export function ringSidePlanes(outer, inner, width, height) {
  const sides = { L: new Float32Array(width * height), T: new Float32Array(width * height), R: new Float32Array(width * height), B: new Float32Array(width * height) };
  const names = ["L", "T", "R", "B"];
  for (let y = Math.max(0, outer[1]); y < Math.min(height, outer[3]); y += 1) {
    for (let x = Math.max(0, outer[0]); x < Math.min(width, outer[2]); x += 1) {
      if (x >= inner[0] && x < inner[2] && y >= inner[1] && y < inner[3]) continue;
      const d = [
        (x - outer[0]) / (inner[0] - outer[0]),
        (y - outer[1]) / (inner[1] - outer[1]),
        (outer[2] - 1 - x) / (outer[2] - inner[2]),
        (outer[3] - 1 - y) / (outer[3] - inner[3]),
      ];
      let side = 0;
      for (let k = 1; k < 4; k += 1) if (d[k] < d[side]) side = k;
      sides[names[side]][y * width + x] = 1;
    }
  }
  return sides;
}

/** BT.709 luma of an 8-bit RGBA image, as a float plane (0 … 255). */
export function lumaPlane(buf, width, height) {
  const L = new Float32Array(width * height);
  for (let p = 0; p < width * height; p += 1) L[p] = 0.2126 * buf[p * 4] + 0.7152 * buf[p * 4 + 1] + 0.0722 * buf[p * 4 + 2];
  return L;
}

/** A small true Gaussian blur of a float plane (σ < 2.5 px), edges
 *  replicated. */
export function blurPlane(plane, width, height, sigma) {
  const r = Math.floor(3 * sigma + 0.5);
  const k = new Float64Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i += 1) {
    k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += k[i + r];
  }
  for (let i = 0; i < k.length; i += 1) k[i] /= sum;
  const tmp = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let v = 0;
      for (let i = -r; i <= r; i += 1) v += plane[Math.min(height - 1, Math.max(0, y + i)) * width + x] * k[i + r];
      tmp[y * width + x] = v;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let v = 0;
      for (let i = -r; i <= r; i += 1) v += tmp[y * width + Math.min(width - 1, Math.max(0, x + i))] * k[i + r];
      out[y * width + x] = v;
    }
  }
  return out;
}

/** The median of a plane over a rectangle. */
export function medianIn(plane, width, [x0, y0, x1, y1]) {
  const v = [];
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) v.push(plane[y * width + x]);
  v.sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const isRgb = (v) => Array.isArray(v) && v.length === 3 && v.every((c) => Number.isFinite(c) && c >= 0 && c <= 255);

/** One region's tone, checked: `{ from, to }` (a gain) or `{ from, to, k }`
 *  (mean and contrast). */
export function checkRegionTone(name, tone) {
  if (!tone || !isRgb(tone.from) || !isRgb(tone.to)) throw new Error(`toneRegions: ${name} needs from / to as RGB (0–255)`);
  if (tone.k !== undefined && !(Number.isFinite(tone.k) && tone.k > 0 && tone.k <= 2)) throw new Error(`toneRegions: ${name} has a bad contrast k ${tone.k}`);
  return tone;
}

/** The per-channel gain of a region's tone: to ÷ from (from floored at 1). */
export function regionGain(tone) {
  return tone.to.map((t, c) => t / Math.max(tone.from[c], 1));
}

/**
 * Tone an 8-bit RGBA image region by region. `regions` maps a name to its
 * coverage (bytes, 0 … 255, the image's size); `tones` maps the same names
 * to `{ from, to, k? }`. Every region is first multiplied by its gain
 * (weights summed where two regions' soft edges overlap); then each region
 * WITH a `k`, in the table's order, replaces what its coverage holds by
 * `(in − from) × k + to` of the UNTONED pixel. Alpha kept; rounded, clamped.
 * A region with no tone, or a tone with no region, throws: the table is
 * the recipe.
 */
export function toneRegions(buf, width, height, regions, tones) {
  const n = width * height;
  if (buf.length !== n * 4) throw new Error(`toneRegions: the image is not ${width}x${height} RGBA`);
  const names = Object.keys(tones);
  for (const name of Object.keys(regions)) if (!tones[name]) throw new Error(`toneRegions: region ${name} has no tone`);
  for (const name of names) {
    checkRegionTone(name, tones[name]);
    if (!regions[name] || regions[name].length !== n) throw new Error(`toneRegions: tone ${name} has no ${width}x${height} region`);
  }
  const acc = new Float32Array(n * 3);
  const mult = new Float32Array(n * 3).fill(1);
  for (const name of names) {
    const g = regionGain(tones[name]);
    const m = regions[name];
    for (let p = 0; p < n; p += 1) {
      if (m[p] === 0) continue;
      const w = m[p] / 255;
      mult[p * 3] += w * (g[0] - 1);
      mult[p * 3 + 1] += w * (g[1] - 1);
      mult[p * 3 + 2] += w * (g[2] - 1);
    }
  }
  for (let p = 0; p < n; p += 1) for (let c = 0; c < 3; c += 1) acc[p * 3 + c] = buf[p * 4 + c] * mult[p * 3 + c];
  for (const name of names) {
    const { from, to, k } = tones[name];
    if (k === undefined) continue;
    const m = regions[name];
    for (let p = 0; p < n; p += 1) {
      if (m[p] === 0) continue;
      const w = m[p] / 255;
      for (let c = 0; c < 3; c += 1) acc[p * 3 + c] = acc[p * 3 + c] * (1 - w) + ((buf[p * 4 + c] - from[c]) * k + to[c]) * w;
    }
  }
  const out = Buffer.from(buf);
  for (let p = 0; p < n; p += 1) for (let c = 0; c < 3; c += 1) out[p * 4 + c] = Math.min(255, Math.max(0, Math.round(acc[p * 3 + c])));
  return out;
}

/** How provenance prints a region tone table: name → "×r/g/b" or
 *  "mean a,b,c → d,e,f, contrast ×k". */
export function describeRegionTones(tones) {
  return Object.fromEntries(
    Object.entries(tones).map(([name, t]) => [
      name,
      t.k === undefined
        ? `× ${regionGain(t).map((g) => g.toFixed(3)).join(" / ")} (${t.from.join(", ")} → ${t.to.join(", ")})`
        : `(in − ${t.from.join(", ")}) × ${t.k} + ${t.to.join(", ")}`,
    ]),
  );
}
