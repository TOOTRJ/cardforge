// ---------------------------------------------------------------------------
// prepare-2026.mjs — the numbers of the Prepare frame (TODO 4.27), measured
// on print, as DATA for scripts/build-prepare-frames.mjs. No scan is read by
// the build.
//
// Secrets of Strixhaven (2026) prints its Prepare creatures on the M15 frame
// with the lower text area split in two: the creature's rules in M15's box
// on the LEFT, and the spell on a PAGE on the RIGHT — a name bar and a type
// bar in the spell's colour, its own (darker) text box, a black outline on
// the page's left, top and bottom, the frame field showing in a strip under
// it, the P/T plate on that strip. Neither Card Conjurer (its fork ends June
// 2024) nor MSE has the frame.
//
// Measured 2026-10-21 on the 93 plain 2015-frame printings of Scryfall's
// `layout:prepare` (124 printings; the 12 + 10 + 6 extended-art, the full-art
// promo and the 2003-frame one left out), each Scryfall PNG resampled to
// 1500 × 2100. Geometry: the median over all 93 (row and column luminance
// profiles, each profile the median across the page's width / height, so
// the text never reads). Tones: the median image of the printings whose
// SPELL is the card's one colour (a hybrid or gold spell prints its own
// page colour, 4.26's per-part colour) — the lists below.
//
// Every number is HD px (a 1500 × 2100 card), inclusive ranges.
// ---------------------------------------------------------------------------

export const PREPARE_RECIPE = {
  measuredOn: "2026-10-21",
  scope: "93 plain 2015-frame printings of layout:prepare (SOS, SOC, PSOS, FRA, PFRA, PLST, YSOS, YFRA)",

  // The base frame each key starts from (a published master), and the
  // storybook bars' source: Card Conjurer's adventure master of the same
  // key, whose page bars ARE the prints' two tones (light name bar, dark
  // type bar). The colourless key is the artifact frame (m15/c is the
  // see-through frame; adventure/c is CC's artifact `a`).
  keys: ["w", "u", "b", "r", "g", "m", "c"],
  base: { w: "m15/w", u: "m15/u", b: "m15/b", r: "m15/r", g: "m15/g", m: "m15/m", c: "m15artifact/c" },
  barSources: { w: "adventure/w", u: "adventure/u", b: "adventure/b", r: "adventure/r", g: "adventure/g", m: "adventure/m", c: "adventure/c" },

  // 1. The LEFT box keeps M15's paper; its right edge is M15's box's own
  //    right edge (base columns 1374..1389) moved onto x 729..744 — the
  //    prints shade 737..744 like M15's 1383..1390.
  leftBoxEdge: { fromCol: 1374, toCol: 729, width: 16, rows: [1314, 1937] },

  // 2. The page's RIM: the pinline's colour between the outline and the
  //    bars / box (prints: x 750..756, between the bars 1417..1424, above
  //    the box 1518..1531). Each column takes the base's pinline pixel at
  //    `sourceRow` (the pinline under M15's type bar, 1305..1313).
  rim: { cols: [750, 1390], rows: [1316, 1871], sourceRow: 1308 },

  // 3. The strip UNDER the page (prints: the frame field, 1885..1926, under
  //    the page's bottom outline and its shadow; M15's own box bottom bevel
  //    below from 1927). Filled with the base's own frame field beside the
  //    art window turned a quarter — strip row r, column j ← the field
  //    pixel at (column r of the block, row sourceRow0 + j): the right
  //    field from its inner edge (1404, whose bright bevel falls under the
  //    page's shadow) to 1437, then its inside again (1415..1437) from rows
  //    260 px lower, the two CROSS-FADED over `crossFade` rows. Never the
  //    field's outer rim (1438..1441: a bright line, owner Round 79 — the
  //    first cut ran it across the strip two-thirds down on blue and
  //    black); a mirror of one block drew kaleidoscope diamonds, the left
  //    field a hue step.
  //    Print's strip is LIGHTER than the frame's own field (the same cards'
  //    side field reads as the master's): each channel moves by print's
  //    strip median − the strip's own (`print.<key>.strip`; m and c: none).
  strip: {
    cols: [745, 1390],
    rows: [1876, 1926],
    blocks: [
      { fieldCols: [1404, 1437], sourceRow0: 250 },
      { fieldCols: [1415, 1437], sourceRow0: 510 },
    ],
    crossFade: 6,
    // The page's drop shadow on the strip, rows 1876.. (print ÷ the strip's
    // own level, 160).
    shadow: [0.1, 0.19, 0.25, 0.24, 0.21, 0.21, 0.28, 0.43, 0.47, 0.55, 0.76, 0.88, 0.91],
  },

  // 4. The page's OWN box (prints: paper 1537..1854 × 761..1381, a 5 px
  //    shadow at its top, a bright bevel at 758..760 and 1855..1862, M15's
  //    box's right edge at 1382..1390). Its paper is the base box's own
  //    paper under a per-key gain: print page box ÷ print left box (the left
  //    box IS M15's paper on print: within 3–6 levels of the masters'). The
  //    edges are the base box's own edges, moved: top rows 1319.. → 1532..
  //    (13 rows), left columns 78.. → 758.. (18), bottom rows 1929..1937 →
  //    1854..1862. Its bevel highlights keep their own light (no gain).
  pageBox: {
    cols: [758, 1390],
    rows: [1532, 1862],
    top: { fromRow: 1319, toRow: 1532, rows: 13 },
    left: { fromCol: 108, toCol: 757, cols: 18, rowOffset: -211 },
    bottom: { fromRow: 1929, toRow: 1854, rows: 9 },
    ungained: { rows: [1855, 1862], cols: [758, 760] },
  },

  // 5. The BARS. Outer box (outline included): x from 758, name 1325..1416,
  //    type 1426..1517; the left end square, the right end half an ellipse
  //    (centre x 1390, semi-axes 20 across and half the bar's height down —
  //    the prints' outline runs 1393 → 1410 → 1390 over the name bar), a
  //    3 px black outline. The fill is the adventure master's bar, its rows
  //    resampled onto the bar's inside and its columns moved (x − 650,
  //    clamped to 100..729: the adventure bar's straight run), toned onto
  //    print (fill ÷ the adventure bar's fill, per channel; a channel under
  //    20 in the source moves by the difference instead), then lit by the
  //    prints' bevel — the luminance ratio to the bar's fill, row by row
  //    (above 1: the luminance step added to all three channels; below 1: a
  //    multiply).
  bars: {
    x0: 758,
    end: { cx: 1390, a: 20 },
    outline: 3,
    sourceCols: { offset: -650, min: 100, max: 729 },
    name: { rows: [1325, 1416], sourceRows: [1323, 1412], topRow: 1329, bottomRow: 1402 },
    type: { rows: [1426, 1517], sourceRows: [1424, 1493], topRow: 1430, bottomRow: 1502 },
  },

  // 6. The page's black OUTLINE: its left, top and bottom (the right side
  //    opens onto M15's pinline). Coverage per px from the prints' profile
  //    (1 − print ÷ the neighbouring level). The left line runs down to the
  //    box's bottom (1937), through the strip.
  outline: {
    left: { cols: { 745: 0.35, 746: 0.81, 747: 1, 748: 1, 749: 0.67, 750: 0.22 }, rows: [1313, 1937] },
    top: { rows: { 1312: 0.42, 1313: 0.92, 1314: 1, 1315: 0.98, 1316: 0.54, 1317: 0.14 }, cols: [745, 1390] },
    bottom: { rows: { 1871: 0.3, 1872: 0.74, 1873: 0.98, 1874: 0.95, 1875: 0.85 }, cols: [745, 1390] },
  },

  // ---- TODO 4.26: the page in the SPELL's colour, and the two-colour
  // ---- Prepare (the pair masters and the page overlays)
  //
  // Print colours the PAGE by the spell (Scryfall 2026-10-21, the 38
  // part-colour and two-colour plain printings): a mono spell's page is
  // that colour's (YFRA #27 / #29: a red and a blue page on a two-colour
  // creature); a two-colour spell's page is a PAIR page — gold bars for a
  // gold cost (SOC #45–50, SOS #198 / #223 / #237), grey bars for an
  // all-hybrid cost (FRA #3 / #39 / #70 / #85 / #105 and the ten hybrid
  // creatures, SOS #170 / #199), the rim and the page's box ramped from
  // the first colour (left) to the second (right) about the PAGE's own
  // centre — and the name ink stays white on the grey bar (every print).
  // A two-colour CREATURE prints M15's pair frame (the gold-split or the
  // hybrid dress, 4.6b) with its LEFT box ramped about the box's own
  // centre and the bottom pinline about x 688.
  pairs: {
    // The ten pairs in printed order, the first colour on the left
    // (scripts/lib/pair-ramp.mjs TWO_COLOR_PAIRS).
    list: ["wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"],
    // Each dress: the published M15 pair master the creature's frame is
    // (its bars, frame field, crown pinline), the adventure master whose
    // page bars are toned onto print, and print's medians (the gold bars on
    // the 8 gold-spell printings, the grey on the 17 hybrid-spell ones;
    // fills and bevels read as `print` below). `strip`: the gold creature's
    // strip (10 printings); a hybrid dress's strip is its SECOND colour's
    // field (FRA #130 / #133 / #139 read 221/214/178, 78/175/223,
    // 95/138/108 against the mono prints' w / u / g) — `print.<k2>.strip`.
    dresses: {
      split: {
        base: "m15/{pair}",
        barSource: "adventure/m",
        printings: ["soc-45", "soc-46", "soc-48", "soc-49", "soc-50", "sos-198", "sos-223", "sos-237"],
        nameFill: [165, 140, 66], typeFill: [123, 85, 25], strip: [185, 156, 83],
        nameTop: [1.038, 1.642, 1.86, 1.933, 1.871, 1.782, 1.674, 1.504, 1.218, 1.027],
        nameBottom: [1.027, 1.049, 1.073, 0.933, 0.674, 0.474, 0.31, 0.256, 0.302, 0.305, 0.275],
        typeTop: [1.506, 2.155, 2.064, 1.996, 2.073, 2.03, 1.85, 1.584, 1.215, 0.987],
        typeBottom: [1, 1, 0.987, 0.957, 0.876, 0.764, 0.67, 0.579, 0.528, 0.511, 0.524, 0.541],
      },
      hybrid: {
        base: "m15/{pair}-h",
        // The black adventure bars: the nearest to print's neutral grey
        // (99/94/97 → 141/137/136).
        barSource: "adventure/b",
        printings: ["fra-3", "fra-39", "fra-70", "fra-85", "fra-105", "fra-130", "fra-133", "fra-139", "fra-143", "fra-146", "fra-151", "fra-156", "fra-161", "fra-164", "fra-165", "sos-170", "sos-199"],
        nameFill: [141, 137, 136], typeFill: [87, 84, 85], strip: null,
        nameTop: [0.763, 1.143, 1.147, 1.126, 1.111, 1.094, 1.075, 1.053, 1.034, 1.014],
        nameBottom: [1.022, 1.024, 1.029, 1.014, 0.986, 0.882, 0.715, 0.604, 0.539, 0.529, 0.565],
        typeTop: [0.797, 1.156, 1.121, 1.086, 1.078, 1.07, 1.059, 1.051, 1.035, 1.027],
        typeBottom: [0.992, 1, 1.023, 1.055, 1.031, 0.953, 0.859, 0.723, 0.641, 0.602, 0.586, 0.59],
      },
    },
    // The ramps: the second colour's share 0 → 1 linearly between two
    // columns. The creature's LEFT box: 25 / 50 / 75 % at 408 / 420 / 432
    // on the 18 two-colour creatures (median; the box spans 98..744). The
    // bottom pinline under both boxes: 50 % at 688, 10 → 90 % over 45 px
    // (SOC #48 / #49, SOS #223). The page's rim and box: 10 / 50 / 90 % at
    // 941 / 1061 / 1205 on the 25 two-colour pages (median) — the page's
    // centre is 1074.
    creatureRamp: [396, 444],
    pinlineRamp: [660, 716],
    pageRamp: [898, 1228],
    // Where the creature's ramps replace the M15 pair master's own
    // (600..900, the card's centre): the left box with its left pinline
    // (rows 1314..1937, cols 98..745) and the pinline under the boxes (rows
    // 1938..1949, cols 98..1404) — never the frame field or the bars, which
    // stay the pair master's.
    creatureZone: { rows: [1314, 1937], cols: [98, 745] },
    pinlineZone: { rows: [1938, 1949], cols: [98, 1404] },
  },

  // The PAGE OVERLAY (TODO 4.26): `prepare/page/<key>` — the page of each
  // master (the seven keys and the twenty pair keys) cut out, drawn over the
  // creature's master where the spell's page key differs. Even HD columns
  // and rows (whole px at the 750 bake): cols 746..1413, rows 1314..1875.
  // Column 746 and rows 1872..1875 are see-through (the outline's soft edge
  // over the creature's own paper); right of the rim (1391..1413) only the
  // bars' rounded ends, at their own coverage, over the creature's pinline.
  page: { cols: [746, 1413], rows: [1314, 1875], clearCols: [746, 746], clearRows: [1872, 1875], rimRight: 1390 },

  // Per key, the printings measured and their medians (RGB: the name bar
  // 1338..1344 × 800..1240, the type bar 1450..1496 × 1100..1385, the page
  // box 1560..1840 × 800..1370, the left box 1340..1900 × 100..700, the
  // strip 1890..1924 × 800..1100; the bevels' luminance ratios). m and c have
  // no plain printing (a two-colour Prepare prints the split frame — 4.6f —
  // and none is colourless): their bars keep the adventure master's tone
  // and their page box takes the mean of the five keys' gains.
  print: {
    w: {
      printings: ["psos-13p", "psos-23p", "soc-13", "sos-12", "sos-13", "sos-19", "sos-23", "sos-27", "sos-33"],
      nameFill: [172.0, 167.0, 154.0], typeFill: [121.0, 111.0, 94.0], strip: [222, 215, 178],
      pageBox: [212.0, 207.0, 195.0], leftBox: [243.0, 243.0, 235.0],
      nameTop: [1.099, 1.305, 1.206, 1.165, 1.202, 1.182, 1.139, 1.086, 1.04, 1.015],
      nameBottom: [1.009, 1.021, 0.999, 0.914, 0.801, 0.681, 0.622, 0.605, 0.626, 0.657, 0.539],
      typeTop: [0.953, 1.204, 1.182, 1.207, 1.222, 1.192, 1.152, 1.1, 1.051, 1.027],
      typeBottom: [0.975, 0.95, 0.917, 0.856, 0.773, 0.694, 0.632, 0.611, 0.608, 0.642, 0.712, 0.614],
    },
    u: {
      printings: ["fra-28", "fra-47", "pfra-28p", "pfra-47p", "psos-45p", "psos-52p", "psos-55p", "psos-67p", "soc-18", "sos-40", "sos-45", "sos-46", "sos-52", "sos-55", "sos-56", "sos-67", "sos-68", "ysos-3"],
      nameFill: [13.0, 130.0, 169.0], typeFill: [0.0, 75.0, 103.0], strip: [76, 175, 222],
      pageBox: [170.0, 196.0, 213.0], leftBox: [218.0, 231.0, 240.0],
      nameTop: [1.64, 1.909, 1.736, 1.714, 1.775, 1.725, 1.576, 1.319, 1.065, 0.976],
      nameBottom: [1.017, 1.008, 0.976, 0.902, 0.815, 0.722, 0.658, 0.603, 0.587, 0.619, 0.555],
      typeTop: [1.135, 1.382, 1.342, 1.32, 1.264, 1.202, 1.163, 1.118, 1.078, 1.045],
      typeBottom: [1.011, 0.988, 0.949, 0.887, 0.814, 0.741, 0.68, 0.623, 0.573, 0.59, 0.702, 0.663],
    },
    b: {
      printings: ["fra-49", "pfra-49p", "plst-SOS-88", "psos-80p", "psos-85p", "psos-99p", "soc-29", "sos-72", "sos-76", "sos-80", "sos-85", "sos-88", "sos-98", "sos-99"],
      nameFill: [89.0, 87.0, 85.0], typeFill: [56.0, 49.0, 49.0], strip: [54, 72, 68],
      pageBox: [167.0, 165.0, 161.0], leftBox: [230.0, 229.0, 227.0],
      nameTop: [1.315, 1.561, 1.447, 1.431, 1.469, 1.405, 1.305, 1.187, 1.088, 1.031],
      nameBottom: [0.971, 0.958, 0.931, 0.882, 0.813, 0.744, 0.695, 0.647, 0.653, 0.695, 0.618],
      typeTop: [1.145, 1.417, 1.397, 1.429, 1.436, 1.358, 1.261, 1.184, 1.125, 1.074],
      typeBottom: [0.99, 0.97, 0.938, 0.893, 0.815, 0.724, 0.666, 0.634, 0.582, 0.563, 0.582, 0.485],
    },
    r: {
      printings: ["fra-90", "fra-91", "pfra-90p", "pfra-91p", "psos-113p", "psos-122p", "soc-33", "sos-109", "sos-113", "sos-117", "sos-122", "sos-126", "sos-131", "ysos-9"],
      nameFill: [180.0, 83.0, 65.0], typeFill: [134.0, 42.0, 30.0], strip: [215, 123, 103],
      pageBox: [210.0, 177.0, 163.0], leftBox: [238.0, 220.0, 210.0],
      nameTop: [1.496, 1.747, 1.597, 1.57, 1.613, 1.545, 1.411, 1.221, 1.062, 0.994],
      nameBottom: [0.973, 0.979, 0.952, 0.868, 0.765, 0.67, 0.609, 0.56, 0.554, 0.584, 0.508],
      typeTop: [1.182, 1.474, 1.46, 1.469, 1.465, 1.392, 1.304, 1.212, 1.124, 1.051],
      typeBottom: [1.007, 0.993, 0.963, 0.9, 0.798, 0.681, 0.589, 0.545, 0.535, 0.584, 0.696, 0.633],
    },
    g: {
      printings: ["fra-100", "fra-437", "pfra-100p", "psos-145p", "psos-166p", "soc-44", "sos-145", "sos-152", "sos-162", "sos-166", "ysos-11"],
      nameFill: [49.0, 94.0, 56.0], typeFill: [2.0, 55.0, 22.0], strip: [98, 140, 111],
      pageBox: [167.0, 183.0, 172.0], leftBox: [211.0, 226.0, 217.0],
      nameTop: [1.237, 1.403, 1.222, 1.154, 1.197, 1.157, 1.112, 1.071, 1.046, 1.021],
      nameBottom: [1.016, 1.006, 0.981, 0.936, 0.865, 0.775, 0.694, 0.634, 0.629, 0.664, 0.584],
      typeTop: [1.247, 1.438, 1.298, 1.247, 1.234, 1.209, 1.171, 1.158, 1.12, 1.082],
      typeBottom: [1.018, 1.005, 0.967, 0.916, 0.827, 0.751, 0.662, 0.624, 0.598, 0.636, 0.751, 0.675],
    },
  },
};

// ---------------------------------------------------------------------------
// TODO 4.27b — the HOLOFOIL STAMP's notch on the Prepare frame. Every rare
// and mythic Prepare printing is oval-stamped (79 of 119 paper printings:
// 60 rare + 19 mythic), and print arches the text box's foot — its bottom
// bevel, the pinline and the black under it — over the oval right across
// the creature's box AND the strip under the page (the page's outline ends
// on the arch). M15's notch piece (m15holostamp) can't serve: it is cut for
// M15's one box, and the page's outline and strip run through it. Ours is
// the prepare master's OWN foot LIFTED along the printed arch
// (scripts/build-borderless-stamp.mjs, the borderless recipe), so the bevel
// and the rim keep each master's pixels — a pair's ramp included.
//
// Measured 2026-10-28 on the 35 stamped one-colour plain printings Scryfall
// serves (SOS, SOC, FRA, PSOS, PFRA), each PNG (745 × 1040) resampled to
// 1500 × 2100 with lanczos — measuring only; no scan is read by a build:
//   • the rim's LOWER edge (rim → black), column by column, both sides: the
//     straight bar's at 1947.5 px (the promos 1949.4 — Scryfall's renders
//     sit 2 px apart; the lift is read against each card's own), lifted
//     37.4 px at the centre (1910.1), the lift starting at x 657 and ending
//     at x 843, symmetric about x 750 within 0.5 px;
//   • the rim's UPPER edge (the bevel above → rim), the left side only (the
//     strip's texture hides it on the right; the 30 non-white prints — a
//     white rim on white paper can't be read): straight at 1936.9, lifted
//     34.3 px at the centre — the rim prints 3 px THINNER at the crown;
//   • the same set's plain M15 mythic (SOS #1, The Dawning Archaic) arches
//     the same within 1 px (1910.7 at the centre): the Prepare notch is
//     M15's printed arch, cut round the page. (PipGlyph's M15 piece, Card
//     Conjurer's, bottoms out 5–7 px lower than print: TODO 4.9c.)
// The lift below is the MEAN of the two edges per |x − 750| (the rim kept
// whole, centred on print's), smoothed over three samples (1-2-1).
// The oval: print's clean renders draw it 7 px higher than any physical
// print (1919–1986, as on every 2015-frame render — 4.9d's measure), so the
// slot keeps M15's oval (683–817 × 1926–1993).
// ---------------------------------------------------------------------------

export const PREPARE_STAMP = {
  measuredOn: "2026-10-28",
  scope: "35 stamped one-colour plain printings of layout:prepare (SOS, SOC, FRA, PSOS, PFRA)",
  /** The lift (HD px) at |x − 750| = 0, 2, 4, … (linear between; 0 from the
   *  last entry on). The app's copy is lib/cards/holo-stamp.ts
   *  PREPARE_ARCH_LIFT_PX (the rules keep-out's columns,
   *  PREPARE_HOLO_STAMP_KEEP_OUT_SHAPE); a unit test holds the two equal. */
  lift: [
    35.8, 35.8, 35.8, 35.8, 35.8, 35.7, 35.6, 35.6, 35.5, 35.4, 35.2, 35.0, 34.7, 34.2, 33.7, 33.3, 32.9, 32.4, 31.8, 31.3,
    30.8, 30.2, 29.5, 28.8, 28.1, 27.3, 26.5, 25.7, 24.8, 23.8, 22.8, 21.8, 20.8, 19.6, 18.4, 17.3, 16.0, 14.6, 13.1, 11.7,
    10.2, 8.5, 6.6, 4.7, 2.8, 1.3, 0.4, 0,
  ],
  /** The first row the lift moves: the text box's bottom bevel (1927–1937
   *  under the strip; under the creature's box 1929–1937, the two rows
   *  above it the box's own paper), then the pinline (1938–1949) and the
   *  black border from 1950. Every master is opaque here, so the foot is
   *  named, not found by its alpha as on the borderless frames. */
  liftTop: 1927,
  /** The masters' first black row under the pinline. */
  barTop: 1950,
  /** The piece's box on the 1500 × 2100 card (whole, even px: the 750 bake
   *  halves it exactly): every pixel the lift paints — x 654–845, from the
   *  lifted bevel's top (1927 − 35.8) down to the pinline's last row. */
  box: { x: 654, y: 1890, width: 192, height: 60 },
};

// ---------------------------------------------------------------------------
// TODO 4.27b — the EXTENDED-ART Prepare dress (`extendedartprepare`): 29
// printings (SOS #309–342: 13, SOC #63–98: 10, FRA #425–430: 6), every one
// oval-stamped, 5 of them two-colour (SOC #93–98). Print is the extended-art
// frame — the art to the card's side edges between the title bar and the
// BLACK type bar — over the Prepare frame's lower half: the creature's box,
// the page, the strip, the P/T plate (SOS #332, FRA #428 against SOS #113,
// FRA #90).
//
// Card Conjurer's extended-art pack (the published `extendedart/<key>`) is
// M15's pixels below its type bar — measured on the masters 2026-10-28:
// inside x 100–1400 every key is m15's byte for byte from row 1320 (blue's
// paper within 10 levels — the pack's own re-encode — and nothing else), the
// black type bar's shadow falls on rows 1312–1318 (15 → 1 levels), and the
// side fields beside the box (x 56–99, 1401–1444) are the pack's own. So the
// dress MERGES two published masters and draws no pixel:
//   • rows above `cutRow`: the extended-art master;
//   • from `cutRow` down, inside `cols` and wherever the Prepare build
//     changed its M15 base: the Prepare master (its box, page, strip,
//     outline, a pair's ramps), PLUS the extended-art master's own
//     difference from M15 on `shadowRows` — the black type bar's shadow
//     falls on the page as on the box;
//   • elsewhere from `cutRow` down (the side fields): the extended-art
//     master's own.
// Below the type bar the dress is the Prepare master's pixels wherever the
// notch, the page overlays and the P/T plate read, so the Prepare holo-stamp
// pieces and the `prepare/page/<key>` overlays serve it unchanged (the stamp
// build checks each piece over both masters).
// The colourless key is the pack's silver ARTIFACT frame (`extendedart/a`)
// over `prepare/c` (built on `m15artifact/c`): no colourless Prepare is
// printed, and the see-through Eldrazi frame (`extendedart/c`) has no box
// under it.
// ---------------------------------------------------------------------------

export const PREPARE_EXTENDED = {
  measuredOn: "2026-10-28",
  template: "extendedartprepare",
  /** The extended-art master a key merges (else `extendedart/<key>`). */
  extendedKey: { c: "a" },
  cutRow: 1312,
  shadowRows: [1312, 1319],
  cols: [100, 1400],
};
