// ---------------------------------------------------------------------------
// The colourless modal double-faced card's SEE-THROUGH masters (TODO 5.11a)
// — DATA and pure pixel functions for scripts/build-mdfc-colourless-frames.mjs
// (and its unit test).
//
// STX #6 Wandering Archaic // Explore the Vastlands is the one modal card
// whose faces are colourless with no Artifact word (Scryfall 2026-10-28:
// STX #6, PSTX #6s, STX #286 extended art; PRM #90338 is MTGO only). Both
// faces print the SEE-THROUGH colourless frame — m15/c's grey bars and box
// with the art showing through the frame field — with the modal HOUSING at
// the name bar's left and the flipside STRIP at the box's bottom left. Card
// Conjurer's 'Modal Regular' pack draws Artifact and Land frames only, so
// the bodies' `c` has been the artifact master standing in (design D2).
//
// Ours is a COMPOSITE of masters the frames bucket already publishes, laid
// through Card Conjurer's own modal masks (read at the pinned commit,
// importer inputs, never published) — the pack's layer recipe with m15/c's
// see-through pieces in place of the artifact frame's:
//
//   base              m15mdfc{front,back}/a — the artifact modal master: the
//                     border, the housing's outline and everything no mask
//                     below replaces;
//   frame.svg         ← m15/c (the see-through frame field, α 28, its art
//                     window and outlines);
//   textbox.svg       ← m15/c's box (α 179; the strip's box stays cut out);
//   m15MaskType.png   ← m15/c's type bar (α 212);
//   title.svg         ← m15/c's title bar right of the housing (x ≥ BAR_X)
//                     and, in the housing's drop, m15/c's bar ROW BY ROW
//                     (the per-row median of x ROW_FILL_X: the housing's
//                     fill is the bar's, as CC's Title mask holds both),
//                     with the modal master's ▲ (front) / ▲▼ (back) and the
//                     drop's dark inner edge laid back over it
//                     (housingGlyphWeight: a pixel ARROW_LUMA_GAP or more
//                     off the bar's luma in its row is the glyph's);
//   pinline.svg       ← the modal master's lines (the housing's ring among
//                     them) toned onto m15/c's pinline (PINLINE_TONE);
//   reminder.svg      ← the modal master's strip (the tab, its ◀, its
//                     outline) — on the FRONT toned onto print's warm grey
//                     tab (FRONT_STRIP_TONE), the back's as published.
//
// The BACK's bars and box are DARKER than the front's on print (every modal
// back's are; STX #6's: the title bar 156,150,154, the type bar 140,133,138,
// the box 176,174,184 against the front's 212,209,223 / 199,196,211 /
// 196,196,213). Both faces show the SAME card's art through the same frame,
// so the back takes m15/c's pieces scaled by the print's back ÷ front LUMA
// ratio per region (BACK_LUMA_GAINS: the hue stays m15/c's neutral grey —
// the prints' casts follow the art under them, cold snow on the front, warm
// sunset on the back), applied before the glyphs, so the ▲▼ stay white.
//
// Print (Scryfall's PNGs at 745 × 1040, read 2026-10-28, resized to
// 1500 × 2100 with Lanczos; readOpaqueTone's reading — the per-channel
// median of the rect sampled every 2 px, the darker 40 % and brightest 5 %
// by luma left out; no scan is read by a build):
//   region (px)                         STX #6 front  STX #6 back   ours (master)
//   title bar 760–1220 × 118–198         212,209,223   156,150,154   front 206,204,202 · back ×0.720
//   type bar  760–1200 × 1198–1272       199,196,211   140,133,138   front 206,204,202 · back ×0.687
//   text box  300–1100 × 1340–1820       196,196,213   176,174,184   front 243,242,240 · back ×0.887
//   strip     280–580 × 1880–1935        120,106,104   226,220,230   modal a 124,128,138 → 120,106,104 · back 223,225,229 (kept: within 6)
// PSTX #6s (the prerelease stamp) reads the same frame with a blue cast
// (+15–40 on B, as the saga back's prerelease scans) — set aside; STX #286
// is the EXTENDED-art printing (no frame field; TODO 5.7b) — its strip
// reads 114,98,85, beside STX #6's.
// ---------------------------------------------------------------------------
import { blendThrough } from "./saga-back.mjs";

export { blendThrough };

/** The masters' size. */
export const W = 1500;
export const H = 2100;

/** The two spell bodies whose `c` this builds, and the published masters
 *  each is composed from. */
export const MDFC_COLOURLESS_BODIES = Object.freeze({
  m15mdfcfront: Object.freeze({ base: "m15mdfcfront/a", face: "front" }),
  m15mdfcback: Object.freeze({ base: "m15mdfcback/a", face: "back" }),
});
/** The see-through colourless master both are composed with (4.17). */
export const SEE_THROUGH_MASTER = "m15/c";

/** Card Conjurer's masks, read at the pinned commit (importer inputs —
 *  never published): the modal pack's SVGs (1500 × 2100) and the regular
 *  M15 type mask (2010 × 2814, resized once, lanczos3, as the importer). */
export const MDFC_COLOURLESS_MASKS = Object.freeze({
  frame: "img/frames/modal/regular/frame.svg",
  rules: "img/frames/modal/regular/textbox.svg",
  type: "img/frames/m15/regular/m15MaskType.png",
  title: "img/frames/modal/regular/title.svg",
  pinline: "img/frames/modal/regular/pinline.svg",
  reminder: "img/frames/modal/regular/reminder.svg",
});

/** The title mask's bar starts here, right of the housing's ring (the
 *  mask is 0 on x 200–219, the ring's gap): from here on the bar is
 *  m15/c's own, left of it the housing's drop is filled row by row. */
export const BAR_X = 220;
/** The columns whose per-row median is the housing's fill (m15/c's flat
 *  bar, clear of its caps and of the name's place). */
export const ROW_FILL_X = Object.freeze([400, 1100]);
/** How far off the bar's luma (in its row) a pixel of the modal master's
 *  housing must be to count as the glyph or the drop's edge; the weight
 *  reaches 1 at black (front) or white (back). */
export const ARROW_LUMA_GAP = 12;

/** The back's pieces (see the header): print's back ÷ front luma, per
 *  region, read on STX #6 (both faces, one scan each). */
export const BACK_LUMA_GAINS = Object.freeze({
  title: 0.72,
  type: 0.687,
  rules: 0.887,
});

/** The modal masters' lines (the housing's ring, the bars' and box's
 *  outlines, the strip's) toned onto m15/c's: `from` the modal artifact
 *  master's median under the pinline mask on x 400–1100 (opaque, luma >
 *  150 — the light line, not its dark edges), `to` m15/c's own lines there
 *  (they coincide right of the housing). Re-read on every run (±2). */
export const PINLINE_TONE = Object.freeze({
  front: Object.freeze({ from: [246, 247, 245], to: [223, 224, 224] }),
  back: Object.freeze({ from: [246, 247, 245], to: [223, 224, 224] }),
});

/** The FRONT strip toned onto STX #6's warm grey tab (the region above);
 *  the ◀ and the light outline kept (STRIP_TONE_LUMA_RAMP). */
export const FRONT_STRIP_TONE = Object.freeze({ from: [124, 128, 138], to: [120, 106, 104] });
/** A strip pixel at or below this luma takes the whole tone, none from the
 *  second (smoothstep between): the tab's fill tones, its white ◀ doesn't. */
export const STRIP_TONE_LUMA_RAMP = Object.freeze([150, 200]);

/** The reading regions (px at 1500 × 2100). */
export const READ_REGIONS = Object.freeze({
  title: Object.freeze([[760, 118, 1220, 198]]),
  type: Object.freeze([[760, 1198, 1200, 1272]]),
  rules: Object.freeze([[300, 1340, 1100, 1820]]),
  strip: Object.freeze([[280, 1880, 580, 1935]]),
});
/** m15/c's own readings there (alpha ignored): the run re-reads them and
 *  refuses a drift past 2 levels — a re-published m15/c is a new look. */
export const SEE_THROUGH_READS = Object.freeze({
  title: Object.freeze([206, 204, 202]),
  type: Object.freeze([206, 204, 202]),
  rules: Object.freeze([243, 242, 240]),
});

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** readTone (scripts/lib/saga-back.mjs) on every pixel with any alpha —
 *  the see-through master's bars are α 212, its box α 179. */
export function readOpaqueTone(rgba, rects, width = W, minAlpha = 1, minLuma = -1) {
  const px = [];
  for (const [l, t, r, b] of rects) {
    for (let y = t; y < b; y += 2) {
      for (let x = l; x < r; x += 2) {
        const i = (y * width + x) * 4;
        if (rgba[i + 3] < minAlpha) continue;
        if (luma(rgba[i], rgba[i + 1], rgba[i + 2]) <= minLuma) continue;
        px.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
      }
    }
  }
  if (px.length === 0) throw new Error("readOpaqueTone: no pixel read");
  px.sort((a, b) => luma(...a) - luma(...b));
  const keep = px.slice(Math.floor(px.length * 0.4), Math.max(Math.floor(px.length * 0.4) + 1, Math.floor(px.length * 0.95)));
  return [0, 1, 2].map((c) => {
    const s = keep.map((p) => p[c]).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  });
}

/** The median of a pinline mask's light line on x 400–1100: opaque pixels
 *  under full mask coverage with luma > 150. */
export function readPinline(rgba, pinlineMask, width = W, height = H) {
  const px = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 400; x < 1100; x += 1) {
      const p = y * width + x;
      if (pinlineMask[p] < 255) continue;
      const i = p * 4;
      if (rgba[i + 3] < 255) continue;
      if (luma(rgba[i], rgba[i + 1], rgba[i + 2]) <= 150) continue;
      px.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
    }
  }
  if (px.length === 0) throw new Error("readPinline: no line pixel");
  return [0, 1, 2].map((c) => {
    const s = px.map((q) => q[c]).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  });
}

/** The housing's fill, per row: the per-channel median (alpha included) of
 *  `src` on x ROW_FILL_X. Returns H × 4 bytes. */
export function rowFillOf(src, width = W, height = H, [x0, x1] = ROW_FILL_X) {
  const out = new Uint8Array(height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let c = 0; c < 4; c += 1) {
      const s = [];
      for (let x = x0; x < x1; x += 1) s.push(src[(y * width + x) * 4 + c]);
      s.sort((a, b) => a - b);
      out[y * 4 + c] = s[Math.floor(s.length / 2)];
    }
  }
  return out;
}

/** The modal master's per-row bar luma on x ROW_FILL_X (the reference a
 *  housing pixel is judged against). Returns H floats. */
export function rowLumaOf(rgba, width = W, height = H, [x0, x1] = ROW_FILL_X) {
  const out = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    const s = [];
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      s.push(luma(rgba[i], rgba[i + 1], rgba[i + 2]));
    }
    s.sort((a, b) => a - b);
    out[y] = s[Math.floor(s.length / 2)];
  }
  return out;
}

/** How much a housing pixel of the modal master is GLYPH (or the drop's
 *  dark edge) rather than fill: 0 within ARROW_LUMA_GAP of the bar's luma
 *  in its row, rising to 1 at black (darker) or white (lighter). */
export function housingGlyphWeight(l, rowLuma, gap = ARROW_LUMA_GAP) {
  const d = l - rowLuma;
  if (Math.abs(d) <= gap) return 0;
  const span = d < 0 ? rowLuma - gap : 255 - rowLuma - gap;
  if (span <= 0) return 1;
  return Math.min(1, (Math.abs(d) - gap) / span);
}

/**
 * The TITLE layer (what title.svg lays over the base): `see` (m15/c, toned
 * for a back) right of BAR_X; left of it the row fill of `see` with the
 * modal master's glyph laid over it by housingGlyphWeight (the glyph's own
 * pixels, opaque). Returns a new W × H RGBA buffer.
 */
export function titleLayer(see, modal, width = W, height = H) {
  const out = Buffer.from(see);
  const fill = rowFillOf(see, width, height);
  const rowLuma = rowLumaOf(modal, width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < BAR_X; x += 1) {
      const i = (y * width + x) * 4;
      const k = housingGlyphWeight(luma(modal[i], modal[i + 1], modal[i + 2]), rowLuma[y]);
      for (let c = 0; c < 3; c += 1) out[i + c] = Math.round(fill[y * 4 + c] * (1 - k) + modal[i + c] * k);
      out[i + 3] = Math.round(fill[y * 4 + 3] * (1 - k) + 255 * k);
    }
  }
  return out;
}

/** Every colour channel of `buf` multiplied by `gain` through a mask's
 *  coverage (alpha kept). In place; returns the pixels touched. */
export function scaleThrough(buf, mask, gain) {
  let touched = 0;
  for (let p = 0; p < mask.length; p += 1) {
    const m = mask[p];
    if (m === 0) continue;
    touched += 1;
    const g = 1 + (gain - 1) * (m / 255);
    const o = p * 4;
    for (let c = 0; c < 3; c += 1) buf[o + c] = Math.min(255, Math.round(buf[o + c] * g));
  }
  return touched;
}

/** A per-channel tone `from → to` through a mask, fading to nothing
 *  between the ramp's luma (smoothstep): the strip's fill tones, its white
 *  ◀ and its light outline keep their pixels. In place. */
export function toneThrough(buf, mask, tone, [lo, hi] = STRIP_TONE_LUMA_RAMP) {
  const gain = tone.to.map((t, c) => t / tone.from[c]);
  let touched = 0;
  for (let p = 0; p < mask.length; p += 1) {
    const m = mask[p];
    if (m === 0) continue;
    const o = p * 4;
    const l = luma(buf[o], buf[o + 1], buf[o + 2]);
    const s = l <= lo ? 0 : l >= hi ? 1 : (l - lo) / (hi - lo);
    const t = 1 - s * s * (3 - 2 * s);
    if (t === 0) continue;
    touched += 1;
    const w = (m / 255) * t;
    for (let c = 0; c < 3; c += 1) buf[o + c] = Math.min(255, Math.max(0, Math.round(buf[o + c] * (1 + (gain[c] - 1) * w))));
  }
  return touched;
}
