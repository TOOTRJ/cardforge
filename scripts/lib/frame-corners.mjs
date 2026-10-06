// ---------------------------------------------------------------------------
// frame-corners.mjs — normalise a git MSE master's card corners (TODO 3.26,
// Phase B, owner decision 2026-09-27). Pure; no I/O. Unit-tested in
// tests/unit/frames/frame-corners.test.ts.
//
// Most Full-Magic-Pack frames paint their black border with a rounded corner
// of their own (r ≈ 57–76 px at 1500 wide) and fill the rest of the corner
// with opaque card-stock paper (white, or grey 225 on expeditionland). Under
// the one card corner (lib/cards/card-corner.ts, 64.5 px) that paper showed
// as a light crescent inside the cut on retro, retroland, aftermath, saga …
// The flood-fill clear of scripts/round-frame-corners.mjs (dc65aa5) left an
// anti-aliased fringe behind on flip and alphatoken, and every builder that
// regenerated a master after it brought the white back.
//
// The normalise pass, per corner of an ALLOW-LISTED master:
//   1. the edge band beside the corner box must be opaque and dark (the
//      border), or the corner is left alone;
//   2. flood from the corner pixel, 4-connected, over the EXTERIOR — pixels
//      that are see-through (α < ½) or neutral and not dark (the paper, the
//      grey anti-aliased fringe between paper and border) — never crossing
//      a dark border pixel;
//   3. paint the flooded pixels opaque with the border AS IT RUNS BESIDE
//      THEM: the edge band's colour at the same depth inside the card's
//      outline (a scanned border is not flat — retro's outer rows read
//      16/16/16/13/8/3 before the black — so a flat paint would leave a
//      step where the old corner ended), sampled along each edge just past
//      the paper, blended between the two edges by angle round the arc,
//      and the dark pixels 3–8 px beside the paper deeper in;
//   4. recolour the paper edge's dark TAIL — neutral pixels joined to the
//      paint that are still lighter than the border at their depth, out to
//      REPAINT_DEPTH_MAX inside the outline — so no grey hairline or step is
//      left where the old painted corner was;
//   5. cut the card corner at the constant (applyCardCornerMask).
//
// Safeguards, so real design is never painted:
//   - an explicit allow-list (CORNER_NORMALISE_TEMPLATES) that never holds a
//     showcase family (NEVER_NORMALISE: Bloomburrow's pale corner, LOTR's
//     tan, Tarkir's ornament, the transparent rings — listing one throws);
//   - connectivity: only pixels joined to the corner through exterior
//     pixels (and, for the tail, through the tail), so a light area behind
//     the dark border is never reached;
//   - geometry: every flooded pixel lies outside a GUARD_RADIUS (96 px) arc
//     in the 96×96 corner box — the paper of the deepest painted corner
//     (retro, r ≈ 76) sits well inside that region. An exterior pixel just
//     beyond it means the flood is leaking: the corner is not painted and
//     normaliseMasterCorners throws. The tail never goes deeper than
//     REPAINT_DEPTH_MAX inside the card's outline;
//   - chroma: a pixel is exterior (or tail) only when it is neutral
//     (max − min ≤ NEUTRAL_CHROMA_MAX) — paper, its grey fringe and the dark
//     end of that fringe, never a coloured design;
//   - it only ever DARKENS: the gate refuses a master in which a repainted
//     opaque pixel came out lighter than it was.
// ---------------------------------------------------------------------------
import { applyCardCornerMask, cardCornerRadiusPx } from "../../lib/cards/card-corner.ts";
import {
  EDGE_CONTRACTS,
  cornerViolations,
  edgeContractViolations,
  isKnownEdgeFailure,
} from "../../lib/frames/edge-contract.ts";

/**
 * The masters Phase B normalises: "all" colour keys, or only the listed
 * ones. expeditionland: the keys the corner check flags (its grey paper
 * reaches 1–2 px inside the cut on w, u, r, c and m); b and g are 7.7 known
 * failures with a transparent edge band — no border to paint with.
 * (adventure, with its 1–2 px grey paper rim, flip and aftermath left the
 * list with TODO 4.21a: their masters are Card Conjurer's in the frames
 * bucket, cut at the one corner by the importer. Saga left it with 4.21c, the
 * same way.)
 */
export const CORNER_NORMALISE_TEMPLATES = Object.freeze({
  retro: "all",
  retroland: "all",
  modern: "all",
  modernland: "all",
  extendedart: "all",
  fullart: "all",
  m15textless: "all",
  m15textlessland: "all",
  alphatoken: "all",
  expeditionland: Object.freeze(["w", "u", "r", "c", "m"]),
});

/** Never normalised: the showcase families' corners are real design. */
export const NEVER_NORMALISE = /^(bloomburrow|bloomanime|lotr|lotrscroll|tarkir[a-z]*|avatar|battle)$/;

/** The corner box the pass works in (and the gate confines the diff to). */
export const NORMALISE_BOX = 96;
/** Flooded pixels must lie outside this arc (px, HD). */
export const GUARD_RADIUS = 96;
/** "Dark": the corner check's border luma ceiling (Rec. 601). */
export const DARK_LUMA_MAX = 48;
/** Paper and its anti-aliased fringe are neutral grey. */
export const NEUTRAL_CHROMA_MAX = 40;
/**
 * The deepest a repaint may reach inside the card's outline (px, HD). The
 * paper crescent plus its grey fringe measured ≤ 7.6 px (retroland); the
 * dark tail of a scanned corner's blur (retro, retroland) runs ~1.5 px
 * further. The tail stops here; the gate refuses a flood that goes deeper.
 */
export const REPAINT_DEPTH_MAX = 10;
/** A pixel is see-through below this alpha (8-bit). */
const SEE_THROUGH_MAX = 127;
/** The deep paint colour is sampled from the dark pixels 3–8 steps beside
 *  the flooded paper (at least 32 of them, else the edge band's). */
const BESIDE_FROM = 3;
const BESIDE_TO = 8;
const BESIDE_MIN = 32;
/** The edge band's depth profile: rows (columns) 0 … PROFILE_ROWS − 1 of
 *  each edge, sampled over PROFILE_SPAN px starting PROFILE_GAP px past the
 *  paper's furthest reach along that edge. */
const PROFILE_ROWS = 12;
const PROFILE_GAP = 6;
const PROFILE_SPAN = 24;
/** A tail pixel is lighter than the border at its depth by more than this. */
const TAIL_TOLERANCE = 6;
/** …and no lighter than the tail pixel it joins from by more than this. */
const TAIL_STEP_UP = 2;

export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** True when Phase B normalises `template`/`key`. Throws when a showcase
 *  family has been put on the allow-list. */
export function shouldNormalise(template, key) {
  const entry = CORNER_NORMALISE_TEMPLATES[template];
  if (NEVER_NORMALISE.test(template)) {
    if (entry) throw new Error(`${template} is a showcase family: its corners are design, never normalised`);
    return false;
  }
  if (!entry) return false;
  return entry === "all" || entry.includes(key);
}

/**
 * @typedef {{
 *   corner: string,
 *   border: number[] | null,
 *   profile: { horizontal: number[], vertical: number[] } | null,
 *   flooded: number,
 *   repainted: number,
 *   repaintedLight: number,
 *   repaintedFringe: number,
 *   repaintedDark: number,
 *   deepestPx: number,
 *   tail: number,
 *   lightened: number,
 *   ghost: number,
 *   ghostLumaOver: number,
 *   lightLeft: number,
 *   blocked: number,
 *   skipped: string | null,
 *   alreadyNormalised: boolean,
 * }} CornerReport
 */

/** @type {Array<[string, number, number]>} */
const CORNERS = [
  ["tl", 0, 0],
  ["tr", 1, 0],
  ["bl", 0, 1],
  ["br", 1, 1],
];

/**
 * Normalise the four card corners of a straight 8-bit RGBA master in place
 * and cut them at the constant. Returns, per corner:
 *   border          the deep border colour (null: nothing painted)
 *   profile         the edge band's luma by depth, top/bottom and side edge
 *   flooded         pixels the flood reached
 *   repainted       pixels the cut keeps whole (d ≤ −0.5 from the arc) whose
 *                   colour the pass changed: the flood's and the tail's —
 *   repaintedLight    … that were light paper (α > ½, luma > 128)
 *   repaintedFringe   … that were the grey fringe (48 < luma ≤ 128) or
 *                     see-through
 *   repaintedDark     … that were the fringe's dark tail (luma ≤ 48)
 *   deepestPx       how far inside the card's outline the deepest of them
 *                   sits
 *   tail            dark-tail pixels recoloured (≤ REPAINT_DEPTH_MAX deep)
 *   lightened       repainted opaque pixels that came out LIGHTER (gate: 0)
 *   ghost           tail-like pixels joined to the tail but deeper than
 *                   REPAINT_DEPTH_MAX, left as they are, and the most
 *                   ghostLumaOver  luma any of them has over the border there
 *   lightLeft       light pixels the cut still shows in the reachable zone
 *                   (outside the guard arc) afterwards — should be 0
 *   blocked         exterior pixels just beyond the guard (a leak)
 *   skipped         why a corner that needed painting was left alone
 *   alreadyNormalised  true on every corner when the master was already cut
 *                   and clean: nothing is touched (the pass is idempotent)
 */
export function normaliseCardCorners(rgba, width, height, opts = {}) {
  const radius = opts.radius ?? cardCornerRadiusPx(width, height);
  const box = Math.min(opts.box ?? NORMALISE_BOX, width >> 1, height >> 1);
  const guard = opts.guardRadius ?? GUARD_RADIUS;
  const n = Math.ceil(radius);
  /** Distance past an arc of radius `r` for the pixel centre (lx, ly). */
  const past = (lx, ly, r) => Math.hypot(r - lx - 0.5, r - ly - 0.5) - r;
  const inGuard = (lx, ly) => lx < box && ly < box && lx < guard && ly < guard && past(lx, ly, guard) > 0;
  const kept = (lx, ly) => lx >= radius || ly >= radius || past(lx, ly, radius) <= -0.5;
  /** How far inside the card's outline the pixel centre sits (negative:
   *  outside the arc), and how much of its border colour comes from the
   *  top/bottom edge (1) rather than the side edge (0). */
  const depthOf = (lx, ly) => {
    const cx = radius - lx - 0.5;
    const cy = radius - ly - 0.5;
    if (cx > 0 && cy > 0) return { depth: radius - Math.hypot(cx, cy), towardH: Math.atan2(cy, cx) / (Math.PI / 2) };
    if (cy > 0) return { depth: ly + 0.5, towardH: 1 };
    if (cx > 0) return { depth: lx + 0.5, towardH: 0 };
    return { depth: Math.min(lx, ly) + 0.5, towardH: 0.5 };
  };
  const isLight = (o) => rgba[o + 3] > SEE_THROUGH_MAX && luma(rgba[o], rgba[o + 1], rgba[o + 2]) > 128;
  const isDarkOpaque = (o) => rgba[o + 3] > SEE_THROUGH_MAX && luma(rgba[o], rgba[o + 1], rgba[o + 2]) <= DARK_LUMA_MAX;
  const isNeutral = (o) =>
    Math.max(rgba[o], rgba[o + 1], rgba[o + 2]) - Math.min(rgba[o], rgba[o + 1], rgba[o + 2]) <= NEUTRAL_CHROMA_MAX;
  const isExterior = (o) => {
    if (rgba[o + 3] <= SEE_THROUGH_MAX) return true;
    if (luma(rgba[o], rgba[o + 1], rgba[o + 2]) <= DARK_LUMA_MAX) return false;
    return isNeutral(o);
  };
  const neighbours = (lx, ly) => [
    [lx + 1, ly],
    [lx - 1, ly],
    [lx, ly + 1],
    [lx, ly - 1],
  ];
  const median = (pool, c) => pool.map((o) => rgba[o + c]).sort((a, b) => a - b)[pool.length >> 1];

  // Plan every corner first: its flood, whether it can be painted, and in
  // what colour.
  const plans = CORNERS.map(([corner, fx, fy]) => {
    const off = (lx, ly) => ((fy ? height - 1 - ly : ly) * width + (fx ? width - 1 - lx : lx)) * 4;
    /** @type {CornerReport} */
    const entry = {
      corner,
      border: null,
      profile: null,
      flooded: 0,
      repainted: 0,
      repaintedLight: 0,
      repaintedFringe: 0,
      repaintedDark: 0,
      deepestPx: 0,
      tail: 0,
      lightened: 0,
      ghost: 0,
      ghostLumaOver: 0,
      lightLeft: 0,
      blocked: 0,
      skipped: null,
      alreadyNormalised: false,
    };
    // 1. The edge band beside the box must be the border: opaque and dark.
    const samples = [];
    for (let a = box; a < Math.min(box + 48, width, height); a += 1) {
      for (let i = 1; i < 7; i += 1) samples.push(off(a, i), off(i, a));
    }
    const dark = samples.filter(isDarkOpaque);
    // 2. The flood, 4-connected from the corner pixel.
    const seen = new Uint8Array(box * box);
    const region = [];
    if (isExterior(off(0, 0))) {
      const stack = [0];
      seen[0] = 1;
      while (stack.length) {
        const p = stack.pop();
        region.push(p);
        for (const [nx, ny] of neighbours(p % box, (p / box) | 0)) {
          if (nx < 0 || ny < 0) continue;
          if (!inGuard(nx, ny)) {
            // An exterior pixel beyond the guard: the flood would leak.
            if (nx < width && ny < height && isExterior(off(nx, ny))) entry.blocked += 1;
            continue;
          }
          const q = ny * box + nx;
          if (seen[q]) continue;
          seen[q] = 1;
          if (isExterior(off(nx, ny))) stack.push(q);
        }
      }
    }
    entry.flooded = region.length;
    const plan = { entry, off, region, tail: [], paint: false, paintAt: null };
    if (region.length === 0) return plan;
    if (dark.length < samples.length / 2) {
      entry.skipped = "border band is not opaque and dark";
      return plan;
    }
    if (entry.blocked > 0) {
      entry.skipped = "exterior reaches the guard arc (leak)";
      return plan;
    }
    // 3a. The deep colour: the border right beside the paper — the dark
    // pixels BESIDE_FROM…BESIDE_TO steps from the flooded region. Too few of
    // them: the edge band's.
    const steps = new Int8Array(box * box).fill(-1);
    for (const p of region) steps[p] = 0;
    let frontier = region;
    const beside = [];
    for (let step = 1; step <= BESIDE_TO && frontier.length; step += 1) {
      const next = [];
      for (const p of frontier) {
        for (const [nx, ny] of neighbours(p % box, (p / box) | 0)) {
          if (nx < 0 || ny < 0 || nx >= box || ny >= box) continue;
          const q = ny * box + nx;
          if (steps[q] !== -1) continue;
          steps[q] = step;
          next.push(q);
          if (step >= BESIDE_FROM && isDarkOpaque(off(nx, ny))) beside.push(off(nx, ny));
        }
      }
      frontier = next;
    }
    const pool = beside.length >= BESIDE_MIN ? beside : dark;
    const deep = [median(pool, 0), median(pool, 1), median(pool, 2)];
    entry.border = deep;
    // 3b. The border's depth profile along each edge, sampled just past the
    // paper's furthest reach along that edge (row t of the top/bottom edge,
    // column t of the side edge); a row without enough dark opaque pixels
    // there takes the deep colour.
    let reachH = 0;
    let reachV = 0;
    for (const p of region) {
      const lx = p % box;
      const ly = (p / box) | 0;
      if (ly < PROFILE_ROWS) reachH = Math.max(reachH, lx);
      if (lx < PROFILE_ROWS) reachV = Math.max(reachV, ly);
    }
    const profileAlong = (reach, horizontal) => {
      const rows = [];
      for (let t = 0; t < PROFILE_ROWS; t += 1) {
        const pool = [];
        for (let a = reach + PROFILE_GAP; a < Math.min(reach + PROFILE_GAP + PROFILE_SPAN, width, height); a += 1) {
          const o = horizontal ? off(a, t) : off(t, a);
          if (isDarkOpaque(o) && isNeutral(o)) pool.push(o);
        }
        rows.push(pool.length >= PROFILE_SPAN / 2 ? [median(pool, 0), median(pool, 1), median(pool, 2)] : deep);
      }
      return rows;
    };
    const profH = profileAlong(reachH, true);
    const profV = profileAlong(reachV, false);
    entry.profile = {
      horizontal: profH.map((c) => Math.round(luma(...c))),
      vertical: profV.map((c) => Math.round(luma(...c))),
    };
    const at = (prof, depth) => {
      const t = depth - 0.5;
      if (t <= 0) return prof[0];
      if (t >= PROFILE_ROWS - 1) return prof[PROFILE_ROWS - 1];
      const i = Math.floor(t);
      const f = t - i;
      return prof[i].map((c, ch) => c + (prof[i + 1][ch] - c) * f);
    };
    /** The border colour at corner-local (lx, ly). */
    plan.paintAt = (lx, ly) => {
      const { depth, towardH } = depthOf(lx, ly);
      const h = at(profH, depth);
      const v = at(profV, depth);
      return [0, 1, 2].map((c) => Math.round(h[c] * towardH + v[c] * (1 - towardH)));
    };
    // 3c. The dark tail of the paper's anti-aliased edge: neutral opaque
    // pixels joined to the paint (through the tail) that are still lighter
    // than the border at their depth, out to REPAINT_DEPTH_MAX inside the
    // outline. Beyond that depth, anything that would still qualify is a
    // GHOST: left alone, reported.
    const inPaint = new Uint8Array(box * box);
    for (const p of region) inPaint[p] = 1;
    // The tail runs DOWN the paper edge's gradient: a pixel joins only when
    // it is no lighter than the pixel it was reached from (± TAIL_STEP_UP),
    // so it stops where the fringe meets the border and never wanders into
    // the border's own scan noise.
    const lumaAt = (lx, ly) => {
      const o = off(lx, ly);
      return luma(rgba[o], rgba[o + 1], rgba[o + 2]);
    };
    const qualifies = (lx, ly, from) => {
      const o = off(lx, ly);
      if (rgba[o + 3] <= SEE_THROUGH_MAX || !isNeutral(o)) return -1;
      const l = lumaAt(lx, ly);
      if (from >= 0 && l > lumaAt(from % box, (from / box) | 0) + TAIL_STEP_UP) return -1;
      const over = l - luma(...plan.paintAt(lx, ly));
      return over > TAIL_TOLERANCE ? over : -1;
    };
    let edge = region;
    let ghostEdge = [];
    while (edge.length || ghostEdge.length) {
      const next = [];
      const nextGhost = [];
      for (const [list, isGhost] of [[edge, false], [ghostEdge, true]]) {
        for (const p of list) {
          for (const [nx, ny] of neighbours(p % box, (p / box) | 0)) {
            if (nx < 0 || ny < 0 || nx >= box || ny >= box) continue;
            const q = ny * box + nx;
            if (inPaint[q]) continue;
            // A see-through flooded pixel's colour means nothing: the step
            // off the paper itself is never a climb.
            const over = qualifies(nx, ny, isGhost || list !== region ? p : -1);
            if (over < 0) continue;
            inPaint[q] = 1;
            if (isGhost || depthOf(nx, ny).depth > REPAINT_DEPTH_MAX) {
              nextGhost.push(q);
              entry.ghost += 1;
              entry.ghostLumaOver = Math.max(entry.ghostLumaOver, Math.round(over));
            } else {
              next.push(q);
            }
          }
        }
      }
      plan.tail.push(...next);
      edge = next;
      ghostEdge = nextGhost;
    }
    plan.paint = true;
    return plan;
  });

  // Already normalised — cut at the constant, and no paper the cut keeps:
  // leave the master alone (re-cutting would cut the anti-aliased ramp twice).
  // (A dark tail alone doesn't count: on a normalised master the flood is the
  // cut's own see-through zone, whose neighbours a re-run would nibble at.)
  const clean = plans.every(({ off, region }) => {
    if (region.some((p) => kept(p % box, (p / box) | 0))) return false;
    for (let ly = 0; ly < n; ly += 1) {
      for (let lx = 0; lx < n; lx += 1) {
        if (past(lx, ly, radius) >= 0.5 && rgba[off(lx, ly) + 3] !== 0) return false;
      }
    }
    return true;
  });
  if (clean) {
    for (const { entry } of plans) {
      entry.border = null;
      entry.profile = null;
      entry.skipped = null;
      entry.ghost = 0;
      entry.ghostLumaOver = 0;
      entry.alreadyNormalised = true;
    }
    return plans.map((p) => p.entry);
  }

  /** How far inside the card's outline a kept pixel's centre sits. */
  const depthOfKept = (lx, ly) => Math.max(0, lx < radius && ly < radius ? -past(lx, ly, radius) : Math.min(lx, ly) + 0.5);
  for (const { entry, off, region, tail, paint, paintAt } of plans) {
    if (!paint) continue;
    /** Count a repainted pixel the cut keeps, by what it was. */
    const tally = (lx, ly, o, colour) => {
      if (!kept(lx, ly)) return;
      const was = luma(rgba[o], rgba[o + 1], rgba[o + 2]);
      const opaque = rgba[o + 3] > SEE_THROUGH_MAX;
      entry.repainted += 1;
      if (opaque && was > 128) entry.repaintedLight += 1;
      else if (!opaque || was > DARK_LUMA_MAX) entry.repaintedFringe += 1;
      else entry.repaintedDark += 1;
      if (opaque && luma(...colour) > was + 1) entry.lightened += 1;
      entry.deepestPx = Math.max(entry.deepestPx, depthOfKept(lx, ly));
    };
    // 4a. The dark tail (it keeps its alpha).
    for (const p of tail) {
      const lx = p % box;
      const ly = (p / box) | 0;
      const o = off(lx, ly);
      const colour = paintAt(lx, ly);
      tally(lx, ly, o, colour);
      rgba[o] = colour[0];
      rgba[o + 1] = colour[1];
      rgba[o + 2] = colour[2];
    }
    entry.tail = tail.length;
    // 4b. The flooded paper and fringe, opaque.
    for (const p of region) {
      const lx = p % box;
      const ly = (p / box) | 0;
      const o = off(lx, ly);
      const colour = paintAt(lx, ly);
      tally(lx, ly, o, colour);
      rgba[o] = colour[0];
      rgba[o + 1] = colour[1];
      rgba[o + 2] = colour[2];
      rgba[o + 3] = 255;
    }
    // The cut's zone (the arc's anti-aliased ramp and beyond) becomes opaque
    // border, so the ramp is one colour, cut once.
    for (let ly = 0; ly < n; ly += 1) {
      for (let lx = 0; lx < n; lx += 1) {
        if (past(lx, ly, radius) <= -0.5) continue;
        const o = off(lx, ly);
        const colour = paintAt(lx, ly);
        // Paper and its fringe take the border; a dark pixel only when it is
        // lighter than the border there (the pass never lightens).
        if (isExterior(o) || (isDarkOpaque(o) && luma(rgba[o], rgba[o + 1], rgba[o + 2]) > luma(...colour))) {
          rgba[o] = colour[0];
          rgba[o + 1] = colour[1];
          rgba[o + 2] = colour[2];
        }
        rgba[o + 3] = 255;
      }
    }
  }
  // 5. The cut.
  applyCardCornerMask(rgba, width, height, radius);
  // What the cut still shows of the paper in the reachable zone (none).
  for (const { entry, off } of plans) {
    for (let ly = 0; ly < box; ly += 1) {
      for (let lx = 0; lx < box; lx += 1) {
        if (inGuard(lx, ly) && kept(lx, ly) && isLight(off(lx, ly))) entry.lightLeft += 1;
      }
    }
  }
  return plans.map((p) => p.entry);
}

/**
 * The 3.26 challenge's light count (its problem P8): light pixels (α > ½,
 * Rec. 601 luma > 128) the cut keeps whole (d ≤ −0.5) in the four corner
 * squares — the crescent a master shows inside the one card corner.
 */
export function lightInsideCorners(rgba, width, height, radius = cardCornerRadiusPx(width, height)) {
  const n = Math.ceil(radius);
  let count = 0;
  for (const [, fx, fy] of CORNERS) {
    for (let ly = 0; ly < n; ly += 1) {
      for (let lx = 0; lx < n; lx += 1) {
        if (Math.hypot(radius - lx - 0.5, radius - ly - 0.5) - radius > -0.5) continue;
        const o = ((fy ? height - 1 - ly : ly) * width + (fx ? width - 1 - lx : lx)) * 4;
        if (rgba[o + 3] > SEE_THROUGH_MAX && luma(rgba[o], rgba[o + 1], rgba[o + 2]) > 128) count += 1;
      }
    }
  }
  return count;
}

/** Pixels that differ between two same-size RGBA images, and how many of
 *  them lie outside the four `box`×`box` corner boxes (the gate: 0). */
export function cornerDiff(before, after, width, height, box = NORMALISE_BOX) {
  let changed = 0;
  let outside = 0;
  for (let y = 0; y < height; y += 1) {
    const yIn = y < box || y >= height - box;
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (before[o] === after[o] && before[o + 1] === after[o + 1] && before[o + 2] === after[o + 2] && before[o + 3] === after[o + 3]) {
        continue;
      }
      changed += 1;
      if (!(yIn && (x < box || x >= width - box))) outside += 1;
    }
  }
  return { changed, outside };
}

/**
 * Phase B's per-master gate (owner decision 2026-09-27, made explicit
 * 2026-09-27 after review): what is wrong with a normalised master, given the
 * pass's `report`, the light count of the master BEFORE the pass
 * (lightInsideCorners — the challenge's P8 measure) and the before/after
 * `cornerDiff`. Empty = it may be written.
 *   - every change stays inside the four NORMALISE_BOX corner boxes;
 *   - no corner was skipped (a leak, or no dark border to paint with);
 *   - the LIGHT it repainted is at most the light the cut showed before, and
 *     none is left;
 *   - the WHOLE repaint — light paper, its grey fringe and the fringe's
 *     dark tail, every pixel the cut keeps whose colour changed — stays
 *     within REPAINT_DEPTH_MAX of the card's outline and only darkens (a
 *     repainted opaque pixel never comes out lighter than it was).
 * The fringe and tail are necessarily more pixels than the light (1.4–3×):
 * leaving them is a grey hairline where the old painted corner was.
 */
export function phaseBGateFailures(report, lightBefore, diff) {
  const out = [];
  if (diff.outside > 0) out.push(`${diff.outside} px changed outside the four ${NORMALISE_BOX}×${NORMALISE_BOX} corner boxes`);
  const repaintedLight = report.reduce((sum, c) => sum + c.repaintedLight, 0);
  if (repaintedLight > lightBefore) out.push(`repainted ${repaintedLight} light px, more than the ${lightBefore} the cut showed`);
  for (const c of report) {
    if (c.skipped) out.push(`${c.corner}: ${c.skipped}`);
    if (c.lightLeft > 0) out.push(`${c.corner}: ${c.lightLeft} light px still inside the cut`);
    if (c.deepestPx > REPAINT_DEPTH_MAX) out.push(`${c.corner}: repaint reaches ${c.deepestPx.toFixed(1)} px inside (> ${REPAINT_DEPTH_MAX})`);
    if (c.lightened > 0) out.push(`${c.corner}: ${c.lightened} repainted px came out lighter`);
  }
  return out;
}

/**
 * Everything wrong with `after`, the normalised `template`/`key` master
 * (`before` = the same master before the pass, `report` = the pass's): the
 * Phase B gate, then — unless the pair is a known edge failure — the edge
 * contract and the corner check (lib/frames/edge-contract.ts). The ONE gate
 * the runner (scripts/round-frame-corners.mjs) and the builders' hook share.
 */
export function normalisedMasterFailures(template, key, before, after, width, height, report) {
  const failures = phaseBGateFailures(report, lightInsideCorners(before, width, height), cornerDiff(before, after, width, height));
  const contract = EDGE_CONTRACTS[template];
  if (contract && !isKnownEdgeFailure(template, key)) {
    failures.push(...edgeContractViolations(contract, after, width, height), ...cornerViolations(contract, after, width, height));
  }
  return failures;
}

/**
 * The builders' hook: normalise `template`/`key`'s master in place when
 * Phase B covers it (no-op otherwise, returns null). It runs the runner's
 * whole gate (normalisedMasterFailures) and throws on any failure — the
 * master is restored first — so a regenerated master can never bring the
 * white back, or be painted wrong, silently.
 */
export function normaliseMasterCorners(template, key, rgba, width, height) {
  if (!shouldNormalise(template, key)) return null;
  const before = Uint8Array.from(rgba);
  const report = normaliseCardCorners(rgba, width, height);
  const failures = normalisedMasterFailures(template, key, before, rgba, width, height, report);
  if (failures.length) {
    rgba.set(before);
    throw new Error(`${template}/${key}: corner normalise refused — ${failures.join("; ")}`);
  }
  return report;
}
