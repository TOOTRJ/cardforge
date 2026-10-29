// ---------------------------------------------------------------------------
// The holofoil stamp's notch on the BORDERLESS frames (TODO 4.9d, owner Round
// 66, 2026-10-14) — what the prints measured, as DATA, and the recipe that
// builds the pieces (scripts/build-borderless-stamp.mjs). No scan and no Card
// Conjurer piece is read by the build: the arch is the published master's OWN
// bar lifted along the printed curve below.
//
// Measured 2026-10-15 on Scryfall PNGs (745 x 1040) resampled to 1500 x 2100
// with lanczos (measuring only; nothing committed):
//   • the arch — fourteen stamped borderless printings Scryfall serves as
//     clean renders (HOC #11 / #45 / #85, FRA #329 / #378, SOC #428, EOC #1 /
//     #2, DSK #344 / #366, FDN #298 / #348, EOE #299, LMAR #6): the straight
//     pinline's rim ends on the black bottom bar at 1948.6 px (our masters'
//     boundary is 1948.0: rows 1937–1947 are the rim, 1948 on the black), and
//     the rim's lower edge rises from x 666 to 32.6 px above it at the centre
//     (1916.0 px, x 738–762), back down by x 834 — symmetric about x 750
//     within 1–2.6 px (the left and right sides are averaged below). The
//     printed arch is the bar lifted: its rim and bevel keep the bar's
//     vertical thickness on the slopes, as Card Conjurer's bordered arch does.
//     The physical scans agree where they can be read (FDN #376: the rim's
//     lower edge at 1917 px at the centre).
//   • the oval — on the physical scans it sits where the bordered frame's
//     does (M15_HOLO_STAMP_OVAL, 683–817 x 1926–1993: FDN #376 1928/1930–1991,
//     MH2 #321 1928–1994, M21 #318 1931–1998 within the scans' ±5 px), so the
//     borderless slot draws the same oval; Scryfall's clean renders draw it
//     7 px higher on the bordered and the borderless frames alike
//     (1919–1986), which no physical print shows.
//   • the collector line — the borderless prints set both lines exactly where
//     the bordered ones do (the clean renders: line 1's ink 1965–1988, line 2's
//     2003–2026, from x 99, on the borderless printings AND their bordered
//     twins; the © line ends at x 1394–1395, on line 2 beside a P/T plate and
//     on line 1 without one — INR #311, 2X2 #381), white on the black bar.
//
// The pieces (one per master the card can be drawn on; the masters that share
// the bar's pixels share a piece — checked by the build):
//   m15borderlessholostamp/<w u b r g m c>   m15borderless/<key> (+ the
//                                            artifact dress and both crowned
//                                            twins: the same pixels there)
//   m15borderlessholostamp/a                 m15borderlessartifact/c (the
//                                            colourless artifact's silver)
//   m15borderlessholostamp/<pair>            m15borderless/<pair> (the split
//                                            pinline; the hybrid dress, the
//                                            artifact pairs and the crowned
//                                            twins hold the same bar)
//   m15borderlesslandholostamp/<key|pair>    m15borderlessland/<key|pair>
//                                            (the land's tinted box and bevel)
//   m15borderlessstationholostamp/<key>      m15borderlessstation/<key> (+ its
//                                            crowned twin: the station box)
// ---------------------------------------------------------------------------

import { PREPARE_STAMP } from "./prepare-2026.mjs";

/** The ten two-colour pairs in printed order (TWO_COLOR_PAIRS). */
export const BORDERLESS_STAMP_PAIRS = ["wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"];

/** The printed arch: how far the bar is lifted (HD px) at |x − 750| = d, for
 *  d = 0, 2, 4, … (linear in between; 0 from the last entry on). The means
 *  of the two sides over the fourteen clean renders, smoothed over three
 *  samples (1-2-1). */
export const ARCH_LIFT_STEP_PX = 2;
export const ARCH_LIFT_PX = Object.freeze([
  32.6, 32.6, 32.6, 32.5, 32.5, 32.4, 32.4, 32.3, 32.0, 31.7, 31.3, 30.9, 30.6, 30.4, 30.1, 29.6, 29.1, 28.5, 27.8, 27.2,
  26.6, 25.9, 25.1, 24.3, 23.5, 22.6, 21.7, 20.8, 19.7, 18.6, 17.5, 16.4, 15.3, 14.1, 12.7, 11.2, 9.7, 8.2, 6.6, 4.8,
  3.0, 1.4, 0.4, 0.1, 0,
]);
export const ARCH_CENTER_X = 750;

/** The lift at card column `x` (the pixel's centre, x + 0.5). */
export function archLiftAt(x, table = ARCH_LIFT_PX) {
  const d = Math.abs(x + 0.5 - ARCH_CENTER_X) / ARCH_LIFT_STEP_PX;
  const i = Math.floor(d);
  if (i >= table.length - 1) return 0;
  const t = d - i;
  return table[i] * (1 - t) + table[i + 1] * t;
}

/** The first row of the masters' black bottom bar under the pinline (every
 *  borderless spell, artifact, land and station master: rim 1937–1947). The
 *  piece never paints at or below it. */
export const BLACK_BAR_TOP = 1948;

/** The piece's box on the 1500 x 2100 card (whole, even px: the 750 bake
 *  halves it exactly). Every pixel the recipe paints is inside it; the build
 *  refuses a piece that would paint outside. */
export const BORDERLESS_NOTCH_BOX = Object.freeze({ x: 660, y: 1896, width: 180, height: 52 });

/** The pieces, by bucket folder: `keys` → the master (template/key) each is
 *  built over, and `sharedBy` the other masters drawn under the same key,
 *  whose pixels in the region the piece reads must be the source's within
 *  `tolerance` (else the build refuses: that master needs its own key). */
export const BORDERLESS_STAMP_FOLDERS = {
  m15borderlessholostamp: {
    keys: {
      ...Object.fromEntries(["w", "u", "b", "r", "g", "m", "c"].map((k) => [k, `m15borderless/${k}`])),
      a: "m15borderlessartifact/c",
      ...Object.fromEntries(BORDERLESS_STAMP_PAIRS.map((p) => [p, `m15borderless/${p}`])),
    },
    sharedBy: {
      ...Object.fromEntries(["w", "u", "b", "r", "g", "m"].map((k) => [k, [`m15borderless/${k}-legendary`, `m15borderlessartifact/${k}`, `m15borderlessartifact/${k}-legendary`]])),
      c: ["m15borderless/c-legendary"],
      a: ["m15borderlessartifact/c-legendary"],
      ...Object.fromEntries(
        BORDERLESS_STAMP_PAIRS.map((p) => [
          p,
          [`m15borderless/${p}-legendary`, `m15borderless/${p}-h`, `m15borderless/${p}-h-legendary`, `m15borderlessartifact/${p}`, `m15borderlessartifact/${p}-legendary`],
        ]),
      ),
    },
  },
  m15borderlesslandholostamp: {
    keys: Object.fromEntries([...["w", "u", "b", "r", "g", "m", "c"], ...BORDERLESS_STAMP_PAIRS].map((k) => [k, `m15borderlessland/${k}`])),
    sharedBy: {},
  },
  m15borderlessstationholostamp: {
    keys: Object.fromEntries(["w", "u", "b", "r", "g", "m", "c"].map((k) => [k, `m15borderlessstation/${k}`])),
    sharedBy: Object.fromEntries(["w", "u", "b", "r", "g", "m", "c"].map((k) => [k, [`m15borderlessstation/${k}-legendary`]])),
  },
};

/** How far a shared master may differ from the source in the region the
 *  piece reads (8-bit levels, any channel): the hybrid dress's one pixel at
 *  x 634 is outside it; nothing else differs. */
export const SHARED_TOLERANCE = 2;

/** The rows the piece reads from its master: its own box, and every row a
 *  lift reaches down to (the black bar). */
export const READ_ROWS = Object.freeze([BORDERLESS_NOTCH_BOX.y, BLACK_BAR_TOP]);

/** The borderless spells', artifact's, land's and station's arch: the lift
 *  table, the first black row under the pinline and the piece's box — what
 *  every function below reads (their default). */
/** @typedef {{ lift: readonly number[]; barTop: number; box: { x: number; y: number; width: number; height: number }; boxAlphaRow?: number; liftTop?: number }} ArchSpec */
/** @type {ArchSpec} */
export const BORDERLESS_ARCH = Object.freeze({ lift: ARCH_LIFT_PX, barTop: BLACK_BAR_TOP, box: BORDERLESS_NOTCH_BOX });

// ---------------------------------------------------------------------------
// The BORDERLESS PLANESWALKERS' arch (TODO 4.9d, owner Round 70: "Build them
// next"). Measured 2026-10-16 on Scryfall PNGs (745 x 1040) resampled to
// 1500 x 2100 with lanczos (measuring only; nothing committed): the dark
// outline under the ability window — its UPPER edge, the light stripe's end,
// read column by column — on thirteen stamped borderless walkers whose
// straight outline reads the same row (BLB #341, BLC #75 / #97, DFT #376,
// FDN #357 / #359, INR #322, LCI #307, OTJ #305 / #306, RVR #444, SLP #55,
// M21 #281): straight at 1918.8 px (1918.7–1919.0; M21 #281 1921.2), lifted
// 24.2–24.4 px at the centre, rising from x 666 to x 834 — the spells' span,
// 8 px lower — symmetric about x 750 within 0–1.5 px. The outline and the
// rim under it keep their thickness over the arch (the rim reads 12 px on the
// straight bar and at the centre on BLC #75 / OTJ #306), so the arch is the
// bar LIFTED, as on the spells. Seven more read the same lift where their art
// or text let the edge be read (AFR #285, DMU #375, FDN #417 / #420 / #421,
// M21 #280, UNF #276: 23.7–24.6 at the centre). The oval sits at M15's place
// (M15_HOLO_STAMP_OVAL; the physical scans read ≈ 1931–1996, the 4.9d
// measure) — the clean renders draw it higher.
//
// Our masters (m15borderlesspw, m15borderlesspwtall: Card Conjurer's) draw
// the window's bottom as a 4-row black outline (1922–1925), an 11-row flat
// rim in the colour (1926–1936) and the black bar from 1937, the window
// above see-through — 3 px lower than the prints'; the lift moves all of it.
// ---------------------------------------------------------------------------

/** The walkers' printed arch: the per-column median lift over the thirteen
 *  prints above (both sides averaged), smoothed over three samples (1-2-1),
 *  at |x − 750| = 0, 2, 4, … (linear between; 0 from the last entry on). */
export const WALKER_ARCH_LIFT_PX = Object.freeze([
  24.3, 24.3, 24.2, 24.2, 24.2, 24.1, 24.1, 24.1, 23.9, 23.7, 23.5, 23.2, 22.8, 22.5, 22.2, 22.0, 21.7, 21.2, 20.7, 20.3,
  19.9, 19.4, 18.8, 18.3, 17.7, 17.0, 16.3, 15.7, 14.9, 14.1, 13.3, 12.4, 11.5, 10.6, 9.6, 8.5, 7.4, 6.3, 5.1, 3.8,
  2.4, 1.2, 0.3, 0,
]);

/** The walker masters' first black row under the rim. */
export const WALKER_BLACK_BAR_TOP = 1937;

/** The walker piece's box (whole, even px): every painted pixel is inside
 *  it — the outline lifted to 1897.7 at the centre, down to the rim's last
 *  row (1936). */
export const WALKER_NOTCH_BOX = Object.freeze({ x: 660, y: 1896, width: 180, height: 42 });

/** The walkers' arch spec (the functions' `arch` argument). */
/** @type {ArchSpec} */
export const WALKER_ARCH = Object.freeze({ lift: WALKER_ARCH_LIFT_PX, barTop: WALKER_BLACK_BAR_TOP, box: WALKER_NOTCH_BOX });

/** The walker pieces: m15borderlesspwholostamp/<key> over
 *  m15borderlesspw/<key>, the tall twin's master the same pixels where the
 *  piece reads (checked by the build). */
export const WALKER_STAMP_FOLDERS = {
  m15borderlesspwholostamp: {
    keys: Object.fromEntries(["w", "u", "b", "r", "g", "m", "c"].map((k) => [k, `m15borderlesspw/${k}`])),
    sharedBy: Object.fromEntries(["w", "u", "b", "r", "g", "m", "c"].map((k) => [k, [`m15borderlesspwtall/${k}`]])),
    arch: WALKER_ARCH,
  },
};

/** How much more opaque than the box above it a row must be to count as the
 *  pinline (its bevel or rim). */
const PINLINE_ALPHA_STEP = 10;

/**
 * The pinline's first row in column `x` of a master (8-bit RGBA): scanning
 * up from the black bar, the rows that are more opaque than the text box
 * (read at row BORDERLESS_NOTCH_BOX.y, well above the bar). Everything above
 * it is the box — the piece never moves the box (a station box's paper keeps
 * its own texture), only the bevel and the rim.
 */
export function pinlineTop(m, width, x, arch = BORDERLESS_ARCH) {
  // An OPAQUE master names its foot's first row (the Prepare frame, TODO
  // 4.27b: no alpha step to find it by).
  if (arch.liftTop !== undefined) return arch.liftTop;
  // The box's own alpha, read on its box row — or (the New Capenna Art Deco
  // box, whose ornaments are opaque where the arch rises) on the arch's
  // `boxAlphaRow`, a row of the box every column of the piece holds clear.
  const boxAlpha = m[((arch.boxAlphaRow ?? arch.box.y) * width + x) * 4 + 3];
  let y = arch.barTop - 1;
  while (y > arch.box.y && m[((y - 1) * width + x) * 4 + 3] > boxAlpha + PINLINE_ALPHA_STEP) y -= 1;
  return y;
}

/**
 * What the card should show at (x, y) once the bar is lifted `lift` rows
 * (premultiplied [r, g, b, a] in 0..1): the master's row `y + lift` — read
 * between two rows for a sub-pixel lift — where that row is the pinline or
 * the black under it, and the master's OWN pixel at (x, y) where it is the
 * box (the box above the arch is never moved). Rows from the black bar down
 * are the master's black.
 */
export function liftedTarget(m, width, x, y, lift, top, arch = BORDERLESS_ARCH) {
  const at = (yy) => {
    const o = (yy * width + x) * 4;
    const a = m[o + 3] / 255;
    return [(m[o] / 255) * a, (m[o + 1] / 255) * a, (m[o + 2] / 255) * a, a];
  };
  const own = at(y);
  const row = (r) => (r >= top ? at(Math.min(r, arch.barTop)) : own);
  const src = y + lift;
  const y0 = Math.floor(src);
  const t = src - y0;
  const s0 = row(y0);
  const s1 = row(y0 + 1);
  return { under: own, want: s0.map((v, i) => v * (1 - t) + s1[i] * t) };
}

/**
 * The piece's pixel at card (x, y) over the master `m` (8-bit RGBA, `width`
 * wide): the layer that, composited OVER the master, lands nearest the
 * lifted master (liftedTarget) over every art — exact wherever covering can
 * do it. Returns [r, g, b, a] in 8 bits.
 */
export function liftedPixel(m, width, x, y, lift, top = pinlineTop(m, width, x), arch = BORDERLESS_ARCH) {
  const { under, want } = liftedTarget(m, width, x, y, lift, top, arch);
  if (under[3] >= 1 - 1e-9) {
    // An opaque pixel (the rim, the black): the lifted one is opaque too.
    const same = want.every((v, i) => Math.abs(v - under[i]) < 0.5 / 255);
    if (same) return [0, 0, 0, 0];
    return [...want.slice(0, 3).map((v) => Math.round(Math.min(255, (v / Math.max(want[3], 1e-9)) * 255))), 255];
  }
  if (want.every((v, i) => Math.abs(v - under[i]) < 0.25 / 255)) return [0, 0, 0, 0];
  return bestCover(under, want);
}

/**
 * The 8-bit cover P that, OVER `under`, lands nearest `want` over every art
 * (both premultiplied [r, g, b, a] in 0..1): P over U = P_c + (1 − P_a)·U,
 * and a layer's pixel over an art t is c + (1 − a)·t, so for a cover alpha
 * the error is linear in the art — its colour is set to centre that error
 * over t ∈ [0, 1], and the alpha that leaves the smallest worst error wins
 * (the smaller on a tie). Exact (0) wherever covering can do it — the
 * lifted pixel at least as opaque as the one under it, in its colour; where
 * it can't (a bevel's shaded edge row lifted a fraction of a row into its
 * lighter middle, which no cover can thin), the nearest.
 */
export function bestCover(under, want) {
  let best = null;
  for (let a8 = 0; a8 <= 255; a8 += 1) {
    const pa = a8 / 255;
    let worst = 0;
    const pc = [0, 0, 0];
    for (let i = 0; i < 3; i += 1) {
      // error(t) = pc + (1-pa)U_c − W_c + t·[(1-pa)(1-U_a) − (1-W_a)]
      const slope = (1 - pa) * (1 - under[3]) - (1 - want[3]);
      const ideal = want[i] - (1 - pa) * under[i] - slope / 2;
      pc[i] = Math.min(pa, Math.max(0, ideal));
      const e0 = pc[i] + (1 - pa) * under[i] - want[i];
      worst = Math.max(worst, Math.abs(e0), Math.abs(e0 + slope));
    }
    if (!best || worst < best.worst - 1e-12) best = { worst, pa, pc: [...pc], a8 };
  }
  if (best.a8 === 0) return [0, 0, 0, 0];
  return [...best.pc.map((v) => Math.round(Math.min(255, (v / best.pa) * 255))), best.a8];
}

/** The whole piece over a master: BORDERLESS_NOTCH_BOX-sized RGBA, and the
 *  count of painted pixels outside the box the recipe would want (always 0
 *  for the published table; the build refuses anything else). */
export function buildBorderlessNotch(master, width, arch = BORDERLESS_ARCH) {
  const box = arch.box;
  const out = Buffer.alloc(box.width * box.height * 4);
  let outside = 0;
  for (let x = box.x - 8; x < box.x + box.width + 8; x += 1) {
    const lift = archLiftAt(x, arch.lift);
    if (lift === 0) continue;
    const top = pinlineTop(master, width, x, arch);
    for (let y = box.y - 8; y < arch.barTop; y += 1) {
      const px = liftedPixel(master, width, x, y, lift, top, arch);
      const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
      if (!inside) {
        if (px[3] > 0) outside += 1;
        continue;
      }
      const o = ((y - box.y) * box.width + (x - box.x)) * 4;
      out[o] = px[0];
      out[o + 1] = px[1];
      out[o + 2] = px[2];
      out[o + 3] = px[3];
    }
  }
  return { piece: out, outside };
}

/**
 * How far the piece over its master lands from the lifted master, over a
 * set of flat art colours (8-bit levels, the worst channel): the recipe's
 * own check (the bevel rows that cannot be made LESS opaque by covering are
 * its only loss).
 */
export function liftError(master, width, piece, arts = [[0, 0, 0], [255, 255, 255], [128, 96, 64], [40, 120, 200]], arch = BORDERLESS_ARCH) {
  const box = arch.box;
  let worst = 0;
  let at = null;
  const over = (px, art) => {
    const a = px[3] / 255;
    return [0, 1, 2].map((i) => px[i] * a + art[i] * (1 - a));
  };
  const tops = Array.from({ length: box.width }, (_, i) => pinlineTop(master, width, box.x + i, arch));
  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      const lift = archLiftAt(x, arch.lift);
      const mo = (y * width + x) * 4;
      const po = ((y - box.y) * box.width + (x - box.x)) * 4;
      const { want: w } = liftedTarget(master, width, x, y, lift, tops[x - box.x], arch);
      for (const art of arts) {
        const base = over([master[mo], master[mo + 1], master[mo + 2], master[mo + 3]], art);
        const p = [piece[po], piece[po + 1], piece[po + 2], piece[po + 3]];
        const got = over(p, base);
        const want = [0, 1, 2].map((i) => (w[i] + (1 - w[3]) * (art[i] / 255)) * 255);
        for (let i = 0; i < 3; i += 1) {
          const e = Math.abs(got[i] - want[i]);
          if (e > worst) {
            worst = e;
            at = { x, y, art };
          }
        }
      }
    }
  }
  return { worst, at };
}

// ---------------------------------------------------------------------------
// The New Capenna ART DECO showcase's arch (TODO 4.11 wave 2: `sncartdeco`,
// Card Conjurer's 'Golden Age (SNC)' pack, which draws no stamp piece).
// Measured 2026-10-27 on Scryfall PNGs (745 x 1040) resampled to 1500 x 2100
// with lanczos (measuring only; nothing committed): the 25 stamped prints of
// the plain run (SNC #296–340: every rare and mythic, `security_stamp:
// oval`) — the gold rim's upper and lower edges read column by column from
// above (the hologram under the arch is never read). The straight rim runs
// 1938–1948 px (the masters' 1939–1949); the arch lifts it 35.3 px at the
// centre (the mean of the upper edge's 37 and the lower's 34: the rim reads
// 3 px thicker at the crown), rising from x 664 to x 836, symmetric about x
// 750 within 1 px. The prints' commons and uncommons run the rim straight,
// as the masters draw it. The oval (the 25 plain and 25 gilded stamped
// prints: its lit pixels 685–815 × 1925–1988) is 134 x 64 at 683, 1924.
//
// Our masters draw the box's foot as a 5-row black outline (1934–1938), the
// 11-row gold rim (1939–1949) and the black border from 1950; above the
// outline the box is translucent on rows 1929–1933 in every column the arch
// spans (its brown ornaments — the arcs over the centre — are opaque, so the
// box's alpha is read on row 1931, `boxAlphaRow`).
// ---------------------------------------------------------------------------

/** The Art Deco arch: the lift at |x − 750| = 0, 2, 4, … (linear between; 0
 *  from the last entry on) — the mean of both sides and both edges over the
 *  25 prints, smoothed over three samples (1-2-1). */
export const SNC_DECO_ARCH_LIFT_PX = Object.freeze([
  35.3, 35.3, 35.3, 35.1, 35.0, 35.0, 34.9, 34.6, 34.3, 34.1, 33.9, 33.7, 33.3, 33.0, 32.7, 32.3, 31.8, 31.4, 30.9, 30.4,
  29.8, 29.2, 28.6, 27.9, 27.1, 26.2, 25.3, 24.3, 23.4, 22.3, 20.9, 19.6, 18.2, 16.7, 15.0, 13.4, 11.9, 10.1, 7.9, 5.9,
  4.3, 3.1, 2.1, 1.1, 0.4, 0,
]);
/** The Art Deco masters' first black row under the gold rim. */
export const SNC_DECO_BLACK_BAR_TOP = 1950;
/** The Art Deco piece's box (whole, even px): x 656–843 (the lift is still
 *  0.1 px at 660 and 840) and from 1896 (the outline lifted to 1898.7 at
 *  the centre) down to the rim's last row (1949). */
export const SNC_DECO_NOTCH_BOX = Object.freeze({ x: 656, y: 1896, width: 188, height: 54 });
/** @type {ArchSpec} */
export const SNC_DECO_ARCH = Object.freeze({ lift: SNC_DECO_ARCH_LIFT_PX, barTop: SNC_DECO_BLACK_BAR_TOP, box: SNC_DECO_NOTCH_BOX, boxAlphaRow: 1931 });

/** The Art Deco pieces: sncartdecoholostamp/<key> over sncartdeco/<key>
 *  (every key the same master), its crowned twin the same pixels where the
 *  piece reads (checked by the build). */
export const SNC_DECO_STAMP_FOLDERS = {
  sncartdecoholostamp: {
    keys: Object.fromEntries(["w", "u", "b", "r", "g", "m", "c"].map((k) => [k, `sncartdeco/${k}`])),
    sharedBy: Object.fromEntries(["w", "u", "b", "r", "g", "m", "c"].map((k) => [k, [`sncartdeco/${k}-legendary`]])),
    arch: SNC_DECO_ARCH,
    liftTable: "SNC_DECO_ARCH_LIFT_PX",
    derivedFrom: 'the published New Capenna Art Deco masters named per key below (Card Conjurer imports: see "sncartdeco")',
    notes: [
      "PipGlyph's own derivation (TODO 4.11 wave 2): the holofoil stamp's notch on the New Capenna Art Deco showcase — the text box's gold foot rim arched over the oval as every stamped print of the run draws it (SNC #296–340 and #361–405: the rares and mythics). Card Conjurer's 'Golden Age (SNC)' pack has no stamp piece (its 'Art Deco' pack's 'Rare Stamp' is a capture of the hologram itself, never read); no CC piece and no scan is read by the build — every painted pixel is the published master's own outline, gold rim and black border, moved up.",
      "The arch is scripts/lib/borderless-stamp.mjs SNC_DECO_ARCH_LIFT_PX: the 25 stamped plain prints measured 2026-10-27 (the rim lifted 35.3 px at the centre against the straight 1938–1948, rising from x 664 to x 836). Above it the box keeps its own pixels — its brown arcs ride over the arch, as on print.",
      "The oval is drawn by both renderers over the black (our own art, lib/cards/holo-stamp-art.ts) at 683–817 × 1924–1988 (SNCARTDECO_HOLO_STAMP_OVAL). Nothing of a hologram is in a piece.",
    ],
  },
};

// ---------------------------------------------------------------------------
// The PREPARE frame's arch (TODO 4.27b): print arches the text box's foot —
// the bottom bevel, the pinline and the black under it — over the oval across
// the creature's box AND the strip under the page; the numbers and the
// measure are scripts/lib/prepare-2026.mjs PREPARE_STAMP. The prepare masters
// are opaque, so the lifted foot starts on a NAMED row (`liftTop`: the bevel's
// first, 1927) rather than one found by alpha.
// ---------------------------------------------------------------------------

/** The Prepare arch: the lift table, the bevel's first row, the first black
 *  row and the piece's box. */
/** @type {ArchSpec} */
export const PREPARE_ARCH = Object.freeze({
  lift: Object.freeze([...PREPARE_STAMP.lift]),
  barTop: PREPARE_STAMP.barTop,
  box: Object.freeze({ ...PREPARE_STAMP.box }),
  liftTop: PREPARE_STAMP.liftTop,
});

const PREPARE_MONO_KEYS = ["w", "u", "b", "r", "g", "m", "c"];

/** The Prepare pieces: prepareholostamp/<key> over prepare/<key> — the seven
 *  keys and the twenty pair masters, BOTH dresses (the lifted bevel's top
 *  edge is cut against the strip under the page, which the gold-split and
 *  the hybrid dress paint differently: the slot is keyed by the master,
 *  FrameOverlaySlot.keyByMaster). Each is drawn over the extended-art
 *  Prepare dress (extendedartprepare/<key>, TODO 4.27b) too: `sharePiece` —
 *  the build builds the piece over that master and refuses one that
 *  differs. */
export const PREPARE_STAMP_FOLDERS = {
  prepareholostamp: {
    keys: {
      ...Object.fromEntries(PREPARE_MONO_KEYS.map((k) => [k, `prepare/${k}`])),
      ...Object.fromEntries(BORDERLESS_STAMP_PAIRS.map((p) => [p, `prepare/${p}`])),
      ...Object.fromEntries(BORDERLESS_STAMP_PAIRS.map((p) => [`${p}-h`, `prepare/${p}-h`])),
    },
    sharedBy: {
      ...Object.fromEntries(PREPARE_MONO_KEYS.map((k) => [k, [`extendedartprepare/${k}`]])),
      ...Object.fromEntries(BORDERLESS_STAMP_PAIRS.map((p) => [p, [`extendedartprepare/${p}`]])),
      ...Object.fromEntries(BORDERLESS_STAMP_PAIRS.map((p) => [`${p}-h`, [`extendedartprepare/${p}-h`]])),
    },
    sharePiece: true,
    arch: PREPARE_ARCH,
    liftTable: "PREPARE_STAMP.lift (scripts/lib/prepare-2026.mjs)",
    derivedFrom: 'the published Prepare masters named per key below (PipGlyph\'s own: see "prepare")',
    notes: [
      "PipGlyph's own derivation (TODO 4.27b): the holofoil stamp's notch on the Prepare frame — the text box's foot (its bottom bevel, the pinline and the black border) arched over the oval across the creature's box and the strip under the page, as every stamped Prepare print draws it (79 of 119 paper printings, every rare and mythic). M15's piece (Card Conjurer's m15holostamp) is cut for one box: the page's outline and strip run through it. No CC piece and no scan is read by the build — every painted pixel is the published master's own bevel, pinline and black, moved up.",
      "The arch is scripts/lib/prepare-2026.mjs PREPARE_STAMP.lift: 35 stamped plain prints measured 2026-10-28 (the rim's lower edge lifted 37.4 px at the centre against the straight 1947.5, its upper edge 34.3 — the lift is their mean, 35.8 — rising from x 657 to x 843); the same set's plain M15 mythic arches the same within 1 px.",
      "Each piece is built over its master and checked over the other master drawn under its key — the extended-art Prepare dress — by building it there too (sharePiece); the two pair dresses each have their own piece (their strips differ where the lifted bevel's top edge is cut). The oval is drawn by both renderers over the black (our own art, lib/cards/holo-stamp-art.ts) at M15's oval. Nothing of a hologram is in a piece.",
    ],
  },
};
