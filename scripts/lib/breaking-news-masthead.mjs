// ---------------------------------------------------------------------------
// The OTJ Breaking News showcase's MASTHEAD pieces (template `breakingnews`,
// TODO 4.11 wave 2; owner decision on #624: FOLLOW PRINT) — the recipe, as
// DATA. scripts/build-breaking-news-masthead.mjs applies it to the published
// `breakingnews/<key>` masters; lib/cards/template-layout.ts
// (BREAKING_NEWS_MASTHEAD) places the pieces through lib/cards/masthead.ts,
// and a unit test holds the two files together.
//
// WHAT PRINT DOES (OTP #1–65 at 1500 × 2100, measured 2026-10-28): the
// masthead — the icon box (x 52–382, rows 81–145), "THE PROSPERITY POST"
// (ink 416–1081, the Y's arms at the cost row's rows ending on 1062) on a
// soft light glow, and the grey ">>" chevron (1096–1184, rows 65–158) —
// makes room for the cost row. Up to three pips the row ends on 1411 and
// everything shows (#7: the discs from 1185, the chevron's tip on 1184). At
// four the chevron goes and nothing else moves (#25, #51, #58: 1108–1411).
// At five the row slides right and still clears the wordmark (#22: the
// discs 1080–1461). At seven the WORDMARK slides left with the box's right
// end — the box is cut short and its right border drawn there (#40: the P
// 427 → 271, the box's right border 378–382 → 229–233), while the paper,
// its rules and its crease stay put. Print also narrows the wordmark by
// 3 % there, which this recipe does not. The rule that places the pieces is
// lib/cards/masthead.ts; this file only cuts them.
//
// THE PIECES (per master key, from the published master; no pixel drawn,
// only alpha set — a fade is a share of the master's own pixel):
//   wordmark  the master's x 376–1140 × rows 40–186 (the paper between the
//             coloured bars, 33–39 and 186–192): the box's right border,
//             the wordmark and its glow, its rules with their THE / POST
//             gaps and the right rules' first px. Its LEFT edge is hard on
//             the box's rows (81–145: the cut print makes through the box)
//             and fades over 39 px elsewhere; its right end fades over the
//             paper past the Y (13 px on the chevron's rows, where the
//             chevron starts on 1096; 46 px above and below them); its top
//             and bottom fade over the paper above "THE" (from 51) and below
//             "POST" (to 176). Drawn over the master's paper, the glow
//             hands over softly — the way print lays it on its paper.
//   paper     the masthead with no ink: x 52–1228 × the same rows, the
//             master's clean run right of the chevron (x 1188–1387: paper
//             and the rules on rows 59–64 and 160–164; a crease starts past
//             1395) laid end to end leftwards every 160 px, each joint a
//             40 px crossfade of two copies — never a mirror (its blots read
//             as a pattern) — and its right end crossfaded onto the master's
//             own 1188–1227, so where it ends it IS the master. Its top and
//             bottom fade like the wordmark's. It goes under the wordmark's
//             old place and the chevron; the renderers clip its left end to
//             the wordmark's new right end.
// No flat zone exists in the masthead (the paper is textured): every edge
// a piece adds is a fade of paper onto paper or lies on a printed edge (the
// box's border, the rules' rows), checked at 2× on the owner's sheet
// (design-backup/otp-breaking-news/sheet-masthead.jpg). The crease that
// crosses the box (x ≈ 180–330) is NOT carried: where the cut box lands on
// it, the wordmark piece covers it (print keeps its crease on top).
// ---------------------------------------------------------------------------

export const BREAKING_NEWS_MASTHEAD_RECIPE = Object.freeze({
  folder: "breakingnewsmasthead",
  from: "breakingnews",
  /** Every master key the template publishes (scripts/lib/cc-frames.mjs
   *  CC_TEMPLATES.breakingnews: the colours, `a`, `c` and the ten pairs). */
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "a", "c", "wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"]),
  card: Object.freeze({ width: 1500, height: 2100 }),
  /** The rows both pieces cover, [top, bottom): the paper between the
   *  coloured bars. */
  rows: Object.freeze([40, 186]),
  /** The rows the pieces are opaque on, [from, to): "THE" starts on 51,
   *  "POST" ends on 176. Above and below, alpha fades to 0 at the edge. */
  opaqueRows: Object.freeze([51, 177]),
  /** The icon box's rows (its borders on 81–85 and 142–145). */
  boxRows: Object.freeze([81, 146]),
  /** The chevron's rows (between the rules' rows 59–64 and 160–164). */
  chevronRows: Object.freeze([65, 159]),
  wordmark: Object.freeze({
    x0: 376,
    x1: 1140,
    /** The left fade off the box's rows: 0 → 1 over [x0, leftOpaque). */
    leftOpaque: 415,
    /** The right end on the chevron's rows: opaque to 1082, 0 by 1094. */
    chevronOpaque: 1082,
    chevronEnd: 1094,
    /** The right end elsewhere: opaque to 1094, 0 by x1. */
    opaque: 1094,
  }),
  paper: Object.freeze({
    x0: 52,
    x1: 1228,
    /** The clean run, [from, to). */
    run: Object.freeze([1188, 1388]),
    /** The copies' step (the run less the crossfade). */
    step: 160,
    /** Where the copies end and the master's own pixels take over, after a
     *  crossfade over [handover, x1). */
    handover: 1188,
  }),
});

/** A 0 → 1 ramp: 0 at `zero`, 1 at `one` (either order), clamped. */
function ramp(v, zero, one) {
  const t = (v - zero) / (one - zero);
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** The pieces' shared row fade: 0 outside `rows`, 1 on `opaqueRows`. */
export function rowAlpha(y, recipe = BREAKING_NEWS_MASTHEAD_RECIPE) {
  const [top, bottom] = recipe.rows;
  const [from, to] = recipe.opaqueRows;
  if (y < top || y >= bottom) return 0;
  if (y < from) return ramp(y, top - 1, from);
  if (y >= to) return ramp(y, bottom, to - 1);
  return 1;
}

/** The wordmark piece's alpha at card px (x, y) (before the master's own). */
export function wordmarkAlpha(x, y, recipe = BREAKING_NEWS_MASTHEAD_RECIPE) {
  const w = recipe.wordmark;
  if (x < w.x0 || x >= w.x1) return 0;
  const inBox = y >= recipe.boxRows[0] && y < recipe.boxRows[1];
  const inChevron = y >= recipe.chevronRows[0] && y < recipe.chevronRows[1];
  const left = inBox ? 1 : ramp(x, w.x0 - 1, w.leftOpaque);
  const right = inChevron ? (x < w.chevronOpaque ? 1 : ramp(x, w.chevronEnd, w.chevronOpaque - 1)) : x < w.opaque ? 1 : ramp(x, w.x1, w.opaque - 1);
  return left * right * rowAlpha(y, recipe);
}

/**
 * The paper piece's source at card column `x`: `[sourceColumn, weight]`
 * pairs (weights sum to 1). Copy k of the run ends on E_k = handover + fade −
 * k·step (copy 0 on 1228); on the last `fade` px of each step a copy hands
 * over to the copy right of it — and copy 0 to the master's own columns,
 * which the same formula names (the run starts on the handover).
 */
export function paperSources(x, recipe = BREAKING_NEWS_MASTHEAD_RECIPE) {
  const { run, step, handover, x0, x1 } = recipe.paper;
  const [r0, r1] = run;
  const fade = r1 - r0 - step;
  if (r0 !== handover) throw new Error("the paper's run must start on its handover");
  if (x < x0 || x >= x1) throw new Error(`column ${x} is outside the paper piece`);
  const end0 = handover + fade;
  const k = Math.floor((end0 - 1 - x) / step);
  const end = end0 - k * step;
  const own = r1 - (end - x);
  if (x < end - fade) return [[own, 1]];
  const t = ramp(x, end - fade - 1, end - 1);
  const right = r0 + (x - end + fade);
  return t >= 1 ? [[right, 1]] : [
    [own, 1 - t],
    [right, t],
  ];
}

/**
 * The two pieces of one master (RGBA, card size): `{ wordmark, paper }`, each
 * `{ data, width, height, x0, y0 }` RGBA at card px (x0, y0).
 */
export function cutMastheadPieces(master, recipe = BREAKING_NEWS_MASTHEAD_RECIPE) {
  const W = recipe.card.width;
  const [top, bottom] = recipe.rows;
  const h = bottom - top;
  const make = (x0, x1, pixel) => {
    const w = x1 - x0;
    const out = Buffer.alloc(w * h * 4);
    for (let y = top; y < bottom; y++) {
      for (let x = x0; x < x1; x++) {
        const o = ((y - top) * w + (x - x0)) * 4;
        const [r, g, b, a] = pixel(x, y);
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = a;
      }
    }
    return { data: out, width: w, height: h, x0, y0: top };
  };
  const at = (x, y) => (y * W + x) * 4;
  const wordmark = make(recipe.wordmark.x0, recipe.wordmark.x1, (x, y) => {
    const s = at(x, y);
    return [master[s], master[s + 1], master[s + 2], Math.round(master[s + 3] * wordmarkAlpha(x, y, recipe))];
  });
  const paper = make(recipe.paper.x0, recipe.paper.x1, (x, y) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (const [sx, wgt] of paperSources(x, recipe)) {
      const s = at(sx, y);
      r += master[s] * wgt;
      g += master[s + 1] * wgt;
      b += master[s + 2] * wgt;
      a += master[s + 3] * wgt;
    }
    return [Math.round(r), Math.round(g), Math.round(b), Math.round(a * rowAlpha(y, recipe))];
  });
  return { wordmark, paper };
}
