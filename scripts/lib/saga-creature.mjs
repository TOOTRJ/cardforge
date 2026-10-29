// ---------------------------------------------------------------------------
// The SAGA CREATURE body's recipe (TODO 4.5d) — DATA and pure pixel
// functions for scripts/build-saga-creature-frames.mjs (and its unit test).
//
// Final Fantasy's "Summon:" cards (FIN / FIC / PFIN, 2025) print a saga that
// is also a creature on a body no Card Conjurer or MSE pack draws: the
// TEXTURED (Nyx) saga — the frame field a starfield — with
//   • the reminder as a full-width BAND under the title bar (237–433 px; the
//     art window starts under it, its top outline at 433–438 on the prints);
//   • the chapter rail and the art column from there to the type bar;
//   • the type bar RAISED 173 px (its outline at 1587–1722 px on 22 of 22
//     black-bordered prints read; 1759–1895 on the saga master);
//   • a second text box under it (1723–≈1947 px: the creature's own
//     abilities or its flavour, one centred line on every print) on the
//     black border, as M15's box is, and the P/T plate at M15's spot.
//
// Ours is a COMPOSITE, every number below (HD px of a 1500 × 2100 card):
//
//   1. Card Conjurer's TEXTURED saga ('Nyx Frames', packSagaNyx.js,
//      img/frames/saga/nyx/<k>.png at the pinned commit — w u b r g m, and
//      its 'Artifact Frame' a.png as our `c`): read from the CC cache like a
//      mask, never published as it is.
//   2. ROWS CUT (BAND_CUT, RAIL_CUT): 165 rows out of the reminder box's
//      middle — the box, both frame sides and the window lose them alike,
//      so the reminder box's foot lands on the band's foot (433 px) — and 8
//      more out of the rail's straight middle, so the type bar lands 173 px
//      up. The FOLD's columns (FOLD_SQUEEZE) are squeezed instead: its curl
//      runs all the way down the box, and the prints draw it shorter.
//   3. THE BAND: the window's columns over the band's rows painted with the
//      box's own paper (`reflectInto`: each column mirrored back into the
//      paper's span, so the paper meets itself with no seam), and the
//      window's top outline drawn under it (WINDOW_TOP_RULE: the master's
//      own 4 px black, at the prints' 434–437).
//   4. FROM THE BOX DOWN (LOWER_FROM): the published m15nyx/<k> master's
//      rows, in place — the box's side and bottom rims, the inner shadow on
//      its right, the frame field beside it, the black border and the
//      corners are M15's — with the box's TOP rim and inner shadow, which
//      m15nyx draws under its own type bar, copied up under ours (BOX_TOP)
//      and the box's paper (BOX_PAPER) taken from the textured saga's
//      chapter column: paper of one pack with the rail's.
//
// The P/T plates are m15nyx's (the profile reads them): no new plate.
// No scan is read by a build: the numbers here were read off Scryfall's
// PNGs at 1500 × 2100 (2026-10-28; design-backup/saga-creature).
// ---------------------------------------------------------------------------

/** The masters' size. */
export const W = 1500;
export const H = 2100;

/** The template. */
export const TEMPLATE = "sagacreature";

/** The keys built, each → its textured-saga file and its m15nyx master. */
export const SAGA_CREATURE_KEYS = Object.freeze(["w", "u", "b", "r", "g", "m", "c"]);
export const TEXTURED_SAGA_FILE = Object.freeze({
  w: "img/frames/saga/nyx/w.png",
  u: "img/frames/saga/nyx/u.png",
  b: "img/frames/saga/nyx/b.png",
  r: "img/frames/saga/nyx/r.png",
  g: "img/frames/saga/nyx/g.png",
  m: "img/frames/saga/nyx/m.png",
  /** The pack's 'Artifact Frame' (silver): FIN #1 Summon: Bahamut's frame is
   *  the silver starfield. (Its rail and box let the art through on print —
   *  not built: an owner question.) */
  c: "img/frames/saga/nyx/a.png",
});

/** Rows cut out of the textured saga, top to bottom: [first row, count].
 *  BAND_CUT: the reminder box's middle (its paper, both frame sides, the
 *  window; the fold's columns are FOLD_SQUEEZE's) — the box ran 237–597, the
 *  band runs 237–432. RAIL_CUT: the rail's straight middle
 *  (the ribbon's straight run, the paper, the window). 165 + 8 = 173: the
 *  type bar's outline 1759–1895 → 1586–1722 (prints 1587–1722). */
export const BAND_CUT = Object.freeze([380, 165]);
export const RAIL_CUT = Object.freeze([1100, 8]);
export const ROWS_CUT = BAND_CUT[1] + RAIL_CUT[1];

/** The FOLD: left of `x1` the reminder box's rows are not cut but SQUEEZED
 *  (rows `from`–`to` of the saga resampled into the band's), since the
 *  ribbon's fold curls all the way down them (from x ≈ 40 at 250 px to the
 *  paper at x 151 at 596): the prints draw the same curl, shorter (the band's
 *  238–432). Faded into the cut columns over `fade` px of paper. */
export const FOLD_SQUEEZE = Object.freeze({ x1: 176, from: 237, to: 597, fade: 16 });

/** The band: the window's columns from the paper's shadow strip (735) to the
 *  window's right outline (1385, kept) over the band's rows. */
export const BAND_FILL = Object.freeze({ x0: 733, x1: 1385, y0: 237, y1: 434 });
/** The paper the band is painted from, mirrored into: the reminder box's
 *  columns clear of the fold (≥ 160) and of the shadow strip (≤ 730). */
export const BAND_PAPER_SPAN = Object.freeze([160, 730]);
/** The window's new top outline: the master's 4 px black (its own top rule
 *  is rows 233–236), from the window's left outline (741) to its right
 *  (1388), on the prints' 434–437 (they read 433–438 through Scryfall's
 *  resampling). */
export const WINDOW_TOP_RULE = Object.freeze({ x0: 741, x1: 1389, y0: 434, y1: 438, rgba: Object.freeze([0, 0, 0, 255]) });

/** From this row down the master is m15nyx's (the box's top edge lies under
 *  the raised bar's bottom outline, 1719–1722). */
export const LOWER_FROM = 1723;
/** The box's TOP: m15nyx draws its rim (1304–1313) and inner shadow
 *  (1314–1322) under its own type bar; copied to under ours, the box's
 *  columns (its left rim from 98 to its right bevel to 1409). */
export const BOX_TOP = Object.freeze({ from: 1304, to: 1323, x0: 98, x1: 1410 });
/** The box's paper: m15nyx's paper (x 110–1382 — from the left rim's end
 *  to the right inner shadow — × y under the copied top to the bottom rim at
 *  1938) taken from the cut saga's chapter column (rows 700+, clear of the
 *  ribbon from 166), each column mirrored into the span. */
export const BOX_PAPER = Object.freeze({
  rect: Object.freeze({ x0: 110, x1: 1383, y0: LOWER_FROM + (BOX_TOP.to - BOX_TOP.from), y1: 1938 }),
  fromRow: 700,
  span: Object.freeze([175, 728]),
});

/** The fold's columns: `squeezed` (the saga's rows FOLD_SQUEEZE.from–to
 *  resampled into the band's rows, same columns) laid over the cut master
 *  left of x1, faded out over the last `fade` columns. In place. */
export function layFold(out, squeezed, width = W, fold = FOLD_SQUEEZE) {
  const rows = fold.to - fold.from - BAND_CUT[1];
  let n = 0;
  for (let r = 0; r < rows; r += 1) {
    const y = fold.from + r;
    for (let x = 0; x < fold.x1; x += 1) {
      const w = x < fold.x1 - fold.fade ? 1 : (fold.x1 - x) / (fold.fade + 1);
      lerp(out, (y * width + x) * 4, squeezed, (r * fold.x1 + x) * 4, w);
      n += 1;
    }
  }
  return n;
}

/** `x` folded into [a, b] by mirroring at each end (a triangle wave):
 *  continuous, so the paper meets itself with no seam. */
export function reflectInto(x, a, b) {
  const span = b - a;
  let t = (x - a) % (2 * span);
  if (t < 0) t += 2 * span;
  return a + (t <= span ? t : 2 * span - t);
}

/** An RGBA buffer with rows cut out (`cuts`: [first row, count], in the
 *  ORIGINAL rows), the rows below moved up and transparent rows at the foot. */
export function cutRows(buf, width, height, cuts) {
  const drop = new Uint8Array(height);
  for (const [from, count] of cuts) for (let y = from; y < from + count; y += 1) drop[y] = 1;
  const out = Buffer.alloc(width * height * 4);
  let to = 0;
  for (let y = 0; y < height; y += 1) {
    if (drop[y]) continue;
    buf.copy(out, to * width * 4, y * width * 4, (y + 1) * width * 4);
    to += 1;
  }
  return out;
}

/** The band's paper: every pixel of `fill` taken from the same row of `buf`
 *  at the column mirrored into `span`. In place; returns the pixel count. */
export function paintBand(buf, width, fill = BAND_FILL, span = BAND_PAPER_SPAN) {
  let n = 0;
  for (let y = fill.y0; y < fill.y1; y += 1) {
    for (let x = fill.x0; x < fill.x1; x += 1) {
      const sx = reflectInto(x, span[0], span[1]);
      buf.copy(buf, (y * width + x) * 4, (y * width + sx) * 4, (y * width + sx) * 4 + 4);
      n += 1;
    }
  }
  return n;
}

/** A solid rule. In place; returns the pixel count. */
export function drawRule(buf, width, rule = WINDOW_TOP_RULE) {
  let n = 0;
  for (let y = rule.y0; y < rule.y1; y += 1) {
    for (let x = rule.x0; x < rule.x1; x += 1) {
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c += 1) buf[o + c] = rule.rgba[c];
      n += 1;
    }
  }
  return n;
}

/**
 * The rows from LOWER_FROM down: m15nyx's pixels, its box's top rim and
 * inner shadow copied up from under its own bar (BOX_TOP), its box's paper
 * taken from the cut saga's (`saga`) chapter column (BOX_PAPER). In place on
 * `out` (the cut saga); returns the pixel counts.
 */
export function composeLower(out, saga, m15, width = W, height = H) {
  const start = LOWER_FROM * width * 4;
  m15.copy(out, start, start, width * height * 4);
  let top = 0;
  for (let r = 0; r < BOX_TOP.to - BOX_TOP.from; r += 1) {
    const from = ((BOX_TOP.from + r) * width + BOX_TOP.x0) * 4;
    m15.copy(out, ((LOWER_FROM + r) * width + BOX_TOP.x0) * 4, from, from + (BOX_TOP.x1 - BOX_TOP.x0) * 4);
    top += BOX_TOP.x1 - BOX_TOP.x0;
  }
  let paper = 0;
  const box = BOX_PAPER.rect;
  for (let y = box.y0; y < box.y1; y += 1) {
    const sy = BOX_PAPER.fromRow + (y - box.y0);
    for (let x = box.x0; x < box.x1; x += 1) {
      const s = (sy * width + reflectInto(x, BOX_PAPER.span[0], BOX_PAPER.span[1])) * 4;
      saga.copy(out, (y * width + x) * 4, s, s + 4);
      paper += 1;
    }
  }
  return { m15: (height - LOWER_FROM) * width, top, paper };
}

function lerp(dst, o, src, s, w) {
  for (let c = 0; c < 4; c += 1) dst[o + c] = Math.round(dst[o + c] * (1 - w) + src[s + c] * w);
}
