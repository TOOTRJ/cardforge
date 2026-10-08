// ---------------------------------------------------------------------------
// Card typography standard — the printed-card numbers both renderers and every
// frame profile derive their rules-text sizing from. Kept in POINTS so the
// intent reads like a print spec; `ptToPct` converts to the fraction-of-card-
// width unit the profiles, the live preview (cqw) and the Satori bake (px)
// all share.
//
// Sources (2026-09 research pass):
//   • Rules text is MPlantin at 9 pt, shrinking as the text grows; WotC's
//     editing floor is about 7.5 pt ("Magic card text runs between 7.5 and 9
//     points"). Flavor text is the italic cut at the same size, reminder
//     text and ability words italic in-line.
//   • Titles / type line / P&T are the display face (Beleren on M15-era
//     frames). Their SLOTS (rects, alignment, ink) are scan-measured per
//     frame in template-layout.ts. Since layout v32 (TODO 4.20) the M15-era
//     family's display SIZES come from the named constants below — Card
//     Conjurer's, which match the prints (name 0.0381 H, type line
//     0.0324 H) — so every frame in lib/cards/m15-family.ts prints one name
//     size and one type size instead of per-frame literals. Frames outside
//     that family keep their own measured sizes.
//   • Inline mana symbols print a touch taller than the capitals of the line
//     they sit in (0.785 em) and are centred on the capitals — the disc's
//     centre 0.334 em above the baseline, about half MPlantin's 0.682 em cap
//     height, not on the x-height (layout v36, TODO 3.31: 37 discs on 14
//     prints) — with a hairline between adjacent symbols ("{G}{G}") and none
//     between a symbol and its punctuation ("{T}:").
//   • Leading is solid: 0.98 × size, rules and flavor alike (the prints'
//     line pitch, 74–75 HD px at 9 pt, measured three ways — layout v33,
//     TODO 3.29). Abilities are separated by a FIXED gap (≈1 mm, 24 HD px
//     whatever the size) and the flavor by 30 px either side of the
//     M15-family hairline (42 px on frames with no hairline).
//
// A physical card is 2.5 in wide (portrait) — 3.5 in when a landscape frame
// (Battle) is the reference box — so 9 pt = 9/72 in = 5 % of a portrait
// card's width. The RULES text alone is sized on an even HD-px grid
// (RULES_SIZE_PX below, layout v33): the prints' 9 pt at 63 mm is 76 px of a
// 1500 px card, and an even size is a whole px at the 750 px bake too.
// ---------------------------------------------------------------------------

/** Physical card width in inches for the two frame orientations. */
const CARD_WIDTH_IN = { portrait: 2.5, landscape: 3.5 } as const;

export type CardOrientation = keyof typeof CARD_WIDTH_IN;

/** A point size as a fraction of the card's width. */
export function ptToPct(pt: number, orientation: CardOrientation = "portrait"): number {
  return pt / 72 / CARD_WIDTH_IN[orientation];
}

/** Inverse of ptToPct — for labels and tests. */
export function pctToPt(pct: number, orientation: CardOrientation = "portrait"): number {
  return pct * 72 * CARD_WIDTH_IN[orientation];
}

/** Orientation from the card's height ÷ width ratio (7/5 portrait, 5/7 landscape). */
export function orientationFromAspect(aspect: number): CardOrientation {
  return aspect < 1 ? "landscape" : "portrait";
}

// ---------------------------------------------------------------------------
// M15-era display sizes (TODO 4.20, layout v32). Every value is a fraction of
// a PORTRAIT card's width — the profile unit — measured against Card
// Conjurer's M15 packs, which match the prints (name ink width 1.007 of the
// print's at 0.0533, n = 30; type line 0.995 at 0.0453). HD px = × 1500.
// A landscape slot takes displayPct(constant, "landscape"): the same
// absolute size on the physical card.
// ---------------------------------------------------------------------------

/** Card name (title) — CC 0.0381 H, 80 px at HD. */
export const TITLE_SIZE_PCT = 0.0533;

/** Type line — CC 0.0324 H, 68 px at HD. */
export const TYPE_SIZE_PCT = 0.0453;

/** The modal double-faced flipside strip's two texts (TODO 5.1b; Card
 *  Conjurer's packModalRegular.js, fractions of H turned into HD px): the
 *  other face's type word in Beleren Bold — CC 0.0234 H, 49 px — and its
 *  cost or mana line in the rules font with inline pips — CC 0.0258 H,
 *  54 px. Measured on the prints: "Land"'s capitals 35–36 px tall (a 49–50
 *  px Beleren Bold), "Add" 84 px wide (54 px MPlantin). Both profile slots
 *  take them through rulesPxToPct. */
export const MDFC_STRIP_WORD_PX = 49;
export const MDFC_STRIP_LINE_PX = 54;

/** Mana-cost pip DISC diameter (FrameProfile.costSizePct) — M15's measured
 *  disc (a DOM scan; CC mana 71/1638, prints ≈ 70 px), 72.75 px at HD.
 *  Planeswalker, saga and flip use it too (owner decision 2026-09-28). */
export const COST_DISC_PCT = 0.0485;

/** Set-symbol BOX height (FrameProfile.symbolSizePct on the family) — CC's
 *  symbol box, 0.041 H = 86 px at HD. An uploaded icon or the default mark
 *  is drawn contained in a square of this size; a Keyrune glyph's font size
 *  is derived from it (KEYRUNE_EM_PER_BOX). */
export const SET_SYMBOL_BOX_PCT = 0.0574;

/** Keyrune font size per unit of set-symbol box: box × this = 0.065 W on
 *  M15, the full-art basics' print-checked glyph size (4.39). A glyph whose
 *  ink is taller than the box at that size is fitted by its ink instead
 *  (font = min(box × KEYRUNE_EM_PER_BOX, box ÷ inkHeightEm)). */
export const KEYRUNE_EM_PER_BOX = 0.065 / SET_SYMBOL_BOX_PCT;

/** The planeswalker's and saga's set-symbol box — CC's 0.0381 H on their
 *  thinner type bars (packPlaneswalkerRegular / packSagaRegular), 80 px at
 *  HD. Every other M15-era pack (M15, tokens, flip, aftermath, adventure)
 *  uses SET_SYMBOL_BOX_PCT. */
export const SET_SYMBOL_BOX_PCT_THIN_BAR = 0.0533;

/** The widest a fitted Keyrune glyph's ink may draw — CC's symbol box
 *  width, 0.12 W. On v32's fit no keyrune 3.19 glyph comes near it (the
 *  widest ink is 1.004 em, 98 px at 0.065 W); at a set's printed size (v36,
 *  lib/cards/set-symbol-prints.ts) it binds nothing either — the three
 *  core-set pills, M19 / M20 / M21, print 187.5–189 px wide and draw there
 *  past it (SET_SYMBOL_PRINTED_PAST_CAP, owner round 18). It guards a wider
 *  glyph a later keyrune might add. */
export const SET_SYMBOL_MAX_WIDTH_PCT = 0.12;

/** How far the white keyline a set symbol wears on a dark type bar
 *  (SET_SYMBOL_KEYLINE in lib/cards/template-layout.ts, the borderless bars)
 *  reaches past the glyph's ink on every side, in em of the glyph's font:
 *  its axis copies' offset. A test holds the shadow string to it. */
export const SET_SYMBOL_KEYLINE_EM = 0.05;

/** Adventure panel name and type line — CC name2 / type2, 0.0296 H = 62 px
 *  at HD. */
export const ADVENTURE_PANEL_PCT = 0.0414;

/** Adventure panel pip disc — CC mana2, 60 px at HD. */
export const ADVENTURE_PANEL_COST_PCT = 0.04;

// ---------------------------------------------------------------------------
// The split card's display sizes (TODO 4.21b, layout v43). Fractions of the
// LANDSCAPE card's own width (2100 px at HD) — a split card is never
// portrait. Split stays OUT of lib/cards/m15-family.ts: each half is a
// small card of its own, and the prints set every line on it smaller than
// the family's. Measured on MH2 #123 Fast // Furious, MH2 #60 Said // Done,
// TSR #156 / #161 / #186 and GRN #224 (Scryfall PNGs at 2100 × 1500),
// against regular M15 prints of the same sets on the same scans (MH2 #50,
// MH2 #118) and against our own bakes of the same words:
//   • the type line — "Instant" 157–160 px wide, "Sorcery" 177–178 (a
//     regular card's 203 / 229 at 68 px; ours at 60 px 176 / 201): 0.775 of
//     the family's, 53 px — NOT Card Conjurer's 0.0286 H (60 px), which sets
//     it 13 % larger than every print;
//   • the name — ten names 0.94–0.97 of our 80 px bake by width (mean
//     0.950), x-height 38–39 px against a regular card's 41–42: 76 px;
//   • the pips — the generic disc 64–65 px across (circle fits), a regular
//     card's 68.7–69.6: 0.935 of the family's 72.75 px disc, 68 px;
//   • the set symbol — MH2's 47–48 px tall (72 wide), TSR's 47–50, GRN's
//     46–54, on a bar whose face is 69 px: a 48 px box a Keyrune glyph's INK
//     fills top to bottom (FrameProfile.setSymbolFit "ink-height"), where a
//     regular card's box is 86 px (0.55 of it: MH2's symbol prints 88–91 px
//     tall on MH2 #50 / #118).
// ---------------------------------------------------------------------------

/** The split card's name — 76 px at HD (see above). */
export const SPLIT_TITLE_SIZE_PCT = 76 / 2100;

/** The split card's type line — 53 px at HD on the thin type bar (see
 *  above; Card Conjurer's packSplit.js says 0.0286 H = 60 px). */
export const SPLIT_TYPE_SIZE_PCT = 53 / 2100;

/** The split card's mana-cost disc — 68 px at HD (see above). */
export const SPLIT_COST_DISC_PCT = 68 / 2100;

/** The split card's set-symbol box — 48 px at HD: the default mark and an
 *  uploaded icon are contained in a square of it, a Keyrune glyph's ink
 *  fills its height (see above). */
export const SPLIT_SET_SYMBOL_BOX_PCT = 48 / 2100;

// ---------------------------------------------------------------------------
// The 1997 frame's sizes (TODO 4.10a, layout v46: `retro`, `retroland`).
// Fractions of a portrait card's width; HD px = × 1500. Print-matched for the
// faces the site sets them in (owner 2026-10-07: no new typeface — names stay
// in Beleren, the type line and the artist line are MPlantin, their printed
// face). Measured on the ORIGINAL cards, Mirage 1996 → Scourge 2003 (the era
// design's overlay fits, 7–13 prints per slot; baselines and centres
// re-measured for 4.10a on 54 prints of blue, red, green, artifact, black
// and land):
//   • the name — the prints' MagicMedieval is set at 84 px (x-height 32 px,
//     baseline at 163 px); Beleren Bold overlaps that ink best at 71 px
//     (caps 50 px against the print's 58: a wider, lower face);
//   • the type line — MPlantin at 67 px (x-height 29 px, baseline 1229 px);
//   • the P/T — a Plantin heavier than MPlantin at 92 px (digits 58–63 px
//     tall, baseline 1963 px, every value's ink ENDING at 1364–1370 px: a
//     one-digit pair is centred on 1309 px, a two-digit one grows to the
//     left at the same size); Beleren Bold's digits are that tall at 86 px;
//   • the artist line — MPlantin at 58 px (x-height 25 px, baseline 1933 px,
//     centred on 748 px), from Exodus 1998 on;
//   • the line under it (the prints' © line, our © slot) — MPlantin at 33 px
//     (capitals 21 px, baseline 1976 px);
//   • the cost — flat discs 72–74 px across, 80–81 px apart, centred on
//     row 137, the last one ending at 1383 px.
// ---------------------------------------------------------------------------

/** The 1997 frame's name — 71 px at HD (Beleren Bold). */
export const RETRO_TITLE_SIZE_PCT = 71 / 1500;

/** The 1997 frame's type line — 67 px at HD (MPlantin). */
export const RETRO_TYPE_SIZE_PCT = 67 / 1500;

/** The 1997 frame's P/T — 86 px at HD (Beleren Bold). */
export const RETRO_PT_SIZE_PCT = 86 / 1500;

/** The 1997 frame's artist line — 58 px at HD (MPlantin). */
export const RETRO_ARTIST_SIZE_PCT = 58 / 1500;

/** The 1997 frame's © slot: a clean download's footer text — 33 px at HD
 *  (MPlantin), and the pipglyph.com mark at the same em. */
export const RETRO_COPYRIGHT_SIZE_PCT = 33 / 1500;

/** The 1997 frame's mana-cost disc — 73 px at HD, flat (symbol style
 *  "1997", lib/cards/symbol-style.ts). */
export const RETRO_COST_DISC_PCT = 73 / 1500;

// ---------------------------------------------------------------------------
// The 2003 frame's sizes (TODO 4.10b; `modern`, `modernland`) — per-era
// constants like the 1997 frame's above (era design D7): print-matched for
// the faces the repo has (the prints set names, type lines, P/T and artist
// lines in Matrix Bold; ours is Beleren Bold — no font file was added, owner
// 2026-10-07). HD px, measured on 79 black-bordered prints of the frame's
// later drawing (CHK 2004 → JOU 2014; white, blue, red, green, artifact,
// gold), and EVEN wherever the print allows it, so the 750 px bake draws
// exactly half:
//   • the name — capitals 55–56 px tall, baseline 198.5 px, starting at
//     133 px; M12 #1 "Aegis Angel" is 405 px wide, Beleren's at 79 px:
//     80 px (capitals 56);
//   • the type line — capitals 46 px, baseline 1264 px, starting at 151 px;
//     "Creature — Angel" 510 px wide: Beleren at 66 px;
//   • the P/T — digits 58–59 px tall, baseline 1959 px, CENTRED on 1258 px
//     at one size whatever the value (10/10, 13/13, 15/15, 9/14 measured);
//     by width Beleren reads 73–85 px over six values: 80 px;
//   • the artist line — capitals 33 px, baseline 1967 px, starting at
//     235 px after the brush (118–227 × 1946–1969 px); Beleren overlaps the
//     printed ink best at 50 px (the design's overlay);
//   • the line under it (the prints' © line, our © slot) — MPlantin, digits
//     22.5 px tall, baseline 2015 px, starting at 128 px: 32 px;
//   • the cost — discs 66.8 px across (84 more prints, CHK 2004 → JOU
//     2014, by a circle fitted to the shadow's outer arc: radius 33.4 ± 0.5
//     px on every colour), 74 px apart, rows 140–206 (centre 172.8 ± 1.4
//     px), the last one ending at 1370 px, each with a black shadow 6 px
//     down and 1–2 px to the LEFT — a crescent from nine o'clock round to
//     four, none on the right, ending on row 212 (symbol style "2003").
//     66 px keeps the 750 px bake at exactly half and the pitch at 74.
// ---------------------------------------------------------------------------

/** The 2003 frame's name — 80 px at HD (Beleren Bold). */
export const MODERN_TITLE_SIZE_PCT = 80 / 1500;

/** The 2003 frame's type line — 66 px at HD (Beleren Bold). */
export const MODERN_TYPE_SIZE_PCT = 66 / 1500;

/** The 2003 frame's P/T — 80 px at HD (Beleren Bold). */
export const MODERN_PT_SIZE_PCT = 80 / 1500;

/** The 2003 frame's artist line — 50 px at HD (Beleren Bold). */
export const MODERN_ARTIST_SIZE_PCT = 50 / 1500;

/** The 2003 frame's © slot: a clean download's footer text — 32 px at HD
 *  (MPlantin), and the pipglyph.com mark at the same em. */
export const MODERN_COPYRIGHT_SIZE_PCT = 32 / 1500;

/** The 2003 frame's mana-cost disc — 66 px at HD (33 at the 750 px bake;
 *  × 1.12 is the prints' 74 px pitch), with a shadow down and a little to
 *  the left (symbol style "2003", lib/cards/symbol-style.ts). */
export const MODERN_COST_DISC_PCT = 66 / 1500;

// ---------------------------------------------------------------------------
// The 1993 frame's sizes (TODO 4.10c, layout v48: `agclassic`, `alphaland`)
// — per-era constants like the two above, print-matched for the faces the
// repo has (no font file was added: the prints set names in Goudy Medieval,
// ours is Beleren Bold; the type line, the credit and the P/T are a Plantin,
// ours MPlantin). HD px on 118 black-bordered Alpha and Beta prints
// (Scryfall scans registered on the frame's top and right edges; proof 3,
// 2026-10-08), EVEN, so the 750 px bake draws exactly half. "Dark layer" =
// the print's dark ink: the lettering is embossed, a dark body under a
// light upper-left edge — on the white frame only the dark body shows.
//   • the name — Goudy Medieval at 84 px: capitals 57.5 px (rows 114–171.5
//     ± 1.0 on 20 white-frame prints), x-height 33.5 px, baseline 171.5 px.
//     Beleren Bold overlaps that ink best at 73.7 ± 4.3 px (12 prints; the
//     1997 frame's same 84 px Medieval took 71): 72 px (capitals 51);
//   • the type line — MPlantin at 70.0 ± 0.2 px (16 white prints, overlap
//     error 0.43; Beleren 0.61), baseline 1227.4 ± 0.7 px;
//   • the credit — `Illus. © <artist>` in MPlantin at 69.2 ± 0.3 px (16
//     white prints; 69.4–69.7 on red, green, artifact and land), baseline
//     1950.4 ± 0.9 px, starting at 153.8 ± 2.2 px: 70 px;
//   • the P/T — MPlantin at 84.5 ± 0.4 px (16 white prints, overlap error
//     0.31; Beleren Bold 0.49 at 78 px), baseline 1950.7 ± 1.1 px, set
//     against its RIGHT end: a one-digit pair's ink covers 1270–1378 px
//     and DRK #30 10/10, ICE #89 11/11, ALL #112 10/4 grow to the left
//     (ink ending 1383–1392 px): 84 px;
//   • the cost — flat discs 72.6 ± 1.0 px across (166 discs by a circle
//     fitted to the outer edge; generic 72.1, colour 73.1), centred on row
//     142.5 ± 1.3, 83.2 ± 1.3 px apart, the last one ending at 1364.9 ±
//     1.0 px: 72 px with a 12 px gap (symbol style "original").
// ---------------------------------------------------------------------------

/** The 1993 frame's name — 72 px at HD (Beleren Bold). */
export const ALPHA_TITLE_SIZE_PCT = 72 / 1500;

/** The 1993 frame's type line — 70 px at HD (MPlantin). */
export const ALPHA_TYPE_SIZE_PCT = 70 / 1500;

/** The 1993 frame's P/T — 84 px at HD (MPlantin). */
export const ALPHA_PT_SIZE_PCT = 84 / 1500;

/** The 1993 frame's `Illus.` credit — 70 px at HD (MPlantin). */
export const ALPHA_ARTIST_SIZE_PCT = 70 / 1500;

/** The 1993 frame's © slot, on the black border under the frame: the
 *  pipglyph.com mark at its standard em (39 px at HD) and a clean
 *  download's footer text at the same size (MPlantin). */
export const ALPHA_COPYRIGHT_SIZE_PCT = 39 / 1500;

/** The 1993 frame's mana-cost disc — 72 px at HD (36 at the 750 px bake),
 *  flat, 84 px apart (symbol style "original", lib/cards/symbol-style.ts). */
export const ALPHA_COST_DISC_PCT = 72 / 1500;

/** A display size given as a fraction of a PORTRAIT card's width, as a
 *  fraction of the width of a card in `orientation`: the same absolute size
 *  on the physical card (× 5/7 on a landscape card, whose width is the
 *  portrait card's height). */
export function displayPct(pct: number, orientation: CardOrientation = "portrait"): number {
  return (pct * CARD_WIDTH_IN.portrait) / CARD_WIDTH_IN[orientation];
}

/**
 * The rules-text typography standard (layout v33, TODO 3.29) — the numbers
 * lib/cards/rules-layout.ts lays every rules and flavor line out with, and
 * both renderers draw. Em values scale with the text size; `…Px` values are
 * FIXED HD px (the 1500 px portrait / 2100 px landscape card — one physical
 * scale), whatever the size, the way the prints set them.
 */
export const RULES_TEXT = {
  /** The printed standard, in points (a full text box). The profiles' own
   *  ceilings are RULES_SIZE_PX, this at 63 mm rounded up to an even px. */
  standardPt: 9,
  /** Last-resort floor, in points, of the fits that still speak in points
   *  (stat values, the display lines). The rules ladder's floor is
   *  RULES_SIZE_PX.floor — the same 5 pt at the bake's whole px. */
  hardFloorPt: 5,
  /** Line box height — the line PITCH — as a multiple of the size, for rules
   *  lines, flavor lines and the attribution line alike. Measured on the
   *  prints: 0.97–0.99 em by word width, autocorrelation and baselines. */
  lineHeight: 0.98,
  /** Between two abilities (paragraphs): line box to line box, HD px. The
   *  prints add a constant ≈24 px (22.9–25.2, n = 26) from 6.6 to 9 pt. */
  paragraphGapPx: 24,
  /** Rules → flavor on a frame that draws the hairline: this much above the
   *  1 px bar and again below it (pitch + 61 baseline to baseline, the
   *  prints' pitch + 60–65), HD px. */
  flavorGapPx: 30,
  /** Rules → flavor with no hairline (pre-M15 frames, flavorDivider false):
   *  line box to line box, HD px (the pre-bar M15-era prints' pitch + 41). */
  flavorGapNoBarPx: 42,
  /** Height a blank source line contributes (em). */
  blankLineEm: 0.6,
  /** Word gap (em) — MPlantin's space width. */
  wordGapEm: 0.26,
  /** Inline pip disc diameter as a fraction of the font size. Layout v36
   *  (TODO 3.31): 0.785 em — 37 inline discs on 14 prints (Scryfall PNGs at
   *  1500 px, circle-fitted, em from the line's cap height) measure 0.754–
   *  0.812 em, mean 0.785 (sd 0.014): 60 px at 76 px type where 0.86 drew 65. */
  pipDiscEm: 0.785,
  /** How far above its line's baseline an inline pip's disc is centred (em):
   *  on the capitals (half MPlantin's 0.682 em cap height is 0.341). The
   *  same 37 discs: 0.323–0.348 em, mean 0.334 (sd 0.006) — 25 px at 76 px
   *  type, where centring the disc in the line box put it 21 px up
   *  (layout v36, TODO 3.31). */
  pipCentreEm: 0.334,
  /** Gap between two adjacent pips (em). */
  pipGapEm: 0.1,
} as const;

/**
 * The rules text's size ladder, in HD px (layout v33): a profile's ceiling is
 * one of the three named sizes (rulesPxToPct), and the fit steps down in
 * `stepPx` to `floor`. Even HD px, so the 750 px bake draws exactly half and
 * the preview draws the HD bake's px (÷ RULES_HD_WIDTH, in cqw). The ceilings
 * are the prints' sizes at 63 mm rounded UP to an even px — 9 pt → 76,
 * 8 pt → 68, 7.5 pt → 64 — so none is below the v32 size it replaces.
 */
export const RULES_SIZE_PX = {
  /** A full text box (M15 and every frame that prints 9 pt; tokens, whose
   *  prints set 9 pt too — and, since TODO 4.21b, the split halves and the
   *  battle: TSR #161 / #186 and MOM #21 set their short texts at 76 px). */
  standard: 76,
  /** Half-width and showcase boxes that print 8 pt (the adventure creature
   *  page, the art-forward showcases, LOTR, full-art). */
  reduced: 68,
  /** The 7.5 pt boxes (flip, the adventure page, Alpha tokens, the saga) and
   *  planeswalker text, which prints at most this (the walker prints'
   *  letters are ≤ 56.5 px, condensed). */
  compact: 64,
  /** The fit's last step: 5 pt (41.7 px) at the bake's whole px. Text that
   *  doesn't fit here clips (the box keeps `overflow: hidden`). */
  floor: 42,
  /** The fit's step, 0.24 pt — finer than a half point, like the prints'
   *  off-half-point sizes (7.33, 7.86, 8.38 pt). */
  stepPx: 2,
} as const;

/** The card width HD px are measured against: the stored HD bake's
 *  (RENDER_PRESETS.hd), 2100 on a landscape card — the same physical scale. */
export const RULES_HD_WIDTH: Readonly<Record<CardOrientation, number>> = { portrait: 1500, landscape: 2100 };

/** A rules size in HD px as the profile unit, a fraction of card width. */
export function rulesPxToPct(px: number, orientation: CardOrientation = "portrait"): number {
  return px / RULES_HD_WIDTH[orientation];
}

/** A profile's rules size (fraction of card width) on the even HD-px grid:
 *  its HD px rounded DOWN to an even px (a hair of float error forgiven), so
 *  an overridden size never grows past what its owner set. */
export function rulesPctToPx(pct: number, orientation: CardOrientation = "portrait"): number {
  const px = pct * RULES_HD_WIDTH[orientation];
  const step = RULES_SIZE_PX.stepPx;
  return Math.floor(px / step + 1e-6) * step;
}

/** The rules box's padding, HD px: `x` either side, `y` above and below —
 *  today's 0.6 % / 1.2 % of the card width. A slot may give its own
 *  (the M15 prints' ink runs to within a few px of the box). */
export const RULES_BOX_PAD_PX = { x: 9, y: 18 } as const;

/** Editor-only sample shown in the live preview of a card with no rules text
 *  yet — real pips, a keyword line and a flavor line, so a fresh card reads
 *  like a card from the first second. Never baked or shown in the gallery. */
export const PLACEHOLDER_RULES_TEXT = "Add text and rules here.";
export const PLACEHOLDER_FLAVOR_TEXT = "Flavor text goes here.";
