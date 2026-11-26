// ---------------------------------------------------------------------------
// The SAGA CREATURE's BACK recipe (TODO 4.5d, part B) — DATA and pure pixel
// functions for scripts/build-saga-creature-back-frames.mjs (and its unit
// test).
//
// Final Fantasy's Dominants transform into summons whose BACK face is a saga
// CREATURE (FIN #13 Summon: Alexander, #16 Bahamut, Warden of Light, #58
// Shiva, #104 Braska's Final Aeon, #133 Ifrit, #185 Summon: Esper Maduin,
// #229 Phoenix, #245 Esper Terra and their PFIN prerelease twins): the saga
// creature body of part A (the textured saga, the reminder band, the type bar
// raised 173 px, the second box and the P/T plate) under the ▼ transform
// back's dark bars. No Card Conjurer or MSE pack draws it. Ours is a
// COMPOSITE of masters the frames bucket already publishes, the way the
// double-faced saga back (scripts/lib/saga-back.mjs, TODO 5.5 (b) PR 2) is:
//
//   sagacreature/<k>  the part A master, whole (the band, the rail, the art
//                     column, the raised type bar, the second box, the
//                     border);
//   m15dfcback/<k>    the ▼ back's dark TITLE BAR and ▼ well, through Card
//                     Conjurer's 'Transform (Back) (New)' title mask (the
//                     title row is M15's on both), and its dark TYPE BAR,
//                     through Card Conjurer's M15 type mask moved down
//                     TYPE_DY px onto the saga creature's raised type row —
//                     the saga's 593 less the 173 the body raises it (the
//                     run checks that the moved mask is the saga pack's own
//                     type mask raised 173 px, no other move within ±2 rows
//                     fitting better).
//
// Then TONED onto print before the first tick, as the saga back was (owner
// 2026-10-17), with the importer's tone (scripts/lib/cc-frames.mjs
// toneSourceRegions: a per-channel gain through the region's coverage whose
// colour part fades out toward white — the marble, the bevels and the ▼'s
// white keep their shading, black stays black; a pixel at `from` lands on
// `to` exactly):
//   • the PAPER — the reminder band, the chapter column and the second box —
//     to the printed backs' greyed box (the part A master's near-white
//     paper reads 204,195,176 on a white back: the box of every transform
//     back is greyed);
//   • the TITLE and TYPE bars per key, m15dfcback's as Card Conjurer drew
//     them, onto FIN's.
// `from` is what the composite reads (re-read by the run: a re-published
// master means a new look at the table), `to` the prints' — both the
// per-channel median of the region, sampled every 2 px at 1500 × 2100, the
// brightest 5 % and the darker 40 % (by luma: ink, rims) left out (the saga
// back's reading, saga-back.mjs readTone). Regions (px): the title bar's
// right end x 1090–1240 × y 118–198 (clear of every printed name: Bahamut,
// Warden of Light's ink ends at ≈ 1054); the type bar's face under the
// type line x 200–1300 × y 1692–1708 (the summons' type lines run to ≈ 1350
// px); the paper — the band x 185–725 × 250–420, the chapter column x
// 215–725 × 470–1560 and the second box x 150–1250 × 1750–1930 (left of
// the plate).
//
// Print (Scryfall's PNGs at 1500 × 2100, read 2026-11-25; no scan is read by
// a build): FIN #13 + #16 (w, pooled), #58 (u), #104 (b), #133 (r), #185
// (g); the gold BARS of #229 Phoenix (R W) and #245 Esper Terra (G R),
// pooled — every two-colour summon prints the two-colour dress (gold bars,
// each half's paper and frame in its colour: the pair masters are a
// follow-up), so no print shows a gold back's PAPER: `m`'s paper goes to the
// printed gold saga back's (LCI #189 Roar of the Fifth People, the saga
// back's reading — SAGA_BACK_TONES.m.paper.to). The date-stamped prerelease
// scans (PFIN #16s–#245s) are set aside for their cast (blue +10–60 on
// every key's paper), as the saga back set PMOM's aside. The colourless `c`
// (the part A master's artifact silver under m15dfcback/c's bronze bars) has
// no print — no colourless summon is double-faced: drawn as composited,
// untoned.
// ---------------------------------------------------------------------------

import { BAND_CUT, BAND_FILL, BOX_TOP, FOLD_SQUEEZE, LOWER_FROM, RAIL_CUT, ROWS_CUT } from "./saga-creature.mjs";
import { SAGA_BACK_TONES, SAGA_TYPE_DY } from "./saga-back.mjs";

/** The masters' size. */
export const W = 1500;
export const H = 2100;

/** The template. */
export const TEMPLATE = "sagacreaturedfcback";

/** The keys: the part A body's seven (its `c` the artifact silver). */
export const SAGA_CREATURE_BACK_KEYS = Object.freeze(["w", "u", "b", "r", "g", "m", "c"]);

/** The type bar's move: M15's type row (1181–1302 px) onto the saga
 *  creature's raised one (the saga's 1774–1895, − 173). */
export const TYPE_DY = SAGA_TYPE_DY - ROWS_CUT;

/** Card Conjurer's masks, read at the pinned commit (importer inputs —
 *  never published). */
export const SAGA_CREATURE_BACK_MASKS = Object.freeze({
  /** 'Transform (Back) (New)' title: the bar and the ▼ well (89–1418 ×
   *  98–223 px). */
  title: "img/frames/m15/transform/regular/new/maskTitle.png",
  /** The M15 type bar (2010 × 2814: resized to 1500 × 2100, 1181–1302 px). */
  type: "img/frames/m15/regular/m15MaskType.png",
  /** The saga pack's own type mask — raised 173 px, the check of TYPE_DY. */
  sagaType: "img/frames/saga/sagaMaskType.png",
  /** The saga rail's paper (the reminder box and the chapter column) … */
  sagaText: "img/frames/saga/sagaMaskText.png",
  /** … less the ribbon the badges sit on. */
  sagaBanner: "img/frames/saga/sagaMaskBanner.png",
  /** M15's text box: the second box's rows (m15nyx's, as part A drew them). */
  rules: "img/frames/m15/regular/m15MaskRules.png",
});

/** The title tone stops short of the ▼ well (its circle starts at 1271 px):
 *  full weight to x = 1240, none from 1262 — the saga back's fade. */
export const TITLE_TONE_FADE_PX = Object.freeze({ from: 1240, to: 1262 });

/** The reading regions (px at 1500 × 2100) — `from` is re-read on the
 *  composite by the run, `to` was read on the prints the same way. */
export const SAGA_CREATURE_BACK_READ_REGIONS = Object.freeze({
  title: Object.freeze([[1090, 118, 1240, 198]]),
  type: Object.freeze([[200, 1692, 1300, 1708]]),
  paper: Object.freeze([
    [185, 250, 725, 420],
    [215, 470, 725, 1560],
    [150, 1750, 1250, 1930],
  ]),
});

/** The prints' tones (see the header): per key, region → { from, to }. */
export const SAGA_CREATURE_BACK_TONES = Object.freeze({
  w: Object.freeze({
    title: Object.freeze({ from: [162, 153, 142], to: [175, 164, 137] }),
    type: Object.freeze({ from: [165, 155, 146], to: [177, 166, 140] }),
    paper: Object.freeze({ from: [252, 251, 248], to: [204, 194, 175] }),
  }),
  u: Object.freeze({
    title: Object.freeze({ from: [61, 103, 139], to: [63, 132, 189] }),
    type: Object.freeze({ from: [66, 107, 144], to: [58, 131, 188] }),
    paper: Object.freeze({ from: [239, 247, 252], to: [141, 179, 217] }),
  }),
  b: Object.freeze({
    title: Object.freeze({ from: [86, 82, 80], to: [63, 58, 52] }),
    type: Object.freeze({ from: [86, 81, 79], to: [62, 56, 51] }),
    paper: Object.freeze({ from: [236, 238, 237], to: [195, 192, 187] }),
  }),
  r: Object.freeze({
    title: Object.freeze({ from: [178, 70, 32], to: [234, 107, 76] }),
    type: Object.freeze({ from: [178, 69, 32], to: [233, 104, 73] }),
    paper: Object.freeze({ from: [252, 242, 239], to: [235, 168, 143] }),
  }),
  g: Object.freeze({
    title: Object.freeze({ from: [52, 79, 57], to: [68, 130, 90] }),
    type: Object.freeze({ from: [51, 79, 57], to: [64, 127, 90] }),
    paper: Object.freeze({ from: [242, 246, 243], to: [145, 175, 154] }),
  }),
  m: Object.freeze({
    title: Object.freeze({ from: [161, 132, 59], to: [198, 171, 87] }),
    type: Object.freeze({ from: [182, 146, 57], to: [196, 172, 85] }),
    paper: Object.freeze({ from: [251, 248, 239], to: SAGA_BACK_TONES.m.paper.to }),
  }),
});

// ---------------------------------------------------------------------------
// The P/T PLATES. The prints set the P/T on the dark back's plate (the ▼
// back's: white digits on the bar's colour), but in FIN's tones — and our
// bars are toned onto FIN's, so the ▼ back's plates as Card Conjurer drew
// them would sit beside them a shade off (r 152,55,27 against the prints'
// 225,97,73; g 48,86,51 against 66,132,93). Each body plate is therefore
// m15dfcback/pt/<k> toned the same way onto FIN's plate (the same tone, the
// whole plate its region; its alpha untouched, so its ink geometry is the ▼
// back's). Read as the profile draws it — resized onto the plate box
// (PLATE_PLACEMENT, 75.73 / 88.48 % × 18.8 / 7.33 % of the card, lanczos3)
// — on the plate's face left and right of the digits (PLATE_READ_REGIONS),
// the saga back's reading: FIN #13 + #16 (w, pooled; extended-art #428
// reads the same within 2 levels), #58 (u), #104 (b), #133 (r), #185 (g),
// #229 + #245 (m: the two-colour summons' gold plate, pooled). `c` has no
// print: m15dfcback/pt/c as published, byte for byte.
// ---------------------------------------------------------------------------

/** The plate box the profile draws (M15.pt.plateRect), HD px. */
export const PLATE_PLACEMENT = Object.freeze({ left: 1136, top: 1858, width: 282, height: 154 });
/** The plate's face beside the digits, HD px of the card. */
export const PLATE_READ_REGIONS = Object.freeze([
  [1185, 1900, 1200, 1975],
  [1385, 1900, 1395, 1975],
]);
export const PLATE_KEYS = Object.freeze(["w", "u", "b", "r", "g", "m", "c"]);
export const PLATE_TONES = Object.freeze({
  w: Object.freeze({ plate: Object.freeze({ from: [175, 162, 154], to: [171, 161, 137] }) }),
  u: Object.freeze({ plate: Object.freeze({ from: [55, 107, 154], to: [59, 130, 189] }) }),
  b: Object.freeze({ plate: Object.freeze({ from: [93, 85, 83], to: [72, 66, 60] }) }),
  r: Object.freeze({ plate: Object.freeze({ from: [152, 55, 27], to: [225, 97, 73] }) }),
  g: Object.freeze({ plate: Object.freeze({ from: [48, 86, 51], to: [66, 132, 93] }) }),
  m: Object.freeze({ plate: Object.freeze({ from: [145, 124, 61], to: [181, 158, 87] }) }),
});

// ---------------------------------------------------------------------------
// The LEGENDARY CROWN. Six of the eight printed backs are legendary (FIN
// #16, #58, #104, #133, #229, #245) and print the Nyx dress's crown — the
// regular crown with the starfield strip inside it (m15nyxcrown, TODO 4.7) —
// wrapped round the ▼ well, as every crowned ▼ back wraps its crown
// (m15dfccrownright, TODO 5.1d). So the piece is the published m15nyxcrown
// band cut round the RIGHT well exactly as m15dfccrownright cuts m15crown
// (scripts/lib/cc-frames.mjs cutCrownBand, DFC_CROWN_WELLS.right: outside the
// well region the band byte for byte; inside it the alpha of Card Conjurer's
// '(Back)' crown twin and the band's own leg texture). The starfield strip
// (16.37–83.68 %W) ends left of the well region (x 1264–1420): the cut never
// touches it. Keys: the Nyx band's w u b r g m and a (the colourless key's
// silver: c → a); no pairs (the body has no pair masters: a two-colour back
// wears gold, its pair dress a follow-up).
// ---------------------------------------------------------------------------

export const CROWN_FOLDER = "m15nyxdfccrownright";
export const CROWN_KEYS = Object.freeze(["w", "u", "b", "r", "g", "m", "a"]);
/** Card Conjurer's '(Back)' crown twins (cut round the ▼ back's right
 *  well) — the alpha the cut reads; never published. */
export const CROWN_TWIN_DIR = "img/frames/m15/transform/crowns/regular/new";

/** An alpha plane (0–255) with rows cut out (`cuts`: [first row, count], in
 *  the ORIGINAL rows), the rows below moved up, empty rows at the foot —
 *  saga-creature.mjs cutRows for a plane. */
export function cutPlaneRows(plane, width, height, cuts) {
  const drop = new Uint8Array(height);
  for (const [from, count] of cuts) for (let y = from; y < from + count; y += 1) drop[y] = 1;
  const out = new Uint8Array(width * height);
  let to = 0;
  for (let y = 0; y < height; y += 1) {
    if (drop[y]) continue;
    out.set(plane.subarray(y * width, (y + 1) * width), to * width);
    to += 1;
  }
  return out;
}

/** The fold's columns of a plane the way part A squeezed the master's
 *  (FOLD_SQUEEZE: rows `from`–`to` of the ORIGINAL resampled into the band's
 *  rows, left of `x1`), linearly; laid over `cut` (the plane after
 *  cutPlaneRows) left of x1. In place on `cut`. */
export function squeezeFoldPlane(original, cut, width = W, fold = FOLD_SQUEEZE) {
  const rows = fold.to - fold.from - BAND_CUT[1];
  const span = fold.to - fold.from;
  for (let r = 0; r < rows; r += 1) {
    const sy = fold.from + ((r + 0.5) * span) / rows - 0.5;
    const y0 = Math.max(fold.from, Math.floor(sy));
    const y1 = Math.min(fold.to - 1, y0 + 1);
    const t = sy - y0;
    for (let x = 0; x < fold.x1; x += 1) {
      cut[(fold.from + r) * width + x] = Math.round(original[y0 * width + x] * (1 - t) + original[y1 * width + x] * t);
    }
  }
  return cut;
}

/**
 * The PAPER's coverage on the saga creature master: the saga pack's text
 * mask less its ribbon (the saga back's paperToneMask), cut the way part A
 * cut the master (BAND_CUT + RAIL_CUT, the fold squeezed), the band painted
 * over the window's columns (BAND_FILL) whole, and — from LOWER_FROM down —
 * M15's text box as part A laid it (its rows in place, its top rim and
 * inner shadow copied up under the raised bar, BOX_TOP). Every plane is
 * 1500 × 2100.
 */
export function paperPlane({ sagaText, sagaBanner, rules }, width = W, height = H) {
  const paper = new Uint8Array(width * height);
  for (let p = 0; p < paper.length; p += 1) paper[p] = Math.round((sagaText[p] * (255 - sagaBanner[p])) / 255);
  const out = squeezeFoldPlane(paper, cutPlaneRows(paper, width, height, [BAND_CUT, RAIL_CUT]), width);
  for (let y = BAND_FILL.y0; y < BAND_FILL.y1; y += 1) out.fill(255, y * width + BAND_FILL.x0, y * width + BAND_FILL.x1);
  // The second box: nothing of the rail reaches it; M15's box from here.
  out.fill(0, LOWER_FROM * width);
  out.set(rules.subarray(LOWER_FROM * width), LOWER_FROM * width);
  for (let r = 0; r < BOX_TOP.to - BOX_TOP.from; r += 1) {
    const from = (BOX_TOP.from + r) * width;
    out.set(rules.subarray(from + BOX_TOP.x0, from + BOX_TOP.x1), (LOWER_FROM + r) * width + BOX_TOP.x0);
  }
  return out;
}
