// ---------------------------------------------------------------------------
// The double-faced saga BACK's recipe (TODO 5.5 (b), PR 2) — DATA and pure
// pixel functions for scripts/build-saga-back-frames.mjs (and its unit test).
//
// No Card Conjurer pack draws the back of a card whose back face is a Saga
// (MOM's five praetors, LCI #189 Huatli, FIN's summons). Ours is a
// COMPOSITE of masters the frames bucket already publishes (owner-approved
// mock, design-backup/dfc-sagas/back-proposal.jpg):
//
//   saga/<k>          the 4.21c saga master, whole (the chapter rail, the
//                     ribbon, the art column, the border);
//   m15dfcback/<k>    the ▼ back's dark TITLE BAR and ▼ well, through Card
//                     Conjurer's 'Transform (Back) (New)' title mask, and its
//                     dark TYPE BAR, through Card Conjurer's M15 type mask —
//                     both moved down SAGA_TYPE_DY px onto the saga's type
//                     row (the saga pack's own type mask IS M15's moved down
//                     593 px: the run checks it).
//
// Then TONED onto print, before the first tick (owner 2026-10-17): the rail's
// paper to the prints' GREYED back box, and the two bars per key — with the
// importer's tone (scripts/lib/cc-frames.mjs toneSourceRegions: a per-channel
// gain through the region's mask whose colour part fades out toward white, so
// the marble, the bevels and the ▼'s white keep their shading and black stays
// black; a pixel at `from` lands on `to` exactly).
//
// `from` is what the composite reads there (the published masters' medians,
// checked by the run: a re-published master means a new look at the table),
// `to` the prints' centre — both the per-channel median of the region,
// sampled every 2 px at 1500 × 2100, the brightest 5 % and the darker 40 %
// (by luma: ink, rims) left out (UB_PRINT_TONES' reading). Regions (px):
// the title bar's text-free right half x 760–1220 × y 118–198; the type bar
// x 760–1200 × y 1791–1865 (the saga's row; m15dfcback's own 1198–1272);
// the rail's paper — the reminder box x 185–725 × 250–585 and the chapter
// column x 215–725 × 640–1740.
//
// Print (Scryfall's PNGs, read 2026-10-18; no scan is read by a build):
//   MOM #12 The Argent Etchings (w), #65 The Great Synthesis (u), #125 The
//   True Scriptures (b), #169 The Great Work (r), #213 The Grand Evolution
//   (g); LCI #189 Roar of the Fifth People (G R W → gold; LCI #296, the
//   showcase reprint, reads the same within 2 levels). The date-stamped
//   prerelease scans (PMOM #12s–#213s) are set aside for their cast (blue
//   +15–40 on every key's paper, as UB_PRINT_TONES set aside its promos').
//   That is every plain printing of a non-creature Saga back: FIN's summons
//   are saga CREATURES — another body with a P/T plate (TODO 4.5d) — and
//   REX #7's back is a land.
//
// What the reading says, key by key (composite → print, R G B):
//   • the rail's paper: the saga's near-white paper (≈ 250) reads 216 / 185 /
//     178 / 210 / 183 / 225 on the backs — the greyed box of every transform
//     back (m15dfcback's own box reads 208 / 175 / 162 / 207 / 171 / 197; the
//     prints' saga paper sits 5–15 levels above it). Every key toned;
//   • the bars — m15dfcback's, which CC drew off the transform backs: the
//     white bar 167,158,149 against MOM #12's 184,174,166 (17 lighter on the
//     print — a neutral mid-grey where CC's is a darker warm one); blue
//     65,106,143 against 51,126,184 (the prints' blue is far more saturated;
//     MID's plain transform backs read the same, 39–49 L / −37 to −45 b*);
//     black 81,77,77 against 102,99,101; red's blue channel 32 against 52;
//     green 51,80,57 against 67,105,59; gold 184,146,56 against 166,143,74.
//     Every key differs by more than 8 levels in some channel (UB's
//     threshold), so every key is toned — black and gold by the least.
// The colourless `c` (the saga's land frame under the artifact back's
// bronze bars) has no print: drawn as composited, untoned.
// ---------------------------------------------------------------------------

/** The masters' size. */
export const W = 1500;
export const H = 2100;

/** The keys the body is built in: the saga's seven (its `c` is the land
 *  frame, owner decision 2026-09-29). */
export const SAGA_BACK_KEYS = Object.freeze(["w", "u", "b", "r", "g", "m", "c"]);

/** The type bar's move: M15's type row (1181–1302 px) onto the saga's
 *  (1774–1895 px). */
export const SAGA_TYPE_DY = 593;

/** Card Conjurer's masks, read at the pinned commit (importer inputs —
 *  never published). */
export const SAGA_BACK_MASKS = Object.freeze({
  /** 'Transform (Back) (New)' title: the bar and the ▼ well (89–1418 ×
   *  98–223 px). */
  title: "img/frames/m15/transform/regular/new/maskTitle.png",
  /** The M15 type bar (2010 × 2814: resized to 1500 × 2100, 1181–1302 px). */
  type: "img/frames/m15/regular/m15MaskType.png",
  /** The saga pack's own type mask — the check that SAGA_TYPE_DY is right. */
  sagaType: "img/frames/saga/sagaMaskType.png",
  /** The saga rail's paper (the reminder box and the chapter column) … */
  sagaText: "img/frames/saga/sagaMaskText.png",
  /** … less the ribbon the badges sit on. */
  sagaBanner: "img/frames/saga/sagaMaskBanner.png",
});

/** The title tone stops short of the ▼ well (its circle starts at 1271 px,
 *  84.7 %W): full weight to x = 1240, none from 1262 — the well's black disc
 *  and its white ▼ are m15dfcback's as published. */
export const TITLE_TONE_FADE_PX = Object.freeze({ from: 1240, to: 1262 });

/** The prints' tones (see the header): per key, region → { from, to }. */
export const SAGA_BACK_TONES = Object.freeze({
  w: Object.freeze({
    title: Object.freeze({ from: [167, 158, 149], to: [184, 174, 166] }),
    type: Object.freeze({ from: [166, 157, 148], to: [179, 168, 162] }),
    paper: Object.freeze({ from: [252, 252, 248], to: [216, 211, 203] }),
  }),
  u: Object.freeze({
    title: Object.freeze({ from: [65, 106, 143], to: [51, 126, 184] }),
    type: Object.freeze({ from: [65, 106, 143], to: [43, 127, 175] }),
    paper: Object.freeze({ from: [239, 247, 251], to: [185, 201, 219] }),
  }),
  b: Object.freeze({
    title: Object.freeze({ from: [81, 77, 77], to: [102, 99, 101] }),
    type: Object.freeze({ from: [86, 81, 80], to: [102, 99, 100] }),
    paper: Object.freeze({ from: [236, 237, 236], to: [178, 177, 175] }),
  }),
  r: Object.freeze({
    title: Object.freeze({ from: [178, 70, 32], to: [180, 74, 52] }),
    type: Object.freeze({ from: [178, 70, 32], to: [180, 72, 50] }),
    paper: Object.freeze({ from: [252, 241, 239], to: [210, 186, 176] }),
  }),
  g: Object.freeze({
    title: Object.freeze({ from: [51, 80, 57], to: [67, 105, 59] }),
    type: Object.freeze({ from: [51, 79, 57], to: [64, 102, 54] }),
    paper: Object.freeze({ from: [242, 246, 243], to: [183, 193, 186] }),
  }),
  m: Object.freeze({
    title: Object.freeze({ from: [184, 146, 56], to: [166, 143, 74] }),
    type: Object.freeze({ from: [184, 147, 57], to: [166, 141, 70] }),
    paper: Object.freeze({ from: [251, 248, 239], to: [225, 217, 190] }),
  }),
});

/** The reading regions (px at 1500 × 2100) — `from` is re-read on the
 *  composite by the run, `to` was read on the prints the same way. */
export const SAGA_BACK_READ_REGIONS = Object.freeze({
  title: Object.freeze([[760, 118, 1220, 198]]),
  type: Object.freeze([[760, 1791, 1200, 1865]]),
  paper: Object.freeze([
    [185, 250, 725, 585],
    [215, 640, 725, 1740],
  ]),
});

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** UB_PRINT_TONES' reading of an RGBA buffer: the per-channel median of the
 *  rects' pixels (every 2 px, opaque only), the brightest 5 % and the darker
 *  40 % by luma left out. */
export function readTone(rgba, rects, width = W) {
  const px = [];
  for (const [l, t, r, b] of rects) {
    for (let y = t; y < b; y += 2) {
      for (let x = l; x < r; x += 2) {
        const i = (y * width + x) * 4;
        if (rgba[i + 3] < 255) continue;
        px.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
      }
    }
  }
  px.sort((a, b) => luma(...a) - luma(...b));
  const keep = px.slice(Math.floor(px.length * 0.4), Math.floor(px.length * 0.95));
  return [0, 1, 2].map((c) => {
    const s = keep.map((p) => p[c]).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  });
}

/** An alpha plane (0–255) moved down `dy` rows (rows above it empty). */
export function shiftPlane(plane, width, height, dy) {
  const out = new Uint8Array(width * height);
  for (let y = Math.max(0, dy); y < height; y += 1) {
    const src = y - dy;
    if (src < 0 || src >= height) continue;
    out.set(plane.subarray(src * width, src * width + width), y * width);
  }
  return out;
}

/** An RGBA buffer moved down `dy` rows (rows above it transparent). */
export function shiftRgba(buf, width, height, dy) {
  const out = Buffer.alloc(width * height * 4);
  for (let y = Math.max(0, dy); y < height; y += 1) {
    const src = y - dy;
    if (src < 0 || src >= height) continue;
    buf.copy(out, y * width * 4, src * width * 4, src * width * 4 + width * 4);
  }
  return out;
}

/** `top` laid over `base` through `mask` (0–255): every channel, alpha
 *  included, lerped by the mask's weight. Returns the number of pixels the
 *  mask touched. In place on `base`. */
export function blendThrough(base, top, mask) {
  let touched = 0;
  for (let p = 0; p < mask.length; p += 1) {
    const m = mask[p];
    if (m === 0) continue;
    touched += 1;
    const o = p * 4;
    const w = m / 255;
    for (let c = 0; c < 4; c += 1) base[o + c] = Math.round(base[o + c] * (1 - w) + top[o + c] * w);
  }
  return touched;
}

/** The title tone's coverage: the title mask, faded out toward the well. */
export function titleToneMask(titleMask, width = W, fade = TITLE_TONE_FADE_PX) {
  const out = new Uint8Array(titleMask.length);
  for (let p = 0; p < titleMask.length; p += 1) {
    const x = p % width;
    const k = x <= fade.from ? 1 : x >= fade.to ? 0 : (fade.to - x) / (fade.to - fade.from);
    out[p] = Math.round(titleMask[p] * k);
  }
  return out;
}

/** The paper tone's coverage: the rail's text mask less the ribbon's. */
export function paperToneMask(textMask, bannerMask) {
  const out = new Uint8Array(textMask.length);
  for (let p = 0; p < textMask.length; p += 1) out[p] = Math.round((textMask[p] * (255 - bannerMask[p])) / 255);
  return out;
}

/** The summed difference between two planes. */
export function planeL1(a, b) {
  let sum = 0;
  for (let p = 0; p < a.length; p += 1) sum += Math.abs(a[p] - b[p]);
  return sum;
}
