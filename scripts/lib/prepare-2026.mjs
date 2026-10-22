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
  //    field's 37 columns, then its outer 14 again, outside in, from rows
  //    250 px lower — the seam meets like columns (a mirror of one block
  //    drew kaleidoscope diamonds; the left field's, a hue step).
  //    Print's strip is LIGHTER than the frame's own field (the same cards'
  //    side field reads as the master's): each channel moves by print's
  //    strip median − the strip's own (`print.<key>.strip`; m and c: none).
  strip: {
    cols: [745, 1390],
    rows: [1876, 1926],
    blocks: [
      { fieldCols: [1404, 1440], sourceRow0: 250 },
      { fieldCols: [1440, 1427], sourceRow0: 500 },
    ],
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
