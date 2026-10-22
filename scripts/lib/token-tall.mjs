// ---------------------------------------------------------------------------
// The arch token's TALL text box (TODO 4.55): the recipe and the one cut,
// as DATA. scripts/build-token-tall-frames.mjs applies it to the published
// m15tokentext / m15tokenartifacttext masters; tests/unit/frames/
// token-tall-recut.test.ts holds the cut, and lib/cards/template-layout.ts
// (TOKEN_TALL_UP_PX) rides the same distance — a unit test keeps the two
// equal.
//
// MEASURED ON PRINT (2026-10-18; Scryfall PNGs at 745 × 1040 scaled to
// 1500 × 2100, for measuring only — no scan is read by the build). The 21
// tall-box printings (TAKH #1/5/6/12/15, THOU #2/3/4/6, TC18 #4/10/19, TSOI
// #11–16, TDOM #7, TRIX #1, TUST #18), each against the published
// m15tokentext / m15tokenartifacttext master of its colour (w, b, r, the
// artifact dress's c), by the correlation of the rows' vertical edges
// (columns 150–1350):
//   • the title bar, the window's top and arch: 0 … +3 px (the scans' own
//     offset; TDOM #2 / TM19 #1, regular boxes, read the same);
//   • the type pill: 234–239 px HIGHER (median 237), 235–241 against each
//     print's own title-to-box-bottom offset (median 238.5);
//   • the box's top edge: 233–238 px higher (median 236.5), the window's
//     bottom edge with them (its art-dependent reading 233–237 on the prints
//     whose art is light at the edge);
//   • the box's bottom edge, the plate and the border: where the master
//     draws them (−1 … +7 px, the scans' tilt);
//   • the type line's capitals 1211–1214 px (median 1213; the regular box's
//     1450–1451), its baseline 1262–1266 (no descender) against the regular
//     1500: the line rides the pill; left from x 124–127 as on the regular;
//   • the rules' ink centred in the taller box (TAKH #1 1412–1849, TSOI #11
//     1467–1788, TC18 #4 1479–1791, THOU #2 1484–1759: centres 1621–1635,
//     the drawn box's 1634);
//   • the box's tone: the regular box's within the prints' spread (box ÷
//     master median, R G B: TC18 #4 1.00 / 0.99 / 0.98, TDOM #2 regular
//     1.00 / 0.99 / 0.98; Amonkhet's warmer stock 0.99 / 0.98 / 0.92 sits in
//     its frame's own shift; the SOI Clues 0.97 / 0.98 / 0.99 against XLN's
//     regular Treasures 0.91 / 0.94 / 0.98) — no re-tone.
// So ONE distance, 238 px (11.33 %H): everything from the window's straight
// sides through the top of the text box moves up as one piece, and the box
// is 238 px taller. Nothing else of the master changes.
//
// THE CUT (pure row moves, premultiplied cross-fades; nothing drawn):
//   rows [fromY, toY) land `up` px higher. Below the moved band the box
//   gains `up` rows [toY − up, toY), filled by columns:
//     • the BOX columns [boxLeft, boxRight) — the paper between the frame's
//       pinlines (x 111–1388 on every master; above them, the window and its keyline) —
//       continue the moved band: rows toY … toY + up − 1 of the box's own
//       paper, so the box reads as one taller box; their seam with the
//       original rows at toY is cross-faded over `blendBottom` rows;
//     • the SIDE columns (the black border, the frame's texture, its shadow
//       line and pinline: identical in structure beside the window and
//       beside the box) take the rows `up` px ABOVE them in the source —
//       beside the window's straight sides — so the frame's lower inner
//       corner (from ~1770) is never repeated; cross-faded from the moved
//       band over `blendSide` rows and into the original rows over
//       `blendBottom`.
//   The top seam (inside the window's straight sides, where only the side
//   texture meets it) fades from the original rows over `blendTop` rows, as
//   the tokens' other re-cuts do.
// Native px of the masters (1500 × 2100).
// ---------------------------------------------------------------------------

export const TOKEN_TALL_RECIPE = Object.freeze({
  width: 1500,
  height: 2100,
  /** How far the band moves up (HD px): the prints' 238. */
  up: 238,
  /** First row of the moved band: the window's straight sides (they run
   *  from row 560 to 1404 on every master; 1300 − 238 = 1062 is still
   *  inside them). */
  fromY: 1300,
  /** One past the band's last row: inside the box's paper (the box's top
   *  edge and shadow end on row 1561; 1562–1589 is paper). */
  toY: 1590,
  /** The box's paper columns (between the pinlines), exclusive end. */
  boxLeft: 111,
  boxRight: 1389,
  blendTop: 24,
  blendSide: 24,
  blendBottom: 24,
  /** template → the published master it is cut from. */
  templates: {
    m15tokentall: "m15tokentext",
    m15tokenartifacttall: "m15tokenartifacttext",
  },
  keys: ["w", "u", "b", "r", "g", "m", "c"],
});

/** Refuse a recipe the cut can't apply. */
function checkRecipe(r) {
  const ints = [r.up, r.fromY, r.toY, r.boxLeft, r.boxRight, r.blendTop, r.blendSide, r.blendBottom];
  const ok =
    ints.every(Number.isInteger) &&
    r.up > 0 &&
    r.fromY - r.up >= 0 &&
    r.toY > r.fromY &&
    r.toY + r.up <= r.height &&
    r.boxLeft > 0 &&
    r.boxRight > r.boxLeft &&
    r.boxRight < r.width &&
    r.fromY - r.up + r.blendTop <= r.toY - r.up &&
    r.toY - r.up + r.blendSide <= r.toY - r.blendBottom &&
    // the side rows of the gained box come from the moved band's own rows
    // above it (beside the window), never from rows the cut overwrites
    r.toY - 2 * r.up >= 0;
  if (!ok) throw new Error(`token-tall: bad recipe ${JSON.stringify(r)}`);
}

/**
 * Cut the tall box out of an 8-bit RGBA text-box master (TOKEN_TALL_RECIPE).
 * Returns a new buffer; every row above `fromY − up` and from `toY` on is
 * the source's, byte for byte.
 */
export function recutTokenTall(buf, recipe = TOKEN_TALL_RECIPE) {
  checkRecipe(recipe);
  const { width: W, height: H, up, fromY, toY, boxLeft, boxRight, blendTop, blendSide, blendBottom } = recipe;
  if (buf.length !== W * H * 4) throw new Error(`token-tall: expected ${W}×${H} RGBA, got ${buf.length} bytes`);
  const out = Buffer.from(buf);
  const top = fromY - up;
  const fill = toY - up;
  // A source row's pixel, premultiplied: [r·a, g·a, b·a, a] with a in 0..1.
  const px = (y, x) => {
    const o = (y * W + x) * 4;
    const a = buf[o + 3] / 255;
    return [buf[o] * a, buf[o + 1] * a, buf[o + 2] * a, a];
  };
  // The cut's own pixel (before the fades into the original rows).
  const base = (y, x) => {
    const box = x >= boxLeft && x < boxRight;
    if (y < fill || box) return px(y + up, x);
    // Side columns of the gained rows: the rows `up` above them, faded in
    // from the moved band's continuation.
    const t = y < fill + blendSide ? (y - fill + 1) / (blendSide + 1) : 1;
    const a = px(y - up, x);
    if (t >= 1) return a;
    const b = px(y + up, x);
    return b.map((v, i) => v * (1 - t) + a[i] * t);
  };
  for (let y = top; y < toY; y += 1) {
    let tOrig = 0; // weight of the ORIGINAL row y
    if (y < top + blendTop) tOrig = 1 - (y - top + 1) / (blendTop + 1);
    else if (y >= toY - blendBottom) tOrig = (y - (toY - blendBottom) + 1) / (blendBottom + 1);
    for (let x = 0; x < W; x += 1) {
      const c = base(y, x);
      const m = tOrig > 0 ? c.map((v, i) => v * (1 - tOrig) + px(y, x)[i] * tOrig) : c;
      const o = (y * W + x) * 4;
      const alpha = m[3];
      for (let k = 0; k < 3; k += 1) out[o + k] = alpha === 0 ? 0 : Math.min(255, Math.round(m[k] / alpha));
      out[o + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}
