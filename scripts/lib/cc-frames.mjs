// ---------------------------------------------------------------------------
// cc-frames.mjs — the pure half of the Card Conjurer importer
// (scripts/import-cc-frames.mjs; frames plan 4.3). Which Card Conjurer pack
// files make each PipGlyph template × colour, and the pixel operations that
// flatten them into our master format. Unit-tested
// (tests/unit/frames/cc-importer.test.ts); no I/O here.
//
// Source: the Investigamer/cardconjurer fork at a PINNED commit. Card
// Conjurer's own site was shut down after a Wizards of the Coast
// cease-and-desist (Nov 2022) and the fork carries no licence file, so the
// converted frames are NEVER committed to this public repo: they go to the
// frames storage bucket (docs/FRAMES.md) and lib/cards/frame-sources.json
// records exactly which source files made each one.
// ---------------------------------------------------------------------------

// The one card corner (TODO 3.26). Import-free .ts, loaded through Node's
// type stripping like import-cc-frames.mjs's edge-contract import.
import { applyCardCornerMask, cardCornerRadiusPx } from "../../lib/cards/card-corner.ts";
import { UB_STAMP_HOLE, roundTriangleDistance } from "../../lib/cards/holo-stamp.ts";
import { GOLD_2003_NARROW_PAIRS, PAIR_RAMPS, TWO_COLOR_PAIRS, pairSides, rampName, rampShare } from "./pair-ramp.mjs";
import { describeRegionTones, regionGain, stretchRange } from "./print-cut.mjs";
import { SEVENTH_BOX_BY_COLOUR, SEVENTH_TONES, retroGoldCut, seventhCut } from "./seventh-1997.mjs";
import { EIGHTH_MASTER_OF, EIGHTH_PLATE_TONES, eighthPrintRecipe } from "./eighth-2003.mjs";

// The piecewise-linear re-cut and the region tone with an offset (TODO
// 4.10a): scripts/lib/print-cut.mjs, re-exported for the importer and tests.
export { clearWindowHalo, cutMaps, piecewiseMap, recutPiecewise, recutPlane, regionGain, squareCornersOnBlack, stretchRange, toneRegions } from "./print-cut.mjs";
export { seventhRegions } from "./seventh-1997.mjs";
export { eighthRegions } from "./eighth-2003.mjs";

export const CC_REPO = "Investigamer/cardconjurer";
/** Pinned so a rerun reproduces the same pixels; bump deliberately. */
export const CC_COMMIT = "2fcddba8966156d484cedf54d8214996748dd5e1";
export const CC_RAW = `https://raw.githubusercontent.com/${CC_REPO}/${CC_COMMIT}`;

export const OUT_W = 1500;
export const OUT_H = 2100;
/** The masters' corner radius: the one card corner (TODO 3.26), 4.3 % of
 *  the short side = 64.5 px, never rounded (it was Math.round(1500 × 0.026)
 *  = 39 before). CC's frames have opaque black corners; ours are
 *  transparent. The bake cuts the same corner, so a master and a bake agree
 *  pixel for pixel. */
export const CORNER_RADIUS = cardCornerRadiusPx(OUT_W, OUT_H);
/** Same encode as scripts/generate-frame-webp.mjs. */
export const WEBP = { quality: 90, effort: 6 };

export const COLORS = ["w", "u", "b", "r", "g", "c", "m"];

const NEW = "img/frames/m15/new";
const REG = "img/frames/m15/regular";
const SNOW = "img/frames/m15/new/snow";
const DEVOID = "img/frames/m15/devoid";
const PW = "img/frames/planeswalker/regular";
const TOKEN = "img/frames/token/m15/textless";
/** CC 'Regular (Bordered M15)' — the 2014–19 arch token with a text box
 *  (packTokenRegularM15.js; TODO 4.49 (b)). */
const TOKEN_REG = "img/frames/token/m15/regular";

/** A layer: a frame image, optionally shown only through a mask (its alpha),
 *  optionally at reduced opacity. */
const layer = (src, mask, opacity) => ({ src, ...(mask ? { mask } : {}), ...(opacity !== undefined ? { opacity } : {}) });
/** A layer whose alpha is LIFTED by `gain` (> 1) and clamped at 1 — a
 *  see-through master's rim made opaque with its anti-aliased edges kept in
 *  proportion (4.33's colourless walker: the pack's rim is α 234, so ×255/234
 *  takes it, and its join with the bottom bar, to 1). */
const lifted = (src, gain) => ({ src, gain });
/** A layer shown everywhere EXCEPT through a mask — how a borderless key
 *  drops a pack's Border mask (4.39). The mask is a region the frame image
 *  itself paints (its black ring), so the mask's COVERAGE is subtracted
 *  (alpha − mask alpha), not multiplied out: see compositeLayers. */
const outside = (src, mask) => ({ src, mask, invert: true });
/** A layer that REPLACES what is under it through a mask (4.34): where the
 *  mask covers, the layer's pixels stand instead of the ones below, not on
 *  top of them — a tinted box over a dark one would otherwise read darker
 *  than either. See compositeLayers. */
const replacing = (src, mask, extra = {}) => ({ src, mask, replace: true, ...extra });
/** A layer that RECOLOURS the layers below it and keeps their alpha (4.33's
 *  gold walker): through `mask`, at `opacity`, and weighted by a ramp of
 *  the layer's OWN luminance — 0 at or below `lumaRamp[0]`, 1 from
 *  `lumaRamp[1]` — so the layer's bright ground shows and its darker veins
 *  let the colour below through. Its alpha counts relative to the alpha
 *  below (as opaque as what is below = full weight), so a see-through bar
 *  (the tall walker's α 0.85 faces) is recoloured, never made more opaque.
 *  See compositeLayers. */
const recolour = (src, mask, { opacity, lumaRamp }) => ({ src, mask, recolour: true, opacity, lumaRamp });

/** The planeswalker loyalty shield's box on the 1500×2100 master: CC's
 *  maskLoyalty.png covers x 1197–1430, y 1844–1991 after the Lanczos
 *  downscale; padded so no anti-aliased edge is clipped. The M15PW
 *  profile's loyalty plateRect is this box in percent (a unit test keeps
 *  them in step). */
export const SHIELD_BOX = { x: 1194, y: 1841, width: 240, height: 154 };

/** Regular M15 P/T plates (CC keeps one set for regular, snow and tokens). */
const REG_PT = Object.fromEntries(COLORS.map((k) => [k, `${REG}/m15PT${k.toUpperCase()}.png`]));
const ARTIFACT_PT = { ...REG_PT, c: `${REG}/m15PTA.png` };
/** The Vehicle plate (TODO 4.5c): Card Conjurer's one brown `m15PTV.png`
 *  (381 × 209) under every colour key — every printed Vehicle wears it
 *  whatever its colour (cardFrameProperties: `pt = 'V'` for a type line
 *  that says Vehicle; 67 of 68 prints read, KLD 2016 → 2026). */
export const VEHICLE_PT_FILE = `${REG}/m15PTV.png`;
const VEHICLE_PT = Object.fromEntries(COLORS.map((k) => [k, VEHICLE_PT_FILE]));
/**
 * The Vehicle plate toned onto the prints (owner 2026-10-12): Card
 * Conjurer's plate is a saturated orange-brown — its face reads 110 / 73 /
 * 30 where the prints' median is 123 / 91 / 67 (52 plain black-bordered
 * Vehicles, KLD 2016 → 2026, the same box at HD: x 1165–1185, y 1915–1955).
 * A per-channel gain would need × 2.23 on blue and turns the bevel's light
 * rim lavender, so the tone keeps every pixel's hue: its colour is pulled
 * toward its own luminance (`saturation`) and the whole lifted (`luma`) —
 * out = luma × (L + saturation × (p − L)), L = Rec. 709 luminance — the
 * least-squares fit of the CC face onto the prints' (116 / 89 / 64 after,
 * measured in the same box: within 7 of the median on every channel).
 * Alpha untouched.
 */
export const VEHICLE_PLATE_TONE = Object.freeze({ luma: 1.235, saturation: 0.552 });
/** A plate tone on raw RGBA, in place (see VEHICLE_PLATE_TONE). */
export function tonePlateRgba8(data, { luma, saturation }) {
  for (let o = 0; o < data.length; o += 4) {
    const l = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    for (let c = 0; c < 3; c += 1) data[o + c] = Math.max(0, Math.min(255, Math.round(luma * (l + saturation * (data[o + c] - l)))));
  }
  return data;
}
/** A recipe letter → its file for a Vehicle: the bronze 'Vehicle Frame'
 *  where the artifact recipe names the artifact frame (`a`), the accurate
 *  M15 pack's file for every other letter. */
const vehicleFrameFile = (letter) => (letter === "a" ? `${NEW}/v.png` : m15FrameFile(letter));
/** The Nyx pack's folder (TODO 4.7; packM15NyxNew.js): seven whole masters,
 *  w u b r g m a, on the accurate M15 pack's geometry and masks. */
export const NYX = `${NEW}/nyx`;
/** A recipe letter → its file for the Nyx dress: the pack's starfield master
 *  for a colour, gold or the artifact silver; the regular pack's grey land
 *  frame for `l` (the hybrid dress's title and type bars — the Nyx pack has
 *  no land file, and its bars are the regular masters' own pixels). */
const nyxFrameFile = (letter) => (letter === "l" ? m15FrameFile(letter) : `${NYX}/${letter}.png`);
/** The Nyx dress's plates (TODO 4.7): the regular M15 plates, m15's seven
 *  images — the prints set the P/T on M15's own plate (no star on it: 0 %
 *  bright specks on the plate face of 58 prints), and the pack has none of
 *  its own. The colourless key keeps the grey colourless plate (m15PTC): it
 *  is the hybrid dress's plate (plateKeyFor), and the one colourless Nyx
 *  creature printed (CLB #1 Faceless One) reads 206 / 202 / 202 on its
 *  plate face — m15PTC's 210 / 202 / 197, not the artifact plate's bluer
 *  203 / 214 / 221. */
const NYX_PT = REG_PT;

/**
 * A coloured artifact is CC's cardFrameProperties recipe (creator-23.js
 * ~577-755, checked on Phyrexian Metamorph, Embercleave, Esper Sentinel):
 * the silver ARTIFACT frame + border, with the colour's pinline, title bar,
 * type bar and text box drawn through CC's masks. Layers go bottom → top in
 * CC's draw order. (The live MSE blend has it inside out — coloured border,
 * silver bars — TODO 4.16.)
 */
const colouredArtifact = (base, colour, baseMasks, colourMasks) => [
  ...baseMasks.map((m) => layer(base, m)),
  ...colourMasks.map((m) => layer(colour, m)),
];
/** CC's accurate-M15 masks, in its draw order (drawFrames reverses the
 *  frame list: Border, Frame, then Rules, Title, Type, Pinline on top). */
const M15_BASE_MASKS = [`${NEW}/border.png`, `${NEW}/frame.png`];
const M15_INTERIOR_MASKS = [`${NEW}/rules.png`, `${NEW}/title.png`, `${NEW}/type.png`, `${NEW}/pinline.png`];

/**
 * The two-colour pair masters (TODO 4.6b; design 2026-09-29 §1.2), a recipe
 * over the SAME Card Conjurer files as each template's verified masters,
 * drawn the way that template's masters are:
 *   • m15 / m15land — CC's whole image (m.png, a hybrid's two colours
 *     blended across the frame ramp, l.png) under the split regions, as their
 *     mono masters are the whole new/<k>.png / new/l<k>.png;
 *   • m15artifact — regions only, like its coloured artifacts
 *     (colouredArtifact): the artifact frame + border, the split text box,
 *     GOLD title and type bars, the split pinline.
 * Regions follow twoColorRecipe (CC's cardFrameProperties, corrected): a
 * split region is its two colours' files blended across the region's
 * UNTILTED ramp (pair-ramp.mjs PAIR_RAMPS: pinline 40→60 %W, a hybrid's
 * frame 44→57, text box 45→57) by a premultiplied lerp (pairLayer), then drawn
 * through CC's mask in CC's order (frame, rules, title, type, pinline).
 * Keys: gold-split `<pair>`, hybrid `<pair>-h`.
 */
const M15_MASK = {
  border: `${NEW}/border.png`,
  frame: `${NEW}/frame.png`,
  rules: `${NEW}/rules.png`,
  title: `${NEW}/title.png`,
  type: `${NEW}/type.png`,
  pinline: `${NEW}/pinline.png`,
};

/** A twoColorRecipe letter → its file in a `new/`-geometry pack: a colour,
 *  "m", "a" or "l" → <dir>/<k>.png; a land tint "wl" → <dir>/lw.png (CC
 *  reverses it). The accurate M15 pack and its snow twin
 *  (`m15/new/snow/`, packSnowNew.js: the same six masks, the same files by
 *  letter) resolve the same way. */
const packFrameFile = (dir) => (letter) =>
  letter.length === 2 && letter[1] === "l" ? `${dir}/l${letter[0]}.png` : `${dir}/${letter}.png`;
function m15FrameFile(letter) {
  return packFrameFile(NEW)(letter);
}
/** The snow pack's file of a letter (4.6f, wave 2c). */
const snowFrameFile = packFrameFile(SNOW);

// --- TODO 4.7 (wave 1): the extended-art frame. Card Conjurer's accurate
// 'Extended Art Frames' pack (packM15ExtendedArtNew.js, 2010 × 2814): the
// accurate M15 pack's title bar, type bar, text box and text layout (its
// loadTextOptions are packM15RegularNew.js's, number for number) with the
// art window opened to the card's side edges from the title bar to the type
// bar, and the M15 masks but its own Pinline. Files by letter as the M15
// pack's (packFrameFile): w u b r g m, `a` the artifact frame, `c` the
// see-through 'Eldrazi Frame', `v` the Vehicle frame, `l` / `l<k>` the land
// frames. PipGlyph builds w u b r g m c a today; `v` and the land frames are
// there for the dresses that build on this recipe (the extended-art
// Spacecraft, 4.27a step 2; an extended-art land frame).
export const EXTENDED = `${NEW}/extended`;
export const extendedFrameFile = packFrameFile(EXTENDED);
/** The extended pack's masks (packM15ExtendedArtNew.js): the accurate M15
 *  pack's Title, Type, Rules, Frame and Border, and its OWN Pinline (the
 *  pinline stops at the art's side edges). */
export const EXTENDED_MASK = Object.freeze({ ...M15_MASK, pinline: `${EXTENDED}/pinline.png` });
/** The extended frames' two-colour pair masters (TODO 4.7 follow-up, owner
 *  Round 63): 4.6b's recipe (pairMasterLayers) over the extended pack's own
 *  files and masks — kind "m15" for extendedart (the gold-split and hybrid
 *  dresses), "land" for extendedartland (the grey land frame with the box
 *  and pinline in the two land tints). */
export const extendedPairLayers = (pair, dress, kind) => pairMasterLayers(pair, dress, kind, extendedFrameFile, EXTENDED_MASK);
const EXTENDED_ART_PACK =
  "packM15ExtendedArtNew.js 'Extended Art Frames' (Card Conjurer's Accurate group): the accurate M15 pack's bars, box and text layout with the art window opened to the side edges";
const EXTENDED_ART_PAIR_NOTE =
  "two-colour pair masters (TODO 4.7 follow-up, owner Round 63): 4.6b's recipe (twoColorRecipe kind 'm15'; the untilted ramps of scripts/lib/pair-ramp.mjs) over the pack's own files through its own masks (EXTENDED_MASK: the M15 Title, Type, Rules, Frame, Border and the pack's own Pinline) — gold-split <pair> = m.png whole with the text box (45→57 %W) and the pinline (40→60 %W) lerped between the two colour frames; hybrid <pair>-h = the two colour frames lerped across the frame ramp (44→57 %W) under the pack's grey l.png title and type bars, the split box and pinline (the grey plate pt/c). Measured 2026-10-14 (median |ΔRGB| over the master's opaque, non-black pixels): 20 gold-split prints, two per pair (SOS #353 / #357 / #358 / #359, FRC #96, FDN #476–483, OTJ #348 / #366 / #367, WOE #360, MKM #413, SOC #98, DSC #65, WOC #39) 10.0–22.7 for the pair against 15.3–38.0 for gold m.png, the pair lower on every one; 5 hybrid prints (STX #334 / #341, IKO #360, ECL #372 / #374) 8.7–15.7 for <pair>-h against 9.0–17.3 for the gold-split and 16.7–26.0 for gold";
const EXTENDED_ART_NOTES = [
  "re-sourced from Card Conjurer (TODO 4.7, owner Q6 2026-10-13): replaces the 744 px MSE magic-extended-art composite that scripts/build-variation-frames.mjs upscaled into git — its title bar sat 10 px low, its box ended 41 px high and it painted white rails beside the art where every print runs the art to the card's edge",
  "w u b r g m = the pack's colour frames whole (new/extended/<k>.png), downscaled once; no border is added — the prints have none beside the art (0 px of black border at the art rows: the median on 13 of 14 prints measured, the 14th's art itself dark at the edge)",
  "c = the pack's see-through 'Eldrazi Frame' (new/extended/c.png): the colourless non-artifact prints (STX #285, CMM #746, MSC #292) show the art through the bars and the box; the profile draws the art under it (underFrameArt)",
  "a = the pack's silver 'Artifact Frame' (new/extended/a.png), the master a colourless ARTIFACT paints (FrameProfile.artifactMasterKeys { c: 'a' }: BRO #376, CMR #692, BIG #92)",
  "plates = M15's (the pack draws the regular m15PT plates at M15's bounds): no objects of its own",
  EXTENDED_ART_PAIR_NOTE,
];
const EXTENDED_ART_LAND_NOTES = [
  "the extended-art LAND frame (TODO 4.7, owner Round 63 2026-10-14): the pack's land frames whole (new/extended/l.png, l<k>.png), downscaled once; no border added, as extendedart",
  "colourless land = the pack's grey 'Land Frame' l.png (FDN #487 Soulstone Sanctuary, BLB #368 Fountainport, DFT #425 Avishkar Raceway, MSC #491 Scavenger Grounds: median |ΔRGB| 3.3–3.7 against the print over the master's opaque pixels); w u b r g = l<k>.png (NEO #501–505, MH2 #480, ELD #386–389, M3C #81: 2.0–19.7); gold m = lm.png, the any-colour land (CMR #705 Command Tower, MSC #470 Exotic Orchard, KHM #373 The World Tree: 10.3–19.0)",
  "two-colour pair masters (TODO 4.7 follow-up, owner Round 63): 4.6b's LAND recipe (twoColorRecipe kind 'land') over the pack's files and its own masks (EXTENDED_MASK: the M15 Title, Type, Rules, Frame, Border and the pack's own Pinline) — <pair> = the grey land frame l.png whole with the text box (45→57 %W) and the pinline (40→60 %W) lerped between the two land tints l<a>.png / l<b>.png, first canonical colour on the left; measured 2026-10-14 on 17 two-colour extended-art lands (SOC #101 / #103 / #107, FRC #102, BRO #370, CLB #602 / #606, STX #360 / #365, CMR #709 / #711, M21 #390, THB #348 / #351, EOC #43, MSC #468 / #477): median |ΔRGB| over the master's opaque, non-black pixels 4.0–15.0 for the pair against 20.3–67.3 for the gold land frame lm.png and 22.0–44.0 for the grey l.png",
  "plates = M15's (a land creature: Dryad Arbor's kind)",
];
// The black-bordered textless promos (Store Championship, MagicFest,
// MagicCon, Secret Lair): Card Conjurer's 'Magic Fest Promos'
// (packMagicFest.js, groupTextless-4.js) — 1500 × 2100 masters with the
// black ring, a dark translucent title bar and the art down to the bottom
// ring inside a rim in the card's colour.
const TEXTLESS_PROMO = "img/frames/textless/magicFest";
const textlessPromoFile = (letter) => `${TEXTLESS_PROMO}/${letter}.png`;
const TEXTLESS_PROMO_PACK = "packMagicFest.js 'Magic Fest Promos' (groupTextless-4.js)";
const TEXTLESS_PROMO_NOTES = (colourless) => [
  "re-sourced from Card Conjurer (TODO 4.35 / 4.42, owner Q6 2026-10-13): replaces the 375 px MSE masters that scripts/build-variation-frames.mjs upscaled into git — the same black-bordered promo look, sharp, with the prints' DARK title bar (SCH #50, PF26 #7, FDN #718)",
  "w u b r g m = the pack's colour frames whole (textless/magicFest/<k>.png), native 1500x2100",
  colourless,
  "no type bar and no text box, as printed: the profile is `textless` (TODO 3.24)",
];

// --- TODO 4.11 (wave 1, item 1): the Zendikar Expedition lands. Card
// Conjurer's two Expedition packs (groupShowcase-5.js), 1500 × 2100 native:
//   • 'ZNR Expeditions (2020)' (packExpeditionZNR-1.js,
//     `expedition/znr/expeditionNewFrame<K>.png`, W U B R G M L C) — the
//     Zendikar Rising Expeditions (ZNE #1–30): the hedron-stone frame with a
//     LIGHT translucent rules panel and type bar printed in dark ink;
//   • 'BFZ Expeditions (2015)' (packExpeditionBFZ-1.js,
//     `expedition/bfz/expeditionFrame<K>.png`, W U B R G M L A) — the
//     Battle for Zendikar / Oath Expeditions (EXP #1–45): the carved-stone
//     frame round an arched window, its own light rules panel.
// Each master is the pack's whole file, copied 1:1 (no resample).
export const EXPEDITION_ZNR = "img/frames/expedition/znr";
export const EXPEDITION_BFZ = "img/frames/expedition/bfz";
/** The pack file of a recipe letter (the pack's capitals). */
export const expeditionZnrFile = (letter) => `${EXPEDITION_ZNR}/expeditionNewFrame${letter.toUpperCase()}.png`;
export const expeditionBfzFile = (letter) => `${EXPEDITION_BFZ}/expeditionFrame${letter.toUpperCase()}.png`;
/** The BFZ pack's Pinline mask: where a coloured EXP land shows its colour
 *  on the land frame (expeditionlandbfz w u b r g). */
export const EXPEDITION_BFZ_PINLINE_MASK = `${EXPEDITION_BFZ}/expeditionMaskPinline.png`;
const EXPEDITION_TRANSFORM = "native 1500x2100, the frame image copied 1:1 (no resample), corners cut at the importer radius";
/**
 * The ZNR pack's two blocks, onto the ZNE prints (owner 2026-10-22; measured
 * 2026-10-22 on ZNE #21 / #22 / #27 / #28 / #29 / #30, each band registered
 * on its own — the print's pixel = the pack's moved by dy):
 *   • the title bar and its hedron stone (rows 150–235): −2 … −6, median −4
 *     (the light bar's run: print 99–206, the pack 104–209 → −4 both edges);
 *   • the lower block — the window's foot and the panel's top (1150–1230:
 *     +9 … +14), the type bar (top 1690–1740: +13 / +14; its foot and the
 *     stone 1790–1870: +8), the bottom stone's edge (1880–1950: +10 … +12):
 *     +11 as one piece ("Land" then sets at 1804 px, the prints' 1802–1806).
 * Only three runs of rows are flat on all seven masters — the top border
 * (0–59), the window's straight sides (730–776) and the bottom border
 * (1939–2099) — so the title block is rows 60–729 (−4: the top border
 * gives 4 rows) and the lower block rows 777–1938 (+11: the bottom border
 * gives 11), the window's straight sides taking the 15 rows between: whole
 * rows, byte for byte (shiftBlocksRgba8 throws on a zone that isn't flat).
 * The EXP pack's bars register within 0–2 px (title) and with no one offset
 * (type bar top +2 … +8, foot −1 … +7, stone −5 … +4 over nine prints): not
 * re-cut.
 */
export const EXPEDITION_ZNR_RECUT = Object.freeze({
  axis: "y",
  blocks: Object.freeze([Object.freeze({ from: 60, to: 730, by: -4 }), Object.freeze({ from: 777, to: 1939, by: 11 })]),
  why: "the pack's title bar sits 4 px below the ZNE prints' and its window foot, panel, type bar and bottom stone 11 px above them: rows 60–729 move 4 px up and rows 777–1938 move 11 px down, through the flat top border, window sides and bottom border",
});
/**
 * The EXP rules panel's opacity onto the prints (owner 2026-10-22): the
 * pack draws the panel white at α 128 (0.50); the prints' is ~0.65 —
 * measured from the art's continuity across the window / panel divider on
 * every EXP print (the art's luma just above the divider against just
 * below it, per 10-column bin: below = α·P + (1 − α)·above), on the twelve
 * where the art crosses it clearly (r > 0.8): the slope's reading 0.676,
 * the spread's 0.621 (the one biased high, the other low) — 0.65, α 166.
 * The land and gold frames' alpha is LIFTED by 166 / 128 (lifted(): ×gain,
 * clamped at 1), so the panel reads α 166, its anti-aliased rim and the
 * divider's dark line become opaque and every opaque or clear pixel keeps
 * its alpha.
 */
export const EXPEDITION_BFZ_PANEL_GAIN = 166 / 128;
const EXPEDITION_ZNR_PACK = "packExpeditionZNR-1.js 'ZNR Expeditions (2020)' (groupShowcase-5.js)";
const EXPEDITION_BFZ_PACK = "packExpeditionBFZ-1.js 'BFZ Expeditions (2015)' (groupShowcase-5.js)";
const EXPEDITION_ZNR_NOTES = [
  "re-sourced from Card Conjurer (TODO 4.11 wave 1, owner-approved 2026-10-21): replaces the 375 px MSE magic-m15-expedition masters that scripts/build-variation-frames.mjs upscaled 4x into git — the 2015 BFZ look (an opaque black box, light ink; b and g broken), where every reference printing (ZNE 2020) prints the light translucent panel with dark ink",
  "w u b r g m c = the pack's colour frames whole (expedition/znr/expeditionNewFrame<K>.png), native 1500x2100; the pack's 'Land Frame' L is not imported. Measured 2026-10-21 (median |ΔRGB| over the master's opaque pixels, prints at 1500x2100, best offset within ±6 / ±10 px; the MSE masters 100–108 on every one): colourless #21 Ancient Tomb, #28 Strip Mine, #30 Wasteland 18.3–20.7 on C (L ties: the same stone, a brown pinline where the prints' is grey); red #29 Valakut 20.7 on R (C 29.0, M 40.7); gold #22 Cavern of Souls, #27 Prismatic Vista 19.0–19.3 on M (C 32.0–34.7)",
  "two blocks moved onto the ZNE prints (EXPEDITION_ZNR_RECUT, owner 2026-10-22): rows 60–729 (the title bar and its stone) 4 px up and rows 777–1938 (the panel, the type bar and the bottom stone) 11 px down, through the flat top border, window sides and bottom border — whole rows, byte for byte",
  "two-colour lands (ZNE #11–20, #23–26, and the fetch lands, whose pinline prints their two colours) are not built here: until the pair masters (over the pack's Pinline mask), their import lands on the plain colourless master `c` as nearest",
];
const EXPEDITION_BFZ_NOTES = [
  "the 2015 BFZ / OGW Expeditions (EXP #1–45; TODO 4.11 wave 1): an ADDITION beside expeditionland, which keeps the 2020 ZNE look",
  "every EXP printing wears the pack's 'Land Frame' (expeditionFrameL.png: the beige carved stone, light bars) with its colours only in the PINLINE, but for the two any-colour lands (#39 Forbidden Orchard, #42 Mana Confluence), which print the gold frame. Measured 2026-10-21 (median |ΔRGB| over the master's opaque pixels, prints at 1500x2100, best offset within ±6 / ±10 px): colourless #36 Ancient Tomb, #41 Kor Haven, #43 Strip Mine, #45 Wasteland 21.0–23.7 on L against 26.0–30.3 on the pack's 'Colorless Frame' A; gold #39 / #42 27.0–31.3 on M against 33.7–35.3 on L; the UW duals #1 / #16 24.7–25.3 on L (A 28.3–29.3, U 31.3–32.7). #37 Dust Bowl and #38 Eye of Ugin read closest to the white frame W (20.3; L 38.3–38.7): a whiter print run",
  "c = the 'Land Frame' L whole; m = the 'Multicolored Frame' M whole; w u b r g = L with the colour frame's pinline laid in through the pack's Pinline mask (expeditionMaskPinline.png) — no mono-colour Expedition was printed in EXP, so a colour key follows the duals' rule (the colour in the pinline alone), never the pack's colour-stone frames, which no print wears",
  "the rules panel's alpha lifted ×166/128 onto the prints' ~0.65 (EXPEDITION_BFZ_PANEL_GAIN, owner 2026-10-22: the pack's 0.50 against 0.62–0.68 measured over twelve EXP prints) on every key — the L and M layers lifted, the colour's pinline over them unchanged",
  "two-colour lands (EXP #1–35, #40, whose pinline prints their two colours) are not built here: until the pair masters (over the pack's Pinline mask), their import lands on the land frame `c` as nearest",
];

// --- TODO 4.25: the Universes Beyond frames. Card Conjurer's accurate
// 'Universes Beyond' pack (packUBNew.js, groupAccurate.js: `m15/new/ub/`,
// 2010 × 2814) is the accurate M15 pack's geometry with the smooth,
// streaked art Universes Beyond printed from 40K (2022-10) to Final Fantasy
// (2025-06), through the SAME six masks and the same text layout — so the
// three templates are m15 / m15artifact / m15land's recipes over the UB
// files (packFrameFile), pairs included. The pack names a 'Colorless
// Frame' (`new/ub/c.png`) that is MISSING from Card Conjurer's tree. The
// colourless SPELL master is the print's SEE-THROUGH frame all the same
// (owner Round 57, decision 3; ACR #1, FIN #2, WHO #9 / #614 — every
// colourless non-artifact card on the frame): UB_SEE_THROUGH_LAYERS below.
// Recipes that ask the pack for a letter's FILE (the hybrid dress's grey
// bars, the plates' borrowings) still read the artifact frame for "c".
const UB = "img/frames/m15/new/ub";
const ubPackFile = packFrameFile(UB);
/** A recipe letter → the UB pack's file; the missing colourless frame is
 *  the pack's artifact frame (the colourless SPELL master is not built
 *  from it: UB_SEE_THROUGH_LAYERS). */
export const ubFrameFile = (letter) => ubPackFile(letter === "c" ? "a" : letter);

/**
 * The see-through colourless Universes Beyond frame (TODO 4.25 follow-up,
 * owner Round 57 decision 3). Two Card Conjurer drawings meet in it:
 *   • the ACCURATE pack's see-through 'Colorless Frame' (`new/c.png`, m15/c's
 *     own file) gives every edge, line, rim, bevel and ALPHA — the accurate
 *     Universes Beyond pack is that pack's geometry, so the Universes
 *     Beyond crown band, stamp notch and plates sit on it as on every other
 *     key;
 *   • the OLDER Universes Beyond pack's see-through colourless frame
 *     (`m15/ub/regular/c.png`, packUB.js) gives the PAPER — the smooth
 *     streaked bars and text box Universes Beyond prints — as COLOUR ONLY
 *     (`recolour`: the alpha below is kept), through the accurate pack's
 *     Title, Type and Rules masks and only PAPER ONTO PAPER: where that
 *     drawing is paper (its luma ≥ 190, nothing at or below 150; never its
 *     opaque rims, `maxAlpha`) AND the accurate drawing below is paper too
 *     (the same luma ramp on what is below). So neither drawing's lines,
 *     rims and bevels are touched — the older pack's sit 1–5 px off the
 *     accurate pack's and its bars end in another cap — and none of them
 *     reaches the master.
 * So the master's alpha is m15/c's, value for value: the same window, the
 * same translucent bars (212 / 255) and box (179 / 255), the same faint
 * wash over the frame field — and the same `underFrameArt` on the profile.
 */
export const UB_SEE_THROUGH_OLD = "img/frames/m15/ub/regular/c.png";
export const UB_SEE_THROUGH_PAPER = Object.freeze({ lumaRamp: Object.freeze([150, 190]), maxAlpha: 245 / 255 });
const UB_SEE_THROUGH_LAYERS = [
  layer(`${NEW}/c.png`),
  ...[`${NEW}/title.png`, `${NEW}/type.png`, `${NEW}/rules.png`].map((mask) =>
    ({
      ...recolour(UB_SEE_THROUGH_OLD, mask, { opacity: undefined, lumaRamp: [...UB_SEE_THROUGH_PAPER.lumaRamp] }),
      belowLumaRamp: [...UB_SEE_THROUGH_PAPER.lumaRamp],
      maxAlpha: UB_SEE_THROUGH_PAPER.maxAlpha,
    }),
  ),
];
/** The UB plates (packUBNew.js '… Power/Toughness', `m15/ub/pt/<k>.png`,
 *  282 × 154, drawn at M15's plate bounds): the colour's, gold, and for
 *  the colourless key the pack's grey 'Colorless' plate on the spell frame
 *  (the hybrid dress's plate too, as m15's pt/c is) and its silver
 *  'Artifact' plate on the artifact frame. */
const UB_PT_DIR = "img/frames/m15/ub/pt";
const UB_PT = Object.fromEntries(COLORS.map((k) => [k, `${UB_PT_DIR}/${k}.png`]));
const UB_ARTIFACT_PT = { ...UB_PT, c: `${UB_PT_DIR}/a.png` };
const ubPairLayers = (pair, dress, kind) => pairMasterLayers(pair, dress, kind, ubFrameFile);
const UB_PACK = "packUBNew.js 'Universes Beyond' (groupAccurate.js): the accurate M15 pack's masks and text layout over the m15/new/ub files";
const UB_TONE_NOTE =
  "toned onto the prints before the first tick (owner Round 57, 2026-10-14; UB_PRINT_TONES through CC_SOURCE_TONES, recorded under sourceTones): the pack's green bars (g.png, lg.png), its gold bars and gold text box (m.png, lm.png) and its land-grey bars and text box (l.png) are multiplied by a per-channel gain through the pack's Title, Type and Rules masks as the FILE is loaded, so every master drawn from one of them — the gold-split and artifact pairs' gold bars, the hybrids' and the two-colour lands' grey bars — carries the same pixels; the frame field, the pinline, the border, the plates, the crowns and every other colour as Card Conjurer drew them";
const UB_PAIR_NOTE =
  "two-colour pair masters (TODO 4.25): 4.6b's recipe (twoColorRecipe; the untilted ramps of scripts/lib/pair-ramp.mjs) over the Universes Beyond pack's own files, through the accurate M15 masks the pack shares";

/**
 * The pack's green, gold and land-grey toned onto the prints BEFORE the
 * first tick (owner Round 57, 2026-10-14; afterwards it would be a
 * correction with a sweep). Card Conjurer drew three of the pack's tones
 * off the prints; every other region of every file is within about 8
 * levels a channel and stays as drawn. Each entry is one region of one
 * drawing: `from` = what the pack's file reads there, `to` = the prints'
 * centre, both the per-channel median of the region's paper (x 140–1360 ×
 * y 118–198 for the title bar, y 1198–1272 for the type bar; x 150–1350 ×
 * y 1350–1880 for the text box, at 1500 × 2100; sampled every 2 px, the
 * brightest 5 % and the darker 40 % — ink, rims — left out). The tone
 * (toneSourceRegions) multiplies the region's colour by to ÷ from through
 * the pack's OWN mask (its soft edge the weight), so the streaks, bevels
 * and rims keep their shading and black stays black — with the HUE kept on
 * the highlights: a plain per-channel gain turns a bevel's white (green:
 * × 1.087 / 1 / 1.085 makes the bar's streaks pink — tried, 2026-10-14; the
 * Vehicle plate's lesson, VEHICLE_PLATE_TONE), so the gain's COLOUR part
 * fades out between the region's own tone and white, where only the
 * luminance gain (luma(to) ÷ luma(from), one number for the three
 * channels) is left. A pixel at `from` lands on `to` exactly. Alpha
 * untouched.
 *
 * Three readings of print — Scryfall's images of the sets that wear the
 * frame (no scan is read by a build; the numbers are the recipe):
 *   • the builder's (9–13 prints a key, scans included): green title
 *     193, 215, 185; gold "7–12 darker";
 *   • the second reader's (#544's independent check; 8 green, 13 gold, 2
 *     grey-land prints): green title 187–194, 210–212, 176–182; gold title
 *     238–240, 218–220, 128–140, box 245, 234, 196; land title
 *     198, 187, 178, box 231, 227, 221;
 *   • Round 57's (143 OTHER printings, none of the 915 above, of 190 read —
 *     the date-stamped promos, the surge foils and 40K's and the Secret
 *     Lair's scans set aside for their cast; FIN, FIC, ACR, PIP, WHO, LTR,
 *     LTC; medians [min–max]):
 *       green, 27 spells — title 185, 211, 178 [180–194, 209–213, 173–182],
 *         type 180, 209, 173 [175–188, 206–212, 165–178] (box 215, 227, 215
 *         against the file's 219, 229, 218: left alone);
 *       gold, 29 spells of three colours or more — title 237, 219, 139
 *         [231–241, 216–222, 127–145], type 237, 219, 135, box 244, 234, 198
 *         [241–246, 233–235, 196–202]; the gold bars of 11 two-colour
 *         spells 239, 221, 134 / 239, 219, 130, of 6 two-colour artifacts
 *         241, 221, 135 / 241, 219, 129; 20 gold LANDS 240, 222, 133 /
 *         241, 222, 130, box 243, 234, 198. Two printings of one gold:
 *         WHO / ACR / LTC blue 122–131, FIN / FIC / PIP / LTR 133–145 —
 *         the target is between them;
 *       land grey, 32 lands with no colour — title 197, 185, 176
 *         [192–200, 182–187, 174–177], type 197, 185, 176, box 230, 226, 219
 *         [229–232, 224–227, 217–221]; the bars of 12 two-colour lands
 *         197, 184, 176 / 197, 184, 175; the three hybrid prints' grey bars
 *         (PIP #212 / #740, ACR #55) 198–202, 187–191, 177–179.
 * `to` is the centre the three readings agree on (the second reader's and
 * Round 57's use one method; the builder's green is 5 lighter in red).
 */
export const UB_PRINT_TONES = Object.freeze({
  g: Object.freeze({
    title: Object.freeze({ from: [173, 211, 165], to: [188, 211, 179] }),
    type: Object.freeze({ from: [170, 209, 162], to: [182, 209, 173] }),
  }),
  m: Object.freeze({
    title: Object.freeze({ from: [241, 227, 157], to: [239, 220, 135] }),
    type: Object.freeze({ from: [241, 226, 154], to: [238, 219, 132] }),
    rules: Object.freeze({ from: [249, 242, 213], to: [244, 234, 197] }),
  }),
  l: Object.freeze({
    title: Object.freeze({ from: [214, 210, 194], to: [197, 186, 177] }),
    type: Object.freeze({ from: [212, 208, 191], to: [197, 185, 176] }),
    rules: Object.freeze({ from: [220, 214, 195], to: [230, 226, 220] }),
  }),
});

/**
 * A pack FILE toned wherever it is drawn (the importer tones the file as it
 * loads it, before any mask, ramp or composite): file → `{ masks, tones }`,
 * region name → the pack's mask and the region's `{ from, to }`. Toning the
 * file, not a master, is what keeps every master built from it in step by
 * construction: the gold bars of the gold-split pairs and of a two-colour
 * artifact are m.png's, the grey bars of a hybrid and of a two-colour land
 * l.png's. The pack's tinted lands carry the SAME bars — lg.png's are
 * g.png's pixel for pixel, lm.png's bars and box m.png's (measured: 0 of
 * 563,640 and 0 of 2,471,640 channel values differ at 1500 × 2100) — so
 * they take the same tones (the prints agree: the 20 gold lands above; LTR
 * #260 and LTC #341, the green lands, 192 / 184, 211 / 210, 180 / 173).
 */
const ubSourceTone = (letter) =>
  Object.freeze({
    masks: Object.freeze(Object.fromEntries(Object.keys(UB_PRINT_TONES[letter]).map((region) => [region, M15_MASK[region]]))),
    tones: UB_PRINT_TONES[letter],
    table: `UB_PRINT_TONES.${letter}`,
  });
export const CC_SOURCE_TONES = Object.freeze({
  [`${UB}/g.png`]: ubSourceTone("g"),
  [`${UB}/lg.png`]: ubSourceTone("g"),
  [`${UB}/m.png`]: ubSourceTone("m"),
  [`${UB}/lm.png`]: ubSourceTone("m"),
  [`${UB}/l.png`]: ubSourceTone("l"),
});
/** Rec. 709 luminance of an RGB triple (tonePlateRgba8's). */
const luma709 = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** One source tone, checked: `{ from, to }`, RGB 0–255, `from` no channel
 *  at 0 and darker than white. */
export function checkSourceTone(name, tone) {
  const rgb = (v) => Array.isArray(v) && v.length === 3 && v.every((c) => Number.isFinite(c) && c >= 0 && c <= 255);
  if (!tone || !rgb(tone.from) || !rgb(tone.to)) throw new Error(`toneSourceRegions: ${name} needs from / to as RGB (0–255)`);
  if (tone.from.some((c) => c < 1) || luma709(...tone.from) > 254) throw new Error(`toneSourceRegions: ${name} can't be toned from ${tone.from.join(", ")}`);
  return tone;
}
/** The gains of a source tone: per channel (to ÷ from) and the neutral one
 *  (luma(to) ÷ luma(from)) the highlights converge on. */
export function sourceToneGain(tone) {
  return {
    channel: tone.to.map((t, c) => t / tone.from[c]),
    neutral: luma709(...tone.to) / luma709(...tone.from),
    fromLuma: luma709(...tone.from),
  };
}
/**
 * Tone a pack file region by region (UB_PRINT_TONES; see it for the why).
 * `regions` maps a name to its coverage (bytes, 0–255, the image's size:
 * the pack's mask alpha), `tones` the same names to `{ from, to }`. Per
 * pixel and region: h = (255 − luma) ÷ (255 − luma(from)), clamped to
 * 0 … 1 (1 at the region's tone and below, 0 at white); the gain of a
 * channel is neutral + (to ÷ from − neutral) × h; the pixel's colour is
 * multiplied by 1 + (gain − 1) × coverage. Rounded, clamped; alpha kept.
 * Regions are applied in the table's order (the pack's masks don't
 * overlap but for their soft edges). A region with no tone, or a tone with
 * no region, throws. Returns a new buffer.
 */
export function toneSourceRegions(buf, width, height, regions, tones) {
  const n = width * height;
  if (buf.length !== n * 4) throw new Error(`toneSourceRegions: the image is not ${width}x${height} RGBA`);
  for (const name of Object.keys(regions)) if (!tones[name]) throw new Error(`toneSourceRegions: region ${name} has no tone`);
  const out = Buffer.from(buf);
  for (const [name, tone] of Object.entries(tones)) {
    checkSourceTone(name, tone);
    const m = regions[name];
    if (!m || m.length !== n) throw new Error(`toneSourceRegions: tone ${name} has no ${width}x${height} region`);
    const { channel, neutral, fromLuma } = sourceToneGain(tone);
    for (let p = 0; p < n; p += 1) {
      if (m[p] === 0) continue;
      const o = p * 4;
      if (out[o + 3] === 0) continue;
      const w = m[p] / 255;
      const h = Math.min(1, Math.max(0, (255 - luma709(out[o], out[o + 1], out[o + 2])) / (255 - fromLuma)));
      const px = [out[o], out[o + 1], out[o + 2]];
      for (let c = 0; c < 3; c += 1) {
        const gain = neutral + (channel[c] - neutral) * h;
        out[o + c] = Math.min(255, Math.max(0, Math.round(px[c] * (1 + (gain - 1) * w))));
      }
    }
  }
  return out;
}
/** How provenance prints a source tone table: name → gains and from → to. */
export function describeSourceToneTable(tones) {
  return Object.fromEntries(
    Object.entries(tones).map(([name, t]) => {
      const { channel, neutral } = sourceToneGain(t);
      return [name, `× ${channel.map((g) => g.toFixed(3)).join(" / ")} (${t.from.join(", ")} → ${t.to.join(", ")}), fading to × ${neutral.toFixed(3)} on every channel at white`];
    }),
  );
}
/** A pack file's tones (CC_SOURCE_TONES), or null. */
export function sourceTonesOf(src) {
  if (Object.hasOwn(CC_SOURCE_TONES, src)) return CC_SOURCE_TONES[src];
  // The LOTR ring's files (TODO 4.11, RING_SOURCE_TONES — defined with its
  // recipe below; read at call time).
  if (Object.hasOwn(RING_SOURCE_TONES, src)) return RING_SOURCE_TONES[src];
  // …the MKM dossier's crowns (TODO 4.11 wave 2, DOSSIER_SOURCE_TONES)…
  if (Object.hasOwn(DOSSIER_SOURCE_TONES, src)) return DOSSIER_SOURCE_TONES[src];
  // …the Doctor Who TARDIS's stripes, wedges and plate (TODO 4.11 wave 2,
  // TARDIS_SOURCE_TONES)…
  if (Object.hasOwn(TARDIS_SOURCE_TONES, src)) return TARDIS_SOURCE_TONES[src];
  // …and the MUL Tarkir dragon wings (TODO 4.11, TARKIR_SOURCE_TONES).
  return Object.hasOwn(TARKIR_SOURCE_TONES, src) ? TARKIR_SOURCE_TONES[src] : null;
}
/** The toned files a recipe draws, as provenance prints them: file → the
 *  table's name, each region's mask and its gain (describeSourceToneTable). */
export function describeSourceTones(def) {
  return describeFileTones(sourceFilesFor(def));
}
/** describeSourceTones for a list of pack files (a band's layers, a notch's
 *  pieces). */
export function describeFileTones(files) {
  const out = {};
  for (const file of files) {
    const tone = sourceTonesOf(file);
    if (!tone) continue;
    const gains = describeSourceToneTable(tone.tones);
    // A region is a pack mask, or (the LOTR ring, TODO 4.11) the pixels near
    // one flat colour of the file itself (nearRegionPlane).
    // …or (the MUL Tarkir wings, TODO 4.11) the pixels where the file
    // differs from another file (diffRegionPlane).
    // …or the file's coloured pixels (chromaRegionPlane), or the dark ground
    // inside a box where the file is the same as another (boxRegionPlane).
    const where = (region) => {
      if (tone.masks?.[region]) return `through ${tone.masks[region]}`;
      const d = tone.diff?.[region];
      if (d) {
        const split = d.luma ? `, the share of them with Rec. 601 luma ${d.luma.side} ${d.luma.split} (ramping across ± ${d.luma.half})` : "";
        return `on the pixels that differ from ${d.file} by ${d.none}–${d.full} levels (max channel; full from ${d.full})${split}`;
      }
      const c = tone.chroma?.[region];
      if (c) return `on the pixels of chroma (max − min channel) ${c.none}–${c.full} (full from ${c.full})`;
      const b = tone.box?.[region];
      if (b)
        return `inside ${b.rect.x},${b.rect.y} ${b.rect.width}×${b.rect.height} px${b.at ? ` (the piece drawn at ${b.at.x},${b.at.y})` : ""} on the dark ground (luma ≤ ${b.luma[0]}, none from ${b.luma[1]})${b.file ? ` where the file is the same as ${b.file} (max channel ≤ ${b.same.full}, none from ${b.same.none})` : ""}`;
      return `on the pixels within ${tone.near[region].full}–${tone.near[region].none} levels (max channel) of ${tone.tones[region].from.join(", ")}`;
    };
    out[file] = { table: tone.table, ...Object.fromEntries(Object.keys(tone.tones).map((region) => [region, `${where(region)}: ${gains[region]}`])) };
  }
  return Object.keys(out).length ? out : null;
}

/** A pair layer: the recipe region's left file blended into its right file
 *  across the region's ramp (lerpLayers over rampMask), through `mask`. */
function pairLayer(region, mask, fileOf = m15FrameFile) {
  return {
    src: fileOf(region.left),
    right: fileOf(region.right),
    ramp: [...region.ramp],
    ...(mask ? { mask } : {}),
  };
}

/** The layers of one pair master (see above). `kind`: "m15", "artifact" or
 *  "land"; `dress`: "split" or "hybrid" (hybrid only on "m15"). `fileOf`
 *  resolves a recipe letter to a pack file: the accurate M15 pack's (the
 *  default) or the snow pack's, whose masks are the same (snowPairLayers);
 *  `masks` the pack's own masks where they differ (the double-faced
 *  bodies' packs, TODO 5.1d: dfcPairLayers). */
export function pairMasterLayers(pair, dress, kind, fileOf = m15FrameFile, masks = M15_MASK) {
  const r = twoColorRecipe(pair, dress, kind);
  if (kind === "artifact") {
    return [
      layer(fileOf(r.frame.left), masks.border),
      layer(fileOf(r.frame.left), masks.frame),
      pairLayer(r.rules, masks.rules, fileOf),
      layer(fileOf(r.typeTitle), masks.title),
      layer(fileOf(r.typeTitle), masks.type),
      pairLayer(r.pinline, masks.pinline, fileOf),
    ];
  }
  const base = r.frame.right ? pairLayer(r.frame, undefined, fileOf) : layer(fileOf(r.frame.left));
  // The bars are the base's own unless the base is a split frame (hybrid:
  // grey l bars over a two-colour frame).
  const bars = r.frame.right
    ? [layer(fileOf(r.typeTitle), masks.title), layer(fileOf(r.typeTitle), masks.type)]
    : [];
  return [base, pairLayer(r.rules, masks.rules, fileOf), ...bars, pairLayer(r.pinline, masks.pinline, fileOf)];
}

/** A template's pair masters: `{ wu: layers, …, "wu-h": layers, … }`. */
function pairMasters(kind, dresses, layersOf = pairMasterLayers) {
  return Object.fromEntries(
    dresses.flatMap((dress) =>
      TWO_COLOR_PAIRS.map((pair) => [dress === "hybrid" ? `${pair}-h` : pair, layersOf(pair, dress, kind)]),
    ),
  );
}

// --- 4.6f (wave 2c): the snow pairs — m15snow (the white-bar pairs) and
// m15snowland (the snow dual lands). Card Conjurer's 'Snow (Kaldheim)' pack
// (packSnowNew.js, `m15/new/snow/<k>.png`) is the accurate M15 pack's
// geometry with frosted art, through the SAME six masks (groupAccurate.js
// lists both), so the pair recipe is 4.6b's over the snow files
// (pairMasterLayers with snowFrameFile): the dark ring rows of
// `new/snow/m.png` sit where `new/snow/w.png`'s do (rows 134–138 / 293–298
// / 310–317 and 1562–1569 / 1583–1587 / 1742–1747 / 2613–2619 at 2010 × 2814;
// u / r / g draw one row more at four of them, covering the gold's), unlike
// the borderless pack's M frame (one row higher than its colours, the #449
// hairline) — the snow pair masters are checked row by row for any gold of
// the m frame left inside the pinline mask's rows (legendary-masters.test.ts's
// method; wave 2c's snow-pair-masters test).
//
// Measured on KHM's three crowned snow pairs (#224 Narfi U|B, #223 Moritte
// G|U, #230 Svella R|G; WotC's renders) beside KHM's mono snow prints (#27
// Search for Glory w, #47 Berg Strider u, #104 Priest of the Haunted Edge b,
// #138 Frost Bite r, #193 Sculptor of Winter g, #244 Replicating Ring c):
//   • the frame BODY is the gold snow body on all three (the strip beside
//     the text box reads 152/142/126 left and 181/175/168 right on every
//     pair; CC's snow m.png reads 161/149/124 and 185/177/159 there; KHM's
//     u body reads 111/123/140), the P/T plate the gold plate (174/154/105 —
//     m15PTM; the monos print their colour's);
//   • the title and type BARS are white: 246–248 / 241–243 / 239–243 on
//     the three pairs against the monos' 248/245/249 (w), 240/239/248 (u),
//     237/233/240 (b), 246/235/236 (r), 238/237/242 (g), 244/242/249 (c) —
//     the whitest bar of the set but for w's, with a faint warm cast
//     (R − B +6 … +8, where w's is −1 and r's pink +10): the gold snow bar
//     at KHM's faint tint. CC's snow m.png bar (236/231/213, R − B +23) is
//     that bar at CC's tint strength — CC's u bar is as far from KHM's
//     (220/233/242 against 240/239/248) — but the owner's call (round 20,
//     2026-10-01: "white-bar pairs") is the print's absolute look, so the
//     bars are the pack's WHITE frame's (snow/w.png, 244/244/242) through
//     CC's Title and Type masks, warmed a quarter of the way to the gold
//     bar's (snow/m.png at SNOW_PAIR_BAR_GOLD_SHARE source-over through the
//     same masks): the least-squares share of (m − w) that reproduces the
//     prints' (pair − w) = (−1, −3, −8) against CC's (−8, −13, −29) is 0.26;
//     CC's m bar as it is would be one letter away (typeTitle "m");
//   • the pinline splits across 4.6b's ramp: the type-bar and text-box
//     rings of the three pairs and the ten snow duals (the KHM #248–274 run)
//     read a median 42.8 / 50.0 / 57.2 %W at 10 / 50 / 90 % (24 of the 26
//     ring readings within 40.8–45.1 / 49.1–51.4 / 55.5–59.4; Moritte's G|U
//     ring is too low in contrast to read), an untilted 41→59 — the 40→60
//     ramp's 42 / 50 / 58;
//   • the text box splits too, faintly on a nonland (KHM's snow box is
//     near-white: U|B reads 242/240/248 left and 245/242/248 right — the u
//     and b monos' 240/238/247 and 245/241/247) and as a colour wash on the
//     duals (saturation ×4 shows the two tints meeting at the centre);
//     the rules region takes the box ramp (45→57) as on m15 / m15land;
//   • the crown is the standard band (owner round 20, option A): KHM's snow
//     crown is the standard crown's shape and registration over a speckled
//     texture (Moritte's G|U split, de-shaded against KHM #179 Jorn's g and
//     J22 #12 Isu's u crown, reads 43.2 / 48.3 / 51.6 at 10 / 50 / 90 %
//     against the standard band's 46.0 / 50.0 / 54.0 — one measurable card,
//     cross-set references; the band is shared with m15, m15crown/<pair>).
// The snow LAND pairs are 4.6b's land recipe over the snow land files
// (snow/l.png whole — its neutral bars are every snow land's: the KHM
// basics and duals read R − B −1 … −9 on the title bar — the box and
// pinline split in the two land tints snow/l<k>.png), as KHM #248–274
// print (their type-bar and box rings are in the 24 readings above).
/** How far the white bar is warmed toward the gold snow bar (see above). */
export const SNOW_PAIR_BAR_GOLD_SHARE = 0.25;

/** The layers of one SNOW pair master (4.6f, wave 2c): the nonland
 *  ("snow") pair is the snow gold frame whole, the split text box, the
 *  white bars (snow/w.png's title and type regions warmed a quarter toward
 *  the gold bar's) and the split pinline; the snow LAND pair is the land
 *  recipe over the snow land files. Keys: `<pair>` (the split dress only —
 *  no hybrid snow print exists). */
export function snowPairLayers(pair, dress, kind) {
  if (dress !== "split") throw new Error(`snowPairLayers: the snow frames draw the split dress only (${dress})`);
  if (kind === "snowland") return pairMasterLayers(pair, "split", "land", snowFrameFile);
  if (kind !== "snow") throw new Error(`snowPairLayers: unknown kind ${kind}`);
  const r = twoColorRecipe(pair, "split", "m15");
  return [
    layer(snowFrameFile(r.frame.left)),
    pairLayer(r.rules, M15_MASK.rules, snowFrameFile),
    // The white bars: the pack's white frame's bar regions, in place of the
    // gold frame's, warmed a quarter toward the gold bar (prints: KHM #224 /
    // #223 / #230, white with a faint warm cast).
    layer(snowFrameFile("w"), M15_MASK.title),
    layer(snowFrameFile("w"), M15_MASK.type),
    layer(snowFrameFile(r.typeTitle), M15_MASK.title, SNOW_PAIR_BAR_GOLD_SHARE),
    layer(snowFrameFile(r.typeTitle), M15_MASK.type, SNOW_PAIR_BAR_GOLD_SHARE),
    pairLayer(r.pinline, M15_MASK.pinline, snowFrameFile),
  ];
}
const SNOW_PAIR_NOTE =
  "two-colour pair masters (TODO 4.6f, wave 2c; owner round 20, 2026-10-01): 4.6b's recipe over the snow pack's files through the same accurate-M15 masks — each split region's two colours blended across the UNTILTED ramp (pinline 40→60 %W, text box 45→57) by a premultiplied lerp (scripts/lib/pair-ramp.mjs), first canonical colour on the left; measured on KHM #224 / #223 / #230 and the ten KHM snow duals (#248–274): the pinline's rings 42–45 / 49–51 / 56–58 %W at 10 / 50 / 90 %";

/** How provenance records the pair masters (notes). */
const PAIR_NOTE =
  "two-colour pair masters (TODO 4.6b, owner decision 2026-09-29): a recipe over the same CC files as the verified masters — each split region's two colours blended across an UNTILTED ramp (pinline 40→60 %W, a hybrid's frame 44→57, text box 45→57) by a premultiplied lerp (scripts/lib/pair-ramp.mjs), never CC's tilted maskRightHalf.png stacking; first canonical colour on the left (WU WB UB UR BR BG RG RW GW GU); measured against the prints (design 2026-09-29 §1.2)";
/** CC's textless bordered token pack masks (packTokenTextlessM15.js). */
const TOKEN_BASE_MASKS = [`${REG}/m15MaskBorder.png`, `${TOKEN}/frame.svg`];
const TOKEN_INTERIOR_MASKS = [`${REG}/m15MaskTitle.png`, "img/frames/token/tokenMaskTextlessType.png", `${TOKEN}/pinline.svg`];
/** The same, from CC's regular (text-box) token pack (packTokenRegularM15.js:
 *  Pinline, Frame, Title, Type, Rules, Border). A coloured artifact keeps the
 *  silver box, as the text-box prints do (TC16 #9, TC18 #8 Thopter: a blue
 *  pinline and pill on the silver frame and box): the box (Rules) is drawn
 *  from the artifact frame with the border and frame, and the colour goes
 *  through the textless recipe's Title + Type + Pinline. */
const TOKEN_REG_RULES_MASK = "img/frames/token/tokenMaskRegularRules.png";
const TOKEN_REG_BASE_MASKS = [`${REG}/m15MaskBorder.png`, `${TOKEN_REG}/frame.svg`, TOKEN_REG_RULES_MASK];
const TOKEN_REG_INTERIOR_MASKS = [`${REG}/m15MaskTitle.png`, "img/frames/token/tokenMaskRegularType.png", `${TOKEN_REG}/pinline.svg`];

/**
 * The re-cut of CC's text-box token masters (TODO 4.49 (b), "measure
 * first"). CC's master draws the lower band ~3 %H above every print: the
 * art window ends at 1340 px (63.9 %H) and the type pill's outline runs
 * 1356–1477 (64.6–70.3 %H), where TDOM #2, TM19 #1, TC17 #9 and TWAR #16
 * end the art at ~1404–1409 px and print the pill's outline at 1420–1540
 * (Scryfall PNGs at 1500 × 2100; their title bars sit where CC's does,
 * ±1 px). The band from the window's straight sides through the top of the
 * text box moves down `shift` px as ONE piece — window edge, pill, box top,
 * the frame beside them — and the rows it opens above are the window's
 * straight sides again; the box keeps its bottom, so it is `shift` px
 * shorter. Each seam is cross-faded over `blend` rows (premultiplied),
 * inside the window's sides and inside the box, where the frame is a plain
 * texture. 64 px (3.05 %H) puts the pill, the window edge and the box's top
 * edge within 1 px of those prints; the alignment score (lib/frames/align.ts)
 * over the 19 reference prints ties 62 and 64 px (94.5 %) and prefers 64 on
 * the four ruler prints (95.0 %; CC as-is 93.1 %). Native px of the pack
 * (1500 × 2100).
 */
export const TOKEN_REGULAR_RECUT = { fromY: 1240, toY: 1560, shift: 64, blend: 24 };

const perColor = (fn, keys = COLORS) => Object.fromEntries(keys.map((k) => [k, fn(k)]));
const WUBRGM = ["w", "u", "b", "r", "g", "m"];

/**
 * The re-cut of CC's TEXTLESS token masters (m15token, m15tokenartifact;
 * TODO 4.49, owner decision 2026-09-29: the pill ~8 px lower). The fifteen
 * 2014–19 textless pins (TDOM #3/#4/#9/#11, TM19 #6/#8/#12, TBFZ #1/#7,
 * TWAR #5, TMH1 #8/#18, TEMN #1, TKLD #2, TC18 #7; Scryfall PNGs at
 * 1500 × 2100) print the window's bottom edge, the strip under it, the type
 * pill and the pill's shadow as ONE piece, 8.2 px below CC's on average
 * (edges measured per print: window edge +8.6, pill outline top +8.6 and
 * bottom +7.7; 4–11 px print to print, as they are cut), while the title
 * bar (−0.3), the frame texture under the pill and the black border
 * (+1.8) stay where CC draws them. So the band from the window's straight
 * sides (1640) through the pill's shadow (CC's last shadow row is 1856; the
 * texture starts at 1857) moves down `shift` px: the window is 8 px taller
 * (the art slot follows, lib/cards/template-layout.ts TOKEN_RECUT_PX), the
 * pill and its shadow cover the top 8 rows of the texture, and the texture,
 * the plate area, the border and the corners keep their place. The rows
 * opened at 1640 repeat the window's sides, cross-faded over `blend` rows;
 * the bottom seam fades over only `blendBottom` 2 rows, the shadow's own
 * tail (1863–1864), so the pill and its shadow keep their edges: a hard cut
 * there left the texture's jump at 1865 1.4–2.5× CC's own last shadow step
 * on the marbled colours (b, r, g, u); the 2-row fade brings it to CC's
 * (7.5 vs 7.8 on b, 14.7 vs 17.4 on r; the step before it is CC's too).
 * Native px of the pack (1500 × 2100).
 */
export const TOKEN_TEXTLESS_RECUT = { fromY: 1640, toY: 1857, shift: 8, blend: 24, blendBottom: 2 };
/** The textless token pack, as provenance names it. */
const TOKEN_TEXTLESS_PACK = "packTokenTextlessM15.js 'Textless (Bordered M15)'";

// --- 4.48 / 4.50 — the full-art token design (M20, 2019 → today): Card
// Conjurer's 'Textless', 'Short' and 'Tall' token packs (groupToken-2.js;
// packTokenTextless-1.js, packTokenShort-1.js, packTokenTall-1.js @2fcddba).
// 1500×2100 native (no resample): a black ring 60 px wide (the art runs to
// it: CC artBounds 4 / 2.86 / 92 × 89.53), the name pill (89–232 px) and the
// type pill (textless 1701–1844, short 1404–1547, tall 1170–1313) at ~α250,
// the translucent box (α≈205, `c` 166) from the pill to the colour strip at
// 1937–1948, black below. CC's 'Regular' pack (type pill at 64 %H) matches
// no print (4.48: 0 of 116) and is not imported; its 'Short' pack is the
// printed regular box.
const M20_TOKEN = "img/frames/token";
/** A height's master for a colour key: W/U/B/R/G/M/A, `c` = frameC. */
const m20TokenFrame = (dir, height, k) =>
  k === "c" ? `${M20_TOKEN}/${dir}/frameC.png` : `${M20_TOKEN}/${dir}/tokenFrame${k.toUpperCase()}${height}.png`;
/** Each pack's Pinline mask (its first mask): the pill rims, the box or
 *  lower-window outline and the colour strip. The tall pack lists the
 *  regular M15 masks; drawn through the colour master, the M15 pinline's
 *  art-window sides fall where the master is clear, so only its pills, box
 *  and strip take colour. */
const M20_TOKEN_PINLINE = {
  textless: `${M20_TOKEN}/tokenMaskTextlessPinline.png`,
  short: `${M20_TOKEN}/short/m15MaskPinlineSuperShort.png`,
  tall: `${REG}/m15MaskPinline.png`,
};
const M20_TOKEN_PACKS = {
  textless: { dir: "textless", height: "Textless", pack: "packTokenTextless-1.js 'Textless' (groupToken-2.js)" },
  short: { dir: "short", height: "Short", pack: "packTokenShort-1.js 'Short' (groupToken-2.js) — the printed regular box" },
  tall: { dir: "tall", height: "Tall", pack: "packTokenTall-1.js 'Tall' (groupToken-2.js)" },
};
/**
 * The re-cut of CC's TEXTLESS full-art token masters (m20token,
 * m20tokenartifact; TODO 4.48, "measure first"). Measured on 28 M20+
 * textless prints (Scryfall PNGs at 1500 × 2100; tfdn #1/#6/#12/#13/#15/
 * #18/#20, tmh3 #7, tcmm #1/#45, teoe #1, teoc #14, tdsk #7/#14, tsoc #8,
 * tm3c #7, tmkm #10, tlci #13, tfin #6, tpip #9, thob #8, tsos #5, tm20 #2,
 * t2xm #4, tscd #6, tc19 #26, tdmu #20, tmoc #25): the type pill prints as
 * ONE piece 4.8 px below CC's (profile correlation over the pill, 2023+
 * prints 4.1–4.9; its top outline +4.4, bottom outline +5.7, medians),
 * while the name pill (+1.3) and the colour strip (−1.0) sit where CC draws
 * them — the 'Short' (+0.9) and 'Tall' (+0.7) pills too, so only the
 * textless pack moves. The band from the pill's glow (1687) through its
 * bottom rim (1844; the lower window's own top edge) moves down `shift` px
 * over the top rows of the clear lower window; the rows it opens repeat the
 * clear window above it and the black ring beside it, row for row, so both
 * seams are hard cuts (no fade: nothing but the ring and clear art meets
 * them). Native px of the pack (1500 × 2100).
 */
export const M20_TOKEN_TEXTLESS_RECUT = { fromY: 1687, toY: 1845, shift: 5, blend: 0, blendBottom: 0 };

/** Each pack's own Type mask (packTokenTextless-1.js, packTokenShort-1.js;
 *  the tall pack lists M15's): the type pill from its black outline in —
 *  every pixel of the pill's interior, and nothing of the art window or
 *  the pill's glow (checked on every master, 2026-09-29). */
const M20_TOKEN_TYPE_MASK = {
  textless: `${M20_TOKEN}/tokenMaskTextlessType.png`,
  short: `${M20_TOKEN}/short/m15MaskTypeShort.png`,
  tall: `${REG}/m15MaskType.png`,
};
/** The three packs' Title mask (M15's): the name pill, outline included. */
const M20_TOKEN_TITLE_MASK = `${REG}/m15MaskTitle.png`;

/**
 * The type pill made SOLID, as printed (owner decision 2026-09-29, TODO
 * 4.48 / 4.50): CC draws its interior at α 204 (`c` 166), so a fifth of the
 * art showed through the pill; every M20+ print's pill is opaque cream (the
 * colour's light tint). A PipGlyph composite over CC's pixels: each pixel
 * the pack's Type mask covers keeps its colour and becomes opaque
 * (compositeFinish "opaque").
 */
export const M20_TOKEN_SOLID_TYPE_PILL = { op: "opaque" };

/**
 * The ARTIFACT templates' name pill darkened to the prints' slate (owner
 * decision 2026-09-29, TODO 4.50): CC's tokenFrameA pill is a silver
 * gradient (luminance ~77 at its middle, ~246 at its ends), where 16 M20+
 * artifact prints (TFDN #22/#23, TLCI #3/#17, TMKM #14, TDSK #7, TCMM #45,
 * TNEO #6, T2XM #8, TMH3 #13/#17/#18, TMOC #25, TSOC #8, TM3C #7, TEOC #14)
 * print a dark slate one — behind the name (x 420–1080 × y 135–190 px) the
 * median is rgb 59/64/67 (luminance 63; white ink 10.5 : 1), lighter towards
 * the caps. A flat slate drawn source-over CC's pill interior at 65 %: fitted
 * to those prints behind the name (median rgb 58/64/69, luminance 63, white
 * ink 10.5 : 1 on CC's pixels), the caps staying lighter as printed
 * (~105). Only the pixels CC draws translucent take it — full weight at
 * CC's interior α 230, none from α 244 (the rims, the bevel's outer rows,
 * the outline) — so the rims keep CC's silver or colour
 * (compositeFinish "tint").
 */
export const M20_ARTIFACT_NAME_SLATE = { op: "tint", rgb: [30, 40, 48], opacity: 0.65, alphaFull: 230, alphaNone: 244 };

/**
 * The artifact name pill made SOLID (owner decision round 14, 2026-09-29,
 * TODO 4.50): after the slate its interior was α ≈ 246, so a sliver of the
 * art still showed through; every print's name pill is opaque. Each pixel
 * M15's Title mask covers keeps its colour (the slate, the rims, the
 * outline) and becomes opaque — the mask covers nothing CC draws below
 * α 230 (no glow, no art window), so nothing new appears around the pill.
 */
export const M20_ARTIFACT_SOLID_NAME_PILL = { op: "opaque" };

/**
 * The type pill DARKENED to the prints (owner decision round 14, 2026-09-29,
 * TODO 4.48 / 4.50) — the same print-fitted "tint" as the artifact name
 * pill's slate, drawn source-over CC's translucent interior BEFORE the pill
 * is made solid. Measured behind the type line (the pill's interior rows
 * inset 25 px, x 620–1080, the ink left out; Scryfall PNGs at 1500 × 2100):
 *
 *   colourless (frameC, the plain templates' `c`): CC's pill is a flat grey
 *     209 (α 166) where 4 M20+ colourless prints (TEOE #1, TCMM #1, TMH3 #38,
 *     TFDN #26) print a warm grey — median rgb 176/165/160, luminance 167
 *     (157–180). A flat rgb 164/149/143 at 65 % puts the interior on
 *     176/165/160 (luminance 168).
 *   artifact (tokenFrameA, every colour of the artifact templates: a
 *     coloured artifact token keeps the silver pill): CC's is a flat
 *     rgb 181/197/203 (luminance 193, α 204) where 16 M20+ artifact prints
 *     (the slate's list) print a steel grey — median rgb 160/178/188,
 *     luminance 174 (160–190). A flat rgb 151/170/181 at 65 % puts the
 *     interior on 160/178/188 (luminance 174).
 *
 * Only CC's flat interior takes it (full weight at its α — 166 +2 / 204 +1 —
 * none from the first bevel α, 186 / 216): the bevel's light top rows and
 * dark left and bottom rows (α 211–247), the black outline and the
 * coloured rim outside the mask keep CC's pixels, as the prints keep a
 * lighter top bevel (~220) and a darker bottom one (~137) around the flat
 * interior. The five coloured pills are not touched (4–12 lighter than
 * the prints = the scans' offset; owner decision round 14).
 */
export const M20_COLOURLESS_TYPE_TINT = { op: "tint", rgb: [164, 149, 143], opacity: 0.65, alphaFull: 168, alphaNone: 186, colors: ["c"] };
export const M20_ARTIFACT_TYPE_TINT = { op: "tint", rgb: [151, 170, 181], opacity: 0.65, alphaFull: 205, alphaNone: 216 };

/**
 * The two-colour full-art token (TODO 4.48's central split; measured
 * 2026-10-15 on Scryfall's PNGs at 1500 × 2100, 32 two-colour M20+ prints,
 * all ten pairs, 2019 → 2026). A pair prints its two colours left to right
 * across ONE untilted ramp (PAIR_RAMPS.m20Token, 40→60 %W) on everything the
 * colour paints — the name pill, the rims, the translucent box and the
 * colour strip (TMKM #10 W|U, TMKM #13 G|W, TDMU #21 R|G) — while its TYPE
 * pill is neither colour: a neutral warm grey, the same on every pair
 * (median rgb 193/187/187, luminance 188, behind the type line on 16 regular
 * prints — 183–203; a mono white pill reads 217/214/207, black 182/167/168),
 * and its P/T plate is M15's grey colourless plate (204/197/192 on 11
 * prints; `m15/pt/c` reads 203/196/191 — FrameProfile.twoColorPlate).
 *
 * The master: the two colours' frames lerped whole (premultiplied,
 * blendPair), then CC's grey 'Land Frame' type pill IN PLACE of the lerped
 * one (`replace`, through the pack's Type mask — L's bevels and outline are
 * the pack's own), tinted to the prints and made solid like every pill
 * (M20_PAIR_TYPE_TINT, then M20_TOKEN_SOLID_TYPE_PILL). CC's L pill is a flat
 * rgb 214/207/203 at α 204; the tint puts it on 193/187/187. The artifact
 * templates keep their silver pills and box (4.50): the A frame whole and
 * the two colours' pinlines lerped through the pack's Pinline mask.
 */
export const M20_PAIR_TYPE_TINT = { op: "tint", rgb: [184, 178, 180], opacity: 0.65, alphaFull: 205, alphaNone: 216, colors: [...TWO_COLOR_PAIRS] };

/**
 * The WHITE half of a two-colour name pill, toned to print's metal (owner
 * Round 69, 2026-10-15: tone, never an outline on the name). CC's white pill
 * is near-white (our pair masters read 220/221/221 there), where every
 * white-pair print sets its white name on a mid metallic grey: on 17 prints
 * of the plain templates (TFRC #11, TECL #7 / #8, TINR #20, TMKM #10 / #12 /
 * #13, TRVR #15 / #17 / #19, TMOM #12, TVOW #15 / #16, TSOS #7 / #10 / #11,
 * TLCI #14 — Scryfall PNGs at 1500 × 2100, the pill's interior rows 110–212
 * on the white side, x 150–450 or 1050–1350, the darker 60 % so the name's
 * ink is left out) the median is rgb 109/109/105, luminance 108 (87–122),
 * the same on WU, WB, RW and GW. A per-channel GAIN (× target / ours) keeps
 * the white pill's own hue and its bevel's shading, applied only where the
 * white colour's share of the split is (rampGain: full on the white side,
 * fading across PAIR_RAMPS.m20Token) and only on the pill's translucent
 * interior (α ≤ 230 full, none from 244 — the rims and outline keep CC's
 * pixels). The black half stays as drawn; the artifact templates' slate pill
 * is untouched.
 */
export const M20_PAIR_WHITE_PILL_GAIN = Object.freeze([0.495, 0.493, 0.475]);
/** The pairs with a white half, and that half's side of the split. */
const WHITE_PAIR_SIDES = Object.freeze({ wu: "left", wb: "left", rw: "right", gw: "right" });
/** The finish entries that tone the white half (one per white pair). */
const m20PairWhitePillTone = () =>
  Object.entries(WHITE_PAIR_SIDES).map(([pair, side]) => ({
    op: "rampGain",
    gain: [...M20_PAIR_WHITE_PILL_GAIN],
    side,
    ramp: [...PAIR_RAMPS.m20Token],
    alphaFull: 230,
    alphaNone: 244,
    colors: [pair],
    mask: M20_TOKEN_TITLE_MASK,
  }));
export { WHITE_PAIR_SIDES as M20_WHITE_PAIR_SIDES };

/** A plain full-art token pair master's layers (see M20_PAIR_TYPE_TINT). */
function m20TokenPairLayers(dir, H, height, pair) {
  const [a, b] = pair.split("");
  return [
    { src: m20TokenFrame(dir, H, a), right: m20TokenFrame(dir, H, b), ramp: [...PAIR_RAMPS.m20Token] },
    { src: m20TokenFrame(dir, H, "l"), mask: M20_TOKEN_TYPE_MASK[height], replace: true },
  ];
}

/** An artifact full-art token pair master's layers: the silver A frame
 *  whole, the two colours' pinlines lerped (4.50's mono recipe, split). */
function m20TokenArtifactPairLayers(dir, H, height, pair) {
  const [a, b] = pair.split("");
  return [
    layer(m20TokenFrame(dir, H, "a")),
    { src: m20TokenFrame(dir, H, a), right: m20TokenFrame(dir, H, b), ramp: [...PAIR_RAMPS.m20Token], mask: M20_TOKEN_PINLINE[height] },
  ];
}

/** One full-art token template: the height's pack, plain or artifact. */
function m20TokenTemplate(height, artifact) {
  const { dir, height: H, pack } = M20_TOKEN_PACKS[height];
  const recut = height === "textless" ? M20_TOKEN_TEXTLESS_RECUT : undefined;
  // Owner decisions 2026-09-29: the type pill darkened to the prints (the
  // colourless one and the artifact one; round 14) and then solid on every
  // template, the artifact name pill slate and then solid (round 14).
  // Composited over CC's flattened pixels BEFORE the re-cut (the masks are
  // the packs' own geometry), in this order: a tint weighs CC's alpha, so it
  // goes before the op that makes those pixels opaque.
  const typeMask = M20_TOKEN_TYPE_MASK[dir];
  const finish = [
    { ...(artifact ? M20_ARTIFACT_TYPE_TINT : M20_COLOURLESS_TYPE_TINT), mask: typeMask },
    // TODO 4.48: a plain pair's grey type pill, tinted to the prints.
    ...(artifact ? [] : [{ ...M20_PAIR_TYPE_TINT, mask: typeMask }]),
    { ...M20_TOKEN_SOLID_TYPE_PILL, mask: typeMask },
    // TODO 4.48 (owner Round 69): a white pair's name pill, its white half
    // toned to print's metal (the artifact templates' pill is slate).
    ...(artifact ? [] : m20PairWhitePillTone()),
    ...(artifact
      ? [
          { ...M20_ARTIFACT_NAME_SLATE, mask: M20_TOKEN_TITLE_MASK },
          { ...M20_ARTIFACT_SOLID_NAME_PILL, mask: M20_TOKEN_TITLE_MASK },
        ]
      : []),
  ];
  const colors = artifact
    ? {
        c: [layer(m20TokenFrame(dir, H, "a"))],
        // 4.50: a coloured artifact token keeps the silver pills and box and
        // takes the colour on the pill rims, the pinline and the strip
        // (TDSK #7 Toy w, TSOC #8 Phyrexian Myr u, TMH3 #18 b, TMOC #25 r).
        ...perColor((k) => [layer(m20TokenFrame(dir, H, "a")), layer(m20TokenFrame(dir, H, k), M20_TOKEN_PINLINE[height])], WUBRGM),
        // TODO 4.48: the ten pairs, their pinlines split (FrameProfile.twoColorMasters).
        ...Object.fromEntries(TWO_COLOR_PAIRS.map((pair) => [pair, m20TokenArtifactPairLayers(dir, H, height, pair)])),
      }
    : {
        ...perColor((k) => [layer(m20TokenFrame(dir, H, k))]),
        // TODO 4.48: the ten pairs (FrameProfile.twoColorMasters).
        ...Object.fromEntries(TWO_COLOR_PAIRS.map((pair) => [pair, m20TokenPairLayers(dir, H, height, pair)])),
      };
  const notes = artifact
    ? [
        `source: CC '${H}' token pack Artifact Frame (tokenFrameA${H}.png) — TODO 4.50`,
        `coloured artifact tokens = the silver artifact master whole + the colour's master through the pack's Pinline mask (${M20_TOKEN_PINLINE[height]}): silver pills and box, the colour on the rims, pinline and strip, as TDSK #7 / TSOC #8 print; NOT 4.16's m15artifact recipe (the token pills stay silver)`,
      ]
    : [
        `source: CC '${H}' token pack (tokenFrame{W,U,B,R,G,M}${H}.png) — the full-art token design, M20 → today (TODO 4.48)`,
        `colourless = CC's frameC.png (charcoal pills, box α≈166; TEOE #1 Sliver, TMH3 #38 Eldrazi Spawn)`,
      ];
  notes.push(
    artifact
      ? "two-colour pair masters <pair>.png (TODO 4.48, measured on 32 two-colour M20+ prints): the silver artifact master whole + the pair's two colour masters lerped left to right across PAIR_RAMPS.m20Token (40→60 %W, untilted, premultiplied) through the pack's Pinline mask — the colours on the rims, pinline and strip, the pills and box silver; the plate is the artifact set's colourless one (FrameProfile.twoColorPlate) — PipGlyph composite of CC pixels"
      : `two-colour pair masters <pair>.png (TODO 4.48, measured on 32 two-colour M20+ prints: TMKM #10 W|U, TMKM #13 G|W, TDMU #21 R|G …): the pair's two colour masters lerped WHOLE left to right across PAIR_RAMPS.m20Token (40→60 %W, untilted, premultiplied — the name pill, rims, box and strip split there on the prints, 42.9 / 50.3 / 58.3 %W at 10 / 50 / 90 % on the strip), then CC's grey 'Land Frame' type pill (tokenFrameL${H}.png) in place of the lerped one through the pack's Type mask, tinted to the prints' neutral pill (median rgb 193/187/187 on 16 regular prints, every pair alike) and made solid; the plate is M15's grey colourless one (FrameProfile.twoColorPlate: the prints' 204/197/192) — PipGlyph composite of CC pixels`,
  );
  if (!artifact) {
    notes.push(
      `the WHITE half of a white pair's name pill (wu, wb: left; rw, gw: right) toned to print's metal (owner Round 69, 2026-10-15): a per-channel gain × ${M20_PAIR_WHITE_PILL_GAIN.join(" / ")} on the white side of PAIR_RAMPS.m20Token, fading across it, on the pill's translucent interior through M15's Title mask (α ≤ 230 full, none from 244: the rims and outline keep CC's pixels) — CC's 220/221/221 onto the median of 17 white-pair prints, rgb 109/109/105 (luminance 108, 87–122); hue and bevel kept; the black half and the artifact templates untouched — PipGlyph composite of CC pixels`,
    );
  }
  if (height === "short") notes.push("CC's 'Short' pack is the printed REGULAR box (type pill 66.9–73.7 %H; its 'Regular' pack at 64 %H matches no print, TODO 4.48); measured on 19 prints: pill +0.9 px, name pill +1.3, strip −1.0 — used as drawn");
  if (height === "tall") notes.push("measured on 16 tall prints: pill +0.7 px, name pill +1.3 — used as drawn");
  if (recut) notes.push("re-cut onto the prints (TODO 4.48, measure first): the type pill 5 px lower, as 28 M20+ textless prints print it (+4.8 px, correlation); PipGlyph composite of CC pixels");
  notes.push(
    artifact
      ? "the type pill darkened to the prints (owner decision round 14, 2026-09-29): a flat rgb 151/170/181 at 65 % source-over CC's flat silver interior (rgb 181/197/203, luminance 193, α 204) through the pack's Type mask, every colour — the interior on rgb 160/178/188 (luminance 174), the median of 16 M20+ artifact prints (luminance 160–190); the bevel, outline and rim keep CC's pixels — PipGlyph composite of CC pixels"
      : "the colourless (c) type pill darkened to the prints (owner decision round 14, 2026-09-29): a flat rgb 164/149/143 at 65 % source-over frameC's flat grey interior (209, α 166) through the pack's Type mask — the interior on rgb 176/165/160 (luminance 168), the median of 4 M20+ colourless prints (luminance 157–180); the bevel, outline and rim keep CC's pixels; the five coloured pills keep CC's colour — PipGlyph composite of CC pixels",
  );
  notes.push("the type pill SOLID, as every M20+ print's (owner decision 2026-09-29): CC's interior α 204 (c 166) made opaque in its own colour through the pack's Type mask — PipGlyph composite of CC pixels");
  if (artifact) {
    notes.push(
      "the name pill darkened to the prints' slate (owner decision 2026-09-29, TODO 4.50): a flat slate rgb 30/40/48 at 65 % source-over CC's translucent silver interior through M15's Title mask (the rims and outline keep CC's pixels) — behind the name luminance 63 and white ink 10.5 : 1, as 16 M20+ artifact prints (luminance 54–71, 9–11 : 1); CC's silver pill was 102–137 (3.5–5.7 : 1) — PipGlyph composite of CC pixels",
      "the name pill SOLID (owner decision round 14, 2026-09-29): after the slate its interior was α ≈ 246; every pixel M15's Title mask covers made opaque in its own colour (the mask covers nothing CC draws below α 230) — PipGlyph composite of CC pixels",
    );
  }
  return {
    colors,
    finish,
    ...(recut ? { recut } : {}),
    pack,
    transforms: `${recut ? m20TextlessRecutTransform(recut) : "native 1500x2100, pixels copied 1:1 (no resample), composited in CC's order, corners rounded to the importer radius"}; before any re-cut, PipGlyph composites over the flattened pixels: ${finish.map(describeFinish).join("; ")}`,
    notes,
  };
}

// --- 4.32 'Borderless (Alt)' — CC packBorderless.js (groupShowcase-5.js:49).
// 1500×2100 native (no resample): sides α0 down to the fins, the α128 black
// box and the translucent bars baked in, an opaque bottom bar from 92.24 % H
// with fins up the side edges from 78.67 % H. The P/T plate sits at
// 1146/1861 px, 274×140 (76.4/88.62/18.27×6.67 %). The pack's masks
// (genericShowcase/m15GenericShowcaseMaskPinline.png + the regular M15
// Title/Type/Rules/Border) are 4.34's land recipe; nothing here needs them.
const BORDERLESS = "img/frames/m15/borderless";
const borderlessFrame = (k) => `${BORDERLESS}/m15GenericShowcaseFrame${k.toUpperCase()}.png`;
/** The pack's P/T plates: one per colour, "Artifact" (a) and "Colorless" (l).
 *  (pt/c.png sits in the folder too, but the pack never lists it.) */
const BORDERLESS_PT = { ...perColor((k) => `${BORDERLESS}/pt/${k}.png`, WUBRGM), c: `${BORDERLESS}/pt/l.png` };

// --- 4.34 the borderless nonbasic land, from the same pack. Measured on the
// prints (2026-09-29, 50+ borderless land printings): a borderless land
// wears its colour on ALL THREE of its translucent parts — the title bar,
// the type bar and the text box — where a borderless spell tints only the
// title bar (its type bar and box are the dark α128 of the masters above).
// CC's pack draws the land look from no single file: its 'Land Frame' (L)
// is the spell look in grey, and CC's autoframe (creator-23.js
// autoBorderlessFrame) keeps the dark type bar and box too. So the land
// master is a PipGlyph composite of the pack's pixels, in four layers:
//   1. the colour's frame, whole (its title bar, pinline, bottom bar and
//      fins — the m15borderless master of that colour; L for colourless);
//   2. the TYPE BAR = the same frame's title bar, moved down onto it
//      (BORDERLESS_TITLE_TO_TYPE_DY): the print's type bar is its title bar
//      (same tint, bevels and caps), and CC's Title and Type masks match at
//      that shift (mean |Δα| 1.7 levels over the bar);
//   3. the TEXT BOX = the tinted box of CC's genericShowcase pack (its
//      neutral 'Land Frame', flat #9a9a9a α191 with its bevels and the
//      shadow under the type bar), re-tinted to the colour's title-bar tint
//      (retintStructure: every genericShowcase colour's box is that one
//      structure lerped from its tint to white or black, ≤ 0.06 levels
//      mean error) — the print's box tint is the title's (best fit over 52
//      box edges: the title colour, rms 22.8, against genericShowcase's own
//      tints 28.4 and the dark α128 box 68.6), at genericShowcase's α191;
//   4. the pinline, through the pack's Pinline mask, on top (it repairs the
//      pixels layers 2 and 3 replaced along its anti-aliased edge).
// Two-colour lands (the most printed kind: MID #281, OTJ #304, the RVR
// shocks, the MKM surveil lands) print the grey L bars with a SPLIT pinline
// and a split box: the ten pair masters `<pair>.png` (TODO 4.56) are the
// SAME function with `{ frame: "l", box: [x, y], pinline: [x, y] }` — the
// grey 'Land Frame' whole (its title bar, bottom bar and fins), its title
// bar moved onto the type bar, the tinted box in the two colours' own box
// tints (each colour's title-bar tint, as its mono master's box) and the
// two colours' pinlines, each pair lerped across ONE untilted ramp,
// PAIR_RAMPS.borderlessLand (39→61 %W, scripts/lib/pair-ramp.mjs), first
// canonical colour on the left. Measured on the 119 two-colour borderless
// lands that print this look (Scryfall 2026-10-06):
//   • the bars are the colourless land's grey: inside-against-art
//     regression (the art above and below the bar), α 0.71 on the title bar
//     (CC's L bar: 179 / 255 = 0.70), its tint 141/135/130 on the 69 digital
//     renders against 144/138/137 on the 13 colourless-land renders read the
//     same way — never gold (m reads 114/91/29), never a colour;
//   • each box half is that colour's mono box: MH3 #354's white box reads
//     121/117/93 over 102/98/25, and the white half of the pairs predicts
//     121/117/95 there (MH3 #351's red box 159/63/49, predicted 151/64/59);
//     the regression (side strips against the art beside the box, corrected
//     for its 0.89 under-read, found by covering the prints' own open art
//     with a known α and tint) puts the printed boxes at α 0.73–0.84 with a
//     duller tint than CC's
//     (w 124/120/108 against 166/155/133, r 149/40/34 against 130/22/14):
//     the mono masters' own difference from the prints, which the pairs
//     keep on purpose (a pair's halves ARE its two mono boxes);
//   • the split: 41.3 / 50.2 / 58.9 on the title and type rings (the
//     median of 420 rings; their mean 41.2 / 50.0 / 58.8) and 40.9 / 49.8 /
//     59.0 on the box's top band at 10 / 50 / 90 % — one ramp for
//     both, a little wider than the spells' 40→60, and not the bordered
//     frames' 45→57 for the box.
// No hairline can show (the #449 lesson): CC's L frame draws every ring row
// where the colour frames do, and the Pinline layer covers the L frame's own
// brown-grey ring whole (tests/unit/frames/borderless-land-pair-masters
// .test.ts holds each master to the two mono masters' lerp inside the ring
// and the box, row by row). `m` stays the three-and-more-colour land
// (Command Tower CMM #659): gold bars, box and pinline.
const GENERIC_SHOWCASE = "img/frames/m15/genericShowcase";
/** The pack's own Pinline mask (packBorderless.js lists it first). */
const BORDERLESS_PINLINE_MASK = `${GENERIC_SHOWCASE}/m15GenericShowcaseMaskPinline.png`;
/** The regular M15 masks the pack lists for its Type and Rules layers. */
const REG_TYPE_MASK = `${REG}/m15MaskType.png`;
const REG_RULES_MASK = `${REG}/m15MaskRules.png`;
/** From the title bar to the type bar on the pack's 1500×2100 frames, in
 *  native px: CC's Title mask spans rows 100–221 and its Type mask
 *  1181–1302 (both 122 rows; the row ends agree within 1 px at every row). */
export const BORDERLESS_TITLE_TO_TYPE_DY = 1081;
/** Where a colour's title-bar tint is read, in native px: the middle of the
 *  bar's flat interior (96–97.6 % of its pixels are that one RGBA). */
export const BORDERLESS_TINT_POINT = { x: 750, y: 160 };
/** The tinted box's structure: genericShowcase's neutral 'Land Frame', whose
 *  flat box is #9a9a9a — `from` is asserted against it when imported. */
export const TINTED_BOX_STRUCTURE = {
  src: `${GENERIC_SHOWCASE}/m15GenericShowcaseFrameL.png`,
  from: [154, 154, 154],
  /** A flat pixel of the box, where `from` is checked. */
  flatAt: { x: 750, y: 1600 },
};
/** The pack letter of a colour key's land dress: colourless is CC's 'Land
 *  Frame' (grey bars, the land's brown-grey pinline), never the see-through
 *  'Colorless Frame' of the spells. */
const borderlessLandLetter = (k) => (k === "c" ? "l" : k);

/**
 * The borderless land master's layers, bottom → top (see above): `frame`
 * dresses the title bar, the type bar and the bottom bar, `box` tints the
 * text box, `pinline` colours the pinline — each a pack letter (w u b r g m
 * l). A mono-colour land passes one letter three times; a pair master
 * (TODO 4.56) passes the grey `l` bars and a letter PAIR `[left, right]` for
 * the box and the pinline: the box structure re-tinted to each colour's
 * title-bar tint and the two frames' pinlines, each lerped across
 * PAIR_RAMPS.borderlessLand (39→61 %W, untilted, premultiplied).
 */
export function borderlessLandLayers({ frame, box, pinline }) {
  const tintOf = (letter) => ({ src: borderlessFrame(letter), ...BORDERLESS_TINT_POINT });
  const ramp = [...PAIR_RAMPS.borderlessLand];
  return [
    layer(borderlessFrame(frame)),
    replacing(borderlessFrame(frame), REG_TYPE_MASK, { dy: BORDERLESS_TITLE_TO_TYPE_DY }),
    replacing(TINTED_BOX_STRUCTURE.src, REG_RULES_MASK, {
      retint: Array.isArray(box)
        ? { from: TINTED_BOX_STRUCTURE.from, tintOf: tintOf(box[0]), tintOfRight: tintOf(box[1]), ramp }
        : { from: TINTED_BOX_STRUCTURE.from, tintOf: tintOf(box) },
    }),
    Array.isArray(pinline)
      ? { src: borderlessFrame(pinline[0]), right: borderlessFrame(pinline[1]), ramp, mask: BORDERLESS_PINLINE_MASK }
      : layer(borderlessFrame(pinline), BORDERLESS_PINLINE_MASK),
  ];
}

/** The ten borderless land pair masters (TODO 4.56): `{ wu: layers, … }`,
 *  the first canonical colour on the left. */
function borderlessLandPairs() {
  return Object.fromEntries(
    TWO_COLOR_PAIRS.map((pair) => {
      const sides = pair.split("");
      return [pair, borderlessLandLayers({ frame: "l", box: sides, pinline: sides })];
    }),
  );
}

// --- 4.6f (wave 2a): the borderless legendary crown and the two-colour
// pinline on m15borderless / m15borderlessartifact — CC's autoBorderlessFrame
// (creator-23.js:1227–1266) with makeBorderlessFrameByLetter (:2034–2170)
// and cardFrameProperties's 'Borderless' style (:577–755).
//
// THE CROWN is CC's FLOATING crown (packM15LegendCrownsFloating.js), the one
// every crowned borderless print wears (FDN #294 / #309 / #324 / #330 /
// #336, DMU #435): 1500-native (1408×215), drawn 1:1 at 3.07/1.91/93.87×
// 10.24 %, its outline (1416×223) UNDER it at 2.8/1.72/94.4×10.62 — after
// CC ERASES the strip 3.94/2.77/92.14×1.77 % (rows 58–94 at HD), where the
// master's title-bar ring (the black outer line at rows 85–88 and, from row
// 89, the pinline ring in the frame's colour — white on W; one row higher on
// the gold frame — α 255 over x 94–1405) would show above the crown's inner
// edge and in its two end notches; the print's crown floats on the art and
// meets the bar on its own outline. An overlay can only add pixels, so the
// crown is baked into a second master per key, `<key>-legendary.png`
// (FrameProfile.crownMasters), beside the plain one; nothing else in the
// master changes (the plain masters rebuild byte-identical). The crown
// letter is the master's: the colour, M on the gold frame, C on
// m15borderless's see-through colourless frame, A on the artifact dress
// (its colourless master IS CC's artifact frame; CC's crown letter for an
// Artifact type line is A). CC's unlisted 'Artifact Legend Crown (Alt)' is
// not used (autoBorderlessFrame never picks it).
//
// THE PAIR: a two-colour borderless print splits only its PINLINE — the
// first colour left, the second right, around the title and type bars (FRA
// #376 / #377, HOB #213, TLA #306, BLC #86, MH2 #321, FRA #461; FDN
// #343–351); the bars, box and bottom bar keep the gold M frame's. So the
// pair master is the M frame with the two colours' frames lerped across the
// pinline ramp (40→60 %W, m15's: the uncrowned FDN pairs #344 / #345
// measure 42.0–43.4 / 50.2–51.2 / 58.4–59.0 at 10 / 50 / 90 % on both
// rings) through the pack's own Pinline mask — CC's Pinline / pinlineRight
// layers, untilted (its maskRightHalf.png tilts +1.35 %W). Under that
// pinline the split dress first takes CC's Rules and Type regions (the
// regular M15 masks CC's own stack lists for those layers) from the two
// colour frames, IN PLACE of the M frame's (`replace`): the box is the same
// dark α128 pixels on every colour, but CC's gold M frame draws its type-bar
// and box rings ONE ROW HIGHER than the colour frames (which agree with each
// other, and with L, pixel for pixel there), so with the M frame kept whole
// a 1 px line of the M ring's gold (246,210,98) stayed above the masked
// pinline at the text box's top and bottom edges — rows 1302 (1,276 px) and
// 1936 (1,278 px) at HD — which no print has (FDN #344 / #345 go black
// straight into the pinline; skeptic 2026-10-02, fixed in #449's review
// follow-up: the 20 split masters and twins re-cut, rows 1181–1936 only).
// The hybrid dress, on the L frame, needs no such layer. A HYBRID cost prints the same split
// pinline over CC's grey 'Land Frame' bars (2X2 #374 / #385, SPG #142 /
// #144, ECL #292–296: cardFrameProperties's typeTitle 'L' for a hybrid
// pair), so m15borderless builds a "hybrid" dress too, `<pair>-h`, on the L
// frame; the artifact dress keeps the split only, like m15artifact (a
// hybrid artifact falls back to it). The pair's crown is its two floating crowns
// lerped across PAIR_RAMPS.crownFloating (40→60: FDN's seven crowned pairs,
// de-shaded against the set's crowned monos inside the crown's alpha,
// measure 41.6 / 50.0 / 58.4 on the crown's top band and 41.6 / 50.2 / 58.8
// on its wrap — wider than the standard band's 45→55).
const CROWNS = "img/frames/m15/crowns";
/** CC's floating crown of a letter (w u b r g m a l c). */
const floatingCrown = (k) => `${CROWNS}/m15Crown${k.toUpperCase()}Floating.png`;
/** The floating crown's pieces at CC's bounds (card %), and the ramp its
 *  pairs split across. */
export const BORDERLESS_CROWN = Object.freeze({
  crown: Object.freeze({ leftPct: 3.07, topPct: 1.91, widthPct: 93.87, heightPct: 10.24 }),
  outline: Object.freeze({ leftPct: 2.8, topPct: 1.72, widthPct: 94.4, heightPct: 10.62 }),
  erase: Object.freeze({ leftPct: 3.94, topPct: 2.77, widthPct: 92.14, heightPct: 1.77 }),
  outlineSrc: `${CROWNS}/m15CrownFloatingOutline.png`,
  /** CC's 'Legend Crown Border Cover' on this frame: img/black.png, ERASED. */
  eraseSrc: "img/black.png",
  ramp: PAIR_RAMPS.crownFloating,
});
/** The crowned twin of a master key: `w` → `w-legendary`, `wu` →
 *  `wu-legendary` (lib/cards/frame-reference-registry.ts
 *  LEGENDARY_MASTER_SUFFIX). */
export const LEGENDARY_MASTER_SUFFIX = "-legendary";
export const legendaryKey = (k) => `${k}${LEGENDARY_MASTER_SUFFIX}`;
/** A layer drawn at CC's bounds (`at`, a card-% rect) instead of over the
 *  whole canvas: the image is resized to the box and placed there. */
const placed = (src, at, extra = {}) => ({ src, at: { ...at }, ...extra });
/** CC's erase (a pack's `erase: true`; makeBorderlessFrameByLetter's Crown
 *  Border Cover): the layer's alpha is CUT from the layers below
 *  (destination-out), nothing is drawn. */
const erasing = (src, at) => ({ src, at: { ...at }, erase: true });

/**
 * The floating crown's layers, drawn over a borderless master in CC's
 * order: the erased strip, the outline, the crown — one letter's crown, or a
 * pair's two crowns (`[a, b]`) lerped across the floating-crown ramp.
 */
export function borderlessCrownLayers(crown) {
  const [a, b] = Array.isArray(crown) ? crown : [crown, null];
  return [
    erasing(BORDERLESS_CROWN.eraseSrc, BORDERLESS_CROWN.erase),
    placed(BORDERLESS_CROWN.outlineSrc, BORDERLESS_CROWN.outline),
    b
      ? placed(floatingCrown(a), BORDERLESS_CROWN.crown, { right: floatingCrown(b), ramp: [...BORDERLESS_CROWN.ramp] })
      : placed(floatingCrown(a), BORDERLESS_CROWN.crown),
  ];
}

/** A borderless pair master's layers: the gold M frame (the "split" dress:
 *  gold bars, FDN #343–351) or CC's grey 'Land Frame' L (the "hybrid" dress:
 *  the grey bars every hybrid borderless print wears — 2X2 #374 / #385, SPG
 *  #142 / #144, ECL #292–296 — CC's typeTitle 'L' for a hybrid pair), then
 *  the pair's two frames lerped across the pinline ramp through the pack's
 *  Pinline mask. Keys: `<pair>` and `<pair>-h`. */
export function borderlessPairLayers(pair, dress = "split") {
  const [a, b] = pair.split("");
  /** The pair's two frames lerped across the pinline ramp, through `mask`. */
  const colours = (mask, extra = {}) => ({
    src: borderlessFrame(a),
    right: borderlessFrame(b),
    ramp: [...PAIR_RAMPS.pinline],
    mask,
    ...extra,
  });
  return [
    layer(borderlessFrame(dress === "hybrid" ? "l" : "m")),
    // CC's gold M frame draws its type bar and text box ONE ROW HIGHER than
    // the colour frames (which agree with each other, and with L, pixel for
    // pixel there): under the masked pinline the M frame's own ring row
    // would stay — a 1 px gold line above the box's top and bottom pinline
    // (rows 1302 and 1936). So the gold dress takes CC's Rules and Type
    // regions from the colour frames, IN PLACE of the M frame's (`replace`:
    // source-over would double the translucent box). The L frame needs none.
    ...(dress === "hybrid" ? [] : [colours(REG_RULES_MASK, { replace: true }), colours(REG_TYPE_MASK, { replace: true })]),
    colours(BORDERLESS_PINLINE_MASK),
  ];
}

/**
 * A borderless template's colour map (4.32's seven masters, unchanged, plus
 * 4.6f's): `frameOf` names the pack frame of a colour key (the see-through C,
 * or the artifact dress's A for its colourless), `crownOf` the crown letter
 * (the same letters), `dresses` the pair dresses the profile declares
 * (FrameProfile.twoColorMasters: "split", and m15borderless's "hybrid").
 * Every master gets its crowned twin: the seven colours, and the pairs of
 * each dress.
 */
function borderlessMasters(frameOf, crownOf, dresses) {
  /** @type {Record<string, Array<{ src: string }>>} */
  const out = {};
  for (const k of COLORS) {
    out[k] = [layer(borderlessFrame(frameOf(k)))];
    out[legendaryKey(k)] = [layer(borderlessFrame(frameOf(k))), ...borderlessCrownLayers(crownOf(k))];
  }
  for (const dress of dresses) {
    for (const pair of TWO_COLOR_PAIRS) {
      const key = dress === "hybrid" ? `${pair}-h` : pair;
      out[key] = borderlessPairLayers(pair, dress);
      out[legendaryKey(key)] = [...borderlessPairLayers(pair, dress), ...borderlessCrownLayers(pair.split(""))];
    }
  }
  return out;
}
const BORDERLESS_ANATOMY_NOTES = [
  "legendary crown (TODO 4.6f, wave 2a): CC's FLOATING crown (packM15LegendCrownsFloating.js) baked into a second master per key, <key>-legendary.png, as autoBorderlessFrame draws it — the strip 3.94/2.77/92.14×1.77 % ERASED from the frame (CC's Crown Border Cover with erase: the master's title-bar ring there), the outline at 2.8/1.72/94.4×10.62 % under the crown at 3.07/1.91/93.87×10.24 %, all 1500-native (no resample); the crown letter is the master's (C for the see-through colourless frame, A for the artifact dress, M for gold); the plain masters are untouched",
  "two-colour pair masters (TODO 4.6f, wave 2a): the gold M frame with the pair's two frames lerped across the UNTILTED pinline ramp 40→60 %W (scripts/lib/pair-ramp.mjs) through the pack's Pinline mask — the prints split only the pinline (FRA #376 / #377, HOB #213, TLA #306, BLC #86, MH2 #321, FRA #461, FDN #343–351), first canonical colour on the left; under it the same lerp replaces CC's Rules and Type regions (the regular M15 masks), because the gold frame draws its type-bar and box rings one row higher than the colour frames and would leave a 1 px gold line above the box's top and bottom pinline (rows 1302 / 1936 at HD) that no print has; a pair's crown is its two floating crowns lerped across 40→60 (PAIR_RAMPS.crownFloating, measured on FDN's crowned pairs), <pair>-legendary.png",
  "hybrid pair masters <pair>-h.png (m15borderless only, TODO 4.6f): CC's grey 'Land Frame' L (the grey bars every hybrid borderless print wears — 2X2 #374 / #385, SPG #142 / #144, ECL #292–296; cardFrameProperties's typeTitle 'L' for a hybrid pair) with the same split pinline; their crowned twins <pair>-h-legendary.png; the P/T plate is the pack's 'Colorless Power/Toughness' (plateKeyFor's grey 'c' = pt/l.png), as CC's pt 'C' for an L typeTitle",
];

// --- 4.33 'Borderless' and 'Tall Borderless' planeswalkers — CC
// packPlaneswalkerBorderless.js / packPlaneswalkerTallBorderless.js
// (groupPlaneswalker.js:3 and :6). 1500×2100 native (no resample): the
// regular planeswalker master without its frame body and border — title bar
// 57–211 px, type bar 1160–1313 (tall: 1022–1175), the ability window x
// 180–1383 with its badge rim, the shield, an opaque bottom bar from 1922 px
// and fins up the side edges from ~80 % H; everything else α 0, so the art
// runs to the top and side edges. The regular pack lists W U B R G M,
// 'Artifact' (a) and 'Land' (l) and no colourless frame; the tall pack adds
// 'Colorless' (c). The ability stripes are the renderer's (CC draws them
// before the frame), so the shield is cut out of each master and drawn again
// above them, as on m15pw.
const PW_BORDERLESS = "img/frames/planeswalker/borderless";
const PW_TALL_BORDERLESS = "img/frames/planeswalker/tallBorderless";
const PW_LOYALTY_MASK = "img/frames/planeswalker/maskLoyalty.png";
/** The regular pack's 'Artifact Frame' (our colourless walker) is
 *  see-through: bars α 191, the ability window's rim α 234 — every other
 *  colour's rim, and the tall pack's 'Colorless Frame' rim in the same
 *  colour, are α 255. Its alpha × 255/234 (clamped at 1) makes the rim and
 *  its join with the bottom bar opaque; the bars go 0.75 → 0.82 (the tall
 *  pack's colourless bars are 0.85). */
export const PW_COLOURLESS_RIM_GAIN = 255 / 234;
/** The gold (m) walker's bar faces, MATCHED TO THE PRINTS (owner round 15,
 *  2026-09-29). CC's 'Multicolored Frame' paints the title and type faces a
 *  flat tan; every mono-gold borderless walker print — the 13 exact ones:
 *  Tamiyo BLC #100, Narset IKO #278, Nicol Bolas MED #GR4, Sarkhan MED #WS8,
 *  Jace FRC #1, Nicol Bolas MED #WS6, Dakkon MH2 #304, Dihada MH2 #305,
 *  Nicol Bolas SLC #2017, Lord Windgrace SLD #1184 and SPG #14, Nicol Bolas
 *  SLD #1246, Aminatou SLD #1421 — prints a pale cream face veined with
 *  that gold. So the pack's own 'White Frame' is drawn over the m frame
 *  through CC's Title and Type masks (the pack's own way of mixing frames)
 *  as a recolour at 90 %, weighted by the white face's luminance from 235
 *  (its grey marble veins: the gold shows) to 250 (its brightest ground:
 *  90 % white) — fitted to the 26 bars' pooled face colour and luminance
 *  quantiles. On the face rectangles of
 *  tests/unit/frames/fixtures/gold-walker-prints.json: prints luma 202 per
 *  bar on average (168–235, interquartile 189–212), red − blue 60
 *  (interquartile 44–78); ours 204 and 56; CC's tan 183 and 80, outside
 *  both. The gold rims (Pinline), the window, the shield, the bottom bar
 *  and the alpha stay the m frame's. tests/unit/frames/gold-walker-faces
 *  .test.ts holds a built master to the prints' range. */
export const PW_GOLD_FACE = Object.freeze({ opacity: 0.9, lumaRamp: Object.freeze([235, 250]) });
const PW_TITLE_MASK = `${PW}/planeswalkerMaskTitle.png`;
const PW_TYPE_MASK = `${PW}/planeswalkerMaskType.png`;
const PW_TALL_TYPE_MASK = "img/frames/planeswalker/tall/planeswalkerTallMaskType.png";
/** The gold walker: the m frame, its title and type faces recoloured with
 *  the pack's white frame through CC's Title and Type masks (PW_GOLD_FACE). */
const goldWalker = (folder, typeMask) => [
  layer(`${folder}/m.png`),
  recolour(`${folder}/w.png`, PW_TITLE_MASK, PW_GOLD_FACE),
  recolour(`${folder}/w.png`, typeMask, PW_GOLD_FACE),
];
const PW_BORDERLESS_PACK = "packPlaneswalkerBorderless.js 'Borderless' (groupPlaneswalker.js:3)";
const PW_TALL_BORDERLESS_PACK = "packPlaneswalkerTallBorderless.js 'Tall Borderless' (groupPlaneswalker.js:6)";

// --- 4.39 'Fullart Basics (2022)' — CC packTextlessBasics2022.js
// (groupTextless-4.js:5). 1500×2100 native, opaque black ring; a title bar
// and a type bar with the mana-symbol socket at its left end. The pack's
// masks are maskPinline, the regular M15 Title, maskType and maskBorder; the
// borderless key needs only the last.
const BASICS_2022 = "img/frames/textless/2022";
const BASICS_2022_BORDER_MASK = `${BASICS_2022}/maskBorder.png`;
/** Frame per colour key: CC has no colourless basic, so `c` (Wastes) wears
 *  the pack's "Colorless Frame" l.png. */
const basics2022Frame = (k) => `${BASICS_2022}/${k === "c" ? "l" : k}.png`;
/** The 168×168 mana-symbol discs (bounds 62/1752 px = 4.13/83.43/11.2×8.0 %),
 *  drawn by the profile's basic-land symbol slot (TODO 3.24). No `m`: there
 *  is no multicolour basic land. */
const BASICS_2022_SYMBOLS = Object.fromEntries(["w", "u", "b", "r", "g", "c"].map((k) => [k, `${BASICS_2022}/s${k}.png`]));

// --- 4.40 / 4.41 — the older full-art basic designs, black-bordered.
// 'Fullart Basics (ZEN)' (packZendikarBasic-1.js, groupTextless-4.js:7):
// the stone ring around a window, the title bar, and the split type bar with
// a centred medallion (BFZ, OGW, AKH, HOU, ZNR; MH1's snow and ZEN / J14 on
// the 2003 frame are the same design, nearest). 'Fullart Basics (SNC)'
// (packTextlessBasicsSNC.js, :5): the same bars with the art under a white
// ring, no stone. 'Fullart Basics (THB)' (packTextlessBasics.js, :6): the
// title bar and a plain "Basic Land — Plains" bar, no symbol (THB, 2XM,
// DMU, SPM, SOS, PLG25). All 1500×2100 native with an opaque black border.
const ZEN_BASICS = "img/frames/textless/zendikar";
const SNC_BASICS = "img/frames/snc/basics";
const THB_BASICS = "img/frames/textless/basics";
/** Frame per colour key: no colourless basic in these packs either, so `c`
 *  (Wastes — OGW #183 / #184 print the stone design) wears the packs'
 *  'Colorless Frame' l.png. */
const olderBasicFrame = (folder, k) => `${folder}/${k === "c" ? "l" : k}.png`;
/** The ZEN pack's Frame mask: the field around the window, the title bar and
 *  the type bar (the stone ring on the prints). */
const ZEN_BASICS_FRAME_MASK = `${ZEN_BASICS}/frame.png`;
/** The medallion's mana symbols, both split-bar packs' (600×600 SVG, drawn
 *  at bounds 42/78.67/16×11.43 %), published as `symbol/<key>.png`. No `m`. */
/** The white sun, PipGlyph's shading over CC's shape (owner Round 64:
 *  CC's is white with a lavender rim, fainter than print's shaded cream sun
 *  on the cream medallion). Px of the 600 × 600 symbol, which the
 *  medallion draws at 228 px of the HD card (× 0.38): the shadow 4 px left
 *  and 5 px down at HD, blurred ~2 px, near-black, as BFZ #250 / SNC #272 print it. */
export const WHITE_MEDALLION_SYMBOL = { fill: [246, 244, 234], shadow: [38, 30, 24], shadowOpacity: 1, dx: -8, dy: 14, blur: 3 };
const ZEN_BASICS_SYMBOLS = Object.fromEntries(["w", "u", "b", "r", "g", "c"].map((k) => [k, `${ZEN_BASICS}/s${k}.svg`]));
/** The medallion of both split-bar packs, measured on their masters (the
 *  same circle: α 1 from 1621 px at x 750, half-widths 36 / 74 / 101 / 120 px
 *  at rows 1625 / 1640 / 1660 / 1680 — centre (750, 1772), r 151). */
const SPLIT_BAR_MEDALLION = { cx: 750, cy: 1772, r: 151, pad: 2, feather: 2 };
/**
 * The ZEN pack onto its prints (TODO 4.40; the 52 black-bordered stone-ring
 * printings BFZ #250–274, OGW #183–184, AKH #250–254, HOU #185–189, ZNR
 * #266–280, Scryfall PNGs at 1500×2100, medians — measured 2026-10-14): the
 * title bar (top 104 / 104, bottom 232 / 233), the window's sides (112 / 115,
 * 1386 / 1387), the medallion (top 1640 / 1640, bottom 1917 / 1918) and the
 * black border (1948 / 1947) sit where the pack draws them; the TYPE BAR sits
 * 7 px lower on every printing (inner top 1716 → 1723, range 1721–1729;
 * bottom 1845 → 1851). So the bar moves 7 px down and the medallion stays.
 */
export const ZEN_BASIC_RECUT = { bar: { fromY: 1690, toY: 1868, dy: 7 }, medallion: { ...SPLIT_BAR_MEDALLION, dy: 0 } };
/**
 * The SNC pack onto its prints (SNC #272–281; measured 2026-10-14): the bar
 * prints 13 px higher than the pack draws it (dark rim 1711 → 1698–1701,
 * inner top 1716 → 1702–1706, bottom rim 1833 / 1845 → 1820 / 1832) and the
 * medallion 18 px higher (top rim 1636 → 1616–1617, inner 1640 → 1620–1622;
 * bottom 1901 / 1905 / 1916 → 1884 / 1888 / 1900). The title bar and the
 * window's sides are the pack's within 1–4 px. BRO #278–287 is NOT this
 * look (no ring round the window, the bars ~80 px lower): nearest.
 * The art's lower edge rides the bar: the prints end it 13–17 px above the
 * pack (x 300: 1930–1932 vs 1948; x 100, in the rounded corner: ~1862 vs
 * 1868), so the moved band runs on through the corners to the border's
 * black (row 1960), and the medallion's old cap below the bar (rows from
 * 1856) is cleared to the art before it moves.
 */
export const SNC_BASIC_RECUT = {
  bar: { fromY: 1690, toY: 1960, dy: -13 },
  medallion: { ...SPLIT_BAR_MEDALLION, dy: -18, keepRows: [1696, 1856] },
};

// --- 4.52 'Planeswalker Emblems' — CC packEmblem.js: ONE master, the M20
// design (2019-07-12 on: TM20 #11, TFDN #24 / #25, TBLB #30, TDSK #17,
// TFRA #16). 1500×2100 native, opaque black border; the planeswalker spark
// is clear (α 0) from 11.67 to 66.38 %H and its tail runs on down through
// the type bar and the text box as 80 % white (α 204), so the art shows
// faintly under it as the prints show it (CC's artBounds run to 90.44 %H).
const EMBLEM = "img/frames/token/emblem/frame.png";

/**
 * The emblem's spark ray, bridged over at the art window's top (owner
 * decision 2026-09-29, "exact slot + frame bridged over the tip"). The art
 * window is Scryfall's art_crop box at the prints' scale, from 250.4 px, and
 * the one part of the spark above it is the top of the centre ray: CC's ray
 * runs up to the silver bar under the name (its clear rows start under the
 * bar's black shadow, 233–246), where an art_crop has no pixels. So the
 * frame's silver closes over the ray's top instead and the ray ends 18 px
 * short of the bar, at 251 — the first row the art covers whole:
 *
 * - rows [fromY, toY) × columns [x0, x1) — the bar's shadow and the silver
 *   under it, across the ray and its two edges — take the frame on either
 *   side (each row's pixel at `anchors[0]` and `anchors[1]`, the plain silver
 *   beyond the ray's highlight line and its outline), blended across, so the
 *   bar's shadow runs on unbroken and the silver below it joins up; left of
 *   the ray, the frame's own pixels (its bevel and highlight line) fade back
 *   in over the last `fadeRows` rows above the new tip;
 * - the tip is the spark's own edge turned across the top: the colour
 *   profile of the ray's right edge (its dark outline into the silver, by
 *   distance from the edge's α-½ line, sampled on rows [edgeRows) of the
 *   composite itself) is drawn by distance from the new tip — its top edge at
 *   `toY`, its corners rounded to `radius` — and it lightens towards the
 *   left edge (× the fraction across, to the power `fadePow`), which has no
 *   outline: the side rays' tips are drawn that way, dark over the top right
 *   and light down the left.
 *
 * Everything above `toY` is opaque, so nothing but the art window's own
 * picture shows in the ray. Native px of the pack (1500 × 2100).
 */
export const EMBLEM_RAY_BRIDGE = {
  fromY: 233,
  toY: 251,
  x0: 723,
  x1: 780,
  anchors: [720, 780],
  fadeRows: 5,
  radius: 4,
  fadePow: 2,
  edgeRows: [255, 301],
};

/**
 * The emblem's name pill, toned onto the prints (owner evidence
 * 2026-09-29: our pill read luma 94–97 against the prints' 54–60, the name's
 * ink included). Why: CC's pack draws frame.png ALONE — packEmblem.js has no
 * darkening layer and creator-23.js does nothing for version 'emblem' — and
 * that file paints the pill as a light gradient, luma ~140 at the ends to
 * ~50 at the centre (median 90 over the name band, rows 128–199 ×
 * 150–1349), where the six M20-design prints (TFDN #24 / #25, TM20 #11,
 * TDSK #17, TBLB #30, TFRA #16; Scryfall PNGs at 1500 × 2100) print a dark
 * pill, luma ~97 at the ends and 45–60 across its length. (The silver, the
 * type pill and the text box are toned too: EMBLEM_SILVER_TONE,
 * EMBLEM_TYPE_PILL_TONE, EMBLEM_TEXT_BOX_TONE.)
 *
 * The pill's body — rows [fromY, toY): under CC's top highlight (105–110,
 * kept), above its lower lip (211–216, kept); the pixels 4-connected to
 * `seed` whose luma is ≥ `minLuma`, which the pill's dark outline bounds —
 * has its colour multiplied by `gain`, piecewise-linear in the distance from
 * the pill's centre (`centreX`), fitted by least squares on the prints'
 * per-pixel median with their name ink masked out: mean |Δluma| 40.3 → 5.2,
 * the band's median 90 → 52 (the prints' 52). CC leaves a 30 px band down
 * the pill's middle at α 242 (the spark's ray drawn on through the bar,
 * showing the art under it); the prints' pill is opaque, so the toned body
 * is. Native px of the pack (1500 × 2100).
 */
export const EMBLEM_NAME_PILL_TONE = {
  seed: { x: 750, y: 160 },
  fromY: 111,
  toY: 211,
  minLuma: 30,
  centreX: 749.5,
  /** [distance from centreX in px, gain] — held at the last knot past it. */
  gain: [
    [0, 0.8],
    [100, 0.6],
    [200, 0.64],
    [300, 0.54],
    [400, 0.52],
    [500, 0.58],
    [600, 0.66],
    [700, 0.83],
  ],
};

/**
 * The emblem's silver, toned onto the prints (owner decisions 2026-09-29:
 * round 12 "the silver ~30–45 luma lighter" than the six M20-design prints;
 * round 12b "fit each side separately"). CC's silver — the ring down both
 * sides and the body round the spark — is lit evenly, left and right alike;
 * the prints' is not: beside the spark's base it reads 113–122 on the left
 * and 178–187 on the right (CC 160 and 179), beside the text box 117–122 and
 * 162–168 (CC 149 both), and the right rail is the darkest silver on the
 * card (78–92, the left 117–124; CC 137–142).
 *
 * The silver is every pixel of rows [bodyFromY, bodyToY) — from the name
 * bar's shadow down to the type bar's rim: the silver, the spark's outline,
 * the bar's shadow — but the spark's tail and the glow above the type bar
 * (CC paints both pure white, translucent: they stay as drawn), and in the
 * rows [fromY, bodyFromY) and [bodyToY, toY) beside the bars, each row from
 * either edge inwards up to the first pixel of luma ≥ `stopLuma` (a bar's
 * light rim: the rims, the bars and the box keep CC's tone, which the prints
 * match or print lighter). Its colour is multiplied by a gain bilinear in the
 * SIGNED offset x − `centreX` (knots `dx`, the left half negative) and the
 * row (knots `rows`), held past the outer knots; `gain[row][dx]`. Each half
 * has its own five knots, fitted on its own side of the prints, and the
 * centre segment (±100 px) runs straight from one side's inner knot to the
 * other's, so the field is continuous everywhere: no seam at the centre line
 * and, bilinear, no step anywhere (no banding). The gains are a
 * least-squares fit of the prints' per-pixel median in the 50 px squares of
 * pure silver (the round-12 square map) and in 20-row slices of the rails and
 * the strips beside the bars, smoothed (second differences) and held to
 * 0.45–1.2, with each region's median — per side — pinned to the prints'
 * median (within 1.4 luma); the first row is 1 (the flat strip above the name
 * bar, which the prints print as a brushed pattern CC doesn't draw, keeps
 * CC's tone). A gain, not a fill: CC's highlights and shading stay.
 * Native px of the pack (1500 × 2100).
 */
export const EMBLEM_SILVER_TONE = {
  fromY: 60,
  bodyFromY: 233,
  bodyToY: 1407,
  toY: 1946,
  stopLuma: 170,
  centreX: 749.5,
  dx: [-680, -590, -450, -300, -100, 100, 300, 450, 590, 680],
  rows: [60, 150, 300, 500, 700, 900, 1100, 1300, 1407, 1550, 1750, 1946],
  gain: [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [0.79, 0.87, 0.92, 0.9, 0.96, 0.99, 0.99, 1.08, 0.99, 0.85],
    [0.95, 0.85, 0.82, 0.74, 0.91, 0.96, 0.9, 1.2, 1.07, 0.8],
    [0.92, 0.86, 0.88, 0.84, 0.81, 0.81, 0.82, 1.14, 1, 0.7],
    [0.74, 0.82, 1.11, 0.78, 0.6, 1.08, 1.2, 1.19, 0.84, 0.55],
    [0.68, 0.8, 1.1, 0.9, 0.76, 1.11, 1.2, 1.2, 0.78, 0.45],
    [0.77, 0.94, 0.85, 1.2, 1.14, 1.12, 1.17, 1.08, 0.77, 0.45],
    [0.91, 1, 0.69, 0.72, 1.2, 1.2, 0.99, 0.97, 0.8, 0.85],
    [0.82, 0.89, 0.67, 0.5, 1.15, 1.2, 0.98, 0.96, 0.87, 0.98],
    [0.84, 0.82, 0.72, 0.65, 0.97, 1.05, 0.95, 0.93, 0.99, 1.07],
    [0.8, 0.79, 0.79, 0.8, 0.84, 0.87, 0.86, 0.91, 1.03, 1.14],
    [0.62, 0.7, 0.81, 0.86, 0.83, 0.8, 0.82, 0.88, 0.96, 1.03],
  ],
};

/**
 * The emblem's type pill, toned onto the prints (owner decision 2026-09-29:
 * it read 238 against the prints' 219–228). Its body — rows [fromY, toY),
 * under CC's top highlight (1422–1428, kept, as the prints print one); the
 * pixels 4-connected to `seed` with luma ≥ `minLuma`, which the pill's dark
 * outline bounds — has its colour multiplied by `gain`, a least-squares fit
 * on the prints' per-pixel median with "Emblem" and the set symbol masked
 * out (one gain: the fit by distance from the centre varied 0.93–0.98). The
 * spark's tail crosses the pill as CC's translucent white: it is toned with
 * the pill and keeps its alpha (`keepAlpha`), so the art still shows through
 * it. Native px of the pack.
 */
export const EMBLEM_TYPE_PILL_TONE = {
  seed: { x: 400, y: 1470 },
  fromY: 1429,
  toY: 1530,
  minLuma: 150,
  centreX: 749.5,
  gain: [[0, 0.94]],
  keepAlpha: true,
};

/**
 * The emblem's text box, toned onto the prints (owner decision 2026-09-29:
 * only if the prints measurably differ — they do: CC's box reads 237 where
 * all six prints read 226–232, a light blue-grey). Its interior — rows
 * [fromY, toY), the pixels 4-connected to `seed` with luma ≥ `minLuma`,
 * inside the box's light rim (202, kept: the prints print it lighter) — has
 * its colour multiplied by `gain`, a least-squares fit on the prints'
 * per-pixel median with the rules text masked out (one gain: by distance it
 * varied 0.94–0.98). The spark's tail keeps its alpha, as in the type pill.
 * Native px of the pack.
 */
export const EMBLEM_TEXT_BOX_TONE = {
  seed: { x: 400, y: 1700 },
  fromY: 1556,
  toY: 1938,
  minLuma: 215,
  centreX: 749.5,
  gain: [[0, 0.96]],
  keepAlpha: true,
};

/** The emblem's tones, in the order the importer applies them (their
 *  regions don't overlap). */
export const EMBLEM_TONES = [EMBLEM_NAME_PILL_TONE, EMBLEM_SILVER_TONE, EMBLEM_TYPE_PILL_TONE, EMBLEM_TEXT_BOX_TONE];

// ---------------------------------------------------------------------------
// The portrait layouts (TODO 4.21a, design 2026-09-29 §3.1 / §3.5 / §3.6):
// flip, adventure and aftermath from CC's own packs, each a native 1500×2100
// master copied 1:1. They replace the 241–375 px MSE composites
// (build-flip-frame.mjs, build-adventure-frame.mjs, build-aftermath-frame.mjs)
// that sat 30–80 px low (flip) or on softer, re-drawn paper (adventure,
// aftermath). Every colour is the pack's own file but for the colourless
// keys the packs lack (notes). Flip's P/T plates — one per creature half,
// as every printed M15 flip creature carries (C18 #134, CM2 #71; owner
// decision 2026-09-29: a correction) — are cut from CC's `<k>pt.png` (both
// plates in one image, drawn at FLIP_PT_BOUNDS through the pack's Top PT /
// Bottom PT masks) into pt/<k>-top.png and pt/<k>-bottom.png.
// ---------------------------------------------------------------------------
const FLIP = "img/frames/m15/flip";
const ADVENTURE = "img/frames/adventure/regular";
const AFTERMATH = "img/frames/m15/aftermath";
/** Where packFlip.js draws the P/T image (`bounds`): a 1360×1000 image at
 *  this box of the card, fractions of the card — 56/478 px, so 1:1. */
export const FLIP_PT_BOUNDS = { x: 0.0374, y: 0.2277, width: 0.9067, height: 0.4762 };
/** The pack's 'Top PT' / 'Bottom PT' masks: the card's top and bottom
 *  halves (rows 0–1049, 1050–2099), so each plate is cut on its own. */
export const FLIP_PT_MASKS = { top: "img/frames/topHalfSharp.svg", bottom: "img/frames/bottomHalfSharp.svg" };
/** Each plate's box on the 1500×2100 card, padded past its soft shadow (the
 *  image's alpha reaches 1179–1416 × 478–632 and 56–293 × 1324–1478 px; the
 *  bodies, α ≥ 128, 1200–1415 × 485–611 and 77–292 × 1331–1457). The FLIP
 *  profile's plateRects are these boxes in percent (a unit test keeps them
 *  in step). The bottom plate is drawn upside-down in the source, as the
 *  print shows it: the renderers draw it at its box unturned. */
export const FLIP_PT_BOXES = {
  top: { x: 1176, y: 475, width: 243, height: 160 },
  bottom: { x: 53, y: 1321, width: 243, height: 160 },
};
/** CC's flip P/T image per colour key (the 'Colorless Power/Toughness'
 *  cpt.png for c). */
const FLIP_PT_IMAGES = perColor((k) => `${FLIP}/${k}pt.png`);
/**
 * The re-cut of CC's flip masters' LOWER HALF onto the prints (TODO 4.21a
 * follow-up, layout v39; owner decision round 22, 2026-10-02). CC drew the
 * bottom half as the top half turned about the window's centre (the type
 * bars mirror about row 969.5, the name bars too); the two printed M15 flips
 * are not that symmetric. Measured on C18 #134 Budoka Gardener and CM2 #71
 * Nezumi Graverobber (Scryfall PNGs at 1500 × 2100, the master's profile
 * blurred to the scan's softness, per-band correlation and half-level
 * crossings, both prints within 0.5 px of each other): the window's inner
 * line and the type bar's dark top band (its outline and bevel) print 7 px
 * HIGHER than CC's (the line centred on rows 1311–1313 against CC's 1318.5,
 * the band's top edge 1324 against 1331.5; a per-band correlation 8.2 / 6.3
 * and 8.3 / 5.4), the bar's bottom outline and the text box's top edge 5 px
 * higher (the bar's bottom edge 1444.7 against 1449.7, the box's edge
 * 1466.5 against 1470.8; correlation 4.8–5.1 / 5.4–6.2), while the
 * upside-down name bar sits where CC draws it (−2 px, the other way, inside
 * the scans' tolerance). The print's own art edge reads 1308.5 by the
 * half-contrast detector, but that reading carries the scan's blur (the
 * same detector puts the window's TOP edge 3.5 px off on a line that agrees
 * within 0.5 px): the line is the mark. The top name bar, type bar, window
 * top and cost stay where v38 put them. So two pieces move up, split inside
 * the bevel's flat grey plateau (CC rows 1337–1342, luma ≈ 122 across the
 * bar): rows [fromY, splitY) — the window's lower rows, the inner line, the
 * pinline, the bar's outline and the first rows of its bevel — 7 px, and
 * rows [splitY, toY) — the rest of the bevel, the bar's face, its bottom
 * outline, the pinline below and the text box's top edge into its paper —
 * 5 px. The two rows that opens are the plateau repeated (the print's dark
 * top band is itself 3–5 px taller than CC's), cross-faded over
 * `blendSplit` rows (only the bar's 45° end-cap chamfers cross them; the
 * left one lies under the bottom plate). The top seam is inside the
 * window, where only the frame's side texture meets it (cross-faded over
 * `blendTop` rows, as the tokens' re-cuts); the bottom seam inside the
 * paper (`blendBottom`). Every row above fromY − 7 and from toY on is
 * CC's, byte for byte; the result: the window ends on row 1309 (CC's
 * 1316), the line on 1310–1313, the bar's face 1339–1444 on every colour
 * (both prints' 1339–1444; CC's 1344–1449), its bottom outline centred on
 * 1447 (the prints'), the paper from 1467 (CC's 1472) — held by
 * tests/unit/frames/flip-lower-block.test.ts. Native px of the pack
 * (1500 × 2100).
 */
export const FLIP_LOWER_RECUT = {
  fromY: 1290,
  splitY: 1340,
  toY: 1500,
  shiftTop: -7,
  shiftBottom: -5,
  blendTop: 24,
  blendSplit: 3,
  blendBottom: 24,
};
const NATIVE_1500 = "native 1500x2100, pixels copied 1:1 (no resample), corners rounded to the importer radius";

// ---------------------------------------------------------------------------
// The landscape layouts (TODO 4.21b, design 2026-09-29 §3.2 / §3.3 / §4.2):
// split and battle from CC's own packs, the first LANDSCAPE recipes
// (`orientation: "landscape"`, a 2100×1500 master cut at the one card corner
// — 64.5 px, 4.3 % of the SHORT side, as the bake cuts a landscape card).
// They replace the MSE composites in git (build-split-frame.mjs: two
// 240×345 half-frames on a black canvas, no coloured body round either
// half, the title bars 31 px above the prints'; the "375 m15 battle" module:
// no border, no siege arc, no icon, no defense shield — a transparent ring).
//   • split — the pack draws the card PORTRAIT (1500×2100) with every text
//     at −90°; `transform: "rotate-cw"` turns the composite a quarter turn
//     clockwise, a pure pixel permutation (rotateCwRgba8: no resample), so
//     the text is upright and the pack's "Right" set lands on our right half;
//   • battle — the pack's canvas is 2814×2010 (resetCardIrregularities);
//     `transform: "downscale"` is ONE Lanczos pass to 2100×1500, the M15
//     family's one-downscale rule (2010×2814 → 1500×2100, the same ratio).
// ---------------------------------------------------------------------------
const SPLIT = "img/frames/m15/split";
const BATTLE = "img/frames/m15/battle";
/** A landscape master's size: the portrait one turned. */
export const LANDSCAPE_OUT = Object.freeze({ width: OUT_H, height: OUT_W });
/** The size a recipe's masters are written at: 2100×1500 for a landscape
 *  recipe (`orientation: "landscape"`), else 1500×2100. */
export function outputSizeOf(def) {
  return def.orientation === "landscape" ? { ...LANDSCAPE_OUT } : { width: OUT_W, height: OUT_H };
}
/**
 * An 8-bit RGBA image turned a quarter turn CLOCKWISE: the pixel at (x, y)
 * of the `width × height` source lands at (height − 1 − y, x) of the
 * `height × width` result. A permutation of the pixels — nothing is
 * resampled, so every value of the source is in the result exactly once
 * (split's `transform: "rotate-cw"`). Returns a new buffer.
 */
export function rotateCwRgba8(buf, width, height) {
  if (buf.length !== width * height * 4) throw new Error(`rotateCwRgba8: ${buf.length} bytes is not ${width}×${height} RGBA`);
  const out = Buffer.alloc(buf.length);
  for (let y = 0; y < height; y += 1) {
    const tx = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      buf.copy(out, (x * height + tx) * 4, from, from + 4);
    }
  }
  return out;
}
/**
 * Whole blocks of an 8-bit RGBA image moved along one axis through the FLAT
 * zones between them (TODO 4.21b: the split's two halves and the battle's
 * two blocks, onto the prints — SPLIT_HALF_RECUT, BATTLE_BLOCK_RECUT).
 * `spec.axis` "x" moves columns, "y" rows. `spec.blocks` lists the blocks in
 * order: lines [from, to) of the source, landing `by` px further along
 * (negative = toward 0). Everything outside the blocks is a ZONE — before
 * the first block, between two, after the last — and a zone only grows or
 * shrinks, so it must be flat: each of its lines identical to the next over
 * the image's whole other side (the black border, the spine between the
 * split's halves, the battle's art window between its border and arc). The
 * result then holds every block byte for byte, `by` px from where it was,
 * and every zone as its one line repeated: nothing is resampled or blended
 * and no pixel of a block is lost. Throws when a zone isn't flat, when a
 * block leaves the image, when two blocks would meet (a zone keeps ≥ 1
 * line; an empty one stays empty) or when the blocks are out of order.
 * Returns a new buffer.
 */
export function shiftBlocksRgba8(buf, width, height, spec) {
  if (buf.length !== width * height * 4) throw new Error(`shiftBlocksRgba8: ${buf.length} bytes is not ${width}×${height} RGBA`);
  const { axis, blocks } = spec;
  if (axis !== "x" && axis !== "y") throw new Error(`shiftBlocksRgba8: axis ${JSON.stringify(axis)}`);
  const lines = axis === "x" ? width : height;
  const across = axis === "x" ? height : width;
  const bad = (why) => new Error(`shiftBlocksRgba8: ${why} ${JSON.stringify({ axis, blocks, lines })}`);
  if (!Array.isArray(blocks) || blocks.length === 0) throw bad("no blocks");
  // Line `line` of the source equals line `other`, over the whole other side.
  const sameLine = (line, other) => {
    for (let i = 0; i < across; i += 1) {
      const a = (axis === "x" ? i * width + line : line * width + i) * 4;
      const b = (axis === "x" ? i * width + other : other * width + i) * 4;
      if (buf[a] !== buf[b] || buf[a + 1] !== buf[b + 1] || buf[a + 2] !== buf[b + 2] || buf[a + 3] !== buf[b + 3]) return false;
    }
    return true;
  };
  // src[t] = the source line the result's line t shows.
  const src = new Int32Array(lines).fill(-1);
  let sourceAt = 0;
  let targetAt = 0;
  const zone = (sourceEnd, targetEnd) => {
    const had = sourceEnd - sourceAt;
    const has = targetEnd - targetAt;
    if (had < 0 || has < 0) throw bad("blocks out of order or overlapping");
    if (had === 0 ? has !== 0 : has < 1) throw bad(`the zone at source ${sourceAt}–${sourceEnd} can't become ${has} lines`);
    for (let line = sourceAt + 1; line < sourceEnd; line += 1) {
      if (!sameLine(sourceAt, line)) throw bad(`the zone ${sourceAt}–${sourceEnd} is not flat: line ${line} differs from line ${sourceAt}`);
    }
    for (let t = targetAt; t < targetEnd; t += 1) src[t] = sourceAt;
  };
  for (const block of blocks) {
    const { from, to, by } = block;
    if (![from, to, by].every(Number.isInteger) || !(to > from) || from < 0 || to > lines || from + by < 0 || to + by > lines) throw bad("bad block");
    zone(from, from + by);
    for (let line = from; line < to; line += 1) src[line + by] = line;
    sourceAt = to;
    targetAt = to + by;
  }
  zone(lines, lines);
  const out = Buffer.alloc(buf.length);
  if (axis === "y") {
    for (let t = 0; t < lines; t += 1) buf.copy(out, t * width * 4, src[t] * width * 4, (src[t] + 1) * width * 4);
  } else {
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let t = 0; t < lines; t += 1) {
        const from = (row + src[t]) * 4;
        buf.copy(out, (row + t) * 4, from, from + 4);
      }
    }
  }
  return out;
}
/** Where a line of the source lands after `spec`'s blocks moved (the `by`
 *  of the block that holds it), or null inside a zone — a zone's lines have
 *  no one place. */
export function shiftedLine(spec, line) {
  const block = spec.blocks.find((b) => line >= b.from && line < b.to);
  return block ? line + block.by : null;
}
/** How provenance records a block shift. */
export function describeBlockShift(spec, width, height) {
  const lines = spec.axis === "x" ? width : height;
  const unit = spec.axis === "x" ? "columns" : "rows";
  const zones = [];
  let at = 0;
  let landed = 0;
  for (const b of spec.blocks) {
    if (b.from > at) zones.push(`${unit} ${at}–${b.from - 1} (flat) → ${b.from + b.by - landed} px`);
    at = b.to;
    landed = b.to + b.by;
  }
  if (lines > at) zones.push(`${unit} ${at}–${lines - 1} (flat) → ${lines - landed} px`);
  return {
    axis: spec.axis,
    blocks: spec.blocks.map((b) => ({ ...b })),
    zones,
    why: spec.why,
    lossless: "each block is copied byte for byte; each zone between them is one flat line repeated (checked: every line of a zone is identical) — no resample, no blend",
  };
}
/**
 * The split's halves, onto the prints (TODO 4.21b, measured 2026-10-06 on
 * MH2 #123 Fast // Furious, MH2 #60 Said // Done, TSR #161 Dead // Gone and
 * TSR #186 Rough // Tumble, each registered edge by edge against the turned
 * master). Card Conjurer's pack draws the collector border 160 px thick
 * where the prints' is 147–148 (a regular M15 print's is 148), so its left
 * half sits 13–14 px right of the prints' at its left edges and 7–11 px at
 * its right ones, its right half 5–6 px right at its left edges and on the
 * prints' at its right ones. The left half (columns 160–1081 of the turned
 * master: body, name bar, window, type bar, text box) moves 11 px LEFT, the
 * right half (1118–2040) 3 px left: every edge of both halves then lies
 * within 3.6 px of the four prints' mean (5.4 px of any one print; the
 * pack's lay up to 14.3 / 16.4 px off). The collector border (columns
 * 0–159), the spine (1082–1117) and the right border (2041–2099) are flat
 * black — the zones the move runs through. Rows are the pack's (within
 * 2.7 px of the prints).
 */
export const SPLIT_HALF_RECUT = Object.freeze({
  axis: "x",
  blocks: Object.freeze([Object.freeze({ from: 160, to: 1082, by: -11 }), Object.freeze({ from: 1118, to: 2041, by: -3 })]),
  why: "the pack's collector border is 160 px, the prints' 147–148: the left half moves 11 px left, the right half 3 px, onto MH2 #123 / #60 and TSR #161 / #186 (every edge within 3.6 px of the four prints' mean, 5.4 of any one; the pack's up to 14.3 / 16.4)",
});
/**
 * The battle's two blocks, onto the prints (TODO 4.21b + 4.21d, measured
 * 2026-10-06 on nine MOM battles — #1, #21, #22, #63, #115, #147, #149,
 * #190, #230 — registered edge by edge).
 *   • The LOWER block (4.21b): the prints set the type bar's top 5.3–5.5 px
 *     lower than the pack, its bottom and the text box's top 4.6, the box's
 *     bottom 2.5 (1.8–4.6), the shield's top 2.8 and its bottom 5.0. Rows
 *     842–1467 of the downscaled master (the type bar, the text box, the
 *     shield and the arc's foot) move 4 px DOWN: those edges then lie
 *     within 1.5 px of the nine prints' mean (2.3 px of any one).
 *   • The TOP block (4.21d): the prints set the name pill 2.5 px (its top)
 *     and 1.4 px (its bottom) HIGHER than the pack, and the icon with it.
 *     Rows 57–362 (the pill, the icon, the arc's upper curve) move 2 px UP:
 *     the pill's top and bottom lie −0.5 / +0.6 px from the prints' mean.
 *     The one edge the move takes off the prints is the top border's inner
 *     edge (−0.7 → +1.3 px); 3 px up is worse (+2.3).
 * The zones the moves run through are flat on all seven masters: rows 0–56
 * (the top border: 57 → 55 rows), rows 363–841 (the art window between the
 * arc's straight stretch and the right border: 479 → 485 rows) and rows
 * 1468–1499 (the bottom border: 32 → 28 rows). What no flat zone reaches —
 * the bars' right ends, the shield, the icon's rings — is BATTLE_RIGHT_RECUT
 * and BATTLE_ICON_RECUT below.
 */
export const BATTLE_BLOCK_RECUT = Object.freeze({
  axis: "y",
  blocks: Object.freeze([Object.freeze({ from: 57, to: 363, by: -2 }), Object.freeze({ from: 842, to: 1468, by: 4 })]),
  why: "the pack's name pill and icon sit 1.4–2.5 px below the nine MOM prints' and its type bar, text box and shield 2.5–5.5 px above them: rows 57–362 move 2 px up (the pill's top and bottom within 0.6 px of the prints' mean) and rows 842–1467 move 4 px down (those edges within 1.5 px of the mean, 2.3 of any one; the pack's up to 5.5 / 6.3)",
});
/**
 * The split pack's two half masks, named for the half each covers AFTER the
 * clockwise turn (design D2): CC's 'Bottom Half' (bottom.svg, portrait rows
 * 1000–2099) is our LEFT half, its 'Top Half' (top.svg, rows 0–999) our
 * RIGHT half — plain rectangles meeting at X `packSeamX` of the pack's
 * turned card (1100 px, 52.38 %W: inside its flat black spine, columns
 * 1082–1117). Importer INPUTS only: the importer rasterises and turns them,
 * checks each is the plain rectangle recorded here (halfMaskFindings) and
 * writes the seam into the provenance — no `mask/*` object is ever
 * published. `seamX` is that seam on OUR master, whose halves
 * SPLIT_HALF_RECUT moved: the middle of its spine (columns 1071–1114), 1093
 * px (52.05 %W) — where TODO 4.26's per-half colour cuts between two
 * masters (a hard seam through flat black, FrameProfile.twoColorSplit's
 * machinery), never a mask asset. The importer holds both seams inside
 * their spine (seamInsideSpine).
 */
export const SPLIT_HALF_MASKS = Object.freeze({
  left: `${SPLIT}/bottom.svg`,
  right: `${SPLIT}/top.svg`,
  packSeamX: 1100,
  seamX: 1093,
});
/** The flat zone between a two-block shift's blocks — the spine between the
 *  split's halves — before (`pack`) and after (`master`) the move: [x0, x1). */
export function spineOf(shift) {
  const [a, b] = shift.blocks;
  return { pack: { x0: a.to, x1: b.from }, master: { x0: a.to + a.by, x1: b.from + b.by } };
}
/** Every way a recipe's two seams are not inside their spine: the pack's
 *  mask seam in the pack's, the master's in the moved one (each strictly
 *  inside, so a half's own pixels never cross it). */
export function seamInsideSpine(masks, shift) {
  const spine = spineOf(shift);
  const failures = [];
  if (!(masks.packSeamX > spine.pack.x0 && masks.packSeamX < spine.pack.x1)) failures.push(`the pack's seam x ${masks.packSeamX} is outside its spine ${spine.pack.x0}–${spine.pack.x1 - 1}`);
  if (!(masks.seamX > spine.master.x0 && masks.seamX < spine.master.x1)) failures.push(`the master's seam x ${masks.seamX} is outside its spine ${spine.master.x0}–${spine.master.x1 - 1}`);
  return failures;
}
/**
 * What a turned half mask covers on a `width × height` card, and every way
 * it is not the plain rectangle `expect` (columns x0 … x1 − 1, every row):
 * a pixel that is neither clear nor solid (α 2–253: only the one
 * anti-aliased seam column may be soft, and it reads α ≤ 1 or ≥ 254), a
 * solid pixel outside the rectangle, a clear one inside it. Empty
 * `failures` = the mask is that rectangle.
 */
export function halfMaskFindings(mask, width, height, expect) {
  let x0 = width;
  let x1 = 0;
  let soft = 0;
  let outside = 0;
  let inside = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = mask[(y * width + x) * 4 + 3];
      const solid = a >= 254;
      if (!solid && a > 1) soft += 1;
      if (solid) {
        if (x < x0) x0 = x;
        if (x + 1 > x1) x1 = x + 1;
        if (x < expect.x0 || x >= expect.x1) outside += 1;
      } else if (x >= expect.x0 && x < expect.x1) inside += 1;
    }
  }
  const failures = [];
  if (soft) failures.push(`${soft} px are neither clear nor solid`);
  if (outside) failures.push(`${outside} solid px outside x ${expect.x0}–${expect.x1 - 1}`);
  if (inside) failures.push(`${inside} clear px inside x ${expect.x0}–${expect.x1 - 1}`);
  return { x0, x1, failures };
}
/** How provenance records a recipe's half masks (never published). */
export function describeHalfMasks(masks, width) {
  const pct = (x) => Math.round((x / width) * 10000) / 100;
  return {
    left: { src: masks.left, covers: `x 0–${masks.packSeamX - 1} of the pack's turned ${width} px card, every row` },
    right: { src: masks.right, covers: `x ${masks.packSeamX}–${width - 1}, every row` },
    packSeam: `x ${masks.packSeamX} px (${pct(masks.packSeamX)} %W) after the clockwise turn, inside the pack's flat black spine`,
    seam: `x ${masks.seamX} px (${pct(masks.seamX)} %W) on the master, the middle of its spine after the halves moved`,
    published: false,
    use: "importer inputs only (rasterised, turned and checked to be these plain rectangles): TODO 4.26's per-half colour is a hard seam between two masters at the master's seam, no mask asset",
  };
}
/**
 * The battle's PAINTED defense shield (TODO 4.21b; owner decision
 * 2026-09-29: the defense is drawn in the frame's own shield, the drawn
 * badge is gone): the pack's 'Defense' mask and the box of its solid
 * pixels (α ≥ 128) on the 2100×1500 MASTER, HD px — the shield the frame
 * paints across the text box's bottom-right corner, on every colour: the
 * pack's box 1881,1300 164×166, 4 px lower with the rest of the lower block
 * (BATTLE_BLOCK_RECUT) and `dx` 12 px further RIGHT, over the right border,
 * where nine MOM prints set theirs (TODO 4.21d: the black interior's
 * centroid +11.7 px on the pack — BATTLE_RIGHT_RECUT lifts the shield
 * through this mask and sets it there). The importer rasterises the mask at
 * the master's size, moves it as it moved the master, holds its box to this
 * one (paintedShieldFindings) and records it; the mask is never published —
 * the shield stays in the master. The BATTLE profile's `defense.paintedRect`
 * (lib/cards/template-layout.ts BATTLE_SHIELD_RECT) is this box in card
 * percent, the rules text's keep-out on every battle; a unit test holds the
 * two together.
 */
export const BATTLE_SHIELD = Object.freeze({
  mask: `${BATTLE}/maskDefense.png`,
  dx: 12,
  box: Object.freeze({ x: 1893, y: 1304, width: 164, height: 166 }),
});
/** The box of a mask's solid pixels (α ≥ 128) on a `width × height` card,
 *  or null when it has none. */
export function solidBoxOf(mask, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[(y * width + x) * 4 + 3] < 128) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
/** How far a block shift moves a box that lies inside ONE of its blocks
 *  (`{ dx, dy }`), or null when the box reaches into a zone or across two
 *  blocks — it has no one place then. No shift = no move. */
export function boxMoveOf(shift, box) {
  if (!shift) return { dx: 0, dy: 0 };
  const [from, to] = shift.axis === "x" ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
  const block = shift.blocks.find((b) => from >= b.from && to <= b.to);
  if (!block) return null;
  return shift.axis === "x" ? { dx: block.by, dy: 0 } : { dx: 0, dy: block.by };
}
/**
 * Every way a painted shield is not what the recipe records: the pack
 * mask's solid box, moved as `shift` moved the master's block it lies in,
 * and then `spec.dx` px right (a shield the recipe sets aside, TODO 4.21d),
 * differs from `spec.box` (the box on the master) — or the box straddles a
 * block's edge — or (with a `master`) the master is see-through (α < 250)
 * somewhere under the mask's solid pixels: the shield is paint on every
 * colour, the colourless frame's translucent text box included, so the art
 * never shows through the defense value. `mask` is the pack's, unmoved.
 */
export function paintedShieldFindings(spec, mask, width, height, master, shift) {
  const failures = [];
  const packBox = solidBoxOf(mask, width, height);
  const blockMove = packBox ? boxMoveOf(shift, packBox) : null;
  const move = blockMove ? { dx: blockMove.dx + (spec.dx ?? 0), dy: blockMove.dy } : null;
  if (packBox && !move) failures.push(`the mask's solid box ${packBox.x},${packBox.y} ${packBox.width}×${packBox.height} is not inside one block of the shift`);
  const box = packBox && move ? { x: packBox.x + move.dx, y: packBox.y + move.dy, width: packBox.width, height: packBox.height } : null;
  const same = box && box.x === spec.box.x && box.y === spec.box.y && box.width === spec.box.width && box.height === spec.box.height;
  if (!same && (box || !packBox)) {
    failures.push(`the mask's solid box lands at ${box ? `${box.x},${box.y} ${box.width}×${box.height}` : "nowhere (it is empty)"}, the recipe records ${spec.box.x},${spec.box.y} ${spec.box.width}×${spec.box.height}`);
  }
  if (master && packBox && move) {
    let thin = 0;
    for (let y = packBox.y; y < packBox.y + packBox.height; y += 1) {
      for (let x = packBox.x; x < packBox.x + packBox.width; x += 1) {
        if (mask[(y * width + x) * 4 + 3] >= 254 && master[((y + move.dy) * width + x + move.dx) * 4 + 3] < 250) thin += 1;
      }
    }
    if (thin) failures.push(`${thin} px of the master are see-through under the shield`);
  }
  return { box, failures };
}
/** How provenance records a painted shield (never cut, never published). */
export function describePaintedShield(spec) {
  return {
    mask: spec.mask,
    ...(spec.dx ? { dx: spec.dx } : {}),
    box: { ...spec.box },
    published: false,
    use: "the shield is the master's own paint: the importer holds the pack's Defense mask to this box (HD px) and every master to solid paint under it; the profile draws the defense value inside it and keeps the rules text out of it",
  };
}
/**
 * The battle's RIGHT SIDE, onto the prints (TODO 4.21d; owner round 33,
 * 2026-10-06: re-cut before the first battle tick). After the block moves
 * the pack still leaves nine MOM prints (#1, #21, #22, #63, #115, #147,
 * #149, #190, #230; print − master, HD px, + = right) by: the name pill's
 * right end +10.0, the type bar's +8.6, the text box's right edge +7.6 and
 * the shield +11.7 (its black interior's centroid; the prints' shield lies
 * OVER the right border, the pack's stops at it). No flat zone crosses the
 * bars, so their paper is STRETCHED and the shield lifted and set aside —
 * every row and column below is the MASTER's, after BATTLE_BLOCK_RECUT:
 *   • `bands` — three column stretches (recutColumns): inside a band's rows
 *     the columns [fromX, toX) land `by` px right and each row fades from
 *     itself to itself `by` px back over the `blend` columns from `fromX` —
 *     opened INSIDE each bar's own paper, where every line a row crosses is
 *     horizontal, so only the mottled paper is blended. The clear window
 *     columns [toX, clearTo) give up `by` columns (held to one colour a
 *     row). The name pill +10 (its end then +0.1 px from the prints'
 *     mean); the type bar and the text box with its arrow notch +8 (+0.7 /
 *     −0.3; +9 puts the bar at −0.3 but the box at −1.3); the box's corner
 *     under the shield the same +8, with the shield erased first.
 *   • `erase` — the shield's footprint (the Defense mask's every covered
 *     pixel, grown `grow` px) repainted with what is beside it
 *     (eraseMaskFootprint): from `borderX` on the border's edge as on row
 *     `refRow` (black from `sideToRow`); black from `bottomRow`; from
 *     `boxEndX` and above `sideToRow` the box's rim and the clear window of
 *     row `refRow`; above `tipToRow` each column continued from above (the
 *     box's rim runs into the top tip); else the paper mirrored from the
 *     left of the row. What shows of it once the shield is set back is a
 *     4 px crescent along the shield's left-facing edges.
 *   • the shield itself is BATTLE_SHIELD: lifted through its mask and drawn
 *     `dx` 12 px right, source-OVER what is under it (setThroughMask) — a
 *     plain replace would leave its anti-aliased edge see-through on top of
 *     the opaque border. Its tips end at x 2056, short of the right edge's
 *     42 px band.
 * Result on the nine prints: pill end +0.1, type bar end +0.7, box edge
 * −0.3, shield −0.3.
 */
export const BATTLE_RIGHT_RECUT = Object.freeze({
  fromX: 1820,
  blend: 24,
  bands: Object.freeze([
    Object.freeze({ name: "name pill", rows: Object.freeze([0, 600]), toX: 1998, by: 10, clearTo: 2012 }),
    Object.freeze({ name: "type bar + text box", rows: Object.freeze([600, 1300]), toX: 2010, by: 8, clearTo: 2036 }),
    Object.freeze({ name: "text box under the shield", rows: Object.freeze([1300, 1472]), toX: 2030, by: 8 }),
  ]),
  erase: Object.freeze({ grow: 1, borderX: 2037, boxEndX: 1986, refRow: 1295, tipToRow: 1326, sideToRow: 1425, bottomRow: 1448 }),
  why: "nine MOM prints end the name pill 10.0 px, the type bar 8.6 px and the text box 7.6 px further right than the pack and set the shield 11.7 px right, over the border: the pill's paper is stretched 10 px, the type bar's and the text box's 8 px (a 24-column cross-fade inside each bar's own paper) and the shield, lifted through the pack's Defense mask, is set 12 px right — those edges within 0.7 px of the prints' mean",
});
/**
 * The battle ICON's three flat rings, redrawn (TODO 4.21d): the pack's dark
 * disc is 5 % large (r 54.9 px against the prints' 52.0) and sits
 * concentric in its rim, where nine MOM prints set it 1.4 px above the
 * rim's centre (8 px of rim above the disc, 11 below). Inside `repaint` px
 * of the rim's centre (`rim`, pixel-INDEX coordinates on the master, the
 * top block's 2 px up included) every pixel is repainted by its distance
 * from `centre`: black to `disc`, white to `white`, black to `ring`, then
 * the rim's own colour — sampled per angle `rimSample` px from the rim's
 * centre, where every key's rim is flat — with 1 px linear edges. The
 * pack's triangle is kept: its pixels inside `triangle.radius` of the rim's
 * centre, `triangle.dx` px along x. A REDRAW of flat geometry at the
 * prints' half-level radii (52.0 / 58.4 / 62.4 on six prints, five
 * directions), not the pack's pixels — provenance says so. What it leaves:
 * the rim's outer radius (72.0 against 72.2) and the triangle (58 × 49 px
 * against 57 × 48.5) already agree.
 */
export const BATTLE_ICON_RECUT = Object.freeze({
  rim: Object.freeze({ x: 290.5, y: 129.5 }),
  centre: Object.freeze({ x: 289.1, y: 128.1 }),
  disc: 52.0,
  white: 58.5,
  ring: 62.3,
  repaint: 65,
  rimSample: 67,
  triangle: Object.freeze({ radius: 40, dx: -1 }),
  why: "the pack's icon disc is r 54.6 px and concentric in its rim; nine MOM prints draw it r 52.0, 1.4 px above the rim's centre: the three rings are redrawn as flat anti-aliased circles at the prints' radii (52.0 / 58.5 / 62.3) about the prints' centre, the rim's colour continued inward, the pack's triangle kept 1 px left",
});
/** What the battle recipe re-cuts after its block moves (`printRecut`). */
export const BATTLE_PRINT_RECUT = Object.freeze({ right: BATTLE_RIGHT_RECUT, icon: BATTLE_ICON_RECUT });
/**
 * Stretch a band of an 8-bit RGBA image to the RIGHT (recutBand's seam
 * turned a quarter turn; BATTLE_RIGHT_RECUT): inside rows [rows[0],
 * rows[1]) the columns [fromX, toX) land `by` px further right, and over
 * the `blend` columns from `fromX` each row fades — premultiplied — from
 * itself to itself `by` px back: out[x] = (1 − t)·row[x] + t·row[x − by],
 * t = (x − fromX + 1) / (blend + 1); from fromX + blend on it is
 * row[x − by]. So `by` columns are gained across the fade, none is copied
 * twice at full weight, and the columns [toX, toX + by) are covered. With
 * `clearTo`, every row must be ONE colour over the columns [toX, clearTo)
 * (clearTo ≥ toX + by: the zone that gives up the columns is flat, so
 * nothing but that colour is lost) — it throws otherwise. Rows outside the
 * band keep every byte. Returns a new buffer.
 * @param {Buffer} buf
 * @param {number} width
 * @param {number} height
 * @param {{ rows: readonly number[], fromX: number, toX: number, by: number, blend: number, clearTo?: number, name?: string }} band
 */
export function recutColumns(buf, width, height, { rows, fromX, toX, by, blend, clearTo }) {
  if (buf.length !== width * height * 4) throw new Error(`recutColumns: ${buf.length} bytes is not ${width}×${height} RGBA`);
  const [r0, r1] = rows ?? [];
  const ok =
    [r0, r1, fromX, toX, by, blend].every(Number.isInteger) &&
    r0 >= 0 &&
    r1 > r0 &&
    r1 <= height &&
    by > 0 &&
    blend >= 0 &&
    fromX - by >= 0 &&
    fromX + blend <= toX &&
    toX + by <= width &&
    (clearTo == null || (Number.isInteger(clearTo) && clearTo >= toX + by && clearTo <= width));
  if (!ok) throw new Error(`recutColumns: bad band ${JSON.stringify({ rows, fromX, toX, by, blend, clearTo, width, height })}`);
  if (clearTo != null) {
    for (let y = r0; y < r1; y += 1) {
      const first = (y * width + toX) * 4;
      for (let x = toX + 1; x < clearTo; x += 1) {
        const i = (y * width + x) * 4;
        if (buf[i] !== buf[first] || buf[i + 1] !== buf[first + 1] || buf[i + 2] !== buf[first + 2] || buf[i + 3] !== buf[first + 3]) {
          throw new Error(`recutColumns: row ${y} is not one colour over columns ${toX}–${clearTo - 1} (column ${x} differs): the band would cover it`);
        }
      }
    }
  }
  const out = Buffer.from(buf);
  for (let y = r0; y < r1; y += 1) {
    const row = y * width * 4;
    buf.copy(out, row + (fromX + by) * 4, row + fromX * 4, row + toX * 4);
    for (let x = fromX; x < fromX + blend; x += 1) {
      const t = (x - fromX + 1) / (blend + 1);
      const ia = row + x * 4;
      const ib = row + (x - by) * 4;
      const aa = (buf[ia + 3] / 255) * (1 - t);
      const ab = (buf[ib + 3] / 255) * t;
      const alpha = aa + ab;
      const clear = Math.round(alpha * 255) === 0;
      for (let c = 0; c < 3; c += 1) out[ia + c] = clear ? 0 : Math.round((buf[ia + c] * aa + buf[ib + c] * ab) / alpha);
      out[ia + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}
/**
 * Repaint a mask's footprint with what is beside it (BATTLE_RIGHT_RECUT
 * `erase`: the battle's shield, before the text box under it is stretched
 * and the shield set back 12 px right). `cover` is the mask's coverage on
 * the image (one byte a pixel); the footprint is every pixel it covers at
 * all, grown `grow` px (4-neighbours). Each footprint pixel takes, by the
 * first rule that holds (every source pixel is the INPUT's, outside the
 * footprint):
 *   x ≥ borderX                → row refRow's pixel of that column above
 *                                sideToRow (the border's inner edge), black
 *                                (0, 0, 0, 255) from it on;
 *   y ≥ bottomRow              → black (the bottom border);
 *   x ≥ boxEndX, y < sideToRow → row refRow's pixel of that column (the
 *                                box's rim and the clear window);
 *   y < tipToRow               → its column mirrored about the footprint's
 *                                top in that column (lines continued down);
 *   else                       → its row mirrored about the footprint's
 *                                left end in that row (the paper).
 * Returns a new buffer.
 */
export function eraseMaskFootprint(buf, width, height, cover, { grow, borderX, boxEndX, refRow, tipToRow, sideToRow, bottomRow }) {
  if (buf.length !== width * height * 4 || cover.length !== width * height) throw new Error(`eraseMaskFootprint: the image or the cover is not ${width}×${height}`);
  let foot = new Uint8Array(width * height);
  for (let i = 0; i < cover.length; i += 1) foot[i] = cover[i] > 0 ? 1 : 0;
  for (let n = 0; n < grow; n += 1) {
    const grown = Uint8Array.from(foot);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!foot[y * width + x]) continue;
        if (y > 0) grown[(y - 1) * width + x] = 1;
        if (y < height - 1) grown[(y + 1) * width + x] = 1;
        if (x > 0) grown[y * width + x - 1] = 1;
        if (x < width - 1) grown[y * width + x + 1] = 1;
      }
    }
    foot = grown;
  }
  const colTop = new Int32Array(width).fill(-1);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if (foot[y * width + x]) {
        colTop[x] = y;
        break;
      }
    }
  }
  const out = Buffer.from(buf);
  const BLACK = [0, 0, 0, 255];
  for (let y = 0; y < height; y += 1) {
    let left = -1;
    for (let x = 0; x < width; x += 1) {
      if (!foot[y * width + x]) continue;
      if (left < 0) left = x;
      const o = (y * width + x) * 4;
      let from = -1;
      if (x >= borderX) from = y < sideToRow ? refRow * width + x : -1;
      else if (y >= bottomRow) from = -1;
      else if (x >= boxEndX && y < sideToRow) from = refRow * width + x;
      else if (y < tipToRow) from = Math.max(0, colTop[x] - 1 - (y - colTop[x])) * width + x;
      else from = y * width + Math.max(0, left - 1 - (x - left));
      if (from < 0) out.set(BLACK, o);
      else buf.copy(out, o, from * 4, from * 4 + 4);
    }
  }
  return out;
}
/**
 * Draw `src` through a mask, `dx` px to the right, source-OVER `dst`
 * (BATTLE_SHIELD's `dx`): a pixel of `src` at (x − dx, y) covers (x, y) by
 * its own alpha times the mask's coverage there (`cover`, one byte a
 * pixel, at `src`'s place), premultiplied — so an edge pixel that was
 * anti-aliased against a clear window stays an edge pixel over whatever is
 * under it, and an opaque pixel under it stays opaque. Returns a new
 * buffer.
 */
export function setThroughMask(dst, src, cover, width, height, dx) {
  if (dst.length !== width * height * 4 || src.length !== dst.length || cover.length !== width * height) throw new Error(`setThroughMask: an input is not ${width}×${height}`);
  if (!Number.isInteger(dx) || dx < 0 || dx >= width) throw new Error(`setThroughMask: dx ${dx}`);
  const out = Buffer.from(dst);
  for (let y = 0; y < height; y += 1) {
    for (let x = dx; x < width; x += 1) {
      const m = cover[y * width + x - dx];
      if (!m) continue;
      const s = (y * width + x - dx) * 4;
      const o = (y * width + x) * 4;
      const sa = (src[s + 3] / 255) * (m / 255);
      if (sa === 0) continue;
      const da = (dst[o + 3] / 255) * (1 - sa);
      const alpha = sa + da;
      // A trace of cover over a clear pixel that rounds to nothing leaves
      // the pixel as it is (no colour under α 0).
      if (Math.round(alpha * 255) === 0) continue;
      for (let c = 0; c < 3; c += 1) out[o + c] = Math.round((src[s + c] * sa + dst[o + c] * da) / alpha);
      out[o + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}
/**
 * Redraw the battle icon's rings (BATTLE_ICON_RECUT): every pixel within
 * `repaint` px of `rim` (the rim's centre; pixel-index coordinates — a
 * pixel's centre is its index) becomes, by its distance d from `centre`,
 * black for d ≤ disc, white to `white`, black to `ring` and beyond it the
 * rim's own colour (the input's pixel `rimSample` px from `rim` at the
 * pixel's angle), each boundary a 1 px linear edge (coverage r + 0.5 − d,
 * clamped to 0–1); inside `triangle.radius` of `rim` the input's own pixel
 * `triangle.dx` px back along x is kept instead (the pack's triangle,
 * moved). Everything is opaque. Returns a new buffer.
 */
export function redrawBattleIcon(buf, width, height, { rim, centre, disc, white, ring, repaint, rimSample, triangle }) {
  if (buf.length !== width * height * 4) throw new Error(`redrawBattleIcon: ${buf.length} bytes is not ${width}×${height} RGBA`);
  const reach = Math.max(repaint, rimSample) + Math.abs(triangle.dx) + 1;
  if (!(disc < white && white < ring && ring < repaint && repaint < rimSample) || rim.x - reach < 0 || rim.y - reach < 0 || rim.x + reach >= width || rim.y + reach >= height) {
    throw new Error(`redrawBattleIcon: bad icon ${JSON.stringify({ rim, centre, disc, white, ring, repaint, rimSample, triangle })}`);
  }
  const out = Buffer.from(buf);
  const cov = (r, d) => Math.min(1, Math.max(0, r + 0.5 - d));
  for (let y = Math.floor(rim.y - repaint); y <= Math.ceil(rim.y + repaint); y += 1) {
    for (let x = Math.floor(rim.x - repaint); x <= Math.ceil(rim.x + repaint); x += 1) {
      if (Math.hypot(x - rim.x, y - rim.y) > repaint) continue;
      const o = (y * width + x) * 4;
      if (Math.hypot(x - triangle.dx - rim.x, y - rim.y) <= triangle.radius) {
        buf.copy(out, o, (y * width + x - triangle.dx) * 4, (y * width + x - triangle.dx) * 4 + 4);
        continue;
      }
      const angle = Math.atan2(y - rim.y, x - rim.x);
      const sample = (Math.round(rim.y + rimSample * Math.sin(angle)) * width + Math.round(rim.x + rimSample * Math.cos(angle))) * 4;
      const d = Math.hypot(x - centre.x, y - centre.y);
      const [cDisc, cWhite, cRing] = [cov(disc, d), cov(white, d), cov(ring, d)];
      // rim·(1 − ring) + black·(ring − white) + white·(white − disc) + black·disc
      for (let c = 0; c < 3; c += 1) out[o + c] = Math.round(buf[sample + c] * (1 - cRing) + 255 * (cWhite - cDisc));
      out[o + 3] = Math.round(buf[sample + 3] * (1 - cRing) + 255 * cRing);
    }
  }
  return out;
}
/**
 * The battle master re-cut onto the prints (TODO 4.21d), after the block
 * moves and before the corner is cut: the shield's footprint erased, the
 * three bands stretched, the shield set `shield.dx` px right and the icon's
 * rings redrawn — in that order. `mask` is the pack's Defense mask (RGBA)
 * at the master's size, UNMOVED: it rides `shift` as the master's lower
 * block did. `spec` = { shift, shield (BATTLE_SHIELD), right
 * (BATTLE_RIGHT_RECUT), icon (BATTLE_ICON_RECUT) }. With no bands, no
 * shield `dx` and no icon it returns the input's bytes. Returns a new
 * buffer.
 * @param {Buffer} master
 * @param {Buffer} mask
 * @param {number} width
 * @param {number} height
 * @param {{ shift: any, shield: any, right?: any, icon?: any }} spec
 */
export function recutBattleOntoPrints(master, mask, width, height, { shift, shield, right, icon }) {
  if (master.length !== width * height * 4 || mask.length !== master.length) throw new Error(`recutBattleOntoPrints: the master or the mask is not ${width}×${height} RGBA`);
  let out = Buffer.from(master);
  if (right) {
    const packBox = solidBoxOf(mask, width, height);
    const move = packBox ? boxMoveOf(shift, packBox) : null;
    if (!move) throw new Error("recutBattleOntoPrints: the Defense mask is empty or not inside one block of the shift");
    // The mask's coverage where the master's shield is.
    const cover = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const ty = y + move.dy;
      if (ty < 0 || ty >= height) continue;
      for (let x = 0; x < width; x += 1) {
        const tx = x + move.dx;
        if (tx >= 0 && tx < width) cover[ty * width + tx] = mask[(y * width + x) * 4 + 3];
      }
    }
    out = eraseMaskFootprint(out, width, height, cover, right.erase);
    for (const band of right.bands) out = recutColumns(out, width, height, { fromX: right.fromX, blend: right.blend, ...band });
    out = setThroughMask(out, master, cover, width, height, shield.dx);
  }
  if (icon) out = redrawBattleIcon(out, width, height, icon);
  return out;
}
/** How provenance records the battle's re-cut (TODO 4.21d). */
export function describeBattleRecut({ shield, right, icon }) {
  return {
    order: "after the block moves, before the corner cut: the shield's footprint erased, the bands stretched, the shield set right, the icon's rings redrawn",
    columns: {
      fromX: right.fromX,
      blend: right.blend,
      bands: right.bands.map((b) => ({ name: b.name, rows: [...b.rows], toX: b.toX, by: b.by, ...(b.clearTo == null ? {} : { clearTo: b.clearTo }) })),
      how: "inside a band's rows the columns [fromX, toX) land `by` px right; over the `blend` columns from fromX each row is a premultiplied cross-fade of itself with itself `by` px back (the bar's own paper, where every line a row crosses is horizontal); the columns [toX, clearTo) are one colour a row (checked) and give up `by` columns",
      why: right.why,
    },
    shield: {
      mask: shield.mask,
      dx: shield.dx,
      erase: { ...right.erase },
      how: "the shield's footprint (the mask's every covered pixel, grown 1 px) is repainted with the paper, rim, window and border beside it, the text box under it is stretched, then the pack's own shield pixels — lifted through the mask — are drawn `dx` px right, source-over (premultiplied; the shield's alpha times the mask's coverage)",
    },
    icon: {
      rim: { ...icon.rim },
      centre: { ...icon.centre },
      radii: { disc: icon.disc, white: icon.white, ring: icon.ring },
      repaint: icon.repaint,
      rimSample: icon.rimSample,
      triangle: { ...icon.triangle },
      how: "a REDRAW of flat geometry, not the pack's pixels: inside `repaint` px of the rim's centre the three rings are flat anti-aliased circles about `centre` (black, white, black; 1 px linear edges), the rim's own colour — sampled per angle `rimSample` px out — continued inward; the pack's triangle is kept, its pixels `triangle.dx` px along x",
      why: icon.why,
    },
  };
}
const SPLIT_TRANSFORM =
  "native 1500x2100 (the pack draws the card portrait, its text at −90°), turned a quarter turn CLOCKWISE to 2100x1500 — a pixel permutation, no resample: source (x, y) → (2099 − y, x); then the two halves moved onto the prints through the flat black border and spine (shift: the left half 11 px left, the right half 3 px — whole blocks, byte for byte); corners rounded to the importer radius (64.5 px, 4.3 % of the 1500 px short side)";
const BATTLE_TRANSFORM =
  "native 2814x2010 (the pack's landscape canvas), downscaled ONCE with Lanczos to 2100x1500 (the M15 family's one-downscale rule: the same 1.34 ratio as 2010x2814 → 1500x2100); then two blocks moved onto the prints through the flat rows between them (shift: the name pill and icon 2 px up, the type bar, text box and shield 4 px down — whole rows, byte for byte); then the right side re-cut onto the prints (printRecut: the name pill's paper stretched 10 px right, the type bar's and text box's 8 px, the shield lifted through the pack's Defense mask and set 12 px right over the border, the icon's three rings redrawn at the prints' radii); corners rounded to the importer radius (64.5 px, 4.3 % of the 1500 px short side)";

// ---------------------------------------------------------------------------
// The saga (TODO 4.21c = 3.7; design 2026-09-29 §3.4, owner decisions
// 2026-09-29): Card Conjurer's 'Regular Frames' saga pack, native
// 1500 × 2100, copied 1:1 — the chapter RIBBON is in each master (x 66–166
// with its gold outlines, full width from the fold under the reminder block,
// ≈ 610 px, down to 1663 px, then tapering to its tip at 1748 px — 18–26 px
// lower than the DOM prints' tip, as the pack draws it), where the 375 px
// MSE cut (magic-m15-saga, in git until
// now) had a flat cream rail and a window that started 26 px left of the
// prints'. Keys w u b r g m are the pack's `sagaFrame<K>.png`; `c` is its
// 'Land Frame' (`l.png`) — the only printed colourless saga is a land, MH2
// #259 Urza's Saga (owner decision 2026-09-29); the pack's 'Artifact Frame'
// (sagaFrameA) is not built (no profile key paints it). Against the prints
// (Scryfall PNGs at 1500 × 2100; DOM #21 / #42 / #90 / #122 / #173, 40K
// #126, LTC #58, MH2 #259) every bar, the window and the rail's outline
// register within the scans' ±1–3 px: no re-cut.
//
// The rail's two bitmaps are the pack's own, drawn by versionSaga.js and by
// both of our renderers: the chapter badge (`sagaChapter.png`, a 118 × 132
// gold hexagon — the prints' measures 119–120 × 130–132) and the row divider
// (`sagaDivider.png`, 592 × 9: a soft dark line over a white one, fading out
// to the right, drawn 6 px tall), published at native size as
// saga/chapter/badge.png and saga/chapter/divider.png (SAGA_CHAPTER_PIECES).
//
// The pack's nine masks (SAGA_MASK_INPUTS) are importer INPUTS for the
// two-colour saga's pair masters (TODO 4.6f: `saga/<pair>.png` through
// twoColorRecipe, the banner split by Banner / Banner (Right), the text box
// by Text / Text (Right)): recorded here and in provenance, fetched into the
// cache with the masters, and never published — no `saga/mask/*` object.
// ---------------------------------------------------------------------------
const SAGA = "img/frames/saga";
/** packSagaRegular.js `masks`, by the pack's own names (design D2). */
export const SAGA_MASK_INPUTS = Object.freeze({
  Pinline: `${SAGA}/sagaMaskPinline.png`,
  Title: `${REG}/m15MaskTitle.png`,
  Type: `${SAGA}/sagaMaskType.png`,
  Frame: `${SAGA}/sagaMaskFrame.png`,
  Banner: `${SAGA}/sagaMaskBanner.png`,
  "Banner (Right)": `${SAGA}/sagaMaskBannerRight.png`,
  Text: `${SAGA}/sagaMaskText.png`,
  "Text (Right)": `${SAGA}/sagaMaskTextRight.png`,
  Border: `${SAGA}/sagaMaskBorder.png`,
});
/** The rail's bitmaps (versionSaga.js): published path under the template's
 *  folder → the pack's file. The SAGA profile's `chapters.badge.assetPath` /
 *  `chapters.divider.assetPath` name these objects (a unit test keeps them
 *  in step). */
export const SAGA_CHAPTER_PIECES = Object.freeze({
  "chapter/badge": `${SAGA}/sagaChapter.png`,
  "chapter/divider": `${SAGA}/sagaDivider.png`,
});

// ---------------------------------------------------------------------------
// The transform bodies (TODO 5.1a; design 2026-10-02, design-next/5/final.md
// §2.1 / §2.3, frames.md §1.1–1.4 / §3.6 / §4.4): Card Conjurer's 'Transform
// (Front)', 'Transform (Back)' (the 2016–22 look, the icon well EMPTY at the
// left) and 'Transform (Back) (New)' (the ▼ baked at the RIGHT, every
// transform printed since 2022-11) packs, 1500 × 2100 native, copied 1:1 —
// the icon well, the grey reverse-P/T tab and the ▼ are the masters'. Keys
// w u b r g m from the colour frames, `a` the pack's 'Artifact Frame' and
// `c` the same artifact master STANDING IN (design D2: no colourless
// transform face printed on the plain M15 frame; EMN's Eldrazi backs are
// see-through, TODO 5.11), the land pair ONE master under every key (as the
// emblem: verified on `c`). The backs' dark bars and greyed box are TONED
// onto the prints before the first tick (DFC_BACK_TONES); the dark back
// P/T plates are the pack's own `pt<K>.png` (285 × 156, white digits; `c`
// takes the artifact plate). The 12 icon glyphs are a RIDER set
// (CC_RIDERS.dfcicon), rasterised at 220 px.
// ---------------------------------------------------------------------------
const TRANSFORM = "img/frames/m15/transform/regular";
const TRANSFORM_ICONS = "img/frames/m15/transform/icons";
/** The pack's masks, in CC's draw order (Border, Frame, Rules, Title, Type,
 *  Pinline); the backs' Rules mask and the Type mask are the regular M15
 *  pack's (2010 × 2814, resized to the working size like any mask). */
const TRANSFORM_MASK = {
  frontTitle: `${TRANSFORM}/maskTitle.png`,
  backTitle: `${TRANSFORM}/maskTitle.png`,
  newBackTitle: `${TRANSFORM}/new/maskTitle.png`,
  type: REG_TYPE_MASK,
  rules: REG_RULES_MASK,
  frontRules: `${TRANSFORM}/maskRulesFront.png`,
};
/** The dark back P/T plates per colour key: the pack's `pt<K>.png`; the
 *  colourless stand-in draws the artifact plate (as m15tokenartifact's c). */
const DFC_BACK_PT = perColor((k) => `${TRANSFORM}/pt${(k === "c" ? "a" : k).toUpperCase()}.png`);
/** A transform master's file for a colour key: the colour's, or the
 *  artifact frame for `a` and the `c` stand-in. */
const transformFrame = (prefix, k) => `${TRANSFORM}/${prefix}${(k === "c" ? "a" : k).toUpperCase()}.png`;

/**
 * The backs' tone pass (TODO 5.1a, design D1 / §2.3: "tone the backs onto
 * the prints before the first tick"): per colour key, the title and type
 * bars and the text box of CC's back masters have their colour multiplied by
 * a gain through the pack's Title, Type and Rules masks (toneMasked), with a
 * luminance ramp (DFC_BACK_TONE_LUMA_RAMP) that leaves the white ring of the
 * icon well, the ▼ glyph and the bars' light rims as CC draws them — a flat
 * multiplier, so CC's bevels and lips keep their shading; the frame body and
 * the plates are untouched (the prints don't darken the body either). Fitted
 * on the medians of the bars' flat face (x 1000–1150, rows 118–205 / 1200–
 * 1290 at HD, clear of the name and type ink) and of the box (x 300–1100,
 * rows 1340–1920, the rules ink inside the median) of the 2015-frame
 * transform back scans in the design folder and nine more fetched for the
 * fit (Scryfall PNGs resized to 1500 × 2100, Lanczos), against the same
 * regions of CC's masters (scratchpad dfc-1a/print-lumas.json, dfc-1a/
 * tones.json):
 *   w  bars 168 → 156 (VOW #12, MID #13 / #27, INR #32: 158 / 148 / 153 / 165), box 196 → 203 (205 / 198 / 201 / 209)
 *   u  bars 118 → 96 (SOI #88, LCI #60, INR #60, ECL #124, MID #47: 90 / 104 / 98 / 100 / 86), box 201 → 191
 *   b  bars 91 → 79 (FIN #125, MID #126 / #100, INR #287 / #107: 78 / 75 / 63 / 91 / 89), box 170 → 160
 *   r  bars 78 → 97 (NEO #141, INR #179, MID #143: 90 / 108 / 93 — CC's red back is DARKER than the prints), box 172 → 182
 *   g  bars 81 → 67 (SOI #203, INR #193, MID #169: 72 / 75 / 54), box 186 → 176
 *   m  bars 130 → 137 (MOM #43 / #36, BOT #13: 141 / 136 / 147), box 205 → 187
 *   a  bars 143 → 126 (MID #256, LCI #262: 117 / 135), box 180 → 181
 *   l  bars 127 → 155 (FIN #31: 167 / 142 — CC's land back is a dark-barred
 *      land where the one FIN / TLA print is light, with DARK name and type
 *      ink), box 158 → 209
 * `c` is the artifact stand-in and takes `a`'s. The old (2016–22) and new
 * (2022-11+) back packs have the same tones key for key (measured), so one
 * table serves both. The design's own numbers (G bars → ≈ 65, U → ≈ 100,
 * W → ≈ 140; bars ×0.72–0.80) read the bars' whole height, outlines
 * included; the gains here are the flat face's, which is what a multiplier
 * moves.
 */
export const DFC_BACK_TONES = Object.freeze({
  w: Object.freeze({ bars: 0.93, box: 1.03 }),
  u: Object.freeze({ bars: 0.81, box: 0.95 }),
  b: Object.freeze({ bars: 0.87, box: 0.94 }),
  r: Object.freeze({ bars: 1.23, box: 1.06 }),
  g: Object.freeze({ bars: 0.83, box: 0.95 }),
  m: Object.freeze({ bars: 1.05, box: 0.91 }),
  a: Object.freeze({ bars: 0.88, box: 1.0 }),
  c: Object.freeze({ bars: 0.88, box: 1.0 }),
  l: Object.freeze({ bars: 1.22, box: 1.32 }),
});
/** The gain fades to 1 between these lumas: the well's white ring, the ▼
 *  and the bars' light rims (≥ 245) stay as CC draws them; the bars' flat
 *  face (≤ 172 on every key) and the box (≤ 206) take the whole gain. */
export const DFC_BACK_TONE_LUMA_RAMP = Object.freeze([215, 245]);

/** One back body's tones for a colour key: the Title and Type masks at the
 *  bars' gain, the Rules mask at the box's (toneMasked, in that order). */
export function dfcBackTones(titleMask, key) {
  const t = DFC_BACK_TONES[key];
  if (!t) throw new Error(`dfcBackTones: no tone for key ${key}`);
  return [
    { mask: titleMask, gain: t.bars, lumaRamp: [...DFC_BACK_TONE_LUMA_RAMP], region: "title bar" },
    { mask: TRANSFORM_MASK.type, gain: t.bars, lumaRamp: [...DFC_BACK_TONE_LUMA_RAMP], region: "type bar" },
    { mask: TRANSFORM_MASK.rules, gain: t.box, lumaRamp: [...DFC_BACK_TONE_LUMA_RAMP], region: "text box" },
  ];
}

/** How provenance describes a back body's tone pass. */
function dfcBackToneTransform(titleMask) {
  return `${NATIVE_1500}; then the title bar (through ${titleMask}), the type bar (through ${TRANSFORM_MASK.type}) and the text box (through ${TRANSFORM_MASK.rules}) have their colour multiplied by the key's gain (DFC_BACK_TONES: bars / box per colour), fading to ×1 between luma ${DFC_BACK_TONE_LUMA_RAMP[0]} and ${DFC_BACK_TONE_LUMA_RAMP[1]} so the well's white ring, the ▼ and the light rims keep CC's tone; the frame body and the plates untouched`;
}

const DFC_FRONT_NOTES = [
  "source: CC 'Transform (Front)' (packM15TransformFront.js, groupDFC.js): the M15 frame with the icon WELL at the left of the name bar (a black disc with a white ring, outer circle x 84–220 × y 98–236 at HD, CC's default ▲ drawn in it — the icon rider overdraws it with the family's glyph) and the pentagonal grey reverse-P/T TAB cut out of the text box's right edge (x 1392–1440, y 1745–1848), both the master's; the prints put the well at 84–225 and the tab at 1398–1441 (MID #169, INR #60, MOM #43), within 2–4 px",
  "the name starts at 16.7 %W (prints 249–252 px: SOI #203, MID #169, INR #60 / #193, XLN #22; CC's pack says 0.16 = 240) — the profile's title inset, not a pixel of the master (design D5)",
  "colourless `c` = the pack's 'Artifact Frame' (frontA.png) as a RENDER STAND-IN (design D2): no colourless non-artifact transform FRONT was printed on the plain M15 frame (EMN's Eldrazi are backs, see-through — TODO 5.11); the row is ticked against an ARTIFACT print (LCI #60 Inverted Iceberg) and offered only to a face whose type line says Artifact (colorlessFaceAllowed)",
  "P/T plate = M15's (m15/pt/<k>.png): the pack draws CC's m15PT<K>.png at M15's bounds; the reverse P/T in the tab is text (the profile's reversePt slot, #777, Beleren small caps), drawn only when the back prints a P/T — the tab prints EMPTY otherwise, as XLN #22 / VOW #12 / LCI #158 do (owner decision Q7)",
  "the legendary crown (TODO 5.1d): the m15dfccrown overlay — our m15crown band cut through CC's transform crown twin's alpha around the well (CC_OVERLAY_BANDS.m15dfccrown); the two-colour PAIR masters (5.1d / 5.12): 4.6b's split recipe over this pack's files and masks — frontM.png whole, the text box and the pinline lerped from the two colour fronts (dfcPairLayers); no hybrid dress: no hybrid-cost transform front was printed on the 2015 frame (MH3's hybrids are modal)",
];

const DFC_BACK_NOTES = (pack, side) => [
  `source: CC '${pack}': the M15 frame with DARK title and type bars (white name and type ink), a greyed text box (dark rules ink) and the icon well at the ${side} — the 'new' back's ▼ is baked in the master at the right (outer circle x 1280–1418, 6 px right of the prints' 1271–1413: accepted in wave 1, a re-cut for the sheet to flag), the old back's well is an EMPTY black disc at the left (84–220) the icon rider fills with the family's back glyph (moon, Emrakul, land, open fan)`,
  "toned onto the prints before the first tick (DFC_BACK_TONES, design D1): CC's bars read 20–30 luma off the prints on most keys — too light on w u b g a, too DARK on r and the land back, gold within 7 — and its boxes 5–20 light; per-key gains through the pack's Title / Type / Rules masks, the white ring, the ▼ and the light rims kept by a luma ramp; the body and the plates untouched",
  "P/T plates = the pack's dark `pt<K>.png` (285 × 156, interior luma W 160 U 95 B 85 R 75 G 69 M 122 A 112, within the prints' G 69–95 / U 93–106), drawn at M15's plate box with WHITE digits; the colourless stand-in takes the artifact plate; ONE set, m15dfcback/pt/<k>.png, which the 2016–22 back's profile draws too",
  "colourless `c` = the pack's 'Artifact Frame' as a RENDER STAND-IN (design D2), ticked against an artifact print (LCI #262 Sunbird Effigy / MID #256 Mystic Monstrosity); a colourless Eldrazi or Avatar back (EMN #63, TLA #203) prints a see-through frame CC lacks — TODO 5.11",
  "no mana cost (the profile's hideCost: a transform back never prints one); the colour-indicator dot is the renderers' (lib/cards/color-indicator.ts), on every coloured back; the pack's 'Vehicle Frame' (new/backV.png, ptV) is TODO 5.10",
  "the legendary crown (TODO 5.1d): the m15dfccrown / m15dfccrownright overlay (our m15crown band cut through CC's transform crown twin's alpha around the well; the ▼ back's well is at the right); the two-colour PAIR masters (5.1d): the prints split a two-colour BACK's pinline rings and text box over the gold bars, as the front's (MOM #43 G|W, MID #218 W|U, MID #246 R|G, EMN #191 R|G, STX #149 B|R measured 2026-10-05 — the design's \"gold backs never split\" was wrong), so the split recipe over this pack's back files: backM.png whole, the box and the pinline lerped from the two colour backs, the gold bars at m's gain and the box at the two colours' box gains lerped across the rules ramp (dfcPairBackTones)",
];

const DFC_LAND_NOTES = (file, print) => [
  `source: CC 'Transform' ${file} — the pack's 'Land Frame', the M15 land body (stone texture) with the transform pieces; ONE master under every colour key, as the emblem's (a land face has no frame colour of its own here), verified on \`c\` against ${print}`,
];

/** The icon riders (CC_RIDERS.dfcicon): CC's 14 icon files less the two no
 *  DFC prints (Lesson, Hammer — BOT prints the plain ▲ / ▼), each a black
 *  disc with the white glyph, keyed by the glyph's name in lowercase (the
 *  frames bucket's keys are lowercase: MANIFEST_KEY). The family → glyph
 *  map is lib/cards/dfc.ts DFC_ICON_GLYPHS (a unit test holds its keys to
 *  this list). */
export const DFC_ICON_FILES = Object.freeze({
  default: `${TRANSFORM_ICONS}/default.png`,
  downarrow: `${TRANSFORM_ICONS}/downArrow.png`,
  sun: `${TRANSFORM_ICONS}/sun.svg`,
  moon: `${TRANSFORM_ICONS}/moon.svg`,
  fullmoon: `${TRANSFORM_ICONS}/fullmoon.svg`,
  emrakul: `${TRANSFORM_ICONS}/emrakul.svg`,
  compass: `${TRANSFORM_ICONS}/compass.svg`,
  land: `${TRANSFORM_ICONS}/land.svg`,
  spark: `${TRANSFORM_ICONS}/spark.svg`,
  planeswalker: `${TRANSFORM_ICONS}/planeswalker.svg`,
  fanclosed: `${TRANSFORM_ICONS}/fanClosed.svg`,
  fanopen: `${TRANSFORM_ICONS}/fanOpen.svg`,
});
/** The riders' published size: 2× the 110 px CC draws them at (icon bounds
 *  0.0734 W = 110 px), so the HD bake never upsamples a glyph. */
export const DFC_ICON_SIZE = 220;

// ---------------------------------------------------------------------------
// The modal (MDFC) bodies (TODO 5.1b; design 2026-10-02, design-next/5/
// final.md §2.1 / §2.3, frames.md §1.5 / §3.5 / §3.6 / §4.4): Card
// Conjurer's 'Modal Regular' pack (packModalRegular.js, groupModal-1.js),
// 1500 × 2100 native, copied 1:1 — the drop-shaped icon HOUSING at the left
// of the name bar (a white fill with the black ▲ on a front, the bar's tone
// with the white ▲▼ on a back), its ring, the flipside STRIP at the bottom
// left (dark on a front, light on a back, with CC's ◀ at its tip) and the
// strip's box are the masters'; only the strip's two texts are drawn (the
// profile's `flipside` slots, lib/cards/template-layout.ts). Keys w u b r g
// m from the colour frames, `a` the pack's artifact frame and `c` the same
// artifact master STANDING IN (design D2: STX #154 Pestilent Cauldron is
// the one colourless modal face printed on this frame — a front; every
// KHM artifact back is a COLOURED artifact, drawn on its colour's body in
// wave 1 as LCI #60 is on the transform bodies). The backs' dark bars and
// box are TONED onto the prints before the first tick (MDFC_BACK_TONES: the
// STX / MSH spell backs; MDFC_LAND_BACK_TONES: the ZNR / MH3 land backs —
// the two sets print the bars 10–30 luma apart on u, b and g, so each
// template has its own table). The land pair is a PipGlyph recipe (no CC
// coloured modal land exists): the colour's modal master with its frame
// BODY (and, on the front, its text box) REPLACED through the pack's own
// `frame.svg` / `textbox.svg` masks by the 2015 coloured land tint
// (`m15/new/l<k>.png`, the m15land masters' own file, downscaled the same
// way) — the pathways (ZNR #258–261, KHM #252) print the stone land body,
// the colour's pinline, the land tint's box and the modal housing and
// strip; the land backs (ZNR #12 / #90 / #134 / #189, MH3 #241) the stone
// body under the colour's dark bars, housing and light box. `c` = the
// pack's grey land modal (`l.png` / `lb.png`) and `m` = the gold land tint
// under the gold modal pieces, both stand-ins with no print. The modal
// back's P/T plates are the transform pack's dark ones (m15dfcback/pt:
// MSH #18 She-Hulk's gold plate reads 117 against ptM's 123); no plates
// of its own.
// ---------------------------------------------------------------------------
const MODAL = "img/frames/modal/regular";
/** The pack's masks (SVG, 1500 × 2100), in CC's draw order: Flipside
 *  (reminder), Pinline, Title, Type (the regular M15 pack's PNG), Rules
 *  (textbox), MDFC Arrow, Frame, Border. */
const MODAL_MASK = {
  reminder: `${MODAL}/reminder.svg`,
  pinline: `${MODAL}/pinline.svg`,
  title: `${MODAL}/title.svg`,
  type: REG_TYPE_MASK,
  rules: `${MODAL}/textbox.svg`,
  frame: `${MODAL}/frame.svg`,
  border: `${MODAL}/border.svg`,
};
/** A modal master's file for a colour key: the colour's, the artifact
 *  frame for `a` and the `c` stand-in; `b` suffixed for a back. */
const modalFrame = (k, back) => `${MODAL}/${k === "c" ? "a" : k}${back ? "b" : ""}.png`;
/** The 2015 coloured land tint a modal land face takes its body (and, on
 *  the front, its box) from: the m15land masters' own files. */
const modalLandTint = (k) => `${NEW}/l${k}.png`;

/**
 * The modal backs' tone pass (TODO 5.1b, design D1 / §2.3): per colour key,
 * the title bar (with the housing's fill, whose tone is the bar's — CC's
 * Title mask holds both), the type bar and the text box of CC's back
 * masters multiplied through the pack's masks (toneMasked, the transform
 * backs' DFC_BACK_TONE_LUMA_RAMP keeping the white ▲▼ and the bars' light
 * rims). Fitted on the medians of the bars' flat face (x 1000–1150, rows
 * 118–205 / 1200–1290 at HD) and of the box (x 300–1100, rows 1340–1920) of
 * the reference scans resized to 1500 × 2100 (Lanczos), against the same
 * regions of CC's masters (scratchpad dfc-1b/measure.json):
 *   the spell backs (STX's two-colour cards, one colour per face, and
 *   MSH #18's gold back — the only 2015-frame modal backs that are spells):
 *   w  bars 188 → 178 (STX #150 Revel in Silence 176 / 181), box 205 → 217
 *   u  bars 123 → 107 (STX #147 Echoing Equation 107 / 106), box 208 → 204
 *   b  bars  91 →  88 (STX #148 Search for Blex 86 / 90), box 172 → 177
 *   r  bars  91 → 107 (STX #159 Flamethrower Sonata 108 / 106 — CC's red
 *      back is DARKER than the print, as the transform one), box 186 → 200
 *   g  bars  88 →  78 (STX #151 Journey to the Oracle 79 / 76), box 182 → 193
 *   m  bars 147 → 133 (MSH #18 The Sensational She-Hulk 135 / 131), box 201 → 183
 *   a  no print: every artifact modal back is a COLOURED artifact (KHM
 *      #15 Sword of the Realms is white, KHM #112 Tergrid's Lantern black),
 *      so CC's artifact back stands as it is; `c` takes `a`'s;
 *   the land backs (MDFC_LAND_BACK_TONES, the ZNR / MH3 land backs, whose
 *   bars print darker than the spell backs' on u and g and lighter on b):
 *   w  bars 188 → 179 (ZNR #12 Emeria 179 / 179), box 205 → 218
 *   u  bars 123 →  91 (MH3 #241 Soporific Springs 91 / 91), box 208 → 201
 *   b  bars  91 →  99 (ZNR #90 Agadeem 102 / 96), box 172 → 189
 *   r  bars  91 → 100 (ZNR #134 Akoum Teeth 101 / 98), box 186 → 198
 *   g  bars  88 →  69 (ZNR #189 Kazandu Valley 68 / 69), box 182 → 188
 *   m  the spell back's (a stand-in, no gold modal land printed); `c`
 *      (CC's grey land modal, no print) is left as it is.
 * The design's own numbers (`ub` ×0.76, `rb` ×1.15, `ab` ×1.35) read the
 * land backs for u and r and KHM #15 for `a`; the gains here are per
 * template, each on its own references.
 *
 * The STRIP (TODO 5.1d; the 5.1b skeptic's finding, 2026-10-05): the backs'
 * flipside strip — CC's light tab at the text box's bottom left — reads
 * 14–44 luma darker than every mono-colour print's on u, b, r and g (and
 * 38 on the gold back), so the whole tab takes a gain through the pack's
 * Flipside mask (`reminder.svg` covers the tab from the border's inner
 * edge to its chevron's tip, so the ◀ and the outline stay dark: a
 * multiplier keeps dark pixels dark). Fitted on the tab's text-free fill
 * (the median luma of rows 1872–1876 and 1938–1942, x 110–640 at HD, the
 * skeptic's regions) of the reference scans — the same references as the
 * bars, one table per template — against CC's backs (scratchpad
 * dfc-1d/research/strips.json), to the luma the clamped channels give:
 *   the spell backs (m15mdfcback):
 *   u  208.2 → 220.0 (STX #147 Echoing Equation 220)
 *   b  175.2 → 221.0 (STX #148 Search for Blex 223, KHM #112 Tergrid's
 *      Lantern 219 — the skeptic's "b 216" averaged the land back in)
 *   r  212.4 → 230.3 (STX #159 Flamethrower Sonata; a 255 clamp on R)
 *   g  200.6 → 228.9 (STX #151 Journey to the Oracle — read inside the
 *      tab: the builder's 224.4 had a row on the tab's top outline, which
 *      sits 3 px lower on this scan; KHM #181 The Ringhart Crest 233.8)
 *   m  194.6 → 233.0 (KHM #168 The Prismatic Bridge — a five-colour GOLD
 *      modal back, 233 — and STX #149's B|R back 233; MSH's gold backs read
 *      228–245: the skeptic's "no mono-gold print" missed Esika's back; a
 *      255 clamp on R, the tab a shade yellower than the prints' neutral
 *      231/232/233 — a gain moves luma, not hue)
 *   w  238.1 — untouched: within the prints' spread (STX #150 230, KHM #15
 *      249, KHM #21 / STX #155 beside them)
 *   the land backs (m15mdfclandback):
 *   u  208.2 → 230.7 (MH3 #241 Soporific Springs)
 *   b  175.2 → 212.4 (ZNR #90 Agadeem, the Undercrypt; the pathways'
 *      b backs ZNR #259 / #261 read 240 / 229 — the reference row's print)
 *   r  212.4 → 227.8 (ZNR #134 Akoum Teeth 226.3, MH3 #246 Boggart Trawler's
 *      back 229.2)
 *   g  200.6 → 218.1 (ZNR #189 Kazandu Valley)
 *   w  238.1 — untouched (ZNR #12 Emeria 237.3)
 *   m  the spell back's (a stand-in); `a` / `c` untouched (no print).
 * The front strips are within 5–11 of the prints (5.1b) and stay.
 */
export const MDFC_BACK_TONES = Object.freeze({
  w: Object.freeze({ bars: 0.947, box: 1.059 }),
  u: Object.freeze({ bars: 0.866, box: 0.981, strip: 1.056 }),
  b: Object.freeze({ bars: 0.967, box: 1.029, strip: 1.263 }),
  r: Object.freeze({ bars: 1.182, box: 1.075, strip: 1.097 }),
  g: Object.freeze({ bars: 0.886, box: 1.06, strip: 1.141 }),
  m: Object.freeze({ bars: 0.905, box: 0.91, strip: 1.213 }),
  a: Object.freeze({ bars: 1, box: 1 }),
  c: Object.freeze({ bars: 1, box: 1 }),
});
export const MDFC_LAND_BACK_TONES = Object.freeze({
  w: Object.freeze({ bars: 0.95, box: 1.063 }),
  u: Object.freeze({ bars: 0.74, box: 0.966, strip: 1.106 }),
  b: Object.freeze({ bars: 1.088, box: 1.099, strip: 1.211 }),
  r: Object.freeze({ bars: 1.099, box: 1.065, strip: 1.082 }),
  g: Object.freeze({ bars: 0.783, box: 1.033, strip: 1.088 }),
  m: MDFC_BACK_TONES.m,
});

/** One modal back body's tones for a colour key from `table`: the pack's
 *  Title mask (the bar and the housing's fill) and the regular Type mask at
 *  the bars' gain, the pack's Rules mask at the box's, and — since 5.1d —
 *  the pack's Flipside mask (the whole tab) at the strip's (toneMasked, in
 *  that order); none for a key the table doesn't name (the grey land modal
 *  `c`) or whose gains are 1 (the artifact stand-in), no strip tone for a
 *  key with none (w, within the prints' spread). */
export function mdfcBackTones(key, table = MDFC_BACK_TONES) {
  const t = table[key];
  if (!t) return [];
  const tones = [
    { mask: MODAL_MASK.title, gain: t.bars, lumaRamp: [...DFC_BACK_TONE_LUMA_RAMP], region: "title bar + housing" },
    { mask: MODAL_MASK.type, gain: t.bars, lumaRamp: [...DFC_BACK_TONE_LUMA_RAMP], region: "type bar" },
    { mask: MODAL_MASK.rules, gain: t.box, lumaRamp: [...DFC_BACK_TONE_LUMA_RAMP], region: "text box" },
    ...(t.strip !== undefined ? [{ mask: MODAL_MASK.reminder, gain: t.strip, lumaRamp: [...DFC_BACK_TONE_LUMA_RAMP], region: "flipside strip" }] : []),
  ];
  return tones.filter((tone) => tone.gain !== 1);
}

/** How provenance describes a modal back's tone pass. */
function mdfcBackToneTransform(table) {
  const name = table === MDFC_LAND_BACK_TONES ? "MDFC_LAND_BACK_TONES" : "MDFC_BACK_TONES";
  return `then the title bar and the housing's fill (through ${MODAL_MASK.title}), the type bar (through ${MODAL_MASK.type}), the text box (through ${MODAL_MASK.rules}) and — on u, b, r, g and m (TODO 5.1d) — the whole flipside strip (through ${MODAL_MASK.reminder}: the tab, its ◀ and its outline, which a multiplier keeps dark) have their colour multiplied by the key's gain (${name}: bars / box / strip per colour), fading to ×1 between luma ${DFC_BACK_TONE_LUMA_RAMP[0]} and ${DFC_BACK_TONE_LUMA_RAMP[1]} so the white ▲▼ and the light rims keep CC's tone; the frame body, the pinline and the plates untouched`;
}

/** How provenance describes the land pair's recipe. */
const MODAL_LAND_TRANSFORM = (front) =>
  `native 1500x2100 (the modal master's size): CC's modal ${front ? "front" : "back"} copied 1:1, then its frame body${front ? " and its text box" : ""} REPLACED (a premultiplied lerp by the mask's alpha) through the pack's ${MODAL_MASK.frame}${front ? ` and ${MODAL_MASK.rules}` : ""} by the 2015 coloured land tint (m15/new/l<k>.png, 2010x2814 resized to 1500x2100 with Lanczos — the m15land masters' own downscale); corners rounded to the importer radius`;

const MDFC_FRONT_NOTES = [
  "source: CC 'Modal Regular' (packModalRegular.js, groupModal-1.js): the M15 frame with the drop-shaped icon HOUSING at the left of the name bar (a white fill, its ring, the black ▲ — tip x 41, circle to 201, rows 97–236 at HD; the prints' 44 / 198–205 / 98–236, within 3 px), the dark flipside STRIP at the bottom left in the colour's tone (x 64–690 × y 1866–1948 with its ◀; the prints' 64–681..694 × 1861..1866–1948, 6–10 luma lighter than theirs) and the strip's box cut into the text box's paper — all the master's; only the strip's two texts are drawn (the profile's `flipside` slots: the other face's last type word in Beleren Bold from CC's box at 6.8 %W, its cost or mana line in the rules font ending at 43.2 %W)",
  "the name starts at 16.7 %W (prints 247–252 px: ZNR #12, KHM #15, STX #147's back, ZNR #258; CC's pack says 0.1614 = 242) — the profile's title inset (the transform bodies' DFC_ICON_FACE_TITLE_LEFT_PCT), not a pixel of the master (design D5)",
  "colourless `c` = the pack's 'Artifact Frame' (a.png) as a RENDER STAND-IN (design D2): ticked against STX #154 Pestilent Cauldron, the one colourless modal face printed on the plain 2015 frame, and offered only to a face whose type line says Artifact (colorlessFaceAllowed)",
  "P/T plate = M15's (m15/pt/<k>.png): the pack draws CC's m15PT<K>.png at M15's bounds",
  "the strip is painted in the MASTER's colour: on a two-colour modal card the prints paint it in the colour of the face it DESCRIBES (STX #147's green front carries a blue strip, the pathways their back's) — an owner question of the 5.1b review, left as the masters paint it (TODO 5.1c); on a pair master the gold m.png's strip (split) or the two colour fronts' strips lerped across the frame ramp (hybrid)",
  "the legendary crown (TODO 5.1d): the m15mdfccrown overlay (our m15crown band cut through CC's modal crown twin's alpha around the housing); the two-colour PAIR masters (5.1d / 5.12): 4.6b's recipe over this pack's files and masks — the split dress m.png whole with the box and the pinline lerped from the two colour fronts (STX #149 Extus W|B, MSH #219 King T'Challa W|U print it), the hybrid dress the two fronts lerped across the frame ramp under CC's grey Land frame's bars (l.png through the Title and Type masks: the housing's fill is the Title mask's) with the split box and pinline (MH3 #252–261's ten hybrid fronts print it; the grey plate pt/c)",
];

const MDFC_BACK_NOTES = [
  "source: CC 'Modal Regular' backs (<k>b.png): the M15 frame with DARK title and type bars (white name and type ink), the housing in the bar's tone with the white ▲▼, a greyed text box (dark rules ink), and the LIGHT flipside strip (its ◀ dark) — the prints' back strip is light with DARK text (CC's pack says white: ours follows the print)",
  "toned onto the prints before the first tick (MDFC_BACK_TONES, design D1): CC's bars read 3–16 luma light on w u b g m and 16 dark on r, its boxes 5–18 off; per-key gains through the pack's Title / Type / Rules masks, the white ▲▼ and the light rims kept by a luma ramp; the body, the pinline and the strip untouched; the artifact back untoned (no colourless modal back was printed)",
  "P/T plates = the transform pack's dark `pt<K>.png` as m15dfcback/pt/<k>.png (MSH #18 She-Hulk's gold plate reads 117 against ptM's 123): the profile draws that set, no plates of its own",
  "a cost prints as on any card (the profile's hideCost is off: KHM / STX / MSH backs carry one); no colour indicator (no modal back prints one)",
  "colourless `c` = the pack's 'Artifact Frame' back (ab.png) as a RENDER STAND-IN with no reference: every artifact modal back printed is a coloured artifact (KHM #15 Sword of the Realms white, KHM #112 Tergrid's Lantern black), drawn on its colour's body in wave 1",
  "the strip toned onto the prints (TODO 5.1d, the 5.1b skeptic's finding): CC's light tab reads 12–44 luma darker than the prints' on u b r g and 38 on the gold back — a gain through the pack's Flipside mask (the whole tab: the ◀ and the outline stay dark), the spell backs on STX #147 / #148 + KHM #112 / #159 / #151 and KHM #168's gold back, the land backs on MH3 #241, ZNR #90 / #134 + MH3 #246 / #189; w within the prints' spread, untouched; the KHM scans read 5–13 lighter than STX's on every key (u KHM #40 242 vs STX #147 220, r KHM #123 237 vs STX #159 230, g KHM #181 234 vs STX #151 229, b KHM #112 219 vs STX #148 223): the fitted targets sit on STX, with b on both",
  "the legendary crown (TODO 5.1d): the m15mdfccrown overlay, as on the front; the two-colour PAIR masters (5.1d): the prints split a two-colour modal BACK's rings and box over the gold bars (STX #149's B|R back, MSH #18 / #219 / #23 / #49 / #80's crowned gold-barred pair backs), so the split recipe over this pack's back files: mb.png whole, the box and the pinline lerped from the two colour backs, the gold bars and strip at m's gains and the box at the two colours' box gains lerped across the rules ramp (dfcPairBackTones)",
];

const MDFC_LAND_NOTES = (front) => [
  `a PipGlyph recipe (no CC coloured modal land exists; design frames.md §4.4): the colour's modal ${front ? "front" : "back"} with its frame body${front ? " and text box" : ""} replaced through the pack's own masks by the 2015 coloured land tint (m15/new/l<k>.png — the m15land masters' file, the same Lanczos downscale) — ${front ? "the pathways print the stone land body, the colour's pinline, the land tint's box and the modal housing and strip (ZNR #258–261, KHM #252)" : "the land backs print the stone land body under the colour's dark bars and housing, the modal back's light box (ZNR #12 / #90 / #134 / #189: a neutral light box; MH3 #241 a bluer one) and light strip"}; the housing, its ring, the pinline and the strip are the modal master's pixels`,
  "keys w u b r g from the five land tints, m the gold land tint under the gold modal pieces (a stand-in: no gold modal land was printed), c = CC's grey land modal (l.png / lb.png) as it is (a stand-in: no colourless modal land was printed) — c and m are never offered (no reference)",
  "no cost (hideCost) and no P/T (a land face prints none)",
];

// ---------------------------------------------------------------------------
// The two-colour PAIR masters of the double-faced bodies (TODO 5.1d / 5.12):
// 4.6b's recipe (twoColorRecipe, kind "m15") over each body's OWN pack files
// and masks — the gold frame whole, the text box lerped across the rules
// ramp (45→57 %W) through the pack's Rules mask, the pinline lerped across
// the pinline ramp (40→60) through the pack's Pinline mask; the hybrid dress
// (the modal front only: MH3 #252–261 print it) the two colour fronts lerped
// across the frame ramp (44→57) under CC's grey Land frame's bars. Measured
// on the prints (scratchpad dfc-1d/research/pairs.json, per-row crossings of
// the title ring at HD): the 2023+ printings split at 40→60 (LCI #233
// 41.7 / 49.5 / 57.4; MH3's hybrids 41–43 / 49–52 / 58–60, their frame
// band 46–49 / 50–54 / 55–57), the Innistrad-era ones (MID #218 / #231,
// INR #241) narrower, 45.5 / 51 / 56 — the one 40→60 ramp of 4.6b serves
// every pair master (the FDN / TLA prints' 42 / 50 / 58), within 4 %W of
// Innistrad's. The BACKS print the split dress too (the design's "gold
// backs never split" was wrong: MOM #43's G|W back reads 44,74,47 →
// 133,135,129 across the title ring, MID #218's W|U, MID #246's R|G, EMN
// #191's R|G and STX #149's B|R the same, each with a gold bar), with a
// gold crown? No — the split crown (MID #246's back: a red leg and a green
// leg): so the transform and modal spell backs build the split dress over
// their back files, toned like their mono backs — the gold bars (and the
// modal strip) at m's gains, the lerped box at the two colours' box gains
// lerped across the same ramp (dfcPairBackTones; toneMasked's ramped gain).
// No pair on a land body (a land face has no colour pair in print; the
// pathways and the MH3 land backs are mono) and no hybrid dress on the
// transform front (no hybrid-cost transform front was printed on the 2015
// frame) or on a back (MH3's hybrid fronts have land backs).
// ---------------------------------------------------------------------------

/** A transform pack letter → its file: a colour, "m" (frontM / backM),
 *  "a" (the artifact frame) or "l" (the land frame). */
const transformPairFile = (prefix) => (letter) => transformFrame(prefix, letter);
/** The modal pack's letter → its file (`l` = the pack's grey Land frame). */
const modalPairFile = (back) => (letter) => modalFrame(letter, back);

/** The five bodies that build pair masters: each its pack's files
 *  (`fileOf`) and masks, the dresses, and — on a back — its tone table and
 *  Title mask. */
export const DFC_PAIR_BODIES = Object.freeze({
  m15dfcfront: {
    fileOf: transformPairFile("front"),
    masks: { rules: TRANSFORM_MASK.frontRules, pinline: `${TRANSFORM}/maskPinlineFront.png`, title: TRANSFORM_MASK.frontTitle, type: TRANSFORM_MASK.type },
    dresses: ["split"],
  },
  m15dfcback: {
    fileOf: transformPairFile("new/back"),
    masks: { rules: TRANSFORM_MASK.rules, pinline: `${TRANSFORM}/new/maskPinlineBack.png`, title: TRANSFORM_MASK.newBackTitle, type: TRANSFORM_MASK.type },
    dresses: ["split"],
    back: { tones: DFC_BACK_TONES, titleMask: TRANSFORM_MASK.newBackTitle, typeMask: TRANSFORM_MASK.type, rulesMask: TRANSFORM_MASK.rules },
  },
  m15dfcbackleft: {
    fileOf: transformPairFile("back"),
    masks: { rules: TRANSFORM_MASK.rules, pinline: `${TRANSFORM}/maskPinlineBack.png`, title: TRANSFORM_MASK.backTitle, type: TRANSFORM_MASK.type },
    dresses: ["split"],
    back: { tones: DFC_BACK_TONES, titleMask: TRANSFORM_MASK.backTitle, typeMask: TRANSFORM_MASK.type, rulesMask: TRANSFORM_MASK.rules },
  },
  m15mdfcfront: {
    fileOf: modalPairFile(false),
    masks: { rules: MODAL_MASK.rules, pinline: MODAL_MASK.pinline, title: MODAL_MASK.title, type: MODAL_MASK.type },
    dresses: ["split", "hybrid"],
  },
  m15mdfcback: {
    fileOf: modalPairFile(true),
    masks: { rules: MODAL_MASK.rules, pinline: MODAL_MASK.pinline, title: MODAL_MASK.title, type: MODAL_MASK.type },
    dresses: ["split"],
    back: { tones: MDFC_BACK_TONES, titleMask: MODAL_MASK.title, typeMask: MODAL_MASK.type, rulesMask: MODAL_MASK.rules, stripMask: MODAL_MASK.reminder },
  },
});

/** The layers of one pair master of a double-faced body: 4.6b's "m15"
 *  recipe over the body's pack (pairMasterLayers with its files and masks).
 *  Keys: `<pair>` (split), `<pair>-h` (hybrid, the modal front). */
export function dfcPairLayers(body, pair, dress) {
  const def = DFC_PAIR_BODIES[body];
  if (!def) throw new Error(`dfcPairLayers: ${body} builds no pair masters`);
  if (!def.dresses.includes(dress)) throw new Error(`dfcPairLayers: ${body} builds no ${dress} dress`);
  return pairMasterLayers(pair, dress, "m15", def.fileOf, def.masks);
}

/** A body's pair masters, `{ wu: layers, …, "wu-h": layers, … }`. */
function dfcPairMasters(body) {
  return pairMasters("m15", DFC_PAIR_BODIES[body].dresses, (pair, dress) => dfcPairLayers(body, pair, dress));
}

/** The pair's two colour letters of a pair master key (`wu` or `wu-h`),
 *  or null for any other key. */
export function pairOfMasterKey(key) {
  const pair = key.endsWith("-h") ? key.slice(0, -2) : key;
  return TWO_COLOR_PAIRS.includes(pair) ? pair.split("") : null;
}

/** A pair BACK's tones: the gold bars (and, on the modal back, the strip)
 *  at m's gains — they are backM's own pixels — and the lerped text box at
 *  the two colours' box gains lerped across the rules ramp (the box under
 *  it is lerped across the same ramp), through the body's masks. */
export function dfcPairBackTones(body, pair) {
  const def = DFC_PAIR_BODIES[body]?.back;
  if (!def) throw new Error(`dfcPairBackTones: ${body} is no back body with pair masters`);
  const [a, b] = pairSidesOf(pair);
  const m = def.tones.m;
  const ramp = [...DFC_BACK_TONE_LUMA_RAMP];
  return [
    { mask: def.titleMask, gain: m.bars, lumaRamp: ramp, region: def.stripMask ? "title bar + housing" : "title bar" },
    { mask: def.typeMask, gain: m.bars, lumaRamp: ramp, region: "type bar" },
    { mask: def.rulesMask, gain: { left: def.tones[a].box, right: def.tones[b].box, ramp: [...PAIR_RAMPS.rules] }, lumaRamp: ramp, region: "text box" },
    ...(def.stripMask && m.strip !== undefined ? [{ mask: def.stripMask, gain: m.strip, lumaRamp: ramp, region: "flipside strip" }] : []),
  ].filter((tone) => tone.gain !== 1);
}

function pairSidesOf(pair) {
  if (!TWO_COLOR_PAIRS.includes(pair)) throw new Error(`not a pair in printed order: ${pair}`);
  return pair.split("");
}

/** A back body's tones for ANY key: a pair's (dfcPairBackTones) or the
 *  colour's (`monoTones`). */
function dfcBackTonesFor(body, monoTones) {
  return (key) => {
    const pair = pairOfMasterKey(key);
    return pair ? dfcPairBackTones(body, pair.join("")) : monoTones(key);
  };
}

// ---------------------------------------------------------------------------
// The flipside strip RIDERS of the modal bodies (TODO 5.1c): on a two-colour
// modal card the prints paint the strip in the colour of the face it
// DESCRIBES — STX #147's green front carries a blue strip for Echoing
// Equation, the pathways' fronts their back's colour, KHM #114 Valki's front
// the B/R back's gold — while every master paints it in its OWN colour. So
// each modal template publishes its masters' tabs as PIECES, `<template>/
// strip/<key>.png`: the tab of the key's master (the exact bytes the bucket
// serves — a mono-colour card's rider is its own master's tab, which is why
// the renderers draw a rider only when the other face's key differs) cut
// through CC's Flipside mask (`reminder.svg`, the whole tab from the
// border's inner edge to the chevron's tip, so the ◀ and the outline stay
// dark) — the mask's full-alpha interior, ERODED by one pixel so the cut runs
// inside the tab's 4-px dark outline (a cross-colour rider then meets this
// master's own outline on both sides of the cut: the outermost ring of the
// tab is luma 0 on every master, so the seam is black on black), and then
// SNAPPED to the 2 × 2 pixel blocks of the HD grid (a block is kept whole
// when every pixel of it is inside the eroded interior, else dropped —
// `snapToBlocks`, `stripRiderInterior`): the 750 px bake's 2:1 resample
// reads exactly one block per pixel, so the piece's alpha lands 0 / 255
// there too and a piece drawn over its own master is byte-identical at HD
// AND at 750 (measured through the bake's rasteriser on all 28 own-key
// pieces: 0 px at both; the un-snapped eroded cut was 1–6 px at ≤ 7 levels
// at 750 on the chevron's diagonals, the plain mask's cut 35 px at ≤ 45).
// The snapped cut's edge stays in the outline (its opaque edge pixels luma
// ≤ 12, their clear neighbours ≤ 1 — the fill is never reached: eroding by
// three or more would). The piece's box is x 44–701 × y 1866–1955 at HD
// (the mask's bbox 45–701 × 1866–1955 grown to an even origin and size, so
// the slot maps 1:1 at HD and 2:1 at 750, and the blocks stay aligned).
// Keys: a template's own colour keys, plus `l` on the SPELL bodies — the
// grey land modal's tab (`l.png` / `lb.png`, the land pair's `c` master byte
// for byte) for a two-colour LAND other face (MH3 #252–261's ten hybrid
// fronts print it: 113,99,88, the land grey) and, on a back, for a front in
// the hybrid dress (MH3's land backs: 218,210,206, a warm light grey, never
// gold); the land bodies map `l` to their own `c`. The pieces are cut from
// PUBLISHED masters (this run's own output first, else a local copy at the
// manifest's sha256) after the template loop, like the cut crowns.
// ---------------------------------------------------------------------------

/** The piece's box at HD (even origin and size; the mask's bbox grown). */
export const MDFC_STRIP_BOX = Object.freeze({ x: 44, y: 1866, width: 658, height: 90 });
/** The cut runs this many px inside the mask's full-alpha interior. */
export const MDFC_STRIP_ERODE_PX = 1;
/** The cut is then snapped to blocks this many px square on the HD grid
 *  (2 = the 750 bake's 2:1 resample reads one block per pixel). */
export const MDFC_STRIP_SNAP_PX = 2;
const MDFC_STRIP_SPELL_KEYS = Object.freeze(["w", "u", "b", "r", "g", "m", "a"]);
const MDFC_STRIP_LAND_KEYS = Object.freeze(["w", "u", "b", "r", "g", "m", "c"]);
/** A template's strip spec: the mask, the box, the erosion, its own keys and
 *  the extra keys cut from ANOTHER published master (`l` from the land
 *  pair's grey `c`). */
function mdfcStripCut(keys, extra) {
  return Object.freeze({ mask: MODAL_MASK.reminder, box: MDFC_STRIP_BOX, erode: MDFC_STRIP_ERODE_PX, snap: MDFC_STRIP_SNAP_PX, keys, ...(extra ? { extra: Object.freeze(extra) } : {}) });
}
export const MDFC_STRIP_CUTS = Object.freeze({
  m15mdfcfront: mdfcStripCut(MDFC_STRIP_SPELL_KEYS, { l: "m15mdfclandfront/c" }),
  m15mdfcback: mdfcStripCut(MDFC_STRIP_SPELL_KEYS, { l: "m15mdfclandback/c" }),
  m15mdfclandfront: mdfcStripCut(MDFC_STRIP_LAND_KEYS),
  m15mdfclandback: mdfcStripCut(MDFC_STRIP_LAND_KEYS),
});

/** Every key a template's strip spec publishes: its own, then the extras. */
export function stripRiderKeys(spec) {
  return [...spec.keys, ...Object.keys(spec.extra ?? {})];
}
/** The published master a strip piece is cut from (`<template>/<key>`). */
export function stripRiderSourceOf(template, key, spec) {
  if (spec.keys.includes(key)) return `${template}/${key}`;
  const extra = spec.extra?.[key];
  if (!extra) throw new Error(`stripRiderSourceOf: ${template} publishes no strip piece ${key}`);
  return extra;
}
/** How provenance prints one strip piece's recipe. */
export function describeStripRider(template, key, spec, sha) {
  return [
    `${stripRiderSourceOf(template, key, spec)}.png (the published master, sha256 ${sha.slice(0, 12)}) cut at x ${spec.box.x}–${spec.box.x + spec.box.width - 1} × y ${spec.box.y}–${spec.box.y + spec.box.height - 1} through the full-alpha interior of ${spec.mask} eroded by ${spec.erode} px and snapped to ${spec.snap} × ${spec.snap} px blocks of the HD grid (the tab's own colour, alpha 255 inside the cut, 0 outside — never a partial pixel, and none at the 750 bake either)`,
  ];
}

// ---------------------------------------------------------------------------
// The adventure's spell PAGE in the spell's own colour (TODO 4.26, owner
// decision 2026-10-22: pre-cut pieces). The storybook's LEFT page — its name
// bar, type bar, paper, curled edge and the left half of the spine — prints
// in the SPELL's colour and the right page in the creature's: WOE #221
// Callous Sell-Sword // Burn Together is a red page beside a black frame; of
// the plain 2015-frame adventure printings, every one whose spell is another
// colour is a mono spell beside a mono (or colourless) creature (WOE #221–241,
// LCI #231, the WOE / LCI promos; the colourless artifacts HOB #170 / #174 /
// #176 and FIN's Towns #283–293, on the `c` master — CC's artifact frame,
// verified; TDM's Omens, whose page is their own, draw it too, unmeasured). Card Conjurer paints it by drawing the spell's frame
// through the pack's `bookLeft` mask over the creature's; we publish that
// cut as PIECES, `adventure/page/<key>.png`: each key's PUBLISHED master
// (the bytes the bucket serves) cropped to the mask's box, its alpha the
// mask's (bookLeft is native 1500 × 2100: no resample) — the colour the
// master's everywhere, so a piece over its own master is that master. The
// renderers draw it through the `partPage` overlay slot Prepare's page uses
// (lib/cards/template-layout.ts ADVENTURE_PAGE), keyed by the spell's
// colour, only where it differs from the creature's: no new renderer code,
// no mask published, nothing composited at render.
//   • Keys: the five colours and gold `m` (a gold spell's page: WOE #220
//     Beluna prints the gold master's own page). The two-colour PAIR pages
//     CC builds with `bookLeftMulticolor` (the first colour's page ramped
//     into the second's, x ≈ 360 → 560) are NOT built: no adventure prints
//     a two-colour spell page beside a creature of other colours — the
//     two-colour spells (MKM #212, MH3 #196, ELD #212's hybrid, HOB #166)
//     sit on creatures of the same pair, whose master already paints the
//     page — so the slot maps a pair to the gold page (keyMap). No
//     colourless PAGE: no adventure SPELL is colourless (a colourless
//     creature with a coloured spell takes that colour's page).
//   • The box: the mask's alpha reaches x 73–752 × y 1313–1937; the piece is
//     x 72–753 × y 1312–1937 (an even origin and size: whole px at the 750
//     bake), every px of the mask inside it.
// ---------------------------------------------------------------------------

/** The page piece's box at HD (even origin and size; the mask's bbox grown). */
export const ADVENTURE_PAGE_BOX = Object.freeze({ x: 72, y: 1312, width: 682, height: 626 });
/** The keys the page publishes. */
export const ADVENTURE_PAGE_KEYS = Object.freeze(["w", "u", "b", "r", "g", "m"]);
/** The adventure template's page spec (CC_TEMPLATES.adventure.page). */
export const ADVENTURE_PAGE_CUT = Object.freeze({
  mask: `${ADVENTURE}/bookLeft.png`,
  box: ADVENTURE_PAGE_BOX,
  keys: ADVENTURE_PAGE_KEYS,
  /** CC's two-colour page mask — read by no recipe (no print shows a pair
   *  page beside a creature of other colours); kept as provenance. */
  unused: Object.freeze({ bookLeftMulticolor: `${ADVENTURE}/bookLeftMulticolor.png` }),
});

/** How provenance prints one page piece's recipe. */
export function describeAdventurePage(template, key, spec, sha) {
  const { box } = spec;
  return [
    `${template}/${key}.png (the published master, sha256 ${sha.slice(0, 12)}) cut at x ${box.x}–${box.x + box.width - 1} × y ${box.y}–${box.y + box.height - 1} through the alpha of ${spec.mask} (native 1500 × 2100; the master's colour on every px, alpha × the mask's)`,
  ];
}

/**
 * What a cut page piece must be (TODO 4.26): every px of the mask's alpha
 * inside the box (none of the page cut off), the piece's alpha the mask's
 * times the master's, and its colour the master's wherever it shows.
 * `master` and `mask` are raw 8-bit RGBA at width × height; returns the
 * counts and the failures.
 */
export function adventurePageFindings(piece, master, mask, width, height, box) {
  let opaque = 0;
  let partial = 0;
  let alphaOff = 0;
  let colourOff = 0;
  let maskOutsideBox = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const inBox = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
      if (!inBox) {
        if (mask[p + 3] > 0) maskOutsideBox += 1;
        continue;
      }
      const o = ((y - box.y) * box.width + (x - box.x)) * 4;
      const want = Math.round((master[p + 3] * mask[p + 3]) / 255);
      if (piece[o + 3] !== want) alphaOff += 1;
      if (piece[o + 3] === 255) opaque += 1;
      else if (piece[o + 3] > 0) partial += 1;
      if (piece[o + 3] > 0 && (piece[o] !== master[p] || piece[o + 1] !== master[p + 1] || piece[o + 2] !== master[p + 2])) colourOff += 1;
    }
  }
  const failures = [];
  if (maskOutsideBox > 0) failures.push(`${maskOutsideBox} px of the mask fall outside the box`);
  if (alphaOff > 0) failures.push(`${alphaOff} px whose alpha is not the mask's × the master's`);
  if (colourOff > 0) failures.push(`${colourOff} px whose colour is not the master's`);
  if (opaque === 0) failures.push("the piece is empty");
  return { opaque, partial, alphaOff, colourOff, maskOutsideBox, failures };
}

const MDFC_STRIP_NOTE =
  "the flipside strip RIDERS (TODO 5.1c, strip/<key>.png): this template's masters' tabs cut through CC's Flipside mask (reminder.svg, the whole tab — the ◀ and the outline stay dark), eroded 1 px so the cut runs inside the tab's dark outline and snapped to the HD grid's 2 × 2 px blocks so the 750 bake's 2:1 resample reads whole blocks (a piece over its own master is byte-identical at HD and at 750); drawn by both renderers over the strip the master paints, keyed by the OTHER face's colour (the prints paint the strip in the colour of the face it describes: STX #147, the pathways, KHM #114), only when that key differs from the master's own; `l` = the grey land modal's tab (the land pair's c master) for a two-colour land other face (MH3 #252–261's hybrid fronts) and, on a back, a front in the hybrid dress";

const DFC_PAIR_NOTE =
  "two-colour pair masters (TODO 5.1d / 5.12): 4.6b's recipe over this body's own Card Conjurer pack files and masks — the gold frame whole, the text box lerped across the UNTILTED rules ramp (45→57 %W) through the pack's Rules mask, the pinline across the pinline ramp (40→60) through the pack's Pinline mask, by a premultiplied lerp (scripts/lib/pair-ramp.mjs), first canonical colour on the left (WU WB UB UR BR BG RG RW GW GU); measured on the prints' title rings (per-row crossings at HD): LCI #233 41.7 / 49.5 / 57.4, MH3 #252 42.2 / 51.9 / 59.7, the Innistrad printings (MID #218 / #231, INR #241) 45.5 / 51 / 56 — the 40→60 ramp of the FDN / TLA prints serves every DFC face";

/**
 * template → { colors: colour → layers, finish?, plates?, symbols?, shield?,
 * plateTone?, ptCut?, pieces?, maskInputs?, recut?, recutUp?, bridge?, tones?, excluded?,
 * orientation?, transform?, shift?, halfMasks?, paintedShield?, pack?,
 * transforms?, notes }.
 * `finish` composites PipGlyph layers over each flattened composite, before
 * any re-cut (compositeFinish; the full-art tokens' type pill darkened and
 * solid, the artifact name pill's slate made solid, owner decisions
 * 2026-09-29); an entry with `colors` applies to those colour keys only
 * (finishFor).
 * `plates` are written at native size to <template>/pt/<colour>.png;
 * `symbols` (a basic land's mana-symbol disc, TODO 3.24) the same way to
 * <template>/symbol/<colour>.png, for the colours listed only.
 * `shield` cuts part of each built master out through a mask (its alpha)
 * into <template>/loyalty/<colour>.png, cropped to `box`.
 * `ptCut` (4.21a's flip) draws a pack's two-plate P/T image at `bounds` on
 * the card and cuts it through each named mask into its `boxes` entry:
 * <template>/pt/<colour>-<name>.png, one plate per creature half.
 * `recut` moves a band of each composite down before the downscale
 * (recutBand; the textless tokens, TOKEN_TEXTLESS_RECUT; the text-box
 * tokens, TOKEN_REGULAR_RECUT); `recutUp` moves a block UP in two pieces
 * (recutBlockUp; the flip masters' lower half, FLIP_LOWER_RECUT).
 * `bridge` closes the frame over the top of a clear ray (bridgeRayTip; the
 * emblem's spark, EMBLEM_RAY_BRIDGE), after any re-cut.
 * `tones` multiply regions of each composite by print-fitted gains, in
 * order, before the downscale (applyTone: toneSilver for the emblem's
 * silver, EMBLEM_SILVER_TONE; toneRegion for an outlined region — its name
 * pill, type pill and text box, EMBLEM_NAME_PILL_TONE, EMBLEM_TYPE_PILL_TONE,
 * EMBLEM_TEXT_BOX_TONE).
 * `orientation: "landscape"` (4.21b's split and battle) writes 2100×1500
 * masters (outputSizeOf), by its `transform`: "rotate-cw" turns the
 * composite a quarter turn clockwise without resampling (rotateCwRgba8; the
 * pack draws the card portrait), "downscale" resizes the pack's landscape
 * canvas once. `shift` then moves whole blocks of the 2100×1500 master
 * through the flat zones between them, onto the prints (shiftBlocksRgba8:
 * SPLIT_HALF_RECUT, BATTLE_BLOCK_RECUT) — before the corner is cut.
 * `halfMasks` (split) names the pack's two half masks for the
 * half each covers after the turn and the seam between them: importer
 * inputs the importer checks and records, never published. `paintedShield`
 * (battle) names the pack's Defense mask and the box of the shield the
 * master paints: checked and recorded, never published (BATTLE_SHIELD).
 * `printRecut` (battle, TODO 4.21d) re-cuts what no block move reaches,
 * after the shift and before the corner: the bars' right ends stretched,
 * the shield set right through its mask, the icon's rings redrawn
 * (recutBattleOntoPrints: BATTLE_RIGHT_RECUT, BATTLE_ICON_RECUT).
 * `pieces` (4.21c's saga: its chapter badge and row divider) are a pack's
 * own bitmaps written at native size to <template>/<name>.png; `maskInputs`
 * are pack masks RECORDED for a later recipe (the two-colour saga's pair
 * masters, TODO 4.6f) — fetched into the cache, listed in provenance, never
 * written to the build folder.
 * `excluded` colours are NOT built: the template keeps its current master
 * for them. `pack` / `transforms` name the CC pack and what was done to its
 * pixels (recorded in provenance). `notes` records every substitution, so
 * provenance says why a colour is not a 1:1 Card Conjurer file.
 */
// ---------------------------------------------------------------------------
// TODO 4.10a (layout v46): the 1997 frame — `retro`, `retroland` — on the
// ORIGINAL cards of 1996–2003 (owner 2026-10-07, round 38). Seven keys are
// Card Conjurer's "Seventh Edition" drawing (packSeventh.js: sharp 2 px
// lines, one geometry for every colour), which as drawn carries the 2021+
// REPRINTS' colours (white frame 215 luma against the originals' 157) on a
// frame 5 px off centre with a text box 8–9 px short — so each master is
// RE-CUT edge by edge onto the prints (a piecewise-linear map per axis; the
// text box's anchors are per colour, the prints' boxes differ) and TONED
// region by region onto the prints' medians (mean and contrast in the frame
// body and the text box, a per-channel gain per bevel side): the steps are
// scripts/lib/print-cut.mjs, the numbers scripts/lib/seventh-1997.mjs.
// GOLD keeps today's MSE artwork (Card Conjurer's gold failed the eye: less
// detail than MSE's, twice the prints' contrast, violet bevels), cut edge by
// edge with the same map so its window and frame box are the other seven's;
// it is not toned (MSE's gold is the prints' colour, ΔE 2.6).
// ---------------------------------------------------------------------------
const SEVENTH = "img/frames/seventh/regular";
/** A source that is a file of THIS repo, not of Card Conjurer's: the MSE
 *  gold master the 1997 gold frame is cut from (the importer reads it from
 *  the checkout; it is MSE-derived, so it may live in git). */
export const REPO_SOURCE_PREFIX = "repo:";
export const RETRO_GOLD_MSE = `${REPO_SOURCE_PREFIX}scripts/frame-inputs/retro-m-mse.png`;
/** How far into the MSE gold's art ring the white window's fade reaches
 *  (grey 85 → 112 → 153 → 208 → 236 on the last five px; the ring's own
 *  inner shadow is 30–45): cleared by clearWindowHalo. */
export const RETRO_GOLD_WINDOW_HALO_PX = 6;
/** The pack's Pinline mask: a land's coloured rings (NOT the bevels). */
const SEVENTH_RINGS_MASK = `${SEVENTH}/pinline.svg`;

/** Which Seventh recipe (a key of SEVENTH_TONES / SEVENTH_TEXT_BOX) builds
 *  a template's colour key; null = the MSE gold. */
export const SEVENTH_RECIPE_OF = Object.freeze({
  retro: Object.freeze({ w: "w", u: "u", b: "b", r: "r", g: "g", c: "a", m: null }),
  retroland: Object.freeze({ w: "wl", u: "ul", b: "bl", r: "rl", g: "gl", c: "l", m: "ml" }),
});

/** A 1997 master's print recipe (the importer's `printRecipe`): the re-cut,
 *  and — but for the MSE gold — the region tones, whether the text box is
 *  cut by colour and the mask of a land's rings. */
export function seventhPrintRecipe(template, key, { cutOf = key } = {}) {
  const recipe = SEVENTH_RECIPE_OF[template]?.[key];
  if (recipe === undefined) throw new Error(`seventhPrintRecipe: ${template}/${key} is no 1997 master`);
  // A two-colour land's side (TODO 4.6h): the key's own drawing and tones on
  // ANOTHER key's cut — the plain land's, whose box the dual lands print.
  const cutRecipe = SEVENTH_RECIPE_OF[template]?.[cutOf];
  if (cutOf !== key && (cutRecipe === undefined || cutRecipe === null || recipe === null)) {
    throw new Error(`seventhPrintRecipe: ${template}/${key} can't take the cut of ${cutOf}`);
  }
  // The MSE master's corners are already cut: flattened onto black first.
  // …and its art window was cut out of a white rectangle on a 375 px JPEG:
  // the grey → white fade that leaves on the ring's last px is cleared.
  if (recipe === null) return { cut: retroGoldCut(), squareCorners: true, windowHalo: RETRO_GOLD_WINDOW_HALO_PX };
  return {
    cut: seventhCut(cutOf === key ? recipe : cutRecipe),
    tones: SEVENTH_TONES[recipe],
    byColour: SEVENTH_BOX_BY_COLOUR.includes(recipe),
    ...(template === "retroland" ? { rings: SEVENTH_RINGS_MASK } : {}),
  };
}

/** How provenance records a print recipe. */
export function describePrintRecipe(recipe) {
  const range = (anchors) => {
    const { min, max } = stretchRange(anchors);
    return `${min.toFixed(3)}–${max.toFixed(3)}`;
  };
  return {
    cut: {
      ...recipe.cut,
      localStretch: { y: range(recipe.cut.y), xUpper: range(recipe.cut.xUpper), xLower: range(recipe.cut.xLower) },
    },
    ...(recipe.tones ? { tones: describeRegionTones(recipe.tones) } : {}),
    ...(recipe.squareCorners ? { corners: "the source's cut corners flattened onto black before the re-cut" } : {}),
    ...(recipe.windowHalo ? { windowHalo: `the last ${recipe.windowHalo} px of the art ring take the ring's colour ${recipe.windowHalo + 1} px out (the white window's fade on the JPEG source); alpha untouched` } : {}),
    ...(recipe.byColour ? { textBox: "cut by colour (no drawn outline), no trim ring" } : {}),
    ...(recipe.rings ? { rings: `${recipe.rings} = region "pin"` } : {}),
    ...(recipe.regionMasks ? { regions: Object.fromEntries(Object.entries(recipe.regionMasks).map(([name, rel]) => [name, `${rel} (moved with the cut)`])) } : {}),
  };
}

const SEVENTH_TRANSFORM =
  "native 1500x2100; re-cut onto the 1996–2003 prints edge by edge (printRecipe.cut: one piecewise-linear map per axis through [source px, print px] anchors — outer frame, art window, text box; the art rows' and the text-box rows' column maps lerped across the type band; Catmull-Rom, premultiplied, one resample), then toned region by region (printRecipe.tones: (in − from) × k + to per channel in the frame body and the text box, × to ÷ from per side of the outer bevel, the art bevel and the text box's trim; regions cut from the drawing's own lines and moved with the same map); corners rounded to the importer radius";
const SEVENTH_NOTES = [
  "the ORIGINAL cards (Mirage 1996 → Scourge 2003), not the 2021+ reprints whose colours the pack carries (owner 2026-10-07); every constant read off the prints once: outer frame and art window on 21 white prints, each colour's text box and tones on the per-pixel median of its prints (9 sets; white 21; the basic lands 7) — no scan is read by the build",
  "known drawing caveats the owner accepted (round 38): blue is a flat-shaded redraw (hard-edged shapes where the print has brushwork), green's plank has no grain, black's parchment keeps a burnt rim",
];

// ---------------------------------------------------------------------------
// TODO 4.10b: the 2003 frame — `modern`, `modernland` — on the prints of the
// frame's LATER drawing (Champions of Kamigawa 2004 → Journey into Nyx
// 2014; Eighth Edition → Fifth Dawn draw the title bar and the left inner
// edges 6–8 px differently: no second master). Card Conjurer's "8th Edition"
// drawing (pack8th.js) is sharp (outer edge 1.7–2.2 px wide, the MSE
// conversion's 6.2–6.8) but about 1 % small and, like the MSE art, 10–25
// luma light on most bands — so every master is RE-CUT with ONE piecewise-
// linear map per axis (the 2003 prints' edges do not differ by colour) and
// TONED through the pack's own five masks onto its prints' medians: the
// steps are scripts/lib/print-cut.mjs, the numbers scripts/lib/eighth-2003.mjs.
// A LIVE pair (owner 2026-10-07: the artwork swapped in the same sweep as
// the text fix).
// ---------------------------------------------------------------------------
const EIGHTH = "img/frames/8th";
const EIGHTH_TRANSFORM =
  "native 1500x2100; re-cut onto the 2004–2014 prints (printRecipe.cut: one piecewise-linear map per axis through [source px, print px] anchors — the outer frame, the type bar's top and bottom lines, the text box's top, bottom and right lines; Catmull-Rom, premultiplied, one resample), then toned region by region (printRecipe.tones: (in − from) × k + to per channel where the prints are darker, × to ÷ from where they are lighter; the regions are the pack's Frame / Title / Type / Rules / Pinline masks moved with the same map, the pinline taken out of the other four); corners rounded to the importer radius";
const EIGHTH_NOTES = [
  "the frame's LATER drawing (CHK 2004 → JOU 2014, black-bordered); every constant read off the prints once (proof 2, 2026-10-07): the edges on 34 white prints and confirmed per key, the tones on the per-pixel median of each master's prints — no scan is read by the build",
  "known drawing caveats (proof 2): the pack's white body is a blocky mottling where the prints have marble veins and its keylines are flat; the black frame's body is left as drawn (its sides read 10–20 luma under the prints' grey stone); every key has clean digital bevels, not the prints' soft ones",
];
/** The pack's P/T plates (322 × 176) per colour key: `c` is the ARTIFACT
 *  plate, as the master is. */
const EIGHTH_PT = Object.freeze(Object.fromEntries(COLORS.map((k) => [k, `${EIGHTH}/pt/${EIGHTH_MASTER_OF.modern[k]}.png`])));
/** Each plate's per-channel gain onto its prints' plate (EIGHTH_PLATE_TONES;
 *  the importer's `plateGains`: colour key → [r, g, b]). */
const EIGHTH_PT_GAINS = Object.freeze(
  Object.fromEntries(COLORS.map((k) => [k, Object.freeze(regionGain(EIGHTH_PLATE_TONES[EIGHTH_MASTER_OF.modern[k]]).map((g) => Math.round(g * 1000) / 1000))])),
);

// ---------------------------------------------------------------------------
// TODO 4.6h: two colours on the old frames — `modern` (the 2003 gold card),
// `modernland` and `retroland` (the two-colour lands of 2003 and of 1999 on).
// Card Conjurer's two packs carry NO two-colour master for either era: the
// 8th pack is fifteen single masters and five masks, the Seventh pack
// fourteen and a "Dual Land" mask of nested rectangles that no print wears
// (the prints blend left to right). So a pair master is SYNTHESISED from this
// template's own finished masters — the pack's drawings after their re-cut
// and their tones, i.e. the published single-colour masters before the
// corner cut — never from a scan:
//   • the BASE master whole (the gold frame; the plain land), then
//   • the split regions, each the pair's two masters blended across the
//     region's untilted ramp (scripts/lib/pair-ramp.mjs, a premultiplied
//     lerp, first canonical colour on the left) through the region's
//     coverage — the pack's own masks moved with the cut (2003), the
//     drawing's own lines (1997).
// What the prints do (measured 2026-10-08, the numbers beside PAIR_RAMPS):
//   • 2003 gold, Ravnica 2005 on: gold body, gold bars and the gold P/T
//     plate; the pinline and the text box in the two colours. The pinline's
//     blend is wide and soft on seven pairs, narrow and straight on bg, gw
//     and rw (GOLD_2003_NARROW_PAIRS); the box's is wide on all ten;
//   • 2003 lands, Eighth Edition 2003 on: the plain land's body and grey
//     bars; the pinline and the box in the two land colours, one narrow ramp;
//   • 1997 lands, Sixth Edition 1999 on: the plain land whole — its gold
//     outer and art rings too — with the box and the box's ring in the two
//     colours, one ramp. Both sides are built on the PLAIN land's cut (the
//     basics' boxes sit up to 2.5 px off it; the dual prints' box is the
//     plain land's within 1 px).
// ---------------------------------------------------------------------------
/** A layer that is one of the template's own finished masters (after the
 *  re-cut and the tones): whole, or — with `right` — blended into another
 *  across `ramp` and laid in through the named regions' coverage. */
const builtLayer = (key, extra = {}) => ({ built: key, ...extra });

/** True for a recipe made of the template's finished masters. */
export function isBuiltRecipe(layers) {
  return Array.isArray(layers) && layers.length > 0 && layers.every((l) => typeof l.built === "string");
}

/** The regions a 1997 land's box is: its face and the four sides of its ring. */
const SEVENTH_BOX_REGIONS = Object.freeze(["text", "trimL", "trimT", "trimR", "trimB"]);

/** The layers of one old-frame pair master (see above). */
export function oldFramePairLayers(template, pair) {
  const [a, b] = pairSides(pair);
  switch (template) {
    case "modern":
      return [
        builtLayer("m"),
        builtLayer(a, { right: b, ramp: [...PAIR_RAMPS.gold2003Rules], regions: ["text"] }),
        builtLayer(a, {
          right: b,
          ramp: [...(GOLD_2003_NARROW_PAIRS.includes(pair) ? PAIR_RAMPS.gold2003PinlineNarrow : PAIR_RAMPS.gold2003Pinline)],
          regions: ["pin"],
        }),
      ];
    case "modernland":
      return [builtLayer("c"), builtLayer(a, { right: b, ramp: [...PAIR_RAMPS.land2003], regions: ["text", "pin"] })];
    case "retroland":
      return [builtLayer("c"), builtLayer(a, { right: b, ramp: [...PAIR_RAMPS.land1997], regions: [...SEVENTH_BOX_REGIONS], cutOf: "c" })];
    default:
      throw new Error(`oldFramePairLayers: ${template} draws no old-frame pairs`);
  }
}

/** A template's ten old-frame pair masters: `{ wu: layers, … }`. */
const oldFramePairs = (template) => Object.fromEntries(TWO_COLOR_PAIRS.map((pair) => [pair, oldFramePairLayers(template, pair)]));

const OLD_PAIR_NOTE = {
  modern:
    "two-colour pair masters <pair>.png (TODO 4.6h): SYNTHESISED, no Card Conjurer two-colour file exists for this frame — the finished gold master whole, with the pair's two finished colour masters blended left to right (a premultiplied lerp, scripts/lib/pair-ramp.mjs; first canonical colour on the left) inside the text box and the pinline (the pack's Rules and Pinline masks, moved with the cut); the gold bars, body and P/T plate stay gold. Measured on 52 two-colour gold prints, Ravnica 2005 → Journey into Nyx 2014: the box blends across a smoothstep 25→73 %W on every pair, the pinline across a smoothstep 25→71 on wu wb ub ur br rg gu and a straight 42→59 on bg gw rw (the pairs whose prints mostly wear the narrow blend: 8 of 8, 6 of 7, 6 of 8). Hybrid cards (a split frame body, grey bars, a grey plate) are not built",
  modernland:
    "two-colour pair masters <pair>.png (TODO 4.6h): SYNTHESISED, no Card Conjurer two-colour file exists for this frame — the finished plain land whole (its body and grey bars: the dual lands' bars read 202/190/182 against the plain land's 196/182/171 and the basics' 40 further off), with the pair's two finished coloured-land masters blended left to right across one straight ramp 42→59 %W inside the text box and the pinline (the pack's Rules and Pinline masks, moved with the cut). Measured on 36 two-colour lands, Eighth Edition 2003 → Theros 2013, all ten pairs: pinline 41.5→58.5, box 41.8→58.8",
  retroland:
    "two-colour pair masters <pair>.png (TODO 4.6h): SYNTHESISED — the pack's 'Dual Land' mask (nested rectangles) is not what the prints do. The finished plain land whole (its gold outer and art rings: the dual prints' rings read 174/131/56 against the plain land's 185/142/53 and a basic's 55/90/107), with the pair's two coloured lands — each the pack's drawing with its own tones, on the PLAIN land's cut — blended left to right across one straight ramp 40→60 %W inside the text box and its ring. Measured on 36 two-colour lands, Sixth Edition 1999 → Onslaught 2002: box 40.0→59.9, ring 39.9→59.5; the lands of 1997 and 1998 (Fifth Edition, Tempest, Anthologies: 11 of 11) print the plain land's orange box and are not this look",
};

// ---------------------------------------------------------------------------
// TODO 4.11 (wave 1, owner-approved 2026-10-22): the Zendikar Rising hedron
// showcase — template `fullart` (the key is history: the frame is not full
// art; ZNR #290–313) — re-sourced from Card Conjurer's 'Zendikar Rising'
// pack (packZendikarRising.js, groupShowcase-5.js:42), 1500 × 2100 native.
// It replaces the 375 px MSE `zendikar` masters that
// scripts/build-variation-frames.mjs upscaled 4× into git (they lacked MSE's
// hedron `back` layer). Self-contained: the recipe (CC_TEMPLATES.fullart),
// its crown band (CC_OVERLAY_BANDS.fullartcrown) and the stamp notch it
// splits off each master (`notch`) read only the constants below.
// ---------------------------------------------------------------------------
const ZNR = "img/frames/m15/zendikarRising";
const ZNR_NICKNAME = "img/frames/m15/nickname";
const znrFile = (part, letter) => `${ZNR}/m15ZendikarRising${part}${letter.toUpperCase()}.png`;
/** CC's bounds for the pack's title pill ends ('… Title', bounds3) and its
 *  crown ('… Crown', bounds2), card %. Both images are their box's size,
 *  so they are placed 1:1 (rectPx: 56, 55, 1388 × 229 and 44, 49, 1412 ×
 *  245). */
export const ZNR_TITLE_BOUNDS = Object.freeze({ leftPct: 3.74, topPct: 2.62, widthPct: 92.54, heightPct: 10.91 });
export const ZNR_CROWN_BOUNDS = Object.freeze({ leftPct: 2.94, topPct: 2.34, widthPct: 94.14, heightPct: 11.67 });
/** The pack's P/T plates, by colour key (CC lists the 'Nickname' pack's
 *  plates for blue, red, green, artifact and land; its own for white, black,
 *  gold and colourless). 282 × 154 each, at M15's plate bounds. */
const ZNR_PT = Object.freeze({
  w: znrFile("PT", "w"),
  u: `${ZNR_NICKNAME}/m15NicknamePTU.png`,
  b: znrFile("PT", "b"),
  r: `${ZNR_NICKNAME}/m15NicknamePTR.png`,
  g: `${ZNR_NICKNAME}/m15NicknamePTG.png`,
  m: znrFile("PT", "m"),
  c: znrFile("PT", "c"),
});
/** One master: the colour's frame whole, then its title pill's ends at CC's
 *  bounds (CC draws the title piece over the frame). */
const znrMasterLayers = (k) => [layer(znrFile("Frame", k)), placed(znrFile("Title", k), ZNR_TITLE_BOUNDS)];

/**
 * The holofoil stamp's notch, split OFF every master (TODO 4.11): CC's
 * frames paint the text box's bottom rim arched over a hologram oval on
 * every key, where the ZNR prints arch it only on a rare or mythic (#292
 * Felidar Retreat, #298, #300, #303, #305, #307, #308, #312, #313) and run
 * the rim straight under the box on a common or uncommon (#290, #293, #296,
 * #301 …). So each master is written PLAIN — the arch, its bevel and the
 * oval replaced by the straight bar (each column under the arch copied from
 * the straight bar beside it, `refX`) and the hedron texture the arch hid
 * filled ALONG ITS OWN RIDGES: the box's hedron lines run parallel to the
 * V's two edges (45°), so a pixel left of the centre takes the one `srcDiag`
 * px up and to the left, a pixel right of it the one up and to the right —
 * the same ridge, the same distance from the V's edge — cross-faded over
 * `feather` rows above and across the centre's 16 columns (owner
 * 2026-10-22: a horizontal copy, 192 px out, left a soft rounded mound
 * under the V's tip; the ridges now run on through the patch) — and the
 * pixels that differ
 * are written beside it as the notch piece (`<template>/holostamp/<key>`,
 * the `box`), the oval cut clear (our oval art is drawn over it,
 * lib/cards/holo-stamp-art.ts). Drawn over the plain master the piece gives
 * back CC's pixels exactly, outside the cut.
 * `archTop`: the arch rim's first row (luma > 240 on the white master) by
 * |x − 750|, read off CC's W frame (symmetric within 1 px; every key's
 * geometry is the same file's).
 */
export const ZNR_NOTCH = Object.freeze({
  centerX: 750,
  archTop: Object.freeze([
    [0, 1905], [18, 1905], [22, 1906], [30, 1907], [38, 1909], [46, 1910], [50, 1911.5], [54, 1913], [58, 1914],
    [62, 1916], [66, 1917.5], [70, 1919.5], [74, 1921.5], [78, 1924.5], [82, 1927.5], [86, 1930.5], [90, 1934.5], [94, 1937],
  ].map((p) => Object.freeze(p))),
  /** The arch's bevel and shadow above its rim (the straight bar's bevel
   *  runs 1930–1936 above its rim at 1937–1947). */
  bevelRows: 10,
  feather: 6,
  /** The straight bar's first bevel row, its rim and the black below. */
  barTop: 1930,
  rimRows: Object.freeze([1937, 1947]),
  bottom: 2004,
  halfWidth: 96,
  refX: Object.freeze({ left: 600, right: 900 }),
  srcDiag: 64,
  /** The piece's box (1:1 at HD) and the oval CC paints in the notch
   *  (685–814 × 1927–1990 on every key), cut clear with `cutMarginPx`. */
  box: Object.freeze({ x: 640, y: 1880, width: 220, height: 125 }),
  oval: Object.freeze({ x: 685, y: 1927, width: 130, height: 64 }),
  cutMarginPx: 2,
});

/** Whether HD pixel (x, y) is inside the notch's oval cut (ZNR_NOTCH.oval
 *  grown by `cutMarginPx`): the pixels the piece leaves clear for our oval
 *  art. */
export function inZnrOvalCut(x, y, spec = ZNR_NOTCH) {
  const { oval, cutMarginPx } = spec;
  const rx = oval.width / 2 + cutMarginPx;
  const ry = oval.height / 2 + cutMarginPx;
  return ((x + 0.5 - (oval.x + oval.width / 2)) / rx) ** 2 + ((y + 0.5 - (oval.y + oval.height / 2)) / ry) ** 2 <= 1;
}

/** The pixels a published plain master and its notch piece draw together:
 *  the piece laid over the master's box (its opaque pixels replace, a clear
 *  one shows the master — the piece holds no translucent pixel), and the
 *  oval cut cleared to 0,0,0,0 whatever drew it. Pure; RGBA8 in, a new
 *  buffer out. The importer records the sha256 of this over CC's own master
 *  (ZNR_NOTCH restoration, frame-sources.json), and a test holds the
 *  published pair to it. */
export function restoredZnrMaster(plain, piece, width, height, spec = ZNR_NOTCH) {
  const out = Buffer.from(plain);
  const { box } = spec;
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const p = (y * box.width + x) * 4;
      if (piece[p + 3] === 0) continue;
      if (piece[p + 3] !== 255) throw new Error(`restoredZnrMaster: a translucent piece pixel at (${box.x + x}, ${box.y + y})`);
      piece.copy(out, ((box.y + y) * width + box.x + x) * 4, p, p + 4);
    }
  }
  return clearZnrOvalCut(out, width, spec);
}

/** The oval cut cleared to 0,0,0,0 in a full master (in place; returned). */
export function clearZnrOvalCut(buf, width, spec = ZNR_NOTCH) {
  const { oval, cutMarginPx } = spec;
  for (let y = oval.y - cutMarginPx - 1; y <= oval.y + oval.height + cutMarginPx; y += 1) {
    for (let x = oval.x - cutMarginPx - 1; x <= oval.x + oval.width + cutMarginPx; x += 1) {
      if (inZnrOvalCut(x, y, spec)) buf.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
    }
  }
  return buf;
}

function znrArchTop(dx, table = ZNR_NOTCH.archTop) {
  const a = Math.abs(dx);
  if (a >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 1; i < table.length; i += 1) {
    const [x1, y1] = table[i];
    if (a <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((y1 - y0) * (a - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

/**
 * Split one finished 1500 × 2100 master (RGBA8) into the PLAIN master and
 * the notch piece (ZNR_NOTCH). Pure. Returns `{ plain, piece, findings }`:
 * `piece` is the box's RGBA8 — CC's pixels where the plain master differs,
 * clear elsewhere and inside the oval cut — and `findings.failures` lists
 * what the importer refuses (the plain bar not straight under the arch, an
 * empty piece).
 */
export function splitZnrNotch(buf, width, height, spec = ZNR_NOTCH) {
  if (width !== OUT_W || height !== OUT_H) throw new Error(`splitZnrNotch: a ${OUT_W}×${OUT_H} master, not ${width}×${height}`);
  const plain = Buffer.from(buf);
  const at = (x, y) => (y * width + x) * 4;
  const { centerX, halfWidth, bevelRows, feather, barTop, bottom, srcDiag, refX } = spec;
  for (let x = centerX - halfWidth; x <= centerX + halfWidth; x += 1) {
    const dx = x - centerX;
    // Under the bar's bevel: the straight bar's own column beside the arch.
    const ref = dx < 0 ? refX.left : refX.right;
    for (let y = barTop; y <= bottom; y += 1) buf.copy(plain, at(x, y), at(ref, y), at(ref, y) + 4);
    // Above it: the hedron texture the arch hid, from further along its own
    // ridges (the two halves cross-faded over the centre's 16 columns).
    const top = znrArchTop(dx, spec.archTop) - bevelRows;
    if (top >= barTop) continue;
    const share = Math.min(1, Math.max(0, (dx + 8) / 16));
    for (let y = Math.max(0, Math.floor(top - feather)); y < barTop; y += 1) {
      const w = Math.min(1, Math.max(0, (y - (top - feather)) / feather));
      if (w === 0) continue;
      const l = at(x - srcDiag, y - srcDiag);
      const r = at(x + srcDiag, y - srcDiag);
      const o = at(x, y);
      for (let c = 0; c < 4; c += 1) {
        const src = buf[l + c] * (1 - share) + buf[r + c] * share;
        plain[o + c] = Math.round(buf[o + c] * (1 - w) + src * w);
      }
    }
  }
  const { box } = spec;
  const piece = Buffer.alloc(box.width * box.height * 4);
  let kept = 0;
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const cx = box.x + x;
      const cy = box.y + y;
      const o = at(cx, cy);
      const p = (y * box.width + x) * 4;
      if (inZnrOvalCut(cx, cy, spec)) continue;
      let same = true;
      for (let c = 0; c < 4; c += 1) if (buf[o + c] !== plain[o + c]) same = false;
      if (same) continue;
      buf.copy(piece, p, o, o + 4);
      kept += 1;
    }
  }
  const failures = [];
  // The plain bar runs straight under the arch: every rim row equals the
  // reference column's, column by column.
  for (let x = centerX - halfWidth; x <= centerX + halfWidth; x += 1) {
    const ref = x < centerX ? refX.left : refX.right;
    for (let y = spec.rimRows[0]; y <= spec.rimRows[1]; y += 1) {
      for (let c = 0; c < 4; c += 1) if (plain[at(x, y) + c] !== buf[at(ref, y) + c]) failures.push(`the plain rim at (${x}, ${y}) is not the straight bar's`);
    }
    if (failures.length) break;
  }
  if (kept === 0) failures.push("the notch piece is empty (the master has no arch?)");
  return { plain, piece, findings: { failures, kept } };
}

/** The ZNR crown band (TODO 4.11): the pack's crown (its two pill ends, the
 *  frame's own corner pieces untouched) at CC's bounds over a clear canvas,
 *  1:1, rows 0–299 kept. It covers the title pill's ends whole (checked by
 *  eye on all nine keys against #300 Moraug, #312 Omnath, #313 Phylath:
 *  CC draws it over the title piece). Keys: the masters' w u b r g m c and
 *  the ten pairs — the first colour's crown left, the second's right,
 *  lerped across PAIR_RAMPS.crown (the crown is two ends: the ramp crosses
 *  nothing drawn), as #313 Phylath (R|G over the gold frame) prints it. */
export const ZNR_CROWN_BAND = Object.freeze({
  crown: ZNR_CROWN_BOUNDS,
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "c", ...TWO_COLOR_PAIRS]),
  compositeSize: Object.freeze({ width: OUT_W, height: OUT_H }),
  rows: 300,
});

export function znrCrownLayers(key) {
  if (!ZNR_CROWN_BAND.keys.includes(key)) throw new Error(`znrCrownLayers: no crown for key ${key}`);
  if (TWO_COLOR_PAIRS.includes(key)) {
    const [a, b] = pairSides(key);
    return [placed(znrFile("Crown", a), ZNR_CROWN_BOUNDS, { right: znrFile("Crown", b), ramp: [...PAIR_RAMPS.crown] })];
  }
  return [placed(znrFile("Crown", key), ZNR_CROWN_BOUNDS)];
}

/** What the importer checks on the full ZNR crown composite: nothing drawn
 *  at or below the band's last row, nothing drawn over the middle of the
 *  title pill (the crown is its two ends only: x 330–1170 clear). */
export function znrCrownFindings(buf, width, height, rows) {
  let lastAlphaRow = -1;
  let peakRow = -1;
  const failures = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = buf[(y * width + x) * 4 + 3];
      if (a === 0) continue;
      lastAlphaRow = y;
      if (peakRow < 0) peakRow = y;
      if (x >= 330 && x <= 1170) failures.push(`α ${a} at (${x}, ${y}): the crown draws only the pill's ends`);
      if (failures.length > 3) break;
    }
  }
  if (lastAlphaRow >= rows) failures.push(`alpha down to row ${lastAlphaRow}, past the band's ${rows} rows`);
  return { failures, lastAlphaRow, peakRow, summary: `first drawn row ${peakRow}` };
}

const ZNR_PACK = "packZendikarRising.js 'Zendikar Rising' (groupShowcase-5.js:42)";
// TODO 4.11 (showcase rebuild, wave 1): the Lord of the Rings SCROLL
// showcase (`lotrscroll`; LTR #452–730 and LTC #411–490) from Card
// Conjurer's 'Scroll' pack (packScroll.js, `img/frames/scroll/`, 2010 ×
// 2814). Its masters replace the 646 px MSE drawing (layout v62's
// correction). Self-contained: the template, its crown band and its stamp
// notch read only the constants below.
//   • masters: the pack's eight frames whole, each downscaled ONCE to
//     1500 × 2100 (Lanczos, as m15ub's) — w u b r g, m (gold: three
//     colours or more, and today a pair), `a` the pack's light-blue
//     'Artifact Frame' (FrameProfile.artifactMasterKeys { c: "a" }: every
//     colourless nonland printing of the run is an artifact — Shire
//     Scarecrow #700, The One Ring #697, LTC #485–489) and `c` the pack's
//     brown 'Land Frame' (the pack has no colourless frame: a colourless
//     card that is no artifact is a LAND on print — Shire Terrace #712; a
//     coloured land wears its colour's frame, as The Shire #711 (green),
//     The Black Gate LTC #490 and Barad-dûr #704 do. A colourless creature
//     that is neither an artifact nor a land draws the brown land master
//     with the artifact's plate: no print has that shape). Each frame keeps the
//     pack's translucent parchment wash over the art window (the 'No Art
//     Overlay' mask, which drops it, is not used: every print shows the
//     wash at the window's edges).
//   • plates: the pack's seven scroll P/T plates (435 × 266 at the pack's
//     ptBounds) — the colourless key the artifact's light-blue plate.
//   • not built: the pack's 'Multicolored Bars' (the gold bars of a
//     two-colour card over the colour halves through maskRightHalf.png) —
//     the two-colour dress is a follow-up; the pack's sagas (SagaLTR, 4.5d).
// ---------------------------------------------------------------------------
export const SCROLL = "img/frames/scroll";
/** The scroll pack's plates, by colour key (the colourless card's is the
 *  artifact's light-blue plate: the pack draws no land plate). */
const SCROLL_PT = Object.freeze(perColor((k) => `${SCROLL}/pt/${k === "c" ? "a" : k}.png`));
const SCROLL_PACK = "packScroll.js 'Scroll' (the Lord of the Rings scroll showcase; groupShowcase-5.js)";
const SCROLL_NOTES = [
  "w u b r g m = the pack's colour frames whole (scroll/<k>.png, 2010x2814), downscaled once to 1500x2100 (Lanczos) — as the LTR scroll showcase prints them (LTR #452–730, LTC #411–490), the parchment wash over the art window included (the pack's 'No Art Overlay' mask, which drops it, is not used)",
  "a = the pack's light-blue 'Artifact Frame' (scroll/a.png): the master a colourless ARTIFACT paints (FrameProfile.artifactMasterKeys { c: 'a' }; LTR #687–703, LTC #485–489)",
  "c = the pack's brown 'Land Frame' (scroll/l.png): the pack draws no colourless frame, and a colourless printing that is not an artifact is a land (LTR #712 Shire Terrace); a coloured land wears its colour's frame (LTR #711 The Shire green, LTC #490 The Black Gate, LTR #704 Barad-dûr)",
  "a colourless creature that is neither an artifact nor a land draws c (the brown land master) with the artifact's light-blue plate — no print has that shape (every colourless creature of the run is an artifact creature)",
  "plates = the pack's seven scroll plates (scroll/pt/<k>.png, 435x266 at the pack's ptBounds 1492/2422 px of 2010x2814); c = the artifact's light-blue plate (the pack has no land plate; LTR #700 Shire Scarecrow prints it)",
  "not built: the 'Multicolored Bars' overlay and maskRightHalf.png (the two-colour dress: the colour frames split down the card under gold bars — a follow-up; a two-colour card draws the gold master today) and the pack's scroll sagas (SagaLTR, TODO 4.5d)",
];
/**
 * The scroll's legendary crown (TODO 4.11): the pack's 'Legendary Crown'
 * (`scroll/crowns/<k>.png`, 1909 × 70 at crownBounds 49 / 43 px of the
 * 2010 × 2814 card) — the rolled top edge of the title scroll a legendary
 * print carries (LTR #470 Gandalf the White, #526 The Watcher in the Water,
 * LTC #422 Denethor against #457 / #700 / LTC #412). A generic band: the
 * crown placed at its bounds on a clear 2010 × 2814 canvas, downscaled once,
 * cropped to rows 0–99 of the HD card (the crown ends at row 86). No cover
 * strip, no pairs (the template draws no pair masters).
 */
export const SCROLL_CROWN_BAND = Object.freeze({
  source: `${SCROLL}/crowns`,
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "a", "l"]),
  crown: Object.freeze({ leftPct: (49 / 2010) * 100, topPct: (43 / 2814) * 100, widthPct: (1909 / 2010) * 100, heightPct: (70 / 2814) * 100 }),
  compositeSize: Object.freeze({ width: 2010, height: 2814 }),
  rows: 100,
});
/** The scroll crown band's one layer for a key. */
export function scrollCrownLayers(key) {
  if (!SCROLL_CROWN_BAND.keys.includes(key)) throw new Error(`scrollCrownLayers: no crown for key ${key}`);
  return [placed(`${SCROLL_CROWN_BAND.source}/${key}.png`, SCROLL_CROWN_BAND.crown)];
}
/**
 * What the importer checks on the full 1500 × 2100 scroll-crown composite
 * (pure): nothing below the band's rows; the crown's top edge (the first
 * row with any alpha) where the pack draws it (row 32: 43 / 2814 × 2100,
 * the Lanczos ringing up to 3 px above it); and
 * the band clear outside x 34–1465 (the crown's bounds, 36.6–1461.2, and
 * that ringing), so it never repaints the black border.
 */
export function scrollCrownFindings(buf, width, height, rows) {
  let lastAlphaRow = -1;
  for (let y = height - 1; y >= 0 && lastAlphaRow < 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      if (buf[(y * width + x) * 4 + 3] > 0) {
        lastAlphaRow = y;
        break;
      }
    }
  }
  let firstAlphaRow = -1;
  for (let y = 0; y < rows && firstAlphaRow < 0; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (buf[(y * width + x) * 4 + 3] > 0) {
        firstAlphaRow = y;
        break;
      }
    }
  }
  let outside = 0;
  for (let y = 0; y < rows; y += 1) {
    for (const x of [0, 33, 1466, width - 1]) outside = Math.max(outside, buf[(y * width + x) * 4 + 3]);
  }
  const failures = [];
  if (lastAlphaRow >= rows) failures.push(`alpha down to row ${lastAlphaRow}, past the band's ${rows} rows`);
  if (firstAlphaRow < 29 || firstAlphaRow > 34) failures.push(`the crown's first row is ${firstAlphaRow}, the pack's bounds put it at 32 (the resample's ringing 2 px above)`);
  if (outside > 0) failures.push(`α ${outside} outside the crown's bounds and the resample's ringing (x 34–1465)`);
  return { lastAlphaRow, peakRow: firstAlphaRow, failures, summary: `first alpha row ${firstAlphaRow}, α outside the bounds ${outside}` };
}

/**
 * The scroll's triangle stamp notch (TODO 4.11): the pack's per-colour
 * piece (`scroll/stamps/<k>.png`, 349 × 181) at its stampBounds (834 / 2518
 * of 2010 × 2814 → 622.4 / 1879.1 + 260.4 × 135.1 px at HD), composited on
 * the whole card and downscaled with it, then cut to SCROLL_NOTCH_BOX — the
 * whole px round it — and drawn 1:1 there (lib/cards/template-layout.ts
 * LOTRSCROLL_HOLO_STAMP's rect).
 */
export const SCROLL_NOTCH_BOX = Object.freeze({ x: 620, y: 1877, width: 266, height: 140 });
export const SCROLL_NOTCH = Object.freeze({
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "a", "l"]),
  pieces: Object.freeze(Object.fromEntries(["w", "u", "b", "r", "g", "m", "a", "l"].map((k) => [k, `${SCROLL}/stamps/${k}.png`]))),
  placeAt: Object.freeze({ x: 834, y: 2518, width: 349, height: 181 }),
  compositeSize: Object.freeze({ width: 2010, height: 2814 }),
  shape: Object.freeze({
    size: Object.freeze({ width: SCROLL_NOTCH_BOX.width, height: SCROLL_NOTCH_BOX.height }),
    bounds: Object.freeze({
      leftPct: (SCROLL_NOTCH_BOX.x / 1500) * 100,
      topPct: (SCROLL_NOTCH_BOX.y / 2100) * 100,
      widthPct: (SCROLL_NOTCH_BOX.width / 1500) * 100,
      heightPct: (SCROLL_NOTCH_BOX.height / 2100) * 100,
    }),
  }),
});

/**
 * A scroll notch piece's hologram, blacked out and cut (in place): every
 * pixel inside the cut grown by `blackoutPx` becomes the trapezoid's opaque
 * black — the pack's triangle is drawn ~2 px larger and higher than the
 * stamp's hole, so its edge would otherwise survive round our cut — then
 * every pixel inside the cut itself transparent (cutOval).
 */
export function blackoutAndCut(buf, shape, cut, marginPx, blackoutPx) {
  const { width, height } = shape.size;
  const inside = cutInside(shape, cut, marginPx);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!inside(x, y, blackoutPx)) continue;
      const o = (y * width + x) * 4;
      buf[o] = 0;
      buf[o + 1] = 0;
      buf[o + 2] = 0;
      buf[o + 3] = 255;
    }
  }
  cutOval(buf, shape, cut, marginPx);
  return buf;
}

/**
 * What the importer (and the unit test, on the published objects) checks
 * on a scroll notch piece (8-bit RGBA at the box's size, pure): every
 * pixel inside the cut is transparent; the blacked-out ring round it is
 * opaque black; the piece's corners are clear (the pack's piece stops
 * inside its box) — and, given the pack's stamp shape (`stamp`: gray.png's
 * alpha at the same bounds, downscaled with the card and cut to the box),
 * nothing of it lies outside the cut and its ring above α 8 (the resample's
 * ringing): no pixel of the hologram capture is published.
 * @param {Uint8Array | null} [stamp]
 */
export function pieceNotchFindings(buf, shape, cut, marginPx, blackoutPx, stamp = null) {
  const { width, height } = shape.size;
  const inside = cutInside(shape, cut, marginPx);
  let cutClear = true;
  let ringBlack = true;
  let stampOutside = 0;
  let opaque = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const o = p * 4;
      if (buf[o + 3] === 255) opaque += 1;
      if (inside(x, y, 0)) {
        if (buf[o + 3] !== 0 || buf[o] || buf[o + 1] || buf[o + 2]) cutClear = false;
        continue;
      }
      if (inside(x, y, blackoutPx)) {
        if (buf[o + 3] !== 255 || buf[o] || buf[o + 1] || buf[o + 2]) ringBlack = false;
        continue;
      }
      if (stamp) stampOutside = Math.max(stampOutside, stamp[p]);
    }
  }
  const corners = [0, width - 1, (height - 1) * width, height * width - 1].map((p) => buf[p * 4 + 3]);
  const failures = [];
  if (!cutClear) failures.push("a pixel inside the cut is not transparent");
  if (!ringBlack) failures.push(`a pixel in the ${blackoutPx} px ring round the cut is not opaque black`);
  if (stampOutside > 8) failures.push(`the pack's stamp shape reaches α ${stampOutside} outside the cut and its ring`);
  if (corners.some((a) => a !== 0)) failures.push(`the box's corners are not clear (α ${corners.join(", ")})`);
  return { cutClear, ringBlack, stampOutside, opaque, failures };
}

// ---------------------------------------------------------------------------
// TODO 4.11 (showcase rebuild, wave 2): the Murders at Karlov Manor DOSSIER
// showcase (`dossier`; MKM #336–376, their invisible-ink twins #377–389 and
// #433 — Scryfall's `dossier` promo type, 55 printings, every one a creature)
// from Card Conjurer's 'Dossier' pack (packDossier.js, `img/frames/dossier/`,
// 2010 × 2814). An ADDITION: a new template, no stored card sits on it.
// Self-contained: the template, its crown band and its stamp notch read only
// the constants below.
//   • masters: the pack's seven frames whole, each downscaled ONCE to 1500 ×
//     2100 (Lanczos) — w u b r g, m (gold: three colours or more) and `c` =
//     the pack's 'Artifact Frame' (dossier/a.png, the slate accent): the
//     pack draws no colourless frame, and the run's one colourless printing
//     is an artifact creature (#376 Magnetic Snuffler, which prints it).
//   • the ten two-colour PAIR masters (the "split" dress, opt-in per card
//     like every two-colour dress): print draws a two-colour card's accents
//     — the photo corners, the rules of the title and type bands, the two
//     seals — in its first colour on the left and its second on the right
//     (pair order; 28 of the run's printings), the rules ramping between:
//     the two masters lerped across DOSSIER_PAIR_RAMP (the pack has no
//     two-colour dress of its own). The masters differ only on the accents,
//     the seals and the photo's paper, so the ramp crosses those alone.
//   • a real black border top, right and bottom, cut at the one card corner;
//     the folder's tan edge runs to the LEFT edge, as on every print (the
//     edge contract's `design`).
//   • plates: the pack's one P/T tag (pt.png, 392 × 195 at its ptBounds
//     1538 / 2468) under every key.
//   • tones (the ring's one rule: raw scan medians, a region toned only
//     where ≥ 9 levels off — DOSSIER_PRINT_TONES): the parchment, the folder
//     edge, the accents and the tag are within 4 levels of print, as drawn;
//     the green and blue CROWNS are toned (the pack draws them 11–12 levels
//     off the frame's own accents, which print uses for the crown too).
//   • geometry kept as drawn: print is the pack's drawing (the stamp's arch
//     within 1 px, the parchment's lines within 1–2 px), so nothing is
//     re-cut. The title and type bands are TILTED (the pack's rules rise
//     ~1° and ~0.7°, and print sets the name and the type line along them);
//     PipGlyph draws its text level, on each band's middle.
// ---------------------------------------------------------------------------
export const DOSSIER = "img/frames/dossier";
const DOSSIER_PACK = "packDossier.js 'Dossier' (the Murders at Karlov Manor dossier showcase; groupShowcase-5.js 'Dossier (MKM)')";
/** A colour key's pack file: `c` draws the pack's artifact frame. */
const dossierFile = (dir, k) => `${DOSSIER}/${dir}${k === "c" ? "a" : k}.png`;
/**
 * The two-colour split, in % of the card's width (scripts/lib/pair-ramp.mjs
 * blendPair: the second colour's share 0 → 1 between the two): measured on
 * the MKM two-colour prints (Scryfall PNGs at 1500 × 2100), the colour of
 * each band's thin rules column by column projected between the same
 * rule's colour on two mono prints of its two colours, smoothed over 15
 * px — 10 / 50 / 90 % at 44.7 / 52.2 / 57.6 (the title band's lower rule,
 * 12 prints), 44.3 / 52.1 / 57.5 (its upper rule, 11), 45.2 / 52.2 / 57.2
 * and 45.8 / 51.9 / 56.9 (the type band's two rules) → 43.5 → 59.5 (45.1 /
 * 51.5 / 57.9).
 */
export const DOSSIER_PAIR_RAMP = Object.freeze([43.5, 59.5]);
/**
 * The two-colour CROWN's split: the crown's colour band (rows 76–84 px,
 * x 60–1400) on the run's two-colour legends (#356, #359, #360, #362, #363,
 * #365, #370, #373), the same projection: 10 / 50 / 90 % medians 42.5 /
 * 49.7 / 55.9 %W (the 10 % point read on the five whose ramp is clean) →
 * 40.5 → 57.5 (42.2 / 49 / 55.8). A little left of the frame's own rules,
 * as on print.
 */
export const DOSSIER_CROWN_RAMP = Object.freeze([40.5, 57.5]);
/**
 * The pack's colours against print by the ring's one rule (raw scan
 * medians over every MKM dossier print that shows the region, the
 * invisible-ink twins #377–389 / #433 left out — their scans carry the
 * ink's cast; Scryfall PNGs at 1500 × 2100; a region ≥ 9 levels off is
 * toned):
 *   • parchment (title band, type band, text box; ink left out): pack
 *     247,240,227 / 248,241,228 / 247,240,228, print 245,240,227 /
 *     245,240,228 / 244,239,227 — ≤ 3: as drawn;
 *   • the folder's tan edge (x 8–22): 185,160,112 / 181,158,109 — 4: as drawn;
 *   • the accents (the photo's corners, 41 mono prints): w 174,158,116 /
 *     171,157,115, u 42,92,158 / 42,92,157, b 58,49,72 / 58,50,72, r
 *     141,47,27 / 140,47,27, g 43,96,50 / 43,96,49, m 191,142,50 /
 *     189,140,48, a 102,124,145 / 102,124,145 — ≤ 3: as drawn;
 *   • the P/T tag's face: 231,220,197 / 229,220,197 — 2: as drawn;
 *   • the crowns' colour band: w 170,155,113 / 168,154,112 (#337), b
 *     59,50,71 / 58,49,72 (#344, #362, #366, #370), r 139,47,27 /
 *     139,47,27, m 188,140,50 / 187,139,48 (#368) — as drawn; g
 *     46,107,55 → 43,96,49 (#352 and the green end of #356, #362, #371,
 *     #372, #373, #375: 11 / 6 off) and u 50,89,168 → 43,92,156 (the blue
 *     end of #355, #359, #360, #365, #366, #373: 7 / 12 off) — TONED, the
 *     crown file's own flat fill (nearRegionPlane) as it loads; the
 *     artifact crown has no print (no colourless legend): as drawn.
 */
export const DOSSIER_PRINT_TONES = Object.freeze({
  crown: Object.freeze({
    g: Object.freeze({ from: [46, 107, 55], to: [43, 96, 49] }),
    u: Object.freeze({ from: [50, 89, 168], to: [43, 92, 156] }),
  }),
});
/** The crown's fill region: the file's pixels within `full` levels (max
 *  channel) of the tone's `from`, none past `none` (the fill's anti-aliased
 *  edge into the parchment between). */
export const DOSSIER_CROWN_NEAR = Object.freeze({ full: 12, none: 36 });
/** The dossier pack's toned files: the green and blue crowns. */
export const DOSSIER_SOURCE_TONES = Object.freeze(
  Object.fromEntries(
    Object.entries(DOSSIER_PRINT_TONES.crown).map(([k, tone]) => [
      `${DOSSIER}/crown/${k}.png`,
      Object.freeze({ near: Object.freeze({ crown: DOSSIER_CROWN_NEAR }), tones: Object.freeze({ crown: tone }), table: `DOSSIER_PRINT_TONES.crown.${k}` }),
    ]),
  ),
);
const DOSSIER_PT = Object.freeze(perColor(() => `${DOSSIER}/pt.png`));
const DOSSIER_NOTES = [
  "w u b r g m = the pack's colour frames whole (dossier/<k>.png, 2010x2814), downscaled once to 1500x2100 (Lanczos) — as the MKM dossier showcase prints them (MKM #336–389, #433)",
  "c = the pack's slate 'Artifact Frame' (dossier/a.png): the pack draws no colourless frame, and the run's one colourless printing is an artifact creature that prints it (MKM #376 Magnetic Snuffler)",
  `the ten pairs (wu wb ub ur br bg rg rw gw gu, the "split" dress) = the pair's two colour frames lerped across ${DOSSIER_PAIR_RAMP[0]} → ${DOSSIER_PAIR_RAMP[1]} %W of the card (scripts/lib/pair-ramp.mjs blendPair) at the pack's size, then downscaled once: print draws a two-colour card's accents — the photo's corners, the title and type bands' rules, the two seals — in the first colour on the left and the second on the right, the rules ramping between (MKM #354–375 but #368, #383–389); the pack has no two-colour dress of its own`,
  "a real black border top, right and bottom, cut at the one card corner; the folder's tan edge runs to the left edge (design), as on every print",
  "plates = the pack's one 'Power/Toughness Box' (dossier/pt.png, 392x195 at its ptBounds 1538/2468 px of 2010x2814) under every key",
  "the parchment, the folder's edge, the accents and the tag against print by the ring's rule (raw scan medians, a region ≥ 9 levels off is toned): within 4 levels, as drawn (DOSSIER_PRINT_TONES)",
  "geometry as drawn: the pack is print's drawing (the stamp's arch within 1 px, the bands' rules within 1–2 px) — nothing is re-cut; the title and type bands are tilted on the pack as on print",
];
/**
 * The dossier's legendary crown (TODO 4.11): the pack's 'Legendary Crown'
 * (`dossier/crown/<k>.png`, 1790 × 419 at crownBounds 33 / 0 px of the
 * 2010 × 2814 card) — the torn paper strip in the card's colour every
 * legendary print carries above the title band (MKM #337, #344, #350, #352
 * and every legendary pair and gold card of #354–375; the non-legendary
 * #336, #343, #358 print none). A generic band: the crown placed at its bounds on
 * a clear 2010 × 2814 canvas, downscaled once, cropped to rows 0–315 of the
 * HD card (the crown ends at row 312.7; its strip down the folder's left
 * edge is the master's own pixels). Keys: the masters' w u b r g m c (c the
 * artifact crown) and the ten pairs, the first colour's crown left and the
 * second's right across DOSSIER_CROWN_RAMP (print's two-colour legends
 * ramp their crown so). The green and blue crowns toned onto print
 * (DOSSIER_SOURCE_TONES).
 */
export const DOSSIER_CROWN_BAND = Object.freeze({
  source: `${DOSSIER}/crown`,
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "c", ...TWO_COLOR_PAIRS]),
  crown: Object.freeze({ leftPct: (33 / 2010) * 100, topPct: 0, widthPct: (1790 / 2010) * 100, heightPct: (419 / 2814) * 100 }),
  compositeSize: Object.freeze({ width: 2010, height: 2814 }),
  rows: 316,
});
/** The dossier crown band's one layer for a key (a pair's two crowns lerped
 *  across DOSSIER_CROWN_RAMP). */
export function dossierCrownLayers(key) {
  if (!DOSSIER_CROWN_BAND.keys.includes(key)) throw new Error(`dossierCrownLayers: no crown for key ${key}`);
  if (TWO_COLOR_PAIRS.includes(key)) {
    const [a, b] = pairSides(key);
    return [placed(dossierFile("crown/", a), DOSSIER_CROWN_BAND.crown, { right: dossierFile("crown/", b), ramp: [...DOSSIER_CROWN_RAMP] })];
  }
  return [placed(dossierFile("crown/", key), DOSSIER_CROWN_BAND.crown)];
}
/**
 * What the importer checks on the full 1500 × 2100 dossier-crown composite
 * (pure): nothing at or below the band's last row; the crown (near) opaque
 * at its top (the black above the strip, α ≥ 250 at row 5 — the pack's
 * black crown reads 254) — it reaches the card's top edge; and the band clear outside x 22–1363 (the crown's bounds, 24.6–
 * 1360.4, and the resample's ringing), so it never repaints the master's
 * clip or its right border.
 */
export function dossierCrownFindings(buf, width, height, rows) {
  let lastAlphaRow = -1;
  for (let y = height - 1; y >= 0 && lastAlphaRow < 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      if (buf[(y * width + x) * 4 + 3] > 0) {
        lastAlphaRow = y;
        break;
      }
    }
  }
  let outside = 0;
  for (let y = 0; y < rows; y += 1) {
    for (const x of [0, 21, 1364, width - 1]) outside = Math.max(outside, buf[(y * width + x) * 4 + 3]);
  }
  const topAlpha = buf[(5 * width + 700) * 4 + 3];
  const failures = [];
  if (lastAlphaRow >= rows) failures.push(`alpha down to row ${lastAlphaRow}, past the band's ${rows} rows`);
  if (topAlpha < 250) failures.push(`the crown's top is α ${topAlpha} at (700, 5), the pack draws it (near) opaque to the card's top edge`);
  if (outside > 0) failures.push(`α ${outside} outside the crown's bounds and the resample's ringing (x 22–1363)`);
  return { lastAlphaRow, peakRow: 0, failures, summary: `top α ${topAlpha}, α outside the bounds ${outside}` };
}
/**
 * The dossier's OVAL stamp notch (TODO 4.11): the pack's one 'Holo Stamp'
 * (`dossier/stamp.png`, 295 × 134 at its bounds 857 / 2540 of 2010 × 2814 —
 * the black border arched up into the page's foot round the hologram, as
 * every stamped print draws it: the arch's top on 1909 px at the centre
 * against the pack's 1908, its feet on the page's foot 1943–1946 against
 * 1942–1945) composited on the whole card and downscaled with it, then cut
 * to DOSSIER_NOTCH_BOX — 2 px round the piece (639.7–859.9 × 1895.5–
 * 1995.5) — and drawn 1:1 there, its rows above the arch cleared (the
 * master's own page shows there). The pack paints a capture of WotC's oval
 * in the well 5–7 px BELOW where print sets the hologram (DOSSIER_CAPTURE_PX
 * against DOSSIER_STAMP_OVAL_PX): the capture is painted opaque black first
 * (grown 2 px — the well is black round the hologram on print), then the
 * prints' oval plus 2 px cut clear and the 2 px round it painted black. Our
 * own oval art covers the cut (lib/cards/holo-stamp-art.ts). One piece for
 * every key, the ten pairs' too (the masters and the pair masters are the
 * same page under the arch).
 */
export const DOSSIER_NOTCH_BOX = Object.freeze({ x: 637, y: 1893, width: 226, height: 106 });
/** The stamp's oval, card px: the PRINTS' hologram — lit from 686 to 816
 *  across its middle row and from 1921 to 1987 down the card's centre on
 *  29 of the 31 stamped MKM prints without the invisible ink (Scryfall PNGs
 *  at 1500 × 2100, every one the same within 1 px; #357 / #362 have rules
 *  ink over the arch and were not read) — 133 × 67 at 685, 1921. */
export const DOSSIER_STAMP_OVAL_PX = Object.freeze({ x: 685, y: 1921, width: 133, height: 67 });
/** The pack's capture in the well, card px (its lit pixels once placed and
 *  downscaled: 684–816 × 1928–1992) — painted black before the cut. */
export const DOSSIER_CAPTURE_PX = Object.freeze({ x: 684, y: 1928, width: 133, height: 65 });
export const DOSSIER_NOTCH = Object.freeze({
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "c", ...TWO_COLOR_PAIRS]),
  pieces: Object.freeze(Object.fromEntries(["w", "u", "b", "r", "g", "m", "c", ...TWO_COLOR_PAIRS].map((k) => [k, `${DOSSIER}/stamp.png`]))),
  placeAt: Object.freeze({ x: 857, y: 2540, width: 295, height: 134 }),
  compositeSize: Object.freeze({ width: 2010, height: 2814 }),
  shape: Object.freeze({
    size: Object.freeze({ width: DOSSIER_NOTCH_BOX.width, height: DOSSIER_NOTCH_BOX.height }),
    bounds: Object.freeze({
      leftPct: (DOSSIER_NOTCH_BOX.x / 1500) * 100,
      topPct: (DOSSIER_NOTCH_BOX.y / 2100) * 100,
      widthPct: (DOSSIER_NOTCH_BOX.width / 1500) * 100,
      heightPct: (DOSSIER_NOTCH_BOX.height / 2100) * 100,
    }),
  }),
  oval: Object.freeze({
    leftPct: (DOSSIER_STAMP_OVAL_PX.x / 1500) * 100,
    topPct: (DOSSIER_STAMP_OVAL_PX.y / 2100) * 100,
    widthPct: (DOSSIER_STAMP_OVAL_PX.width / 1500) * 100,
    heightPct: (DOSSIER_STAMP_OVAL_PX.height / 2100) * 100,
  }),
  /** The capture's pixels in the notch box: the well's lit pixels (luma >
   *  60) inside the ellipse inscribed in box x 44–182, rows 32–102 — the
   *  capture's own oval (684–816 × 1928–1992 px) and 3 px round it; the
   *  arch's parchment shoulders at the box's top corners lie outside it —
   *  painted black before the cut. */
  capture: Object.freeze({ x0: 44, x1: 182, y0: 32, y1: 102, minLuma: 60, oval: true }),
  /** The piece's rows above the arch (card rows 1893–1905; the arch's
   *  anti-aliased top starts on 1907) are the master's own page — the
   *  pack's parchment there is within 3 levels of the masters' — and are
   *  cleared: the downscale rang at the piece's top edge (row 1896 read
   *  255,255,244, a light line across the page). */
  clearAboveY: 1906,
});

// ---------------------------------------------------------------------------
// TODO 4.11 (showcase rebuild, wave 2): the Doctor Who TARDIS showcase
// (`tardis`; WHO #535–564, their serialized twins #552z–564z and their
// surge-foil twins #1126–1155 — 73 printings, every one single-faced and
// borderless on the 2015 frame, every one a creature but #551 / #1142 TARDIS
// (an artifact Vehicle), each with the Universes Beyond triangle stamp —
// Scryfall 2026-10-28) from Card Conjurer's 'TARDIS' pack (packTARDIS.js,
// `img/frames/tardis/`, 1500 × 2100 NATIVE: nothing is resampled). An
// ADDITION: a new template, no stored card sits on it. Self-contained: the
// template and its stamp notch read only the constants below.
//   • masters: the pack's frames — w u b r g, m (gold: three colours or
//     more) and `c` = the pack's 'Artifact Frame' (tardis/a.png, the steel
//     stripe): the pack's Land frame 404s in the tree and it draws no
//     colourless one; the run's two colourless printings are artifacts
//     (#550 Cyberman Patrol, #551 TARDIS), and print gives them the steel.
//     Each master is the frame WITH the pack's 'Legendary Crown'
//     (tardis/crowns/<k>.png, 1270 × 450 at its bounds 115 / 45, 1:1) —
//     the angled brace under the title bar at the window's top corners, its
//     wedge in the card's colour: print draws it on EVERY printing of the
//     run, legendary or not (#538 Dalek Squadron, #549 Weeping Angel, #550
//     Cyberman Patrol carry it as the legends do), so it is the frame's own
//     drawing here, not an opt-in crown. (The one exception is #551 / #1142
//     TARDIS, whose art — the police box's open doors — fills the window
//     past the brace; a card is drawn on the frame as the rest of the run
//     prints it.)
//   • the ten two-colour PAIR masters (the "split" dress, opt-in per card):
//     print draws a two-colour card's left stripe and wedge in its first
//     colour and the right ones in its second (pair order; #541–545, #547–
//     549, #552–564 — 21 of the 30 base printings). The masters differ only
//     on the stripes and wedges (x 61–346 and 1156–1439, measured on all
//     seven), so the pair is the two masters lerped across TARDIS_PAIR_RAMP,
//     a span of identical pixels.
//   • a real black border at the top and the bottom (0,0,0 on the pack and on
//     print), cut at the one card corner; the police box's blue sides run to
//     the left and right edges as print draws them (borderless: the edge
//     contract's `design`).
//   • plates: the pack's one P/T box (pt.png, 299 × 173 at its ptBounds
//     1133 / 1850, 1:1) under every key.
//   • tones (the ring's one rule: raw scan medians, a region toned only
//     where ≥ 9 levels off — TARDIS_PRINT_TONES): each stripe's body and
//     light strip (the steel body aside) and every wedge (the steel one
//     aside) are toned; the blue box, the bars and the plate are within 8
//     levels, as drawn.
//   • geometry kept as drawn: the run is WotC's digital file (its black reads
//     0,0,0 and its blue the pack's within 7 levels), and the pack is that
//     drawing at the same size — the bars, box, plate and stamp housing sit
//     within 2–3 px of print, all of it one shift of the scans' crop — so
//     nothing is re-cut.
// ---------------------------------------------------------------------------
export const TARDIS = "img/frames/tardis";
const TARDIS_PACK = "packTARDIS.js 'TARDIS' (the Doctor Who TARDIS showcase; groupShowcase-5.js 'TARDIS (WHO)')";
/** A colour key's pack file: `c` draws the pack's artifact frame. */
const tardisFile = (dir, k) => `${TARDIS}/${dir}${k === "c" ? "a" : k}.png`;
/** The pack's crown at its bounds (115 / 45, 1270 × 450 of the 1500 × 2100
 *  card: 1:1). */
export const TARDIS_CROWN_AT = Object.freeze({ leftPct: (115 / 1500) * 100, topPct: (45 / 2100) * 100, widthPct: (1270 / 1500) * 100, heightPct: (450 / 2100) * 100 });
/**
 * The two-colour split, % of the card's width: any span between the
 * masters' last coloured column on the left (346 px, the left wedge's tip)
 * and their first on the right (1156 px) draws the same pixels — print
 * gives the left stripe and wedge the pair's first colour and the right
 * ones its second, with nothing coloured between. The ramp is the standard
 * band's 45 → 55, inside that span.
 */
export const TARDIS_PAIR_RAMP = Object.freeze([45, 55]);
/**
 * The pack's colours against print by the ring's one rule (raw scan medians
 * over the run's 30 base printings, WHO #535–564 — the serialized and
 * surge-foil twins are the same frame under a foil, not read; Scryfall PNGs at 1500 ×
 * 2100; a region ≥ 9 levels off on a channel is toned). Each print is read
 * REGISTERED on the pack's drawing (the scans sit 3 px right of it and 2 px
 * higher at the top, 1 px lower at the box: the best fit of the frame's
 * opaque pixels band by band), so a thin region's interior is its own on
 * both. The regions are interiors, read per side with the side's colour (a
 * pair's left with its first colour, its right with its second):
 *   • the stripe's BODY (down both sides of the box, x 62–78 / 1421–1437:
 *     the pixels where the colour's frame file differs from the blue one —
 *     the white one for the blue and steel files — darker than the stripe's
 *     light strip, eroded 2 px across and 4 down): w 176,171,165 →
 *     206,190,155 (30 off), u 6,103,154 → 0,101,166 (12), b 44,39,40 →
 *     61,67,77 (37), r 131,16,6 → 133,33,26 (20), g 16,91,11 → 21,92,44
 *     (33), gold 175,132,51 → 182,127,25 (26) — TONED; the steel
 *     71,113,135 → 72,113,140 (5): as drawn;
 *   • the stripe's LIGHT strip (its 5 px highlight column, x 79–84 /
 *     1430–1435: the same pixels lighter than the body, eroded 1 px across
 *     and 4 down — the pack draws it as the colour paled toward white, print
 *     as the colour lit): w 241,236,230 → 250,243,226 (9), u 163,207,231 →
 *     0,155,218 (163), b 117,112,113 → 117,121,127 (14), r 198,91,81 →
 *     212,43,41 (48), g 91,161,86 → 93,165,67 (19), gold 239,199,122 →
 *     249,217,41 (81), the steel 175,217,239 → 196,214,228 (21) — TONED
 *     (one gain on the whole stripe turned the red's and green's light
 *     strips lilac and sky blue: their blue channel × 4.5 / × 4);
 *   • the wedge (the brace's colour, x 115–346 / 1156–1384, rows 264–298,
 *     eroded 4 px; #551's left out, its art covers them): w 209,203,195 →
 *     195,180,146 (49), u 5,94,140 → 0,96,157 (17), b 54,48,49 → 64,70,80
 *     (31), r 156,19,7 → 126,32,25 (30), g 19,109,13 → 18,86,41 (28), gold
 *     209,157,60 → 172,120,25 (37) — TONED; the steel 62,104,126 →
 *     69,108,133 (7, #550 alone): as drawn;
 *   • the box's blue panels (780–1100 × 1700–1830): 3,39,85 → 0,40,78 (7);
 *     the sides' blue (18–52 × 500–1000): 5,70,126 → 0,65,120 (6); the
 *     title bar 1,1,1 → 0,0,0, the type bar 0,0,0 → 2,3,3; the P/T box's
 *     blue rim (the plate's pixels with blue > 80, eroded 2 px) 7,70,125 →
 *     0,63,117 (8) — as drawn.
 * Through toneSourceRegions: a per-channel gain at the region's tone, fading
 * to the neutral (luma) gain toward white.
 */
export const TARDIS_PRINT_TONES = Object.freeze({
  stripe: Object.freeze({
    w: Object.freeze({ from: [176, 171, 165], to: [206, 190, 155] }),
    u: Object.freeze({ from: [6, 103, 154], to: [0, 101, 166] }),
    b: Object.freeze({ from: [44, 39, 40], to: [61, 67, 77] }),
    r: Object.freeze({ from: [131, 16, 6], to: [133, 33, 26] }),
    g: Object.freeze({ from: [16, 91, 11], to: [21, 92, 44] }),
    m: Object.freeze({ from: [175, 132, 51], to: [182, 127, 25] }),
  }),
  stripeLight: Object.freeze({
    w: Object.freeze({ from: [241, 236, 230], to: [250, 243, 226] }),
    u: Object.freeze({ from: [163, 207, 231], to: [0, 155, 218] }),
    b: Object.freeze({ from: [117, 112, 113], to: [117, 121, 127] }),
    r: Object.freeze({ from: [198, 91, 81], to: [212, 43, 41] }),
    g: Object.freeze({ from: [91, 161, 86], to: [93, 165, 67] }),
    m: Object.freeze({ from: [239, 199, 122], to: [249, 217, 41] }),
    a: Object.freeze({ from: [175, 217, 239], to: [196, 214, 228] }),
  }),
  wedge: Object.freeze({
    w: Object.freeze({ from: [209, 203, 195], to: [195, 180, 146] }),
    u: Object.freeze({ from: [5, 94, 140], to: [0, 96, 157] }),
    b: Object.freeze({ from: [54, 48, 49], to: [64, 70, 80] }),
    r: Object.freeze({ from: [156, 19, 7], to: [126, 32, 25] }),
    g: Object.freeze({ from: [19, 109, 13], to: [18, 86, 41] }),
    m: Object.freeze({ from: [209, 157, 60], to: [172, 120, 25] }),
  }),
});
/** The stripe / wedge region: full coverage where the file differs from the
 *  pack's blue file of its kind (the white one, for the blue and the steel
 *  files) by ≥ `full` levels (max channel), none at ≤ `none`. */
export const TARDIS_ACCENT_DIFF = Object.freeze({ full: 40, none: 16 });
/** The stripe's body / light split: the Rec. 601 luma between the body's and
 *  the light strip's (pack medians: w 174 / 237, u 79 / 196, b 41 / 114, r
 *  51 / 124, g 59 / 132, gold 140 / 205, steel 105 / 205), the coverage
 *  ramping across ± TARDIS_STRIPE_SPLIT_HALF — the body's share below it,
 *  the light strip's above. */
export const TARDIS_STRIPE_SPLIT = Object.freeze({ w: 210, u: 138, b: 76, r: 85, g: 95, m: 172, a: 157 });
export const TARDIS_STRIPE_SPLIT_HALF = 15;
/** The blue file a TARDIS file's accent is read against (its own colour's
 *  pixels are those that differ from it). */
const tardisAccentRef = (dir, key) => `${TARDIS}/${dir}${key === "u" || key === "a" ? "w" : "u"}.png`;
/** A frame file's tone entry: its stripe's body and light strip. */
function tardisFrameTone(key) {
  const diff = {};
  const tones = {};
  const split = TARDIS_STRIPE_SPLIT[key];
  for (const [region, side] of [["stripe", "below"], ["stripeLight", "above"]]) {
    if (!TARDIS_PRINT_TONES[region][key]) continue;
    diff[region] = Object.freeze({ file: tardisAccentRef("", key), ...TARDIS_ACCENT_DIFF, luma: Object.freeze({ split, half: TARDIS_STRIPE_SPLIT_HALF, side }) });
    tones[region] = TARDIS_PRINT_TONES[region][key];
  }
  return Object.freeze({ diff: Object.freeze(diff), tones: Object.freeze(tones), table: `TARDIS_PRINT_TONES (${key})` });
}
/** The TARDIS pack's toned files: every frame file (its stripe; the steel
 *  file its light strip alone) and every crown but the steel one (its
 *  wedges). */
export const TARDIS_SOURCE_TONES = Object.freeze(
  Object.fromEntries([
    ...["w", "u", "b", "r", "g", "m", "a"].map((k) => [`${TARDIS}/${k}.png`, tardisFrameTone(k)]),
    ...Object.keys(TARDIS_PRINT_TONES.wedge).map((k) => [
      `${TARDIS}/crowns/${k}.png`,
      Object.freeze({
        diff: Object.freeze({ wedge: Object.freeze({ file: tardisAccentRef("crowns/", k), ...TARDIS_ACCENT_DIFF }) }),
        tones: Object.freeze({ wedge: TARDIS_PRINT_TONES.wedge[k] }),
        table: `TARDIS_PRINT_TONES.wedge.${k}`,
      }),
    ]),
  ]),
);
const TARDIS_PT = Object.freeze(perColor(() => `${TARDIS}/pt.png`));
/** A key's master: the frame and its crown at the crown's bounds, as every
 *  print of the run draws them. */
const tardisMasterLayers = (k) => [layer(tardisFile("", k)), placed(tardisFile("crowns/", k), TARDIS_CROWN_AT)];
/** A pair's master: the two frames and the two crowns lerped across
 *  TARDIS_PAIR_RAMP. */
function tardisPairLayers(pair) {
  const [a, b] = pairSides(pair);
  return [
    { src: tardisFile("", a), right: tardisFile("", b), ramp: [...TARDIS_PAIR_RAMP] },
    placed(tardisFile("crowns/", a), TARDIS_CROWN_AT, { right: tardisFile("crowns/", b), ramp: [...TARDIS_PAIR_RAMP] }),
  ];
}
const TARDIS_NOTES = [
  "w u b r g m = the pack's colour frames (tardis/<k>.png, 1500x2100 NATIVE — no resample), each with the pack's 'Legendary Crown' (tardis/crowns/<k>.png, 1270x450) at its bounds 115/45 px, 1:1 — the angled brace under the title bar at the window's top corners, its wedge in the card's colour, which print draws on EVERY printing of the run, legendary or not (WHO #538 Dalek Squadron, #549 Weeping Angel, #550 Cyberman Patrol as the legends do): the frame's own drawing on this showcase, not an opt-in crown",
  "c = the pack's 'Artifact Frame' and crown (tardis/a.png, crowns/a.png, the steel stripe and wedge): the pack draws no colourless frame (and its Land frame and crown 404 in the tree); the run's two colourless printings are artifacts that print the steel (WHO #550 Cyberman Patrol, #551 TARDIS)",
  `the ten pairs (wu wb ub ur br bg rg rw gw gu, the "split" dress) = the pair's two frames and two crowns lerped across ${TARDIS_PAIR_RAMP[0]} → ${TARDIS_PAIR_RAMP[1]} %W (scripts/lib/pair-ramp.mjs blendPair): print draws a two-colour card's left stripe and wedge in its first colour and the right ones in its second (WHO #541–545, #547–549, #552–564); the masters differ only on x 61–346 and 1156–1439, so the ramp crosses identical pixels`,
  "a real black border at the top and the bottom (0,0,0 on the pack and on print), cut at the one card corner; the police box's blue sides run to the left and right edges (borderless — the edge contract's design), as print draws them",
  "plates = the pack's one 'Power/Toughness' box (tardis/pt.png, 299x173 at its ptBounds 1133/1850 px, 1:1) under every key",
  "toned onto the prints by one rule, the ring's (raw scan medians over WHO #535–564, each print registered on the pack's drawing, a region ≥ 9 levels off is toned — TARDIS_PRINT_TONES through TARDIS_SOURCE_TONES, recorded under sourceTones), as each FILE loads, so the masters and pairs drawn from it agree: each stripe's body and its light strip (the pixels where the frame file differs from the blue one — the white one for the blue and steel files — split by luma; the steel body is within 5 levels and stays as drawn) and every crown's wedge but the steel one (within 7); the box, the bars and the P/T box are within 8 levels and stay as drawn",
  "geometry as drawn: the pack is print's drawing at print's size — the bars, the box, the plate and the stamp housing sit within 2–3 px of the scans (one shift, the scans' crop) — so nothing is re-cut",
];
/**
 * The TARDIS showcase's triangle stamp notch (TODO 4.11): the pack's one
 * 'Gold Holo Stamp' (`tardis/stamp.png`, 176 × 80 at its stampBounds 662 /
 * 1909: a black trapezoid over the box's foot round the stamp) — 1:1 at HD,
 * no resample — cut to TARDIS_NOTCH_BOX: 1 px round the piece and 9 px past
 * its foot, so the Universes Beyond hole (apex 1992.5, lib/cards/holo-stamp.ts
 * UB_STAMP_HOLE — the run's prints set the stamp there: 686–816 px wide at
 * row 1925, 708–793 at 1950, the apex on 1990–1991, every one) and its ring
 * fit. The pack paints a capture of WotC's hologram in the trapezoid (its
 * triangle 693–806 × 1922–1985 px, inside the hole's cut — the rounded hole
 * reaches up to 1918): every lit pixel of it is painted opaque black first
 * (grown 1 px: belt and braces, the importer holds it), then the hole plus
 * 2 px cut clear and the 2 px round it painted black. Our own
 * triangle art covers the cut (lib/cards/holo-stamp-art.ts). One piece under
 * every key, the ten pairs' too (every master is the same box under it).
 */
export const TARDIS_NOTCH_BOX = Object.freeze({ x: 661, y: 1908, width: 178, height: 90 });
export const TARDIS_NOTCH = Object.freeze({
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "c", ...TWO_COLOR_PAIRS]),
  pieces: Object.freeze(Object.fromEntries(["w", "u", "b", "r", "g", "m", "c", ...TWO_COLOR_PAIRS].map((k) => [k, `${TARDIS}/stamp.png`]))),
  placeAt: Object.freeze({ x: 662, y: 1909, width: 176, height: 80 }),
  compositeSize: Object.freeze({ width: 1500, height: 2100 }),
  shape: Object.freeze({
    size: Object.freeze({ width: TARDIS_NOTCH_BOX.width, height: TARDIS_NOTCH_BOX.height }),
    bounds: Object.freeze({
      leftPct: (TARDIS_NOTCH_BOX.x / 1500) * 100,
      topPct: (TARDIS_NOTCH_BOX.y / 2100) * 100,
      widthPct: (TARDIS_NOTCH_BOX.width / 1500) * 100,
      heightPct: (TARDIS_NOTCH_BOX.height / 2100) * 100,
    }),
  }),
  /** The capture's pixels in the notch box: the trapezoid's lit pixels (luma
   *  > 40) on box x 27–150, rows 10–82 — the pack's triangle (693–806 ×
   *  1922–1985 px) and 4 px round it. */
  capture: Object.freeze({ x0: 27, x1: 150, y0: 10, y1: 82, minLuma: 40 }),
});

// ---------------------------------------------------------------------------
// TODO 4.11 (showcase rebuild, wave 1): the Lord of the Rings RING showcase
// (`lotr`; LTR #302–331 and their surge-foil twins #794–823 — sixty
// printings, every one a legendary creature) from Card Conjurer's 'Ring'
// pack (packRing.js, `img/frames/lotr/`, 1500 × 2100 NATIVE: nothing is
// resampled). Its masters replace the 646 px MSE drawing (layout v65's
// correction). Self-contained: the template, its crown band and its stamp
// notch read only the constants below.
//   • masters: the pack's eight frames whole — w u b r g, m (gold: three
//     colours or more, and today a pair), `a` the pack's blue-grey
//     'Artifact Frame' (FrameProfile.artifactMasterKeys { c: "a" }) and `c`
//     the pack's brown 'Land Frame' (the pack has no colourless frame; the
//     scroll's split, #604: a colourless card that is no artifact is a land
//     on that run's prints). The ring run prints NONE of the three
//     (sixty legendary creatures: 14 mono, 12 two-colour, 4 gold) — `a` and
//     `c` follow the scroll's rule unprinted.
//   • the frame field runs to the card's TOP and SIDE edges (as every print
//     has it: no border there) and the bottom is the black border's
//     shoulders: the edge contract's `design` edges (lib/frames/
//     edge-contract.ts). The importer cuts the one card corner at the two
//     BOTTOM corners only (`keepCorners`); the top corners are design — a
//     square output keeps the frame field there (lib/frames/square-corners.ts
//     "frame"), and every round output cuts it anyway (the renderer's card
//     corner).
//   • the art window is the pack's round one, cut off by the title and type
//     bars: see-through (α < 16) on 150–1350 × 254–1160 px, its soft white
//     foot (α 90) down to row 1170, everything else opaque — so the pack's
//     own artBounds (149 / 252 / 1202 × 918) cover it as a plain slot, and
//     the frame hides the slot's corners round the circle.
//   • plates: the pack's eight P/T plates (268 × 134 at ptBounds 1148 /
//     1857) — the colourless key the artifact's plate (the plate follows the
//     colour key; the scroll's rule).
//   • not built: the pack's two-colour dress (replacementMasks 'Right Half'
//     = `lotr/maskRightHalf.png`: the colour frames split down the card —
//     LTR #316 / #318–327 / #330, 24 of the 60 printings: a follow-up, a
//     two-colour card draws the gold master today).
// ---------------------------------------------------------------------------
export const RING = "img/frames/lotr";
/** The ring pack's plates, by colour key (the colourless card's is the
 *  artifact's: the plate follows the colour key, as on the scroll). */
const RING_PT = Object.freeze(perColor((k) => `${RING}/pt/${k === "c" ? "a" : k}.png`));
const RING_PACK = "packRing.js 'Ring' (the Lord of the Rings ring showcase; groupShowcase-5.js)";
/** The ring's master corners the importer leaves SQUARE: the frame field
 *  runs into them on print (lib/frames/square-corners.ts "frame"). */
export const RING_KEEP_CORNERS = Object.freeze(["tl", "tr"]);

/**
 * The ring pack's colours toned onto its prints (owner 2026-10-22, the #607
 * review: Card Conjurer's text-box paper is 40–60 levels off print on u / b
 * / r / g, where the MSE masters were within ~3). Measured on the Scryfall
 * PNGs at 1500 × 2100 (LTR #302–306 w, #307–308 u, #309–311 b, #312 r,
 * #313–315 g, #317 / #328 / #329 / #331 gold; the scans of one colour agree
 * to 1 level, so the medians are these):
 *   • paper — the 85th luma percentile of the box 200–1100 × 1700–1820 px
 *     (the colour of the paper's light ground, its texture under it):
 *       w 218,212,191 → 213,206,179;  u 123,165,195 → 163,188,216;
 *       b 156,157,156 → 204,202,202;  r 210,136,126 → 216,177,146;
 *       g 123,170,141 → 184,202,188;  gold 228,208,155 → 212,187,133.
 *     Every key is ≥ 9 levels off on a channel (w 12 in blue, gold 16–22),
 *     so every colour key is toned; the pack's `a` and `l` frames have no
 *     print and stay as drawn.
 *   • frame field — CC paints the field, the bars' faces and the plate's
 *     face one flat colour; on print the field, the plate's face and (but
 *     on blue) the bars agree within 3 levels (median of the three): r
 *     118,34,34 → 108,46,41; g 13,68,45 → 36,65,48. Left as drawn: w
 *     (134,123,105 vs 134,127,108), b (44,43,39 vs 47,46,42), gold
 *     (158,124,78 vs 159,126,73) — ≤ 5 levels — and blue (44,51,103 vs
 *     46,52,94): its prints set the bars LIGHTER (60,69,106) than the field,
 *     so one tone of CC's single colour would move the bars 12 off to fix
 *     the field by 9.
 * Through toneSourceRegions (UB_PRINT_TONES' function): per-channel gain at
 * the region's tone, fading to the neutral gain toward white, so a
 * highlight keeps its hue. The paper region is the pack's own Rules mask
 * (lotr/rules.png); the field region the pixels of the FILE near its flat
 * colour (nearRegionPlane: full within 2 levels, none past 24 — the cream
 * inscription and rims are far from it), so the crowns and plates, which
 * repaint the field, take the same tone as the masters.
 */
export const RING_PRINT_TONES = Object.freeze({
  paper: Object.freeze({
    w: Object.freeze({ from: [218, 212, 191], to: [213, 206, 179] }),
    u: Object.freeze({ from: [123, 165, 195], to: [163, 188, 216] }),
    b: Object.freeze({ from: [156, 157, 156], to: [204, 202, 202] }),
    r: Object.freeze({ from: [210, 136, 126], to: [216, 177, 146] }),
    g: Object.freeze({ from: [123, 170, 141], to: [184, 202, 188] }),
    m: Object.freeze({ from: [228, 208, 155], to: [212, 187, 133] }),
  }),
  field: Object.freeze({
    r: Object.freeze({ from: [118, 34, 34], to: [108, 46, 41] }),
    g: Object.freeze({ from: [13, 68, 45], to: [36, 65, 48] }),
  }),
});
/** The field region: full coverage within `full` levels (max channel) of
 *  the tone's `from`, none past `none`, linear between. */
export const RING_FIELD_NEAR = Object.freeze({ full: 2, none: 24 });
/**
 * A region of an image's OWN pixels: the coverage plane (0–255) of the
 * pixels near `rgb` — 255 within `full` levels on every channel, 0 past
 * `none` on any, linear between; a transparent pixel 0. Pure.
 */
export function nearRegionPlane(buf, width, height, rgb, { full, none }) {
  const n = width * height;
  if (buf.length !== n * 4) throw new Error(`nearRegionPlane: the image is not ${width}x${height} RGBA`);
  if (!(none > full && full >= 0)) throw new Error(`nearRegionPlane: bad range ${full}–${none}`);
  const plane = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) {
    const o = p * 4;
    if (buf[o + 3] === 0) continue;
    const d = Math.max(Math.abs(buf[o] - rgb[0]), Math.abs(buf[o + 1] - rgb[1]), Math.abs(buf[o + 2] - rgb[2]));
    plane[p] = d <= full ? 255 : d >= none ? 0 : Math.round((255 * (none - d)) / (none - full));
  }
  return plane;
}
/** One ring file's tone entry: the paper through the Rules mask (a file
 *  drawn on the whole card, or at `at` — the stamp piece, its box cut from
 *  the mask), the field by its own colour. */
function ringSourceTone(key, { paper, at = null }) {
  const tones = {};
  const masks = {};
  const near = {};
  if (paper && RING_PRINT_TONES.paper[key]) {
    tones.paper = RING_PRINT_TONES.paper[key];
    masks.paper = `${RING}/rules.png`;
  }
  if (RING_PRINT_TONES.field[key]) {
    tones.field = RING_PRINT_TONES.field[key];
    near.field = RING_FIELD_NEAR;
  }
  if (!Object.keys(tones).length) return null;
  return Object.freeze({ masks: Object.freeze(masks), near: Object.freeze(near), ...(at ? { maskAt: at } : {}), tones: Object.freeze(tones), table: `RING_PRINT_TONES (${key})` });
}
/** The ring's toned files: masters (paper + field), crowns and plates
 *  (field), stamp pieces (paper, the mask cut at the piece's place). */
export const RING_SOURCE_TONES = Object.freeze(
  Object.fromEntries(
    ["w", "u", "b", "r", "g", "m"].flatMap((k) =>
      [
        [`${RING}/${k}.png`, ringSourceTone(k, { paper: true })],
        [`${RING}/crown/${k}.png`, ringSourceTone(k, { paper: false })],
        [`${RING}/pt/${k}.png`, ringSourceTone(k, { paper: false })],
        [`${RING}/stamp/${k}.png`, ringSourceTone(k, { paper: true, at: { x: 644, y: 1893 } })],
      ].filter(([, t]) => t !== null),
    ),
  ),
);
const RING_NOTES = [
  "w u b r g m = the pack's colour frames whole (lotr/<k>.png, 1500x2100 NATIVE — no resample), as the LTR ring showcase prints them (LTR #302–331, #794–823)",
  "a = the pack's blue-grey 'Artifact Frame' (lotr/a.png): the master a colourless ARTIFACT paints (FrameProfile.artifactMasterKeys { c: 'a' }); c = the pack's brown 'Land Frame' (lotr/l.png) — the pack draws no colourless frame. The ring run prints neither (sixty legendary creatures, every one coloured): the scroll's split (#604) applied unprinted",
  "corners: the one card corner cut at the two BOTTOM corners (the black border's shoulders, as on every Card Conjurer master); the TOP corners kept square — the frame field runs to the card's top and side edges on every print, so a square output keeps it there (lib/frames/square-corners.ts 'frame'); a round output cuts it at render",
  "plates = the pack's eight plates (lotr/pt/<k>.png, 268x134 at ptBounds 1148/1857 px); c = the artifact's plate (the plate follows the colour key); the land plate is not published (no land creature prints on the frame)",
  "toned onto the prints (owner 2026-10-22; RING_PRINT_TONES through RING_SOURCE_TONES, recorded under sourceTones): the text-box paper of w u b r g and gold through the pack's Rules mask, and the frame field of r and g (the field, the bars' faces and the plate's face — one flat colour in the pack — by their own colour), as each FILE loads, so the masters, crowns, plates and stamp pieces drawn from it agree",
  "geometry as drawn (owner 2026-10-22): the pack draws its top block (edge inscription, title bar and rim) 12 px lower than the prints and its box bottom and plate 6 px higher — known and accepted; no flat zone allows a lossless re-cut of the top (the rim would thicken), so the slots ride the pack's own bars",
  "not built: the two-colour dress (replacementMasks 'Right Half' = lotr/maskRightHalf.png: the colour frames split down the card under the pack's bars — LTR #316, #318–327, #330 and their twins; a follow-up — a two-colour card draws the gold master today)",
];
/**
 * The ring's legendary crown (TODO 4.11): the pack's 'Legendary Crown'
 * (`lotr/crown/<k>.png`, 1500 × 272 at crownBounds 0 / 0) — the scalloped
 * cream title bar every print of the run carries (all sixty are
 * legendary), with the frame field round it: it repaints the whole top of
 * the card, so the band is rows 0–271 at 1:1, its two top corners kept
 * square as the masters' are.
 */
export const RING_CROWN_BAND = Object.freeze({
  source: `${RING}/crown`,
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "a", "l"]),
  crown: Object.freeze({ leftPct: 0, topPct: 0, widthPct: 100, heightPct: (272 / 2100) * 100 }),
  compositeSize: Object.freeze({ width: 1500, height: 2100 }),
  rows: 272,
});
/** The ring crown band's one layer for a key. */
export function ringCrownLayers(key) {
  if (!RING_CROWN_BAND.keys.includes(key)) throw new Error(`ringCrownLayers: no crown for key ${key}`);
  return [placed(`${RING_CROWN_BAND.source}/${key}.png`, RING_CROWN_BAND.crown)];
}
/**
 * What the importer checks on the full 1500 × 2100 ring-crown composite
 * (pure): nothing below the band's rows; the frame field opaque across the
 * band's top row and down both side edges (the crown repaints the card's
 * top edge to edge — its corners kept square, `keepCorners`); and the
 * title bar's interior see-through (the master's own bar shows there:
 * x 200–1300 on row 170).
 */
export function ringCrownFindings(buf, width, height, rows) {
  let lastAlphaRow = -1;
  for (let y = height - 1; y >= 0 && lastAlphaRow < 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      if (buf[(y * width + x) * 4 + 3] > 0) {
        lastAlphaRow = y;
        break;
      }
    }
  }
  let edgeMin = 255;
  for (let x = 0; x < width; x += 1) edgeMin = Math.min(edgeMin, buf[x * 4 + 3]);
  for (let y = 0; y < rows; y += 1) edgeMin = Math.min(edgeMin, buf[(y * width) * 4 + 3], buf[(y * width + width - 1) * 4 + 3]);
  let interior = 0;
  for (let x = 200; x <= 1300; x += 1) interior = Math.max(interior, buf[(170 * width + x) * 4 + 3]);
  const failures = [];
  if (lastAlphaRow >= rows) failures.push(`alpha down to row ${lastAlphaRow}, past the band's ${rows} rows`);
  if (edgeMin < 255) failures.push(`the frame field is α ${edgeMin} on the card's top or side edge (the crown repaints it edge to edge)`);
  if (interior > 0) failures.push(`the title bar's interior is α ${interior} on row 170 (the master's own bar shows there)`);
  return { lastAlphaRow, peakRow: 0, failures, summary: `edge α ≥ ${edgeMin}, title interior α ≤ ${interior}` };
}

/**
 * The ring's triangle stamp notch (TODO 4.11): the pack's per-colour
 * 'Holo Stamp' (`lotr/stamp/<k>.png`, 212 × 95 at stampBounds 644 / 1893:
 * the text box's rim stepped up round a black trapezoid) — 1:1 at HD, no
 * resample — cut to RING_NOTCH_BOX: 1 px round the piece (its soft edge
 * stops inside the box) and 10 px past its foot, so the Universes Beyond
 * hole (apex 1992.5) and its ring fit inside: below
 * the piece the box is clear but for that black ring, over the master's own
 * black border (lib/cards/template-layout.ts LOTR_HOLO_STAMP's rect).
 */
export const RING_NOTCH_BOX = Object.freeze({ x: 643, y: 1892, width: 214, height: 106 });
export const RING_NOTCH = Object.freeze({
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "a", "l"]),
  pieces: Object.freeze(Object.fromEntries(["w", "u", "b", "r", "g", "m", "a", "l"].map((k) => [k, `${RING}/stamp/${k}.png`]))),
  placeAt: Object.freeze({ x: 644, y: 1893, width: 212, height: 95 }),
  compositeSize: Object.freeze({ width: 1500, height: 2100 }),
  shape: Object.freeze({
    size: Object.freeze({ width: RING_NOTCH_BOX.width, height: RING_NOTCH_BOX.height }),
    bounds: Object.freeze({
      leftPct: (RING_NOTCH_BOX.x / 1500) * 100,
      topPct: (RING_NOTCH_BOX.y / 2100) * 100,
      widthPct: (RING_NOTCH_BOX.width / 1500) * 100,
      heightPct: (RING_NOTCH_BOX.height / 2100) * 100,
    }),
  }),
});

/**
 * The pack's hologram capture blacked out of a ring notch piece (in place,
 * before blackoutAndCut): every pixel where the pack's stamp shape
 * (`stamp`: gray.png's alpha at the piece's place, cut to the box) is
 * non-zero, grown by `growPx` (Chebyshev), becomes opaque black. The pack
 * draws its triangle 8–10 px HIGHER than the printed stamp (gray.png's top
 * edge at 1915 px, the stamp hole's at 1924.6), so the hole's own ring
 * leaves a strip of it above the cut: the shape itself goes, then the hole.
 */
export function blackoutStampShape(buf, stamp, width, height, growPx) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let hit = false;
      for (let dy = -growPx; dy <= growPx && !hit; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -growPx; dx <= growPx; dx += 1) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && stamp[yy * width + xx] > 0) {
            hit = true;
            break;
          }
        }
      }
      if (!hit) continue;
      const o = (y * width + x) * 4;
      buf[o] = 0;
      buf[o + 1] = 0;
      buf[o + 2] = 0;
      buf[o + 3] = 255;
    }
  }
  return buf;
}

/**
 * What the importer (and the unit test, on the published objects) checks
 * on a ring notch piece beside pieceNotchFindings (pure): every pixel where
 * the pack's stamp shape is non-zero is opaque black or transparent — no
 * pixel of the hologram capture is published.
 */
export function stampShapeBlackFindings(buf, stamp, width, height) {
  let leaks = 0;
  for (let p = 0; p < width * height; p += 1) {
    if (!stamp[p]) continue;
    const o = p * 4;
    if (buf[o + 3] === 0) continue;
    if (buf[o + 3] !== 255 || buf[o] || buf[o + 1] || buf[o + 2]) leaks += 1;
  }
  return { leaks, failures: leaks ? [`${leaks} px of the pack's stamp shape are neither opaque black nor clear`] : [] };
}

// ---------------------------------------------------------------------------
// TODO 4.11 (showcase rebuild, wave 2): the Wilds of Eldraine ENCHANTING
// TALES showcase (`enchantingtales`; the bonus sheet WOT #1–63, 2023 — 63
// printings, every one a mono-coloured enchantment, Auras and Bitterblossom's
// Kindred Enchantment among them, none legendary, none a creature) from Card
// Conjurer's 'Enchanting Tales' pack (packEnchantingTales.js,
// `img/frames/enchantingTales/`, 2010 × 2814: downscaled ONCE to 1500 ×
// 2100, Lanczos, as the scroll's). NOT WOT #64–83 (and their confetti-foil
// twins #84–103): the anime-style borderless reprints of twenty of the same
// cards, another design (dark translucent boxes, no swirls) the pack does not
// draw. An ADDITION: a new template, no stored card sits on it.
//   • masters: the pack's six colour frames whole — w u b r g, and m (gold,
//     no print: the run is mono-coloured) — and `c` = the WHITE frame: the
//     pack draws no colourless (or artifact, or land) frame and no
//     colourless card prints on it; the white page is CC's own nearest
//     neutral (its swirls 142,138,118, its bars 208,205,183).
//   • BORDERLESS as printed (Scryfall `border_color: borderless`): the
//     swirled frame field runs to the top edge and down both sides above
//     the art and beside the text box (design), the art to the side edges
//     between them, the dark footer in the colour's own tone (w 72,71,61, u
//     8,38,60 …) to the bottom edge — the importer cuts the one card corner.
//   • the art runs under the WHOLE frame from the title bar down: see-
//     through across the card's width from row 116 (the top-right shoulder)
//     to the type bar, and on under the translucent text box (α 204 on w,
//     222 on the others — print shows the art through it) to row 1931 —
//     CC's artBounds (0 / 111 / 1500 × 1821 px) cover it.
//   • plates: the pack's six P/T plates (499 × 276, drawn at its bounds
//     1535 / 2458 of 2010 × 2814 → 1145.5 / 1834.3 px, 278.4 × 153.7) — c the
//     white one. No print draws one (the run has no creature).
//   • geometry: the pack's LOWER block (type bar, text box, rim) is 3 px
//     below print and moved up onto it through the flat zones round it
//     (ETALES_LOWER_RECUT, lossless); its TOP block (swirls, title bar) is
//     3.5 px above print and kept as drawn — no flat zone lies above it —
//     so the name and cost row ride the pack's bar. Across, every bar edge
//     registers within a pixel.
//   • tones: nothing toned — every opaque region is within 5 levels of the
//     raw scan medians (ETALES_PRINT_TONE).
// ---------------------------------------------------------------------------
export const ETALES = "img/frames/enchantingTales";
/**
 * The pack's top rows made solid (ETALES' masters, before the corner cut):
 * Card Conjurer leaves a translucent crease (α 200–254, ~12 px wide) along
 * its own rounded corner at the two TOP corners (466–976 px a key at HD),
 * and the GOLD frame's swirls are near-opaque across its whole top band —
 * 3,136 px more at α 228–254 over x 35–1480 of rows 0–79 (one of them the
 * edge band's α 0.93 at x 1313) — so every pixel of rows 0–80 with α ≥ 128
 * takes α 255 in its own colour (3,282 px on the gold master). No art reaches above row 111
 * (the art slot), so nothing there is meant to be seen through — and the
 * corners are kept square (ETALES_KEEP_CORNERS), so a square output shows
 * the swirls there solid.
 */
export const ETALES_SOLID_ROWS = Object.freeze({ y0: 0, y1: 80, minAlpha: 128 });
/**
 * The pack's LOWER block moved onto print (TODO 4.11 wave 2), in the
 * written 1500 × 2100 master's rows, after the downscale: the type bar, the
 * text box, its bottom rim and the footer's top — rows 1163–1953 — 3 px up,
 * through the two FLAT zones round it (shiftBlocksRgba8: every row of each
 * identical across the card on every key, so nothing is resampled or
 * blended): the see-through art rows 472–1162 above (3 rows fewer) and the
 * footer's flat rows 1954–2099 below (3 rows more). Registered on the 63
 * prints (every edge, each against the pack's): the type bar's outlines at
 * 1167 / 1188 / 1299 px on print against 1171 / 1191 / 1302, the box's
 * bottom rim at 1929 against 1932, the footer's top 1947 against 1950 — 3 px
 * low, every column; across, every bar edge within a pixel. The TOP block
 * (the swirls and the title bar, rows 0–471) is kept as drawn: print draws
 * it 3.5 px lower (the bar's outlines 83 / 100.5 / 219.5 / 238.5 against 79
 * / 97 / 216 / 235) but no flat zone lies above it (the swirls run to the
 * card's top edge), so the name and the cost row ride the pack's bar.
 */
export const ETALES_LOWER_RECUT = Object.freeze({
  axis: "y",
  blocks: Object.freeze([Object.freeze({ from: 0, to: 472, by: 0 }), Object.freeze({ from: 1163, to: 1954, by: -3 })]),
});
/** Every corner is design (the swirled field at the top, the colour's
 *  footer at the bottom, opaque to the card's corner on every key): the
 *  importer keeps all four square, so a square output keeps them
 *  (lib/frames/square-corners.ts "frame"); every round output cuts them at
 *  render. */
export const ETALES_KEEP_CORNERS = Object.freeze(["tl", "tr", "bl", "br"]);
/**
 * Every pixel of an 8-bit RGBA image within `within` levels (max channel) of
 * `tone` — but not exactly it — takes that tone, its alpha kept (in place;
 * TODO 4.11 wave 2: the Enchanting Tales notch's well and the slightly
 * darker ring Card Conjurer draws on its outer ellipse, flattened into the
 * master's footer tone so the piece meets the footer with no line). Returns
 * how many pixels changed.
 */
export function flattenNearToneRgba8(buf, tone, within) {
  if (buf.length % 4 !== 0) throw new Error("flattenNearToneRgba8: not RGBA");
  if (!(Array.isArray(tone) && tone.length >= 3 && within >= 0 && within < 32)) throw new Error(`flattenNearToneRgba8: bad tone ${tone} / ${within}`);
  let changed = 0;
  for (let o = 0; o < buf.length; o += 4) {
    if (buf[o + 3] === 0) continue;
    const d = Math.max(Math.abs(buf[o] - tone[0]), Math.abs(buf[o + 1] - tone[1]), Math.abs(buf[o + 2] - tone[2]));
    if (d > within || d === 0) continue;
    buf[o] = tone[0];
    buf[o + 1] = tone[1];
    buf[o + 2] = tone[2];
    changed += 1;
  }
  return changed;
}
/**
 * A notch piece's rows from `fromRow` down: every pixel of the piece (α >
 * 0) outside its cut takes `tone`, opaque (in place; TODO 4.11 wave 2: the Enchanting
 * Tales piece below the text box's rim, where it lies on the master's flat
 * footer — the well and the pack's soft outer ellipse there become the
 * footer itself, so nothing of the piece's edge shows). The cut (`cut` grown
 * by `marginPx`, cutInside) stays transparent. Returns how many pixels
 * changed.
 */
export function fillRowsOutsideCut(buf, shape, cut, marginPx, fromRow, tone) {
  const { width, height } = shape.size;
  if (buf.length !== width * height * 4) throw new Error(`fillRowsOutsideCut: the piece is not ${width}x${height} RGBA`);
  if (!(fromRow >= 0 && fromRow < height)) throw new Error(`fillRowsOutsideCut: bad row ${fromRow}`);
  const inside = cutInside(shape, cut, marginPx);
  let changed = 0;
  for (let y = fromRow; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (inside(x, y, 0)) continue;
      const o = (y * width + x) * 4;
      // The piece's own pixels only: what it leaves clear stays clear (the
      // master's footer, the same tone, shows there).
      if (buf[o + 3] === 0) continue;
      if (buf[o] === tone[0] && buf[o + 1] === tone[1] && buf[o + 2] === tone[2] && buf[o + 3] === 255) continue;
      buf[o] = tone[0];
      buf[o + 1] = tone[1];
      buf[o + 2] = tone[2];
      buf[o + 3] = 255;
      changed += 1;
    }
  }
  return changed;
}
/**
 * Make the rows `y0` ≤ y < `y1` of an 8-bit RGBA image solid where they are
 * nearly so (in place): every pixel with `minAlpha` ≤ α < 255 takes α 255,
 * its colour kept. Returns how many pixels changed. Pure but for the buffer.
 */
export function solidifyRowsRgba8(buf, width, height, { y0, y1, minAlpha }) {
  if (buf.length !== width * height * 4) throw new Error(`solidifyRowsRgba8: the image is not ${width}x${height} RGBA`);
  if (!(y0 >= 0 && y1 <= height && y1 > y0 && minAlpha > 0 && minAlpha < 255)) throw new Error(`solidifyRowsRgba8: bad rows ${y0}–${y1} or α ${minAlpha}`);
  let changed = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4 + 3;
      if (buf[o] >= minAlpha && buf[o] < 255) {
        buf[o] = 255;
        changed += 1;
      }
    }
  }
  return changed;
}
const ETALES_PACK = "packEnchantingTales.js 'Enchanting Tales' (the Wilds of Eldraine bonus-sheet showcase, WOT #1–63; groupShowcase-5.js)";
/** The pack's file for a colour key: the white frame stands in for the
 *  colourless key (the pack draws none; no colourless card prints). */
const etalesFile = (dir, k) => `${ETALES}/${dir}${k === "c" ? "w" : k}.png`;
const ETALES_PT = Object.freeze(perColor((k) => etalesFile("pt/", k)));
/**
 * The pack against print by the ring's one rule (raw scan medians; a region
 * ≥ 9 levels off is toned): per colour, the median of the per-print medians
 * of the 63 WOT #1–63 PNGs at 1500 × 2100 (12–13 a colour; ink — |Δluma| >
 * 45 from the region's median — left out of the bars, box and footer)
 * against the pack's over the same pixels. Regions: the title bar (120–1380
 * × 100–195), the type bar (120–1250 × 1195–1285), the footer (60–1440 ×
 * 1945–2090) and the swirled frame field (the top band 100–1400 × 0–70, the
 * lower sides 5–80 / 1420–1495 × 1420–1900):
 *   w: bars 208,205,183 → 208,204,183; footer 72,71,61 → 72,71,61; field
 *      142,138,118 → 142,137,117;
 *   u: bars 150,196,227 → 150,195,227; footer 8,38,60 → 9,39,60; field
 *      5,75,105 → 4,74,104 (sides 1,67,99 → 5,68,98);
 *   b: bars 186,180,189 → 186,179,188; footer 22,12,21 → 23,13,22; field
 *      73,48,61 → 72,48,61;
 *   r: bars 223,189,179 → 222,188,178; footer 73,25,20 → 72,26,20; field
 *      98,26,17 → 97,26,16;
 *   g: bars 215,219,189 → 214,219,190; footer 49,54,22 → 49,55,23; field
 *      79,88,37 → 78,87,38.
 * Within 5 levels everywhere: as drawn. The text box is translucent over
 * the art (print shows the art through it), so it has no raw median to tone
 * by (the ghostfire's rule); its pack colour is kept. Gold has no print.
 */
export const ETALES_PRINT_TONE = Object.freeze({
  w: Object.freeze({ bars: [[208, 205, 183], [208, 204, 183]], footer: [[72, 71, 61], [72, 71, 61]], field: [[142, 138, 118], [142, 137, 117]] }),
  u: Object.freeze({ bars: [[150, 196, 227], [150, 195, 227]], footer: [[8, 38, 60], [9, 39, 60]], field: [[5, 75, 105], [4, 74, 104]] }),
  b: Object.freeze({ bars: [[186, 180, 189], [186, 179, 188]], footer: [[22, 12, 21], [23, 13, 22]], field: [[73, 48, 61], [72, 48, 61]] }),
  r: Object.freeze({ bars: [[223, 189, 179], [222, 188, 178]], footer: [[73, 25, 20], [72, 26, 20]], field: [[98, 26, 17], [97, 26, 16]] }),
  g: Object.freeze({ bars: [[215, 219, 189], [214, 219, 190]], footer: [[49, 54, 22], [49, 55, 23]], field: [[79, 88, 37], [78, 87, 38]] }),
});
const ETALES_NOTES = [
  "w u b r g m = the pack's colour frames whole (enchantingTales/<k>.png, 2010x2814), downscaled once to 1500x2100 (Lanczos) — as the Wilds of Eldraine Enchanting Tales showcase prints them (WOT #1–63); gold has no print (the run is mono-coloured)",
  "c = the pack's WHITE frame (enchantingTales/w.png): the pack draws no colourless, artifact or land frame and no colourless card prints on it; the white page is the pack's own nearest neutral",
  "borderless as printed: the swirled frame field to the top edge and down the sides above the art and beside the text box, the art to the side edges between them, the dark footer in the colour's own tone to the bottom edge; all four corners are design and kept square (keepCorners) — every round output cuts them at render",
  "the art under the whole frame from the title bar down: see-through across the card's width to the type bar, and on under the translucent text box (α 204 on w, 222 on the others, as print shows the art through it) to row 1931 — CC's artBounds (0/111, 1500x1821 px)",
  "plates = the pack's six P/T plates (enchantingTales/pt/<k>.png, 499x276, drawn at the pack's bounds 1535/2458 px, 373x206 of 2010x2814); c = the white one; no print draws one (the run has no creature)",
  `the pack against print by the ring's rule (raw scan medians over the bars, the footer and the swirled field, ink left out; a region ≥ 9 levels off is toned): within 5 levels on every colour (ETALES_PRINT_TONE) — nothing is toned; the text box is translucent over the art, so it has no raw median to tone by, and keeps the pack's colour`,
  "geometry: the LOWER block (rows 1163–1953 of the master: the type bar, the text box, its rim, the footer's top) moved 3 px UP onto the 63 prints through the flat zones round it (ETALES_LOWER_RECUT: the see-through art rows 472–1162 above, the footer's flat rows 1954–2099 below — every row of each identical across the card on every key; shiftBlocksRgba8, byte for byte, after the downscale); the TOP block (swirls, title bar) kept as drawn, 3.5 px above print's — no flat zone lies above it — so the name and the cost row ride the pack's bar; across, every bar edge registers within a pixel",
  "the top rows made solid after the downscale (ETALES_SOLID_ROWS: rows 0–80, α ≥ 128 → 255, the colour kept): the pack's translucent crease along its own rounded TOP corners (α 200–254) on every key, and on the gold frame the near-opaque swirls across its whole top band (3,136 px more at α 228–254, x 35–1480; 3,282 made solid in all); no art reaches above row 111",
  "no legendary crown: the pack draws none and no printing of the run is legendary",
  "not built: WOT #64–103, the anime-style borderless reprints — another design, not in the pack",
];
/**
 * The Enchanting Tales OVAL stamp notch (TODO 4.11 wave 2): the pack's
 * per-colour 'Holo Stamp' (`enchantingTales/stamp/<k>.png`, 306 × 176,
 * drawn at stampBounds 890 / 2548, 229 × 132 of 2010 × 2814 → 664.2 /
 * 1901.5 px, 170.9 × 98.5 at HD) — the text box's bottom rim arched up over
 * a well in the footer's own tone round the hologram oval — resampled ONCE
 * to its HD box, 171 × 99, placed ON PRINT at 666, 1898: 3 px up with the
 * master's lower block (ETALES_LOWER_RECUT: its ends meet the box's moved
 * rim) and 2 px right of the pack's bounds (the 45 stamped prints' arch runs
 * 678–825 px, centre 751.5, where the pack's placed piece ran 674–824,
 * 749), cut to ETALES_NOTCH_BOX (1 px round it). The prints'
 * oval (ETALES_STAMP_OVAL_PX) plus 2 px is cut clear; the well round it
 * stays the footer's own tone, as print draws it (no black ring:
 * blackoutPx 0). The rares and mythics of the run print it (`security_stamp:
 * oval`, 45 of 63), the uncommons don't.
 */
export const ETALES_NOTCH_BOX = Object.freeze({ x: 665, y: 1897, width: 173, height: 101 });
/**
 * The well flattened into the footer (TODO 4.11 wave 2, review of #618):
 * Card Conjurer draws the piece's well in the footer's tone but its outer
 * ellipse 4–8 levels darker (w 65,65,53 / 70,69,57 against the footer's
 * 72,71,61) — a faint oval line round the stamp that print does not have.
 * Every pixel of the cut piece within `within` levels of the master's
 * footer (read from the same key's master at `at`, a flat footer pixel)
 * takes that tone, its alpha kept (flattenNearToneRgba8) — the well inside
 * the arch — and from `footerFromRow` down (card row 1948: below the box's
 * rim, where the piece lies on the master's flat footer, rows 1947 on) every
 * pixel of the piece outside the cut IS the footer, opaque (fillRowsOutsideCut): the
 * pack's soft outer ellipse there — its 4–8 levels darker ring and its light
 * low-α fringe — leaves no line. The rim, the box and the cut are untouched.
 */
export const ETALES_WELL_TONE = Object.freeze({ master: "enchantingtales", at: Object.freeze({ x: 750, y: 2060 }), within: 12, footerFromRow: 51 });
/** The stamp's oval, card px: the PRINTS' hologram — the 45 stamped WOT
 *  prints' bright pixels at 688–814 × 1923–1986 (the median over the dark-
 *  footed prints, every one within a pixel), 127 × 64. The pack's own
 *  capture (687–815 × 1921–1983 where the piece is placed) lies inside it
 *  and the cut's 2 px. */
export const ETALES_STAMP_OVAL_PX = Object.freeze({ x: 688, y: 1923, width: 127, height: 64 });
export const ETALES_NOTCH = Object.freeze({
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "c"]),
  pieces: Object.freeze(Object.fromEntries(["w", "u", "b", "r", "g", "m", "c"].map((k) => [k, etalesFile("stamp/", k)]))),
  /** The piece's own size: resampled once to placeAt's. */
  nativeSize: Object.freeze({ width: 306, height: 176 }),
  placeAt: Object.freeze({ x: 666, y: 1898, width: 171, height: 99 }),
  compositeSize: Object.freeze({ width: OUT_W, height: OUT_H }),
  shape: Object.freeze({
    size: Object.freeze({ width: ETALES_NOTCH_BOX.width, height: ETALES_NOTCH_BOX.height }),
    bounds: Object.freeze({
      leftPct: (ETALES_NOTCH_BOX.x / 1500) * 100,
      topPct: (ETALES_NOTCH_BOX.y / 2100) * 100,
      widthPct: (ETALES_NOTCH_BOX.width / 1500) * 100,
      heightPct: (ETALES_NOTCH_BOX.height / 2100) * 100,
    }),
  }),
  oval: Object.freeze({
    leftPct: (ETALES_STAMP_OVAL_PX.x / 1500) * 100,
    topPct: (ETALES_STAMP_OVAL_PX.y / 2100) * 100,
    widthPct: (ETALES_STAMP_OVAL_PX.width / 1500) * 100,
    heightPct: (ETALES_STAMP_OVAL_PX.height / 2100) * 100,
  }),
  /** The capture's pixels in the notch box: the ellipse inscribed in x
   *  20–152, rows 20–92 of the box (the pack's hologram, at card x 687–815 ×
   *  1921–1983 where the piece is placed, lies inside it; the box's corners
   *  hold the text box's light rim and the piece's soft outer edge, which
   *  are no capture), its lit pixels (luma > 120 — the well round the
   *  hologram is the footer's darker tone, its anti-aliased inner edge
   *  ≤ 106 on the white piece), which the importer holds inside the cut. */
  capture: Object.freeze({ x0: 20, x1: 152, y0: 20, y1: 92, minLuma: 120, oval: true }),
});

// ---------------------------------------------------------------------------
// TODO 4.11 (showcase rebuild): the Multiverse Legends TARKIR "Dragon Wing"
// showcase (`tarkirdragon`; MUL #1 / #131 / #131z Anafenza, Kin-Tree Spirit
// — white — and #60 / #190 / #190z Taigam, Ojutai Master — white-blue: six
// printings of two legendary creatures, every one rare, each with the oval
// stamp) from Card Conjurer's 'Tarkir' pack (packTarkir.js, "Tarkir Sketch
// (MOM)", `img/frames/tarkir/`, 1500 × 2100 NATIVE: nothing is resampled).
// Its masters replace the 646 px MSE drawing (a layout correction).
// Self-contained: the template, its crown band and its stamp notch read only
// the constants below.
//   • masters: the pack's six colour frames whole — w u b r g and m (gold:
//     three colours or more; a pair draws its two colours' halves,
//     FrameProfile.twoColorSplit) — and `c` = the pack's 'Artifact Frame'
//     (tarkir/a.png, the silver-blue wings): the pack's Colorless frame is
//     commented out of packTarkir.js and 404s in the tree, so the
//     colourless card takes the frame Card Conjurer itself offers it. No
//     print exists (the run is a white and a white-blue legend).
//   • every master is the SAME drawing but for its dragon wings: two masters
//     differ only on x 47–442 and 1069–1457 (any difference, measured on all
//     seven; the wings run down the box's sides, x 58–182 and 1329–1440), so the
//     profile's hard two-colour seam at 50 %W crosses identical pixels — as
//     the pack's own 'Right Half' mask (tarkir/maskFrame.png, a ramp across
//     41.7–61.3 %W) does.
//   • a real black border all round (the edge contract's ALL_BORDER), cut
//     at the one card corner by the importer.
//   • the art window is see-through (α < 16) on 144–1349 × 244–1157 px with
//     a soft shadow round it (α < 250 on 131–1365 × 232–1158) on every key:
//     the profile's slot covers it with the art-window check's spare.
//   • plates: the pack's P/T plates (274 × 150 — the white one 273 × 150,
//     stretched to ptBounds — at ptBounds 1155 / 1850, 274 × 150) — the
//     colourless key the artifact's.
//   • geometry kept as drawn: registered region by region on the prints, the
//     pack's top block (crown, title bar) sits 6 px lower than print and its
//     box bottom, plate and stamp 6 px higher (the type bar within 1 px) —
//     print is the same drawing 0.66 % taller (and 0.4 % wider), a scale no
//     flat zone can re-cut (the wings run unbroken from the title bar to the
//     box). The slots ride the pack's own bars.
// ---------------------------------------------------------------------------
export const TARKIR = "img/frames/tarkir";
/** The pack's 'Artifact Frame' file stands in for its missing Colorless
 *  one (master, plate and crown alike). */
const tarkirFile = (dir, k) => `${TARKIR}/${dir}${k === "c" ? "a" : k}.png`;
const TARKIR_PT = Object.freeze(perColor((k) => tarkirFile("pt/", k)));
const TARKIR_PACK = "packTarkir.js 'Tarkir' (\"Tarkir Sketch (MOM)\" — the Multiverse Legends Tarkir dragon-wing showcase; groupShowcase-5.js)";

/**
 * The pack's colours toned onto the prints (TODO 4.11) by ONE rule — the
 * ring's (#607): the raw median of the Scryfall PNGs at 1500 × 2100 against
 * the pack's, over the same pixels (each print registered on the pack's
 * drawing; text and misregistered outlines, |Δluma| > 45, left out of both),
 * and any region off by ≥ 9 levels on a channel is toned. Per region (pack →
 * print, MUL #1 / #60; the halo-foil twins #131 / #190 print another ink
 * and are not read):
 *   • the w wings (the pixels where the colour's file differs from the
 *     artifact file by ≥ 40 levels, eroded 3 px): 207,178,138 →
 *     202,180,152 (#1's two wings and #60's left: 207,183,159 / 195,174,152 /
 *     202,180,149) — 14 off in blue: TONED;
 *   • the u wings: 56,110,211 → 75,105,177 (#60's right) — 19 / 34 off: TONED;
 *   • the text box (its dark ground, 130–1370 × 1330–1900): 53,53,52 →
 *     61,61,61 (#1) and 66,65,67 (#60), their mean 64,63,64 — 11 off: TONED;
 *   • the w plate's tan ends (the plate's coloured pixels, chroma ≥ 30):
 *     214,190,154 → 201,183,164 (#1) — 13 off: TONED;
 *   • the title bar's face: 197,197,197 → 198,198,201 (both) — 4: as drawn;
 *   • the type bar's face: 191,190,190 → 193,192,194 / 192,191,193 — 4: as
 *     drawn;
 *   • the plate's face: 201,202,203 → 196,199,201 / 196,198,198 — 5: as drawn;
 *   • the gold plate's ends (chroma ≥ 30): 188,146,56 → 187,151,51 (#60) —
 *     5: as drawn.
 * b r g, the gold wings and the artifact silver have no print: as drawn.
 * Through toneSourceRegions: a per-channel gain at the region's tone, fading
 * to the neutral (luma) gain toward white.
 */
export const TARKIR_PRINT_TONES = Object.freeze({
  wing: Object.freeze({
    w: Object.freeze({ from: [207, 178, 138], to: [202, 180, 152] }),
    u: Object.freeze({ from: [56, 110, 211], to: [75, 105, 177] }),
  }),
  box: Object.freeze({ from: [53, 53, 52], to: [64, 63, 64] }),
  plateEnds: Object.freeze({
    w: Object.freeze({ from: [214, 190, 154], to: [201, 183, 164] }),
  }),
});
/** The wing region: full coverage where the file differs from the pack's
 *  artifact file by ≥ `full` levels (max channel), none at ≤ `none`. */
export const TARKIR_WING_DIFF = Object.freeze({ full: 40, none: 16 });
/**
 * The text box region: inside the box (`rect`, card px — the masters' box
 * interior, 110–1390 × 1311–1925), on its dark ground (luma ≤ `luma[0]`
 * full, ≥ `luma[1]` none: the silver ornaments are lighter) and where the
 * file is the SAME as another master (max channel diff ≤ `same.full` full,
 * ≥ `same.none` none: the dragon wings that run down the box's sides,
 * x 58–182 and 1329–1440, are not the box). Every master draws the same box.
 */
export const TARKIR_BOX_REGION = Object.freeze({
  rect: Object.freeze({ x: 110, y: 1311, width: 1280, height: 614 }),
  luma: Object.freeze([110, 150]),
  same: Object.freeze({ full: 8, none: 24 }),
});
/** The plate ends' region: the plate's coloured pixels — chroma (max −
 *  min channel) ≥ `full` full, ≤ `none` none; the face is grey. */
export const TARKIR_PLATE_CHROMA = Object.freeze({ full: 30, none: 12 });
/**
 * A region of an image where it DIFFERS from a reference image of the same
 * size (both 8-bit RGBA): the coverage plane (0–255) — 255 where the max
 * channel difference is ≥ `full`, 0 at ≤ `none` or where either pixel is
 * transparent, linear between. The Tarkir pack draws every colour as one
 * drawing whose dragon wings alone change (TODO 4.11), so the region is
 * the colour's own wing pixels. With `luma` (TODO 4.11 wave 2: the TARDIS
 * stripe's body and its light strip, two regions of one difference) the
 * coverage is split by the pixel's own Rec. 601 luma: `side: "below"` keeps
 * the share 1 − s, `"above"` the share s, s ramping 0 → 1 across
 * `split ± half` — the two sides of one split sum to the plain coverage.
 * Pure.
 *
 * @param {Uint8Array | Buffer} buf
 * @param {Uint8Array | Buffer} ref
 * @param {number} width
 * @param {number} height
 * @param {{ full: number, none: number, luma?: { split: number, half: number, side: string } | null }} opts
 */
export function diffRegionPlane(buf, ref, width, height, { full, none, luma = null }) {
  const n = width * height;
  if (buf.length !== n * 4 || ref.length !== n * 4) throw new Error(`diffRegionPlane: the images are not ${width}x${height} RGBA`);
  if (!(full > none && none >= 0)) throw new Error(`diffRegionPlane: bad range ${none}–${full}`);
  if (luma && !(luma.half > 0 && (luma.side === "below" || luma.side === "above"))) throw new Error(`diffRegionPlane: bad luma split ${JSON.stringify(luma)}`);
  const plane = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) {
    const o = p * 4;
    if (buf[o + 3] === 0 || ref[o + 3] === 0) continue;
    const d = Math.max(Math.abs(buf[o] - ref[o]), Math.abs(buf[o + 1] - ref[o + 1]), Math.abs(buf[o + 2] - ref[o + 2]));
    let cover = d >= full ? 1 : d <= none ? 0 : (d - none) / (full - none);
    if (luma && cover > 0) {
      const l = 0.299 * buf[o] + 0.587 * buf[o + 1] + 0.114 * buf[o + 2];
      const s = Math.min(1, Math.max(0, (l - (luma.split - luma.half)) / (2 * luma.half)));
      cover *= luma.side === "above" ? s : 1 - s;
    }
    plane[p] = Math.round(255 * cover);
  }
  return plane;
}
/** A region of an image's coloured pixels: chroma (max − min channel) ≥
 *  `full` → 255, ≤ `none` → 0, linear between; a transparent pixel 0. Pure. */
export function chromaRegionPlane(buf, width, height, { full, none }) {
  const n = width * height;
  if (buf.length !== n * 4) throw new Error(`chromaRegionPlane: the image is not ${width}x${height} RGBA`);
  if (!(full > none && none >= 0)) throw new Error(`chromaRegionPlane: bad range ${none}–${full}`);
  const plane = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) {
    const o = p * 4;
    if (buf[o + 3] === 0) continue;
    const c = Math.max(buf[o], buf[o + 1], buf[o + 2]) - Math.min(buf[o], buf[o + 1], buf[o + 2]);
    plane[p] = c >= full ? 255 : c <= none ? 0 : Math.round((255 * (c - none)) / (full - none));
  }
  return plane;
}
/** The text box region of a whole-card master (TARKIR_BOX_REGION): the
 *  product of the box rect, the dark-ground ramp and the same-as-`ref`
 *  ramp. A PIECE drawn at `at` (card px — the stamp notch, whose arch
 *  carries the box's ground round it) reads the rect at that place and has
 *  no `ref` (null): no wing reaches it. Pure; the images 8-bit RGBA at
 *  `width × height`. */
export function boxRegionPlane(buf, ref, width, height, { rect, luma, same, at = { x: 0, y: 0 } }) {
  const n = width * height;
  if (buf.length !== n * 4 || (ref && ref.length !== n * 4)) throw new Error(`boxRegionPlane: the images are not ${width}x${height} RGBA`);
  const ramp = (v, full, none) => (full < none ? (v <= full ? 1 : v >= none ? 0 : (none - v) / (none - full)) : 0);
  const plane = new Uint8Array(n);
  for (let y = Math.max(0, rect.y - at.y); y < Math.min(height, rect.y + rect.height - at.y); y += 1) {
    for (let x = Math.max(0, rect.x - at.x); x < Math.min(width, rect.x + rect.width - at.x); x += 1) {
      const p = y * width + x;
      const o = p * 4;
      if (buf[o + 3] === 0) continue;
      const l = 0.299 * buf[o] + 0.587 * buf[o + 1] + 0.114 * buf[o + 2];
      const d = ref ? Math.max(Math.abs(buf[o] - ref[o]), Math.abs(buf[o + 1] - ref[o + 1]), Math.abs(buf[o + 2] - ref[o + 2])) : 0;
      plane[p] = Math.round(255 * ramp(l, luma[0], luma[1]) * (ref ? ramp(d, same.full, same.none) : 1));
    }
  }
  return plane;
}
/** A master's tone entry: its box (against another master: the artifact
 *  file, or the white one for the artifact file itself) and, for w / u, its
 *  wings (against the artifact file). */
function tarkirMasterTone(key) {
  const tones = { box: TARKIR_PRINT_TONES.box };
  const diff = {};
  if (TARKIR_PRINT_TONES.wing[key]) {
    tones.wing = TARKIR_PRINT_TONES.wing[key];
    diff.wing = Object.freeze({ file: `${TARKIR}/a.png`, ...TARKIR_WING_DIFF });
  }
  return Object.freeze({
    ...(Object.keys(diff).length ? { diff: Object.freeze(diff) } : {}),
    box: Object.freeze({ box: Object.freeze({ file: `${TARKIR}/${key === "a" ? "w" : "a"}.png`, ...TARKIR_BOX_REGION }) }),
    tones: Object.freeze(tones),
    table: `TARKIR_PRINT_TONES (${key})`,
  });
}
/** The Tarkir pack's toned files: every master (the box; w and u their
 *  wings too), the w and u crowns (their wings), the w plate (its ends) and
 *  the stamp notch piece (the box's ground its arch carries round it, at its
 *  place on the card — else it composites darker than the toned box, a
 *  faint halo round the arch). */
export const TARKIR_SOURCE_TONES = Object.freeze(
  Object.fromEntries([
    ...["w", "u", "b", "r", "g", "m", "a"].map((k) => [`${TARKIR}/${k}.png`, tarkirMasterTone(k)]),
    ...Object.keys(TARKIR_PRINT_TONES.wing).map((k) => [
      `${TARKIR}/crowns/${k}.png`,
      Object.freeze({
        diff: Object.freeze({ wing: Object.freeze({ file: `${TARKIR}/crowns/a.png`, ...TARKIR_WING_DIFF }) }),
        tones: Object.freeze({ wing: TARKIR_PRINT_TONES.wing[k] }),
        table: `TARKIR_PRINT_TONES (${k})`,
      }),
    ]),
    [
      `${TARKIR}/stamp.png`,
      Object.freeze({
        box: Object.freeze({ box: Object.freeze({ rect: TARKIR_BOX_REGION.rect, luma: TARKIR_BOX_REGION.luma, at: Object.freeze({ x: 638, y: 1888 }) }) }),
        tones: Object.freeze({ box: TARKIR_PRINT_TONES.box }),
        table: "TARKIR_PRINT_TONES (box: the stamp piece)",
      }),
    ],
    ...Object.keys(TARKIR_PRINT_TONES.plateEnds).map((k) => [
      `${TARKIR}/pt/${k}.png`,
      Object.freeze({
        chroma: Object.freeze({ plateEnds: TARKIR_PLATE_CHROMA }),
        tones: Object.freeze({ plateEnds: TARKIR_PRINT_TONES.plateEnds[k] }),
        table: `TARKIR_PRINT_TONES (${k})`,
      }),
    ]),
  ]),
);
const TARKIR_NOTES = [
  "w u b r g m = the pack's colour frames whole (tarkir/<k>.png, 1500x2100 NATIVE — no resample), as the MUL Tarkir showcase prints them (MUL #1 / #131 / #131z white, #60 / #190 / #190z white-blue); one drawing whose dragon wings alone take the colour (any two masters differ only on x 47–442 and 1069–1457), so a two-colour card's hard seam at 50 %W (FrameProfile.twoColorSplit) crosses identical pixels, as the pack's own 'Right Half' ramp (tarkir/maskFrame.png, 41.7–61.3 %W) does",
  "c = the pack's 'Artifact Frame' (tarkir/a.png, the silver-blue wings): the pack's Colorless frame is commented out of packTarkir.js and is not in the tree, so a colourless card wears the frame Card Conjurer offers it; no colourless card prints on the frame",
  "a real black border all round, cut at the one card corner",
  "plates = the pack's P/T plates (tarkir/pt/<k>.png, 274x150 — the white one 273x150, stretched to ptBounds — drawn at ptBounds 1155/1850 px, 274x150); c = the artifact's plate",
  "toned onto the prints by one rule, the ring's (raw scan medians; a region ≥ 9 levels off is toned — TARKIR_PRINT_TONES through TARKIR_SOURCE_TONES, recorded under sourceTones), as each FILE loads, so the masters, crowns and plates drawn from it agree: the w and u dragon wings (the pixels where the colour's file differs from the artifact file), every master's text box (its dark ground inside the box, where the master is the same as another) and the w plate's tan ends (its coloured pixels); the bars, the plate's face and the gold plate's ends are within 5 levels and stay as drawn, as do b r g, gold and the artifact silver (no print)",
  "geometry as drawn: the pack's top block (crown, title bar) sits 6 px lower than the prints and its box bottom, plate and stamp 6 px higher, the type bar within 1 px — print is the same drawing 0.66 % taller and 0.4 % wider, which no flat zone can re-cut (the wings run unbroken from the title bar to the box); the slots ride the pack's own bars",
];

/** The two-colour crown's ramp: the pack's own 'Right Half' mask
 *  (tarkir/maskFrame.png: α 0 at x ≤ 625, 255 at ≥ 920, straight between —
 *  41.7 → 61.3 %W), across which MUL #60 Taigam's crown turns from the
 *  white wing's tan to the blue (its centre bulb, 159,144,152 on print,
 *  the two blended). */
export const TARKIR_PAIR_RAMP = Object.freeze([41.7, 61.3]);
/** CC's crownBounds (180/1500, 51/2100, 1145 × 65 px: the image's own
 *  size, so 1:1). */
export const TARKIR_CROWN_BOUNDS = Object.freeze({ leftPct: (180 / 1500) * 100, topPct: (51 / 2100) * 100, widthPct: (1145 / 1500) * 100, heightPct: (65 / 2100) * 100 });
/**
 * The Tarkir legendary crown (TODO 4.11): the pack's 'Legend Crown'
 * (`tarkir/crowns/<k>.png`, 1145 × 65 at crownBounds 180 / 51) — the row of
 * dragon-wing spikes along the title bar's top that all six printings
 * carry (both legends) — 1:1 over a clear card, rows 0–119 kept. Keys: the
 * masters' w u b r g m c (c = the artifact crown, as the master) and the
 * ten pairs: the first colour's crown left, the second's right, across
 * TARKIR_PAIR_RAMP (MUL #60 prints its white-blue crown so).
 */
export const TARKIR_CROWN_BAND = Object.freeze({
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "c", ...TWO_COLOR_PAIRS]),
  crown: TARKIR_CROWN_BOUNDS,
  compositeSize: Object.freeze({ width: OUT_W, height: OUT_H }),
  rows: 120,
});
/** The Tarkir crown band's one layer for a key. */
export function tarkirCrownLayers(key) {
  if (!TARKIR_CROWN_BAND.keys.includes(key)) throw new Error(`tarkirCrownLayers: no crown for key ${key}`);
  if (TWO_COLOR_PAIRS.includes(key)) {
    const [a, b] = pairSides(key);
    return [placed(tarkirFile("crowns/", a), TARKIR_CROWN_BOUNDS, { right: tarkirFile("crowns/", b), ramp: [...TARKIR_PAIR_RAMP] })];
  }
  return [placed(tarkirFile("crowns/", key), TARKIR_CROWN_BOUNDS)];
}
/** What the importer checks on the full Tarkir crown composite (pure):
 *  nothing above the crown's bounds (row 51) or at or below the band's
 *  last row, and the spikes drawn (alpha reaches 255). */
export function tarkirCrownFindings(buf, width, height, rows) {
  let firstRow = -1;
  let lastAlphaRow = -1;
  let peak = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = buf[(y * width + x) * 4 + 3];
      if (a === 0) continue;
      if (firstRow < 0) firstRow = y;
      lastAlphaRow = y;
      peak = Math.max(peak, a);
    }
  }
  const failures = [];
  if (firstRow < 51) failures.push(`α from row ${firstRow}, above the crown's bounds (row 51)`);
  if (lastAlphaRow >= rows) failures.push(`alpha down to row ${lastAlphaRow}, past the band's ${rows} rows`);
  if (peak < 255) failures.push(`the crown is never opaque (α ≤ ${peak})`);
  return { lastAlphaRow, peakRow: firstRow, failures, summary: `rows ${firstRow}–${lastAlphaRow}` };
}

/**
 * The Tarkir showcase's OVAL stamp notch (TODO 4.11): the pack's one 'Holo
 * Stamp' (`tarkir/stamp.png`, 225 × 101 at stampBounds 638 / 1888 — the
 * text box's bottom rim arched over a black well round the hologram oval;
 * every colour's master has the same rim there) — 1:1 at HD, no resample —
 * cut to TARKIR_NOTCH_BOX: 1 px round the piece and 8 px past its foot, so
 * the oval cut and its black ring fit (below the piece the box is clear but
 * for that ring, over the master's own black border). The prints' oval (134
 * × 64 on the well's centre, TARKIR_STAMP_OVAL_PX — it covers the capture
 * the pack paints in the well, 685–815 × 1924.5–1987.5 px) is cut clear with
 * 2 px, the 2 px round it painted black, and our own oval art covers it
 * (lib/cards/holo-stamp-art.ts).
 * Its own piece per key (all seven the same pixels), as the masters'.
 */
export const TARKIR_NOTCH_BOX = Object.freeze({ x: 637, y: 1887, width: 227, height: 110 });
/** The stamp's oval, card px: the PRINTS' hologram — 134 × 64 (MUL #1 /
 *  #60 / #131 / #190: its ink 132–133 px across the widest row, 62–65 rows
 *  down the centre, inside a thin dark edge; M15's oval is 134 × 67, so the
 *  print agrees with it in width only) — on the centre of the pack's own
 *  well (750, 1956), whose capture (685–815 × 1924.5–1987.5, the ink at
 *  luma > 70) it covers. */
export const TARKIR_STAMP_OVAL_PX = Object.freeze({ x: 683, y: 1924, width: 134, height: 64 });
/** The pack's capture in the well, card px — what the cut must cover. */
export const TARKIR_CAPTURE_PX = Object.freeze({ x: 685, y: 1924.5, width: 130, height: 63 });
export const TARKIR_NOTCH = Object.freeze({
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "c"]),
  pieces: Object.freeze(Object.fromEntries(["w", "u", "b", "r", "g", "m", "c"].map((k) => [k, `${TARKIR}/stamp.png`]))),
  placeAt: Object.freeze({ x: 638, y: 1888, width: 225, height: 101 }),
  compositeSize: Object.freeze({ width: OUT_W, height: OUT_H }),
  shape: Object.freeze({
    size: Object.freeze({ width: TARKIR_NOTCH_BOX.width, height: TARKIR_NOTCH_BOX.height }),
    bounds: Object.freeze({
      leftPct: (TARKIR_NOTCH_BOX.x / 1500) * 100,
      topPct: (TARKIR_NOTCH_BOX.y / 2100) * 100,
      widthPct: (TARKIR_NOTCH_BOX.width / 1500) * 100,
      heightPct: (TARKIR_NOTCH_BOX.height / 2100) * 100,
    }),
  }),
  oval: Object.freeze({
    leftPct: (TARKIR_STAMP_OVAL_PX.x / 1500) * 100,
    topPct: (TARKIR_STAMP_OVAL_PX.y / 2100) * 100,
    widthPct: (TARKIR_STAMP_OVAL_PX.width / 1500) * 100,
    heightPct: (TARKIR_STAMP_OVAL_PX.height / 2100) * 100,
  }),
  /** The capture's pixels in the notch box (the well's lit pixels: x
   *  45–179, rows 39 on — the rim's own light pixels lie outside it), which
   *  the importer holds inside the cut and its ring. */
  capture: Object.freeze({ x0: 45, x1: 179, y0: 39, y1: 109, minLuma: 60 }),
});
/**
 * The hologram capture's plane in a placed notch piece (pure; 8-bit RGBA at
 * the box's size): α of every pixel inside `capture`'s box whose luma is
 * above `minLuma`, 0 elsewhere — what pieceNotchFindings holds inside the
 * cut and its ring (TODO 4.11: the Tarkir pack paints its capture in the
 * piece itself, with no separate shape file). With `oval`, only the pixels
 * inside the ellipse inscribed in the box count (TODO 4.11 wave 2: the MKM
 * dossier's well, whose arch shoulders — lit parchment — reach the box's
 * top corners; the Enchanting Tales piece, whose box corners hold the text
 * box's light rim and the piece's own soft edge).
 */
export function capturePlane(buf, width, height, { x0, x1, y0, y1, minLuma, oval = false }) {
  const plane = new Uint8Array(width * height);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2 + 0.5;
  const ry = (y1 - y0) / 2 + 0.5;
  for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y += 1) {
    for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x += 1) {
      if (oval && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
      const o = (y * width + x) * 4;
      if (buf[o + 3] === 0) continue;
      if ((buf[o] + buf[o + 1] + buf[o + 2]) / 3 > minLuma) plane[y * width + x] = buf[o + 3];
    }
  }
  return plane;
}

// ---------------------------------------------------------------------------
// TODO 4.11 (showcase rebuild, wave 2 item 1): the Dungeons & Dragons
// SOURCEBOOK showcase (`dndsourcebook`; Adventures in the Forgotten Realms
// AFR #299–349, 2021, and Commander Legends: Battle for Baldur's Gate CLB
// #375–450, 2022 — 127 printings; AFR #350–358, the nine lands of the same
// run, print the 'Dungeon Module' cover instead and are not this frame) from
// Card Conjurer's 'D&D Sourcebook' pack (packDNDSourcebook.js,
// `img/frames/dndSourcebook/`, 1500 × 2100 NATIVE: nothing is resampled).
// An ADDITION: a new template, no stored card sits on it.
//   • ONE master for every key: the pack draws one parchment page for every
//     colour, and so does print — a sourcebook card's colour is its ART's
//     background (a white card's pale pink, a blue's teal …), never the
//     frame's: the parchment's median is the same within print's own spread
//     whatever the colour (DND_PRINT_TONE below). So w u b r g c m are all
//     `frame.png`, byte for byte.
//   • a real black border all round (the edge contract's ALL_BORDER), cut
//     at the one card corner by the importer; the page's own rounded
//     corners are the pack's drawing.
//   • the art window is see-through on 133–1399 × 237–1175 px (α < 1) with
//     torn, half-transparent edges reaching 93–1439 × 227–1180 (α < 250):
//     the profile's slot covers that with the art-window check's spare.
//   • plates: the pack's one P/T plate (pt.png, 260 × 132, 1:1) under every
//     key; the profile draws it where print sets it (1167 / 1867), 6 px
//     right of and below the pack's ptBounds (1161 / 1861).
//   • geometry kept as drawn: print is the same page with its lines a few px
//     higher — the title rule 1.5 (AFR) / 5 (CLB) px, the art's foot and
//     the type rule 4–5 / 7.5 px — and its page's foot 3.5–4.5 px lower; the
//     lines run across textured parchment, never a flat zone, so nothing is
//     re-cut, and the slots ride the pack's own lines.
// ---------------------------------------------------------------------------
export const DND = "img/frames/dndSourcebook";
const DND_PACK = "packDNDSourcebook.js 'D&D Sourcebook' (the Adventures in the Forgotten Realms / Battle for Baldur's Gate sourcebook showcase; groupShowcase-5.js)";
/**
 * The parchment against print by the ring's one rule (raw scan medians; a
 * region ≥ 9 levels off is toned): the page's median over its title band,
 * type band and text box (100–1400 × 80–210, 1200–1295, 1340–1880 px; the
 * ink, |Δluma| > 45 from the region's median, left out) on all 127
 * sourcebook prints (Scryfall PNGs at 1500 × 2100), the median of the
 * per-print medians, against the pack's over the same pixels:
 *   • the pack 219,178,139 — print 217,181,144 (AFR 214,174,137, CLB
 *     218,183,146; the prints' quartiles 213–219 / 174–184 / 138–148): 2 /
 *     3 / 5 off — as drawn.
 * Nothing is toned.
 */
export const DND_PRINT_TONE = Object.freeze({ pack: Object.freeze([219, 178, 139]), print: Object.freeze([217, 181, 144]), afr: Object.freeze([214, 174, 137]), clb: Object.freeze([218, 183, 146]) });
const DND_PT = Object.freeze(perColor(() => `${DND}/pt.png`));
const DND_NOTES = [
  "w u b r g c m = the pack's one 'Frame' (dndSourcebook/frame.png, 1500x2100 NATIVE — no resample), byte for byte: the pack and print draw one parchment page for every colour (a sourcebook card's colour is its art's background), so there is no colour master to draw",
  "a real black border all round, cut at the one card corner; the page's own rounded corners are the pack's drawing",
  "plates = the pack's one 'Power/Toughness' plate (dndSourcebook/pt.png, 260x132, native size) under every key; the profile draws it 1:1 where print sets it (1167/1867 px, the median of 115 creatures), 6 px right of and below the pack's ptBounds (1161/1861)",
  `the parchment against print by the ring's rule (raw scan medians over the title band, type band and text box, ink left out; a region ≥ 9 levels off is toned): the pack ${DND_PRINT_TONE.pack.join(",")}, the 127 sourcebook prints ${DND_PRINT_TONE.print.join(",")} (AFR ${DND_PRINT_TONE.afr.join(",")}, CLB ${DND_PRINT_TONE.clb.join(",")}) — within 5 levels, as drawn: nothing is toned`,
  "geometry as drawn: print's lines sit a few px higher (the title rule 1.5 / 5 px on AFR / CLB, the art's foot and the type rule 4–5 / 7.5 px) and its page's foot 3.5–4.5 px lower; the lines cross textured parchment, never a flat zone, so nothing is re-cut and the slots ride the pack's own lines",
  "no legendary crown: the pack's 'Legend Crown' (dndSourcebook/crown.png) is not on print — none of the run's legendary printings (AFR #303, #304, #317, #323, #333, #335–347 and CLB's legends) prints one — so it is neither built nor published",
];

/**
 * The sourcebook's OVAL stamp notch (TODO 4.11): the pack's one 'Holo Stamp'
 * (`dndSourcebook/holo.png`, 186 × 78 at its bounds 657 / 1917 — the black
 * border arched up into the page's foot round the hologram oval) — 1:1 at
 * HD, no resample — cut to DND_NOTCH_BOX: 1 px round the piece and 8 px past
 * its foot, so the oval cut and its black ring fit (below the piece the box
 * is clear but for that ring, over the master's own black border). The
 * prints' oval (134 × 64 on the well's centre, DND_STAMP_OVAL_PX — it
 * covers the capture the pack paints in the well, 685–815 × 1930–1993 px)
 * is cut clear with 2 px, the 2 px round it painted black, and our own oval
 * art covers it (lib/cards/holo-stamp-art.ts). Its own piece per key (all
 * seven the same pixels), as the masters.
 */
export const DND_NOTCH_BOX = Object.freeze({ x: 656, y: 1916, width: 188, height: 88 });
/** The stamp's oval, card px: the PRINTS' hologram — 134 × 64 (the 49
 *  stamped prints: its right edge at 816–818, its foot at 1991–1994; the
 *  Tarkir and M15 prints' 134 across) — on the centre of the pack's own
 *  well (750, 1961), whose capture (DND_CAPTURE_PX) it covers. */
export const DND_STAMP_OVAL_PX = Object.freeze({ x: 683, y: 1929, width: 134, height: 64 });
/** The pack's capture in the well, card px — what the cut must cover
 *  (the piece's lit pixels, luma > 60: x 28–157, rows 13–75). */
export const DND_CAPTURE_PX = Object.freeze({ x: 685, y: 1930, width: 130, height: 63 });
export const DND_NOTCH = Object.freeze({
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "c"]),
  pieces: Object.freeze(Object.fromEntries(["w", "u", "b", "r", "g", "m", "c"].map((k) => [k, `${DND}/holo.png`]))),
  placeAt: Object.freeze({ x: 657, y: 1917, width: 186, height: 78 }),
  compositeSize: Object.freeze({ width: OUT_W, height: OUT_H }),
  shape: Object.freeze({
    size: Object.freeze({ width: DND_NOTCH_BOX.width, height: DND_NOTCH_BOX.height }),
    bounds: Object.freeze({
      leftPct: (DND_NOTCH_BOX.x / 1500) * 100,
      topPct: (DND_NOTCH_BOX.y / 2100) * 100,
      widthPct: (DND_NOTCH_BOX.width / 1500) * 100,
      heightPct: (DND_NOTCH_BOX.height / 2100) * 100,
    }),
  }),
  oval: Object.freeze({
    leftPct: (DND_STAMP_OVAL_PX.x / 1500) * 100,
    topPct: (DND_STAMP_OVAL_PX.y / 2100) * 100,
    widthPct: (DND_STAMP_OVAL_PX.width / 1500) * 100,
    heightPct: (DND_STAMP_OVAL_PX.height / 2100) * 100,
  }),
  /** The capture's pixels in the notch box (the well's lit pixels: x
   *  29–158, rows 14–76 of the box), which the importer holds inside the
   *  cut and its ring. */
  capture: Object.freeze({ x0: 29, x1: 158, y0: 14, y1: 76, minLuma: 60 }),
});

export const CC_TEMPLATES = {
  // TODO 4.11 wave 2: the D&D Sourcebook showcase (see DND above) — one
  // master for every key.
  dndsourcebook: {
    colors: perColor(() => [layer(`${DND}/frame.png`)]),
    plates: DND_PT,
    pack: DND_PACK,
    notes: DND_NOTES,
  },
  // TODO 4.11: the MUL Tarkir dragon-wing showcase (see TARKIR above).
  tarkirdragon: {
    colors: perColor((k) => [layer(tarkirFile("", k))]),
    plates: TARKIR_PT,
    pack: TARKIR_PACK,
    notes: TARKIR_NOTES,
  },
  // TODO 4.11: the Lord of the Rings ring showcase (see RING above).
  lotr: {
    colors: {
      ...perColor((k) => [layer(`${RING}/${k === "c" ? "l" : k}.png`)]),
      a: [layer(`${RING}/a.png`)],
    },
    plates: RING_PT,
    keepCorners: RING_KEEP_CORNERS,
    pack: RING_PACK,
    notes: RING_NOTES,
  },
  // TODO 4.11: the Lord of the Rings scroll showcase (see SCROLL above).
  lotrscroll: {
    colors: {
      ...perColor((k) => [layer(`${SCROLL}/${k === "c" ? "l" : k}.png`)]),
      a: [layer(`${SCROLL}/a.png`)],
    },
    plates: SCROLL_PT,
    pack: SCROLL_PACK,
    notes: SCROLL_NOTES,
  },
  // TODO 4.11 wave 2: the Murders at Karlov Manor dossier showcase (see
  // DOSSIER above) — and its ten two-colour pairs, lerped.
  dossier: {
    colors: {
      ...perColor((k) => [layer(dossierFile("", k))]),
      ...Object.fromEntries(
        TWO_COLOR_PAIRS.map((pair) => {
          const [a, b] = pairSides(pair);
          return [pair, [{ src: dossierFile("", a), right: dossierFile("", b), ramp: [...DOSSIER_PAIR_RAMP] }]];
        }),
      ),
    },
    plates: DOSSIER_PT,
    pack: DOSSIER_PACK,
    notes: DOSSIER_NOTES,
  },
  // TODO 4.11 wave 2: the Doctor Who TARDIS showcase (see TARDIS above) —
  // each master the frame and its brace, and the ten two-colour pairs.
  tardis: {
    colors: {
      ...perColor((k) => tardisMasterLayers(k)),
      ...Object.fromEntries(TWO_COLOR_PAIRS.map((pair) => [pair, tardisPairLayers(pair)])),
    },
    plates: TARDIS_PT,
    pack: TARDIS_PACK,
    notes: TARDIS_NOTES,
  },
  // TODO 4.11 wave 2: the Wilds of Eldraine Enchanting Tales showcase (see
  // ETALES above) — the pack's six frames, `c` the white one.
  enchantingtales: {
    colors: perColor((k) => [layer(etalesFile("", k))]),
    shift: ETALES_LOWER_RECUT,
    shiftOnOutput: true,
    solidRows: ETALES_SOLID_ROWS,
    keepCorners: ETALES_KEEP_CORNERS,
    plates: ETALES_PT,
    pack: ETALES_PACK,
    notes: ETALES_NOTES,
  },
  m15: {
    colors: {
      ...perColor((k) => [layer(`${NEW}/${k}.png`)]),
      ...pairMasters("m15", ["split", "hybrid"]),
    },
    plates: REG_PT,
    notes: [
      "colourless = CC's see-through 'Eldrazi' frame (new/c.png): the M15 profile draws the art under the frame for 'c' (underFrameArt, TODO 4.17), like printed colourless Eldrazi (owner decision 2026-09-25)",
      `${PAIR_NOTE}. Gold-split <pair> = m.png with the split text box and pinline (FDN #122 / #123 / #115 / #651 / #126); hybrid <pair>-h = the two colours' frames split across the frame ramp, CC's grey land bars (l.png title + type), the split text box and pinline, drawn with the grey plate pt/c (TLA #212, TLA #223–252)`,
    ],
  },
  m15artifact: {
    colors: {
      c: [layer(`${NEW}/a.png`)],
      ...perColor((k) => colouredArtifact(`${NEW}/a.png`, `${NEW}/${k}.png`, M15_BASE_MASKS, M15_INTERIOR_MASKS), WUBRGM),
      ...pairMasters("artifact", ["split"]),
    },
    plates: ARTIFACT_PT,
    notes: [
      "coloured artifacts = artifact frame + border, colour pinline/title/type/text box through CC's masks",
      `${PAIR_NOTE}. <pair> = the artifact frame + border, GOLD title and type bars (m.png), the split text box and pinline, drawn with the gold plate pt/m (DFT #188–220 gearhulks, MH3 #195, EOE #223); no hybrid dress (no hybrid plate on this template yet: a hybrid artifact draws the gold-split master)`,
    ],
  },
  // TODO 4.5c: the Vehicle frame — Card Conjurer's own recipe for a type
  // line that says Vehicle (creator-23.js cardFrameProperties: frame 'V'
  // through the Frame and Border masks, the colour's — or the artifact's —
  // pinline, title bar, type bar and text box on top, pt 'V'): m15artifact's
  // recipe with the bronze 'Vehicle Frame' (new/v.png) where the silver
  // artifact frame is. A NEW template (docs/FRAMES.md "A template never
  // gains a kind"): no stored card sits on it.
  m15vehicle: {
    colors: {
      ...perColor((k) => colouredArtifact(`${NEW}/v.png`, `${NEW}/${k === "c" ? "a" : k}.png`, M15_BASE_MASKS, M15_INTERIOR_MASKS)),
      // The ten two-colour Vehicles (owner 2026-10-12; DFT #188–220, NEO
      // #231, MKM #215): m15artifact's pair recipe — gold title and type
      // bars, the text box and the pinline split between the two colours —
      // over the bronze frame.
      ...pairMasters("artifact", ["split"], (pair, dress, kind) => pairMasterLayers(pair, dress, kind, vehicleFrameFile)),
    },
    plates: VEHICLE_PT,
    plateTone: VEHICLE_PLATE_TONE,
    pack: "packM15RegularNew.js 'Vehicle Frame' + 'Vehicle Power/Toughness' (groupAccurate.js; creator-23.js cardFrameProperties draws a Vehicle this way)",
    notes: [
      "every key = the bronze 'Vehicle Frame' (new/v.png) through CC's Border and Frame masks, then the colour's pinline, title bar, type bar and text box through CC's masks (colourless: the artifact frame's silver, new/a.png; gold for two colours or more, new/m.png) — CC's recipe for a Vehicle, m15artifact's with v.png for a.png; as KLD #235, NEO #9, WAR #24, DFT #188 print",
      "plates = CC's one brown Vehicle plate (m15PTV.png, 381x209) under every colour key (pt/<k>.png, seven names, one image): a printed Vehicle's plate is brown whatever its colour; the profile draws WHITE digits on it",
      `the plate is TONED onto the prints (plateTone: luma x ${VEHICLE_PLATE_TONE.luma}, saturation x ${VEHICLE_PLATE_TONE.saturation} about each pixel's own luminance — hue kept, alpha untouched): CC's face reads 110/73/30, the prints' median 123/91/67 over 52 plain Vehicles (KLD 2016 - 2026); 116/89/64 after`,
      `${PAIR_NOTE}. <pair> = the bronze Vehicle frame + border, GOLD title and type bars (m.png), the split text box and pinline — m15artifact's pair recipe with v.png for a.png — drawn with the same brown plate (DFT #188-220, NEO #231, MKM #215); no hybrid dress`,
    ],
  },
  // TODO 4.7: the Nyx dress — the printed enchantment frame (Theros 2013 on
  // the 2003 frame; on the 2015 frame C15 2015 → today: every enchantment
  // creature and enchantment artifact, and since Foundations 2024 every
  // enchantment). Card Conjurer's 'Nyx (Theros)' of the accurate M15 pack:
  // seven whole masters at 2010 × 2814 whose title bar, type bar, text box,
  // pinline and border are the regular M15 masters' own pixels (mean
  // difference 0.00–0.20 inside each of CC's five masks, 46–62 inside the
  // Frame mask: only the frame field is redrawn, as a starfield). A NEW
  // template (docs/FRAMES.md "A template never gains a kind"): no stored
  // card sits on it.
  m15nyx: {
    colors: {
      ...perColor((k) => [layer(nyxFrameFile(k === "c" ? "a" : k))]),
      // The two-colour dresses, as m15's (TODO 4.6b): gold-split — the gold
      // starfield under the split text box and pinline (THB #220, NEO #225,
      // FRC #52) — and hybrid — the two colours' starfields split across the
      // frame ramp under CC's grey land bars (HOB #155, FRA #134).
      ...pairMasters("m15", ["split", "hybrid"], (pair, dress, kind) => pairMasterLayers(pair, dress, kind, nyxFrameFile)),
    },
    plates: NYX_PT,
    pack: "packM15NyxNew.js 'Nyx (Theros)' (groupAccurate.js)",
    notes: [
      "every colour key = Card Conjurer's whole Nyx master (new/nyx/<k>.png, 2010x2814), downscaled once: the regular M15 master of that letter with its frame field redrawn as a starfield — inside CC's Title, Type, Rules, Pinline and Border masks the two files differ by a mean 0.00-0.20 of 255, inside the Frame mask by 46-62 (measured on all seven, 2026-10-13)",
      "colourless = the pack's 'Artifact Frame' (new/nyx/a.png): the pack draws no see-through colourless starfield, and the two colourless prints on the plain 2015 frame (CLB #1 Faceless One, SOC #131 Eldrazi Conscription) wear a silver-grey starfield; no art under the frame",
      "an Enchantment Artifact wears its COLOUR's starfield, never an artifact frame with coloured bars: C15 #86 / A25 #42 / LCC #146 Bident of Thassa (blue), CP2 #5 Whip of Erebos (black), EOC #88 Hammer of Purphoros (red)",
      "plates = the regular M15 plates (the pack has none: the prints set the P/T on M15's own plate, with no star on it) — m15's seven images under pt/<k>.png; the colourless key keeps the grey m15PTC, which is the hybrid dress's plate too (CLB #1 Faceless One's plate face reads 206/202/202: m15PTC's 210/202/197, not the artifact plate's 203/214/221)",
      `${PAIR_NOTE}. Gold-split <pair> = the gold starfield master (nyx/m.png) with the split text box and pinline (THB #220, NEO #225, C20 #226, FRC #52); hybrid <pair>-h = the two colours' starfield masters split across the frame ramp, the regular pack's grey land bars (l.png title + type: the Nyx pack has no land file and its bars are the regular masters' own), the split text box and pinline (HOB #155, FRA #134, ECC #121)`,
    ],
  },
  // TODO 4.25: the Universes Beyond frames — three NEW templates (no stored
  // card sits on them), m15 / m15artifact / m15land's recipes over the UB
  // pack's files.
  m15ub: {
    colors: {
      ...perColor((k) => (k === "c" ? UB_SEE_THROUGH_LAYERS : [layer(ubFrameFile(k))])),
      ...pairMasters("m15", ["split", "hybrid"], ubPairLayers),
    },
    plates: UB_PT,
    pack: UB_PACK,
    notes: [
      "w u b r g m = the pack's colour frames whole (new/ub/<k>.png), as m15's are new/<k>.png",
      "colourless (c) = the print's SEE-THROUGH frame (owner Round 57, decision 3; ACR #1, FIN #2, WHO #9 / #614): the pack lists a 'Colorless Frame' new/ub/c.png that is not in Card Conjurer's tree at this commit (404), so it is built from two of its drawings — the accurate pack's see-through colourless frame (new/c.png, m15/c's own file: every edge, rim, bevel and the alpha, value for value) with the OLDER Universes Beyond pack's see-through colourless frame (m15/ub/regular/c.png) as colour only through the accurate pack's Title, Type and Rules masks, paper onto paper only — weighted by that drawing's own luma AND by the luma of the accurate drawing below (each 0 at or below 150, whole from 190) and never where the older drawing is opaque (its rims): neither drawing's lines, rims or bevels are touched (the older pack's sit 1–5 px off the accurate geometry). The M15UB profile draws the art under the frame for 'c' (underFrameArt), as m15 does. Until 2026-10-14 this key was the pack's artifact frame, borrowed (never verified, no card on it)",
      "plates = the pack's own smooth plates (m15/ub/pt/<k>.png, 282x154, at M15's plate bounds); c = its grey 'Colorless' plate, which the hybrid dress draws too",
      UB_TONE_NOTE,
      `${UB_PAIR_NOTE}. Gold-split <pair> = m.png with the split text box and pinline (40K #104, LTR #287, PIP #210); hybrid <pair>-h = the two colours' frames split across the frame ramp, the pack's land-grey bars (l.png title + type), the split text box and pinline, drawn with the grey plate pt/c (ACR #55 / #60, PIP #212)`,
    ],
  },
  m15ubartifact: {
    colors: {
      c: [layer(`${UB}/a.png`)],
      ...perColor((k) => colouredArtifact(`${UB}/a.png`, `${UB}/${k}.png`, M15_BASE_MASKS, M15_INTERIOR_MASKS), WUBRGM),
      ...pairMasters("artifact", ["split"], ubPairLayers),
    },
    plates: UB_ARTIFACT_PT,
    pack: UB_PACK,
    notes: [
      "colourless = the pack's artifact frame whole (new/ub/a.png); coloured artifacts = that frame + border with the colour's pinline, title bar, type bar and text box through CC's accurate-M15 masks — m15artifact's recipe over the UB files (40K #25 / #54, FIN #23, PIP #538)",
      "plates = the pack's plates; c = its silver 'Artifact' plate (m15/ub/pt/a.png)",
      UB_TONE_NOTE,
      `${UB_PAIR_NOTE}. <pair> = the artifact frame + border, GOLD title and type bars (m.png), the split text box and pinline, drawn with the gold plate pt/m (40K #106 / #110, WHO #119, PIP #211); no hybrid dress`,
    ],
  },
  m15ubland: {
    colors: {
      ...perColor((k) => [layer(k === "c" ? `${UB}/l.png` : `${UB}/l${k}.png`)]),
      ...pairMasters("land", ["split"], ubPairLayers),
    },
    pack: UB_PACK,
    notes: [
      "colourless land = the pack's land frame new/ub/l.png; a coloured land its tinted one (new/ub/l<k>.png; gold lm for three colours or more)",
      UB_TONE_NOTE,
      `${UB_PAIR_NOTE}. <pair> = the land frame l.png with the split text box and pinline in the two land tints, as 40K #268, PIP #297 and LTR #258 print`,
      "no plates of its own: a land creature draws the UB spell frame's plates (the profile's plateAssetPathTemplate)",
    ],
  },
  m15land: {
    colors: {
      ...perColor((k) => [layer(k === "c" ? `${NEW}/l.png` : `${NEW}/l${k}.png`)]),
      ...pairMasters("land", ["split"]),
    },
    notes: [
      "colourless land = CC's land frame new/l.png",
      `${PAIR_NOTE}. <pair> = CC's land frame l.png (grey frame and bars) with the split text box and pinline in the two land tints (new/l<k>.png), as MKM #259–271 and LTR #258 print`,
    ],
  },
  // 4.6f (wave 2c): the ten white-bar pair masters (snowPairLayers) beside
  // the seven monos; the legendary crown is the standard band over them
  // (M15_CROWN on the m15snow entry, keyMap c → a: no new objects).
  m15snow: {
    colors: {
      ...perColor((k) => [layer(k === "c" ? `${SNOW}/a.png` : `${SNOW}/${k}.png`)]),
      ...pairMasters("snow", ["split"], snowPairLayers),
    },
    plates: ARTIFACT_PT,
    notes: [
      "colourless snow = CC's snow artifact frame (colourless snow nonland prints are artifacts)",
      `${SNOW_PAIR_NOTE}. <pair> = the snow gold frame m.png whole (the gold body KHM #224 / #223 / #230 print) with the split text box, WHITE title and type bars — the pack's white frame w.png through CC's Title and Type masks, warmed a quarter of the way to the gold bar (m.png at ${Math.round(SNOW_PAIR_BAR_GOLD_SHARE * 100)}% through the same masks: the prints' bars are the whitest of KHM's but for w's, with a faint warm cast; owner round 20: white bars) — and the split pinline, drawn with the gold plate pt/m as the prints are; no hybrid dress (no hybrid snow print exists)`,
    ],
  },
  m15snowland: {
    colors: {
      ...perColor((k) => [layer(k === "c" ? `${SNOW}/l.png` : `${SNOW}/l${k}.png`)]),
      ...pairMasters("snowland", ["split"], snowPairLayers),
    },
    notes: [
      `${SNOW_PAIR_NOTE}. <pair> = CC's snow land frame l.png (the grey body and neutral white bars every KHM snow land prints) with the split text box and pinline in the two snow land tints (snow/l<k>.png), as the ten KHM snow duals #248–274 print`,
    ],
  },
  m15devoid: {
    // Every CC devoid frame is see-through (text box alpha ~179): the
    // M15DEVOID profile draws the art under the whole frame (4.17).
    colors: perColor((k) => [
      layer(k === "c" ? `${NEW}/c.png` : `${DEVOID}/m15DevoidFrame${k.toUpperCase()}.png`),
    ]),
    plates: perColor(() => `${DEVOID}/m15DevoidPT.png`),
    notes: [
      "see-through frames: the art runs under the whole frame (underFrameArt)",
      "true colourless = the colourless 'Eldrazi' frame; devoid colours keep their pinline",
    ],
  },
  m15pw: {
    colors: perColor((k) => [layer(`${PW}/planeswalkerFrame${k === "c" ? "A" : k.toUpperCase()}.png`)]),
    // CC draws the ability stripes BEFORE the frame, so the shield its
    // masters paint sits on top of them. Ours are an overlay above the frame
    // and washed the shield out (owner review 2026-09-25), so each master's
    // shield is cut out through CC's loyalty mask and drawn again as the
    // loyalty plate, above the stripes.
    shield: { mask: "img/frames/planeswalker/maskLoyalty.png", box: SHIELD_BOX },
    notes: [
      "colourless planeswalker = CC's artifact planeswalker frame",
      "the loyalty shield is the master's own pixels cut out through CC's maskLoyalty.png (loyalty/<colour>.png), drawn above the ability stripes",
    ],
  },
  m15token: {
    colors: {
      ...perColor((k) => [layer(`${TOKEN}/${k}.png`)], WUBRGM),
      // Printed colourless creature tokens (BFZ Eldrazi Scion, MH1
      // Shapeshifter, WAR Spirit) have a SEE-THROUGH grey frame with the art
      // running under it. CC's bordered token pack has no such frame, so it
      // is a PipGlyph composite of CC's silver token frame: opaque border,
      // black title bar and window pinline, translucent frame + type bar.
      c: [
        layer(`${TOKEN}/a.png`, `${REG}/m15MaskBorder.png`),
        layer(`${TOKEN}/a.png`, `${TOKEN}/frame.svg`, 0.35),
        layer(`${TOKEN}/a.png`, "img/frames/token/tokenMaskTextlessType.png", 0.8),
        layer(`${TOKEN}/a.png`, `${REG}/m15MaskTitle.png`),
        layer(`${TOKEN}/a.png`, `${TOKEN}/pinline.svg`),
      ],
    },
    recut: TOKEN_TEXTLESS_RECUT,
    pack: TOKEN_TEXTLESS_PACK,
    transforms: textlessRecutTransform(TOKEN_TEXTLESS_RECUT),
    notes: [
      "source: CC 'Textless (Bordered M15)' — its geometry matches the M15TOKEN profile (art 12.5–81.3 %, type bar ~82 %)",
      "colourless creature token = PipGlyph composite: CC's silver token frame at 35 % (frame) / 80 % (type bar) opacity over the art, like printed BFZ/MH1/WAR colourless tokens (owner decision 2026-09-25)",
      "re-cut onto the prints (TODO 4.49, owner decision 2026-09-29): the window's bottom edge, the type pill and its shadow 8 px lower, as the fifteen 2014–19 textless pins print them; PipGlyph composite of CC pixels",
    ],
  },
  m15tokenartifact: {
    colors: {
      c: [layer(`${TOKEN}/a.png`)],
      ...perColor((k) => colouredArtifact(`${TOKEN}/a.png`, `${TOKEN}/${k}.png`, TOKEN_BASE_MASKS, TOKEN_INTERIOR_MASKS), WUBRGM),
    },
    recut: TOKEN_TEXTLESS_RECUT,
    pack: TOKEN_TEXTLESS_PACK,
    transforms: textlessRecutTransform(TOKEN_TEXTLESS_RECUT),
    notes: [
      "coloured artifact tokens = artifact token frame, colour pinline/title/type through CC's token masks",
      "re-cut onto the prints like m15token (TODO 4.49, owner decision 2026-09-29)",
    ],
  },
  // TODO 4.49 (b) — the 2014–19 arch token with a text box (CC 'Regular
  // (Bordered M15)'), re-cut onto the prints (TOKEN_REGULAR_RECUT).
  m15tokentext: {
    colors: {
      ...perColor((k) => [layer(`${TOKEN_REG}/${k}.png`)], WUBRGM),
      // Built like m15token's `c`: printed colourless text-box tokens (BFZ /
      // OGW Eldrazi Scion) are see-through over the art, the box too.
      c: [
        layer(`${TOKEN_REG}/a.png`, `${REG}/m15MaskBorder.png`),
        layer(`${TOKEN_REG}/a.png`, `${TOKEN_REG}/frame.svg`, 0.35),
        layer(`${TOKEN_REG}/a.png`, "img/frames/token/tokenMaskRegularType.png", 0.8),
        layer(`${TOKEN_REG}/a.png`, TOKEN_REG_RULES_MASK, 0.8),
        layer(`${TOKEN_REG}/a.png`, `${REG}/m15MaskTitle.png`),
        layer(`${TOKEN_REG}/a.png`, `${TOKEN_REG}/pinline.svg`),
      ],
    },
    recut: TOKEN_REGULAR_RECUT,
    pack: "packTokenRegularM15.js 'Regular (Bordered M15)'",
    transforms: recutTransform(TOKEN_REGULAR_RECUT),
    notes: [
      "source: CC 'Regular (Bordered M15)' — the arch token with a cream type pill and a text box, re-cut onto the prints (TODO 4.49 (b)): CC's lower band sits ~3 %H above TXLN #10, TDOM #2, TM19 #1 and TC17 #9",
      "colourless = PipGlyph composite like m15token's: CC's silver token frame at 35 % (frame) / 80 % (type pill and text box) opacity over the art, as BFZ #2 / OGW #1 Eldrazi Scion print",
    ],
  },
  // Its artifact dress (4.48's model, owner 2026-09-29: artifact tokens get
  // their own templates), mirroring m15tokenartifact.
  m15tokenartifacttext: {
    colors: {
      c: [layer(`${TOKEN_REG}/a.png`)],
      ...perColor(
        (k) => colouredArtifact(`${TOKEN_REG}/a.png`, `${TOKEN_REG}/${k}.png`, TOKEN_REG_BASE_MASKS, TOKEN_REG_INTERIOR_MASKS),
        WUBRGM,
      ),
    },
    recut: TOKEN_REGULAR_RECUT,
    pack: "packTokenRegularM15.js 'Regular (Bordered M15)'",
    transforms: recutTransform(TOKEN_REGULAR_RECUT),
    notes: [
      "source: CC 'Regular (Bordered M15)' Artifact Frame (a.png), re-cut onto the prints like m15tokentext (TODO 4.49 (b))",
      "coloured artifact tokens = the silver token frame + border and box, the colour through CC's Title, Type and Pinline masks (TC16 #9, TC18 #8 Thopter print a blue pinline and pill on the silver frame and box)",
    ],
  },
  // TODO 4.48 — the full-art token design (M20 → today), three printed
  // heights: textless (re-cut onto the prints), the regular box (CC
  // 'Short') and the tall box.
  m20token: m20TokenTemplate("textless", false),
  m20tokentext: m20TokenTemplate("short", false),
  m20tokentall: m20TokenTemplate("tall", false),
  // TODO 4.50 — their artifact templates (owner 2026-09-29: artifact tokens
  // get their own templates, picked from the Artifact type word).
  m20tokenartifact: m20TokenTemplate("textless", true),
  m20tokenartifacttext: m20TokenTemplate("short", true),
  m20tokenartifacttall: m20TokenTemplate("tall", true),
  // 4.32 — the standard borderless frame (2019+): art to the card edge.
  // 4.6f (wave 2a) adds the floating legendary crown as `<key>-legendary`
  // masters and the ten pinline-split pair masters (borderlessMasters).
  m15borderless: {
    colors: borderlessMasters(
      (k) => k,
      (k) => k,
      ["split", "hybrid"],
    ),
    plates: BORDERLESS_PT,
    pack: "packBorderless.js 'Borderless (Alt)' (groupShowcase-5.js:49) + the floating crown of packM15LegendCrownsFloating.js (4.6f)",
    transforms:
      "native 1500x2100, pixels copied 1:1 (no resample), corners rounded to the importer radius; a -legendary master erases CC's strip and draws the outline and the floating crown at CC's bounds, 1:1; a pair master draws the pinline region as the two frames lerped across the untilted pinline ramp (4.6f)",
    notes: [
      "colourless = CC's see-through colourless frame (m15GenericShowcaseFrameC.png): the art runs under the frame, as on m15 'c' (4.17)",
      "colourless P/T plate = the pack's 'Colorless Power/Toughness' pt/l.png (the unlisted pt/c.png is not used)",
      "CC's 'Land Frame' (m15GenericShowcaseFrameL.png) is not imported here: it is 4.34's m15borderlessland",
      ...BORDERLESS_ANATOMY_NOTES,
    ],
  },
  // 4.32 — its artifact skin, mirroring m15artifact. 4.6f: the same crowned
  // twins and pairs; its colourless crown is CC's artifact crown (A).
  m15borderlessartifact: {
    colors: borderlessMasters(
      // A coloured artifact wears the colour frame (see notes).
      (k) => (k === "c" ? "a" : k),
      (k) => (k === "c" ? "a" : k),
      ["split"],
    ),
    plates: { ...BORDERLESS_PT, c: `${BORDERLESS}/pt/a.png` },
    pack: "packBorderless.js 'Borderless (Alt)' (groupShowcase-5.js:49) + the floating crown of packM15LegendCrownsFloating.js (4.6f)",
    transforms:
      "native 1500x2100, pixels copied 1:1 (no resample), corners rounded to the importer radius; a -legendary master erases CC's strip and draws the outline and the floating crown at CC's bounds, 1:1; a pair master draws the pinline region as the two frames lerped across the untilted pinline ramp (4.6f)",
    notes: [
      "colourless artifact = CC's 'Artifact Frame' (m15GenericShowcaseFrameA.png) with the 'Artifact Power/Toughness' plate pt/a.png",
      "coloured artifacts = the colour frame, whole (same bytes as m15borderless). 4.16's recipe (artifact frame + border, colour interior) keeps the ARTIFACT frame only where the colour doesn't draw: the frame body and the border. A full-bleed frame has no frame body, and the Border region (bottom bar + fins) of the Artifact frame matches every colour's (premultiplied; measured 2026-09-26). Drawn through the pack's masks it would only add damage: a partial-alpha seam row at 92.76-92.81 % H between the Pinline and Border masks, and the bars' outer bevel (0.13 % of the frame's alpha lies outside the five masks)",
      ...BORDERLESS_ANATOMY_NOTES,
      "colourless artifact crown = CC's 'Artifact Legend Crown' (m15CrownAFloating.png) on the artifact frame; the coloured and pair masters are the same bytes as m15borderless's",
    ],
  },
  // 4.34 — the borderless nonbasic land: the colour on the title bar, the
  // type bar AND the text box (borderlessLandLayers). 4.56 adds the ten
  // two-colour pair masters from the same function (borderlessLandPairs).
  m15borderlessland: {
    colors: {
      ...perColor((k) => {
        const letter = borderlessLandLetter(k);
        return borderlessLandLayers({ frame: letter, box: letter, pinline: letter });
      }),
      ...borderlessLandPairs(),
    },
    pack: "packBorderless.js 'Borderless (Alt)' (groupShowcase-5.js:49) + the text-box structure of packGenericShowcase.js 'Borderless' (groupShowcase-5.js:48)",
    transforms: `native 1500x2100, no resample; a PipGlyph composite of the packs' pixels: the colour's frame whole, its title bar moved down ${BORDERLESS_TITLE_TO_TYPE_DY} px onto the type bar (replacing it through CC's Type mask), genericShowcase's neutral text box re-tinted to the colour's title-bar tint (the flat pixel at (${BORDERLESS_TINT_POINT.x}, ${BORDERLESS_TINT_POINT.y})) at its own alpha (replacing the dark box through CC's Rules mask), the pinline through the pack's Pinline mask on top; a pair master draws the box and the pinline as its two colours' lerped across the untilted ${rampName(PAIR_RAMPS.borderlessLand)} (4.56); corners rounded to the importer radius`,
    notes: [
      "the print's land look (2026-09-29, 50+ borderless land printings): title bar, type bar and text box all wear the colour's title-bar tint; a borderless spell tints only its title bar (m15borderless)",
      "colourless = CC's 'Land Frame' (m15GenericShowcaseFrameL.png): grey bars and box, the land's brown-grey pinline (the prints' #a5988a on CMM #663 / FRA #379), never the see-through 'Colorless Frame'",
      "m = the three-and-more-colour land (gold bars, box and pinline: CMM #659, SNC #291); two-colour lands print grey L bars with a split pinline and box — the pair masters below",
      `two-colour pair masters <pair>.png (TODO 4.56): the same function with the grey 'Land Frame' L for the frame (its title bar, the type bar moved from it, the bottom bar and fins) and the pair's two letters for the box and the pinline — the box structure re-tinted to each colour's title-bar tint and the two colours' frames through the pack's Pinline mask, each pair blended across ONE UNTILTED ramp ${PAIR_RAMPS.borderlessLand[0]}→${PAIR_RAMPS.borderlessLand[1]} %W by a premultiplied lerp (scripts/lib/pair-ramp.mjs), first canonical colour on the left; measured on the 119 two-colour borderless lands that print the tinted look (MID #281, OTJ #304, the RVR shocks, the MKM surveil lands, CLU …; Scryfall 2026-10-06): the rings read 41.3 / 50.2 / 58.9 %W and the box's top band 40.9 / 49.8 / 59.0 at 10 / 50 / 90 %, the bars the colourless land's grey`,
      "no P/T plates of its own: a land creature prints on m15borderless's plates (the profile's plateAssetPathTemplate)",
    ],
  },
  // 4.33 — the light borderless planeswalker (3 ability rows).
  m15borderlesspw: {
    colors: {
      ...perColor((k) => [layer(`${PW_BORDERLESS}/${k}.png`)], WUBRGM),
      // Gold = the prints' pale cream faces (PW_GOLD_FACE; see notes).
      m: goldWalker(PW_BORDERLESS, PW_TYPE_MASK),
      // No colourless frame in the pack: `c` is its 'Artifact Frame', a
      // see-through frame (bars α 0.75, rim α 0.92), its alpha lifted so the
      // rim is opaque (PW_COLOURLESS_RIM_GAIN; see notes).
      c: [lifted(`${PW_BORDERLESS}/a.png`, PW_COLOURLESS_RIM_GAIN)],
    },
    shield: { mask: PW_LOYALTY_MASK, box: SHIELD_BOX },
    pack: PW_BORDERLESS_PACK,
    transforms: "native 1500x2100, pixels copied 1:1 (no resample), corners rounded to the importer radius; the loyalty shield cut out through maskLoyalty.png",
    notes: [
      "colourless = the pack's 'Artifact Frame' (borderless/a.png): the pack lists no colourless frame. It is the colourless look — the tall pack's 'Colorless Frame' rim is the same colour (197/203/217), and Ugin M21 #279 and Karn DMU #372 print its see-through grey bars (Karn's stained glass shows through them); the tall pack's own 'Artifact Frame' is a different, white-rimmed one",
      "colourless rim made opaque: the frame's alpha × 255/234 (clamped at 1) takes the rim (α 234) and its join with the bottom bar to 1, as the tall pack's Colorless rim and both prints have it, and the see-through bars from α 0.75 to 0.82 (the tall pack's colourless bars are 0.85). As shipped, the rim's lower edge (1922–1957 px) runs past the art slot, so the card root's #101015 showed through it (7.6), and the bottom bar band was α 0.92–0.96 there (7.7)",
      "gold (m) = MATCHED TO THE PRINTS (owner round 15, 2026-09-29): the pack's 'Multicolored Frame' with its title and type faces recoloured by the pack's 'White Frame' through CC's Title and Type masks at 90 %, weighted by the white face's luminance from 235 (its grey veins: the gold shows) to 250 (PW_GOLD_FACE), fitted to the prints. The 13 exact mono-gold borderless walker prints (BLC #100, IKO #278, MED #GR4/#WS6/#WS8, FRC #1, MH2 #304/#305, SLC #2017, SLD #1184/#1246/#1421, SPG #14; 26 bars; Scryfall scans registered on the gold rims, text left out) print pale cream faces veined with the gold: mean 221/201/160, luma 202 per bar (168–235, interquartile 189–212), red − blue 60 (interquartile 44–78). Ours: 219/204/163, luma 204, red − blue 56. CC's flat tan was 205/182/125, luma 183, red − blue 80. Rims, window, shield, bottom bar and alpha are the m frame's",
      "the pack's 'Land Frame' (borderless/l.png) is not imported: no land walker prints on it",
      "the loyalty shield is the master's own pixels cut out through CC's maskLoyalty.png (loyalty/<colour>.png), drawn above the ability stripes, as on m15pw",
    ],
  },
  // 4.33 — its tall twin (4 ability rows), auto-picked by the row count.
  m15borderlesspwtall: {
    colors: {
      ...perColor((k) => [layer(`${PW_TALL_BORDERLESS}/${k}.png`)]),
      // Gold = the prints' pale cream faces (PW_GOLD_FACE; see notes); the
      // tall pack's see-through faces (α 0.85) keep their alpha.
      m: goldWalker(PW_TALL_BORDERLESS, PW_TALL_TYPE_MASK),
    },
    shield: { mask: PW_LOYALTY_MASK, box: SHIELD_BOX },
    pack: PW_TALL_BORDERLESS_PACK,
    transforms: "native 1500x2100, pixels copied 1:1 (no resample), corners rounded to the importer radius; the loyalty shield cut out through maskLoyalty.png",
    notes: [
      "colourless = the pack's own 'Colorless Frame' (tallBorderless/c.png)",
      "gold (m) = MATCHED TO THE PRINTS (owner round 15, 2026-09-29): the pack's 'Multicolored Frame' with its title and type faces recoloured by the pack's 'White Frame' through CC's Title and Type masks at 90 %, weighted by the white face's luminance from 235 (its grey veins: the gold shows) to 250 (PW_GOLD_FACE), fitted to the prints. The 13 exact mono-gold borderless walker prints (BLC #100, IKO #278, MED #GR4/#WS6/#WS8, FRC #1, MH2 #304/#305, SLC #2017, SLD #1184/#1246/#1421, SPG #14; 26 bars; Scryfall scans registered on the gold rims, text left out) print pale cream faces veined with the gold: mean 221/201/160, luma 202 per bar (168–235, interquartile 189–212), red − blue 60 (interquartile 44–78). Ours: 219/204/163, luma 204, red − blue 56. CC's flat tan was 205/182/125, luma 183, red − blue 80. Rims, window, shield, bottom bar and alpha are the m frame's (its see-through faces stay α 0.85)",
      "the pack's 'Artifact Frame' (tallBorderless/a.png) and 'Land Frame' (tallBorderless/l.png) are not imported: no artifact or land walker dress",
      "the loyalty shield is the master's own pixels cut out through CC's maskLoyalty.png (loyalty/<colour>.png), drawn above the ability stripes, as on m15pw",
    ],
  },
  // TODO 4.7 (wave 1, owner Q6 2026-10-13): the extended-art frame
  // re-sourced from Card Conjurer's accurate 'Extended Art Frames' pack
  // (EXTENDED_ART_PACK; it replaces the 744 px MSE masters that
  // scripts/build-variation-frames.mjs upscaled into git). Each master is
  // the pack's whole file, downscaled once — no border is added: the prints
  // run the art to the card's side edges between the title bar and the type
  // bar (EXTENDED_ART_EDGES in lib/frames/edge-contract.ts).
  extendedart: {
    colors: {
      ...perColor((k) => [layer(extendedFrameFile(k))]),
      // The colourless ARTIFACT's master (FrameProfile.artifactMasterKeys
      // { c: "a" }): the pack's silver 'Artifact Frame'. `c` itself is the
      // see-through 'Eldrazi Frame' a colourless non-artifact prints.
      a: [layer(extendedFrameFile("a"))],
      ...pairMasters("m15", ["split", "hybrid"], extendedPairLayers),
    },
    pack: EXTENDED_ART_PACK,
    notes: EXTENDED_ART_NOTES,
  },
  // The extended-art LAND frame (TODO 4.7, owner Round 63 2026-10-14): the
  // same pack's land frames — the grey frame and bars of `l` with the box
  // and title bar in the land tints of `l<k>` — as m15land is M15's. A land
  // on extended art prints these (FDN #487, NEO #501–505, MSC #470); on the
  // spell masters a colourless land showed its art through the see-through
  // `c` frame.
  extendedartland: {
    colors: {
      ...perColor((k) => [layer(extendedFrameFile(k === "c" ? "l" : `${k}l`))]),
      ...pairMasters("land", ["split"], extendedPairLayers),
    },
    pack: EXTENDED_ART_PACK,
    notes: EXTENDED_ART_LAND_NOTES,
  },
  // TODO 4.35 / 4.42 (owner Q6 2026-10-13): the textless pair re-sourced
  // from Card Conjurer's 'Magic Fest Promos' (TEXTLESS_PROMO_PACK) — the
  // black-bordered textless promos' look the MSE masters drew softly. One
  // set of masters for both templates; the land's colourless key is the
  // pack's brown land rim, the spell's the silver one.
  m15textless: {
    colors: {
      ...perColor((k) => [layer(textlessPromoFile(k === "c" ? "a" : k))]),
    },
    pack: TEXTLESS_PROMO_PACK,
    transforms: "native 1500x2100, the frame image copied 1:1 (no resample), corners cut at the importer radius",
    notes: TEXTLESS_PROMO_NOTES("colourless = the pack's silver 'Artifact Frame' (a.png): every colourless textless promo wears the silver rim, artifact or not (PF26 #1 Wayfarer's Bauble, SLD #2783 Sol Ring, SCH #32 Void Winnower, SLP #52 Kozilek's Command)"),
  },
  m15textlessland: {
    colors: {
      ...perColor((k) => [layer(textlessPromoFile(k === "c" ? "l" : k))]),
    },
    pack: TEXTLESS_PROMO_PACK,
    transforms: "native 1500x2100, the frame image copied 1:1 (no resample), corners cut at the importer radius",
    notes: TEXTLESS_PROMO_NOTES("colourless = the pack's brown 'Colorless Frame' (l.png), the land rim (PF23 #3 Reliquary Tower, PW25 #17 Command Tower)"),
  },
  // TODO 4.11 (wave 1): the Expedition lands — the 2020 ZNE look on the
  // existing template (a correction) and the 2015 EXP look as a template of
  // its own (an addition). See EXPEDITION_ZNR above.
  expeditionland: {
    colors: perColor((k) => [layer(expeditionZnrFile(k))]),
    // The title block 4 px up, the lower block 11 px down, onto the ZNE
    // prints (EXPEDITION_ZNR_RECUT); the EXPEDITIONLAND profile rides it.
    shift: EXPEDITION_ZNR_RECUT,
    pack: EXPEDITION_ZNR_PACK,
    transforms: `${EXPEDITION_TRANSFORM}; then two blocks moved onto the ZNE prints through the flat rows between them (shift: rows 60–729 4 px up, rows 777–1938 11 px down — whole rows, byte for byte)`,
    notes: EXPEDITION_ZNR_NOTES,
  },
  expeditionlandbfz: {
    colors: {
      ...perColor(
        (k) => [lifted(expeditionBfzFile("l"), EXPEDITION_BFZ_PANEL_GAIN), layer(expeditionBfzFile(k), EXPEDITION_BFZ_PINLINE_MASK)],
        ["w", "u", "b", "r", "g"],
      ),
      c: [lifted(expeditionBfzFile("l"), EXPEDITION_BFZ_PANEL_GAIN)],
      m: [lifted(expeditionBfzFile("m"), EXPEDITION_BFZ_PANEL_GAIN)],
    },
    pack: EXPEDITION_BFZ_PACK,
    transforms: `${EXPEDITION_TRANSFORM}; the frame's alpha lifted ×166/128 (the rules panel α 128 → 166, onto the prints' ~0.65)`,
    notes: EXPEDITION_BFZ_NOTES,
  },
  // 4.39 — the black-bordered full-art basic (P23+ left-medallion design).
  m15fullartland: {
    colors: perColor((k) => [layer(basics2022Frame(k))]),
    symbols: BASICS_2022_SYMBOLS,
    pack: "packTextlessBasics2022.js 'Fullart Basics (2022)' (groupTextless-4.js:5)",
    transforms: "native 1500x2100, the full frame image copied 1:1 (no resample), corners rounded to the importer radius; symbol discs native 168x168",
    notes: [
      "the full composite: the pack's frame image with its black ring (Pinline, Title, Type and Border all drawn)",
      "colourless (Wastes) = the pack's 'Colorless Frame' l.png + the colourless disc sc.png: no left-medallion Wastes was ever printed (owner visual sign-off before it is verified)",
      "m = the pack's 'Multicolored Frame' m.png, built so the key has a master; no multicolour basic exists, so no symbol disc and never offered",
    ],
  },
  // 4.39 — the borderless full-art basic: the same composite minus the ring
  // (owner decision 4.35(a): fullartland stays borderless; light bars).
  fullartland: {
    colors: perColor((k) => [outside(basics2022Frame(k), BASICS_2022_BORDER_MASK)]),
    symbols: BASICS_2022_SYMBOLS,
    pack: "packTextlessBasics2022.js 'Fullart Basics (2022)' (groupTextless-4.js:5)",
    transforms: "native 1500x2100, no resample; the frame image with its Border mask's coverage erased (alpha - mask alpha, floored at 0: the ring's anti-aliased inner edge leaves no residue), corners rounded to the importer radius; symbol discs native 168x168",
    notes: [
      "re-sourced from CC (4.39): replaces the 744 px MSE magic-m15-full-art-basic-land-symbol composite that scripts/build-variation-frames.mjs upscaled",
      "borderless = m15fullartland without the Border mask (owner decision 4.35(a)); the bars keep their bevels and drop shadows",
      "light bars, as on the 263 bordered printings (owner decision 2026-09-26): FRA #382–396 print dark bars and resolve nearest",
      "colourless (Wastes) = the pack's 'Colorless Frame' l.png + the colourless disc sc.png (owner visual sign-off before it is verified)",
      "m = the pack's 'Multicolored Frame' m.png, built so the key keeps a master (the MSE build dressed m as colourless); no multicolour basic exists, so no symbol disc and never offered",
    ],
  },
  // 4.40 — the Zendikar-style full-art basic: the stone ring, the split
  // type bar and its centred medallion (BFZ, OGW, AKH, HOU, ZNR).
  m15fullartlandzen: {
    colors: perColor((k) => [
      { ...layer(olderBasicFrame(ZEN_BASICS, k)), barRecut: true },
      { ...replacing(olderBasicFrame(ZEN_BASICS, "c"), ZEN_BASICS_FRAME_MASK), maskBarRecut: true },
    ]),
    barRecut: ZEN_BASIC_RECUT,
    symbols: ZEN_BASICS_SYMBOLS,
    symbolShading: { w: WHITE_MEDALLION_SYMBOL },
    pack: "packZendikarBasic-1.js 'Fullart Basics (ZEN)' (groupTextless-4.js:7)",
    transforms: "native 1500x2100, no resample; the colour's frame with its type bar moved onto the prints (ZEN_BASIC_RECUT), the 'Colorless Frame' stone laid over the frame field through the pack's Frame mask (moved with the bar), corners rounded to the importer radius; medallion symbols rasterised from the pack's 600x600 SVGs",
    notes: [
      "the stone ring: every print of the look wears the SAME brown stone round the window whatever its colour (BFZ #250 / #255 / #260 / #265 / #270, OGW #183, AKH, HOU, ZNR); the pack paints each colour's own frame texture there, so every key takes the pack's 'Colorless Frame' (l.png) stone through its Frame mask — Card Conjurer's own pixels, the tone checked against the prints in the PR's sheet",
      "the type bar moved 7 px down onto the 52 prints (ZEN_BASIC_RECUT): the title bar, the window, the medallion and the border were the pack's within 1 px; the medallion is drawn back over the moved bar from the pack's own pixels",
      "colourless (Wastes, OGW #183 / #184) = the pack's 'Colorless Frame' l.png + the colourless medallion symbol sc.svg",
      "m = the pack's 'Multicolored Frame' m.png, built so the key has a master; no multicolour basic exists, so no symbol and never offered",
      "MH1's snow basics (#250–254) print this design with snow-covered bars (CC textless/snowBasics, whose masters paint their symbol into the medallion): nearest on this frame, not imported here",
    ],
  },
  // 4.40 — the plain-ring full-art basic (SNC): the same bars, the art under
  // a white ring.
  m15fullartlandsnc: {
    colors: perColor((k) => [{ ...layer(olderBasicFrame(SNC_BASICS, k)), barRecut: true }]),
    barRecut: SNC_BASIC_RECUT,
    symbols: ZEN_BASICS_SYMBOLS,
    symbolShading: { w: WHITE_MEDALLION_SYMBOL },
    pack: "packTextlessBasicsSNC.js 'Fullart Basics (SNC)' (groupTextless-4.js:5)",
    transforms: "native 1500x2100, no resample; the colour's frame with its type bar and medallion moved onto the prints (SNC_BASIC_RECUT), corners rounded to the importer radius; medallion symbols rasterised from the ZEN pack's 600x600 SVGs (the SNC pack names the same files)",
    notes: [
      "the bar moved 13 px up and the medallion 18 px up onto SNC #272–281 (SNC_BASIC_RECUT); the medallion's old place below the bar is cleared to the art (α 0), as the pack leaves it beside",
      "BRO #278–287 is another look (no ring round the window, the bars lower): nearest on this frame",
      "colourless = the pack's 'Colorless Frame' l.png (no SNC Wastes was printed); m = the pack's 'Multicolored Frame', never offered",
    ],
  },
  // 4.41 — the plain-bar full-art basic: the title bar and a "Basic Land —
  // Plains" bar, no symbol (THB, 2XM, DMU, SPM, SOS, PLG25).
  m15fullartlandthb: {
    colors: perColor((k) => [layer(olderBasicFrame(THB_BASICS, k))]),
    pack: "packTextlessBasics.js 'Fullart Basics (THB)' (groupTextless-4.js:6)",
    transforms: "native 1500x2100, the full frame image copied 1:1 (no resample), corners rounded to the importer radius",
    notes: [
      "the pack's geometry is the prints' (31 printings, 2026-10-14): type bar inner top 1778 / 1779 (range 1776–1782), bottom 1906 / 1906, title bar 104 / 104 and 232 / 235 — no re-cut",
      "colourless = the pack's 'Colorless Frame' l.png (no plain-bar Wastes was printed; PLG25 #2's 'Basic Land' prints the white frame); the pack's 'Artifact Frame' a.png is not imported; m = the 'Multicolored Frame', never offered",
    ],
  },
  // TODO 4.11 (wave 1): the Zendikar Rising hedron showcase — see the
  // ZNR_* block above.
  fullart: {
    colors: perColor((k) => znrMasterLayers(k)),
    plates: ZNR_PT,
    notch: ZNR_NOTCH,
    pack: ZNR_PACK,
    transforms:
      "native 1500x2100, no resample: the colour's frame whole and its title pill's ends at CC's bounds (1:1); then the stamp notch split off (ZNR_NOTCH: the master written with the straight bar under the box, the arch, its bevel and the oval as the piece holostamp/<key>.png, 220x125 at 640, 1880, the oval cut clear); corners rounded to the importer radius",
    notes: [
      "w u b r g m = the pack's colour frames whole (m15ZendikarRisingFrame<K>.png) with the colour's 'Title' pill ends on top; c = its see-through 'Colorless Frame' (FrameC; not 'Colorless Frame (2)', CAlt, whose only difference is a see-through notch) with the colourless title ends — the art runs under the whole frame on every key (the profile's art slot is CC's art bounds 4/2.86/92x86.48 %, the box and the V translucent)",
      "the pack's 'Artifact Frame' and 'Land Frame' (and their title, crown and plate) are not imported: no ZNR showcase printing is colourless, and the template has no artifact or land master (a colourless artifact draws c, as the MSE masters did)",
      "plates (pt/<k>.png, native 282x154 at M15's plate bounds) = the pack's own for w, b, m and c (m15ZendikarRisingPT<K>.png) and the 'Nickname' pack's for u, r and g (m15NicknamePT<K>.png), as the pack lists them; the profile prints dark digits on the light w / m / c plates and white ones on the rest, as ZNR #290–313 print them",
      "the holofoil stamp: CC paints the arched rim and a hologram oval on every key; the prints arch only a rare's or mythic's box (commons and uncommons run the rim straight). So each master is written plain and the arch is its own piece — see ZNR_NOTCH; the piece's oval is cut clear and our oval art drawn over it",
      "the source has never been in git: the MSE zendikar masters it replaces (public/frames/fullart, built by scripts/build-variation-frames.mjs) were deleted with this recipe",
    ],
  },
  // 4.52 — the emblem (M20 design, today's look). CR 114: an emblem has no
  // colour, and every printed one is on this silver frame whatever the
  // planeswalker's colour; the emblem kind forces colourless, so `c` is
  // the one key with a reference. The other six keys are the same master,
  // built so each key has one (the 7-master contract every template ships:
  // a stray coloured card on the frame still draws it); never offered.
  emblem: {
    colors: perColor(() => [layer(EMBLEM)]),
    bridge: EMBLEM_RAY_BRIDGE,
    tones: EMBLEM_TONES,
    pack: "packEmblem.js 'Planeswalker Emblems'",
    transforms: emblemTransform(EMBLEM_RAY_BRIDGE, EMBLEM_TONES),
    notes: [
      "source: CC 'Planeswalker Emblems' (packEmblem.js), the M20 design: the source's name in the dark title bar, a silver frame with the art in a planeswalker-spark cut-out, a type bar reading \"Emblem\", a light text box (TFDN #24 / #25, TBLB #30, TDSK #17, TFRA #16)",
      "every colour key = the same silver master (CR 114: an emblem is colourless; the emblem kind forces c). w/u/b/r/g/m are built so each key has a master and are never offered",
      "the spark's tail through the type bar and the text box is CC's own 80 % white (alpha 204) over the art, as the prints show the art faintly there",
      "the name pill's body is toned onto the prints (EMBLEM_NAME_PILL_TONE): CC's pack draws frame.png alone, and its pill is a light gradient (median luma 90 over the name band) where the six M20-design prints print a dark one (52); the gain by distance from the pill's centre is a least-squares fit on the prints, and the body is made opaque as printed",
      "the frame's silver closes over the top of the spark's centre ray (EMBLEM_RAY_BRIDGE, owner decision 2026-09-29): the art window is Scryfall's art_crop box at the prints' scale (from 250.4 px), where the prints' ray runs on up to the bar with art in it; the ray ends at 251 px, its tip drawn with the profile of its own right edge, and the bar's shadow and the silver run across",
      "the silver (EMBLEM_SILVER_TONE), the type pill (EMBLEM_TYPE_PILL_TONE) and the text box (EMBLEM_TEXT_BOX_TONE) are toned onto the six prints (owner decision 2026-09-29): CC's read 10–32 luma over the prints' median by region; gains fitted on the prints; the spark's tail keeps its alpha; the light rims keep CC's tone",
      "the silver is fitted on each side separately (owner decision 2026-09-29, round 12b): CC lights its silver evenly, the prints do not (beside the spark's base 113–122 on the left, 178–187 on the right; CC 160 and 179), so the gain runs on the signed offset from the centre and by row, each half on its own knots, joined across the centre without a seam, each region's median per side on the prints'",
    ],
  },
  // 4.21a — the Kamigawa flip layout on the M15 frame (C18 #134 Budoka
  // Gardener, CM2 #71 Nezumi Graverobber: the only M15-frame flip prints).
  flip: {
    colors: perColor((k) => [layer(`${FLIP}/${k}.png`)]),
    ptCut: { image: FLIP_PT_IMAGES, bounds: FLIP_PT_BOUNDS, masks: FLIP_PT_MASKS, boxes: FLIP_PT_BOXES },
    recutUp: FLIP_LOWER_RECUT,
    pack: "packFlip.js 'Flip'",
    transforms: `${flipLowerRecutTransform(FLIP_LOWER_RECUT)}; P/T plates: the pack's two-plate image drawn at its bounds (56/478 px, 1:1) and cut through the Top PT / Bottom PT masks into each plate's box, native size`,
    notes: [
      "source: CC 'Flip' (packFlip.js): the top creature's name bar, text box and type bar, the shared art window, the upside-down bottom creature's type bar, text box and name bar — replaces the MSE magic-m15-flip composite (build-flip-frame.mjs), which sat 30–80 px low from the title bar down against C18 #134 and CM2 #71",
      "the lower half re-cut onto the prints (TODO 4.21a follow-up, layout v39; owner decision 2026-10-02): CC drew the bottom half as the top half turned, and C18 #134 / CM2 #71 are not that symmetric — the window's inner line and the upside-down type bar's dark top band print 7 px higher than CC's, the bar's bottom outline and the text box's top edge 5 px higher, the upside-down name bar where CC has it; two pieces move up (FLIP_LOWER_RECUT), split inside the bar's flat bevel plateau, every row above 1283 and from 1500 on CC's byte for byte; the top half, the cost and the P/T plates are untouched",
      "colourless = CC's see-through 'Colorless Frame' (flip/c.png): the FLIP profile draws the art under the frame for 'c' (underFrameArt on UNDER_FRAME_RECT, layout v35's rect; owner decision 2026-09-29), as m15/c does; never offered until a print exists",
      "P/T plates (owner decision 2026-09-29, a correction): CC's <k>pt.png holds both plates — the top creature's upright, the bottom creature's upside-down — drawn at packFlip.js's bounds and cut through the pack's Top PT / Bottom PT masks (the card's halves) into pt/<k>-top.png and pt/<k>-bottom.png; a plate draws only when its half has a P/T, as on M15; cpt.png is the 'Colorless Power/Toughness' plate",
      "no crown: the legendary bottom halves of C18 #134 and CM2 #71 print none",
    ],
  },
  // 4.21a — the Eldraine adventure frame: M15's bars and window over the
  // open storybook (ELD #115 Bonecrusher Giant and every ELD / WOE / MKM
  // adventure print).
  adventure: {
    colors: {
      ...perColor((k) => [layer(`${ADVENTURE}/${k}.png`)], WUBRGM),
      c: [layer(`${ADVENTURE}/a.png`)],
    },
    pack: "packAdventure.js 'Adventure'",
    transforms: NATIVE_1500,
    // TODO 4.26: the spell's page in its own colour — pieces cut from the
    // published masters through CC's bookLeft mask (ADVENTURE_PAGE_CUT).
    page: ADVENTURE_PAGE_CUT,
    notes: [
      "source: CC 'Adventure' (packAdventure.js): the M15 frame with the storybook's two pages — replaces the MSE composite (build-adventure-frame.mjs: the MSE m15 master + double_page + null_page), whose window ran 10 / 6 px narrow and whose paper was re-drawn",
      "colourless = CC's 'Artifact Frame' (adventure/a.png; the pack has no other colourless frame): colourless adventures ARE printed — the artifacts HOB #170 / #174 / #176 and FIN's Towns #283–293 — and `adventure/c` is verified on production (supabase/seed.sql lists adventure in all seven keys; corrected 2026-10-22, 4.26 — the 4.21a note said no colourless adventure was printed and the key would never be ticked); a colourless creature with a coloured spell draws the spell's page over it (HOB #170: `page/w` over `adventure/c`, TODO 4.26)",
      "P/T plate = M15's (m15/pt/<k>.png): the pack draws CC's m15PT<K>.png at M15's bounds, so the ADVENTURE profile keeps M15's plate and box",
      "the book masks are not published: bookLeft cuts the spell's PAGE pieces (TODO 4.26, page/<key>.png — the published masters' left page through its alpha, drawn by the partPage overlay slot where the spell's colour differs from the creature's: WOE #221 a red page beside a black frame); bookLeftMulticolor (a two-colour page) is read by nothing, as no print shows a pair page beside a creature of other colours; bookRight is the creature's own page, which the master paints",
    ],
  },
  // 4.21a — the Amonkhet aftermath frame (AKH Insult // Injury and the 27
  // AKH / HOU prints).
  aftermath: {
    colors: {
      ...perColor((k) => [layer(`${AFTERMATH}/${k}.png`)], WUBRGM),
      c: [layer(`${AFTERMATH}/a.png`)],
    },
    pack: "packAftermath.js 'Aftermath'",
    transforms: NATIVE_1500,
    notes: [
      "source: CC 'Aftermath' (packAftermath.js): the upright top half and the sideways bottom half with textured cream text boxes — replaces the MSE stack (build-aftermath-frame.mjs: two per-colour pieces with flat white boxes)",
      "colourless = CC's 'Artifact Frame' (aftermath/a.png) as a RENDER STAND-IN only (owner decision 2026-09-29): no colourless aftermath was ever printed and the pack has no colourless frame; never offered (no reference, never ticked)",
      "gold (m) is built for the key but needs TODO 4.26: every printed two-colour aftermath is mono // mono (21 mixed, 6 same-colour), none gold // gold — flagged in the registry, never ticked until a print or 4.26",
      "the pack's top / bottom masks are plain rectangles cutting the card at y 1139 (54.24 %H): 4.26's per-half colour is a hard seam, no mask asset (not published)",
    ],
  },
  // 4.21b — the M15 split frame (MH2 #123 Fast // Furious, MH2 #60 Said //
  // Done, C16 #239 Trial // Error): two upright half-cards side by side on a
  // landscape card, each with its own coloured body, name bar, window, thin
  // type bar and text box.
  split: {
    orientation: "landscape",
    transform: "rotate-cw",
    colors: {
      ...perColor((k) => [layer(`${SPLIT}/${k}.png`)], WUBRGM),
      c: [layer(`${SPLIT}/a.png`)],
    },
    shift: SPLIT_HALF_RECUT,
    halfMasks: SPLIT_HALF_MASKS,
    pack: "packSplit.js 'Split'",
    transforms: SPLIT_TRANSFORM,
    notes: [
      "source: CC 'Split' (packSplit.js): the two half-cards of the M15 split frame, each a coloured body round its name bar, art window, thin type bar and text box — replaces the MSE composite (build-split-frame.mjs: two 240×345 magic-m15-split-fusable half-frames on a black canvas), which drew no coloured body round either half, set the title bars 31 px above the prints' and both windows 37 px high (the left one 69 px left of the prints': 133–952 × 201–800 px against 202–1018 × 238–796)",
      "the pack draws the card PORTRAIT with its text turned −90°: the importer turns each composite a quarter turn clockwise (a pixel permutation, no resample), so the text reads upright and the pack's 'Right' texts and art window are our right half, its 'Left' texts our left half",
      "colourless = CC's 'Artifact Frame' (split/a.png) as a RENDER STAND-IN only (owner decision 2026-09-29): no colourless split was ever printed and the pack has no colourless frame, so the key keeps a master for a stray colourless card and is never offered (no reference, never ticked)",
      "the two halves are moved onto the prints (SPLIT_HALF_RECUT): the pack's collector border is 160 px where MH2 #123 / #60 and TSR #161 / #186 print 147–148, so the left half moves 11 px left and the right half 3 px, through the flat black border and spine — every pixel of both halves is the pack's, byte for byte, and every edge of both lies within 3.6 px of the four prints' mean (5.4 px of any one print; the pack's up to 14.3 / 16.4)",
      "the pack's 'Top Half' / 'Bottom Half' masks (top.svg, bottom.svg) are plain rectangles cutting the PORTRAIT card at y 1000: after the turn 'Bottom Half' is the LEFT half (x 0–1099) and 'Top Half' the RIGHT half (x 1100–2099), the seam at x 1100 (52.38 %W) inside the pack's spine — importer inputs, checked and recorded (halfMasks), never published; on the master, whose halves moved, the seam is the middle of its spine, x 1093: TODO 4.26's per-half colour is a hard seam between two masters there, no mask asset",
      "gold (m) is the pack's 'Multicolored Frame' on BOTH halves (C16 #239 Trial // Error, the only gold // gold M15 split outside a showcase — printed in the frame's 2016 arrangement, its collector line along the bottom border); a mixed split (GRN's hybrid // gold, a mono // mono of two colours) needs TODO 4.26",
      "the pack hides the set symbol (setSymbolBounds off the card) and has no fuse dress here (split/fuse/ is its own pack): neither is built",
    ],
  },
  // 4.21b — the March of the Machine battle (Siege) frame, front face (MOM
  // #149 Invasion of Tarkir and the 36 MOM battles): the black border with
  // the siege arc down its left, the battle icon at the name bar's left end,
  // full art under a name pill, a type bar and a text box, and the defense
  // shield painted across the text box's bottom-right corner.
  battle: {
    orientation: "landscape",
    transform: "downscale",
    colors: perColor((k) => [layer(`${BATTLE}/${k}.png`)]),
    shift: BATTLE_BLOCK_RECUT,
    paintedShield: BATTLE_SHIELD,
    printRecut: BATTLE_PRINT_RECUT,
    pack: "packBattle.js 'Battle'",
    transforms: BATTLE_TRANSFORM,
    notes: [
      "source: CC 'Battle' (packBattle.js), 2814×2010: the black border with the siege arc, the battle icon in the name bar's left end, the name pill, the type bar, the text box and the defense shield — replaces the MSE 'm15 mainframe battles' master, which had no border, arc, icon or shield (a transparent ring: the art window was the whole card, and the defense sat on a drawn disc)",
      "two blocks are moved onto the prints (BATTLE_BLOCK_RECUT): the nine MOM battles measured print the type bar, the text box and the shield 2.5–5.5 px lower than the pack draws them and the name pill 1.4–2.5 px higher, so rows 842–1467 of the downscaled master move 4 px down and rows 57–362 (the pill, the icon, the arc's upper curve) 2 px up, through the flat rows of the top border, the art window and the bottom border — byte for byte, to within 1.5 px of the prints' mean (the top border's inner edge goes from −0.7 to +1.3 px)",
      "the right side is re-cut onto the prints (BATTLE_RIGHT_RECUT, TODO 4.21d; owner round 33, 2026-10-06): the prints end the name pill 10.0 px, the type bar 8.6 px and the text box 7.6 px further right than the pack, which no flat zone can give — each bar's paper is stretched instead (a 24-column premultiplied cross-fade of each row with itself, opened inside the bar's own mottled paper from column 1820: the pill +10 px, the type bar and the text box +8 px), the clear window columns after each bar giving up as many; those ends then lie +0.1 / +0.7 / −0.3 px from the nine prints' mean",
      "the defense shield is the pack's own pixels, lifted through the pack's Defense mask and set 12 px right, over the right border, where the prints print theirs (the pack's stops at the border; +11.7 px by the black interior's centroid, −0.3 after): its old footprint is repainted with the paper, the box's rim, the window and the border beside it (a 4 px crescent of that fill shows along its left-facing edges) and the shield is drawn source-over, so the border under its anti-aliased edge stays opaque",
      "the battle icon's rings are REDRAWN, not the pack's pixels (BATTLE_ICON_RECUT): the pack's dark disc is r 54.6 px, concentric in its rim; the prints' is r 52.0, 1.4 px above the rim's centre — inside r 65 of the rim's centre the black disc (r 52.0), the white ring (to 58.5) and the black ring (to 62.3) are flat anti-aliased circles about the prints' centre, the rim's own colour continued inward, the pack's triangle kept 1 px left; the rim's outer edge and everything outside it are the pack's",
      "the defense shield is the MASTER's own painted shield (the pack's Defense mask region, moved with the lower block and set 12 px right): the BATTLE profile draws the defense value in it in white and nothing else (owner decision 2026-09-29: the drawn badge is gone); it is on every battle, so the rules text keeps out of it whether or not a value is drawn",
      "left as the pack has it: the bottom border's edge (−3.1 px: the prints' box rim is 2 px thinner), the siege arc down the left, and the name pill's left end (a plain concave arc on the pack, a bracket on the prints)",
      "colourless = CC's see-through 'Colorless Frame' (battle/c.png), as MOM #1 Invasion of Ravnica prints: its name pill, type bar and text box are translucent down to the bottom border, so the BATTLE profile draws the art under the frame for 'c' in a LANDSCAPE under-frame rect that runs to the bottom border (underFrameArt; owner decision 2026-09-29) — the art-window check fails the import without it",
      "the pack's Pinline / Title / Type / Rules / Defense / Border masks and its 'Holo Stamp' are not used and not published; its 'Artifact Frame' and 'Land Frame' are not built (no artifact or land battle was printed)",
      "the grey reverse-P/T line the pack draws for the back face (its 'Reverse PT' text) and a legendary back face's crown are double-faced anatomy (TODO 5.5): not drawn",
    ],
  },
  // 4.21c — the saga (DOM #21 History of Benalia and every 2015-frame saga
  // print): the title bar, the chapter rail with its ribbon, the tall art
  // column, the type bar.
  saga: {
    colors: {
      ...perColor((k) => [layer(`${SAGA}/regular/sagaFrame${k.toUpperCase()}.png`)], WUBRGM),
      c: [layer(`${SAGA}/regular/l.png`)],
    },
    pieces: SAGA_CHAPTER_PIECES,
    maskInputs: SAGA_MASK_INPUTS,
    pack: "packSagaRegular.js 'Regular Frames' (groupSaga-1.js; versionSaga.js draws the chapter badges and dividers)",
    transforms: `${NATIVE_1500}; the chapter badge and the row divider published at native size (118x132, 592x9)`,
    notes: [
      "source: CC 'Regular Frames' saga pack (packSagaRegular.js): the M15 title bar, the chapter rail with the reminder block and the RIBBON the chapter badges sit on, the art column on the right, the type bar — replaces the 375 px MSE cut (magic-m15-saga.mse-style, import-mse-profiles.mjs), which had no ribbon and whose window started 26 px left of the prints'",
      "colourless = CC's 'Land Frame' (saga/regular/l.png), the land saga (owner decision 2026-09-29): the only printed colourless saga is MH2 #259 Urza's Saga, an Enchantment Land; a colourless non-land saga wears it too (none was printed)",
      "the pack's 'Artifact Frame' (sagaFrameA.png) is not built: no SAGA profile key paints an artifact master",
      "the chapter badge (sagaChapter.png) and the row divider (sagaDivider.png) are the pack's own bitmaps, published as chapter/badge.png and chapter/divider.png and drawn by both renderers where lib/cards/saga-rail.ts puts them; the numerals are text (MPlantin — the prints' Plantin semibold is TODO 4.8)",
      "the pack's masks (Pinline, Title, Type, Frame, Banner, Banner (Right), Text, Text (Right), Border) are importer inputs for the two-colour saga's pair masters (TODO 4.6f), recorded as maskInputs and never published; its 'Banner Pinstripe (Multicolored)' (sagaMidStripe.png) and 'Holo Stamp' addons are not drawn (4.6f / 4.9d)",
    ],
  },
  // 5.5 (b) — the double-faced saga's FRONT (NEO #141 Fable of the
  // Mirror-Breaker and every transforming Saga): the saga master with the
  // transform icon well in its title bar and the reverse-P/T tab at the
  // ribbon's foot.
  sagadfcfront: {
    colors: {
      ...perColor((k) => [layer(`${SAGA}/dfc/${k}.png`)], WUBRGM),
      c: [layer(`${SAGA}/dfc/l.png`)],
    },
    pack: "packSagaDFC.js 'Saga (Transform)' (groupSaga-1.js; versionSaga.js draws the chapter badges and dividers)",
    transforms: NATIVE_1500,
    notes: [
      "source: CC 'Saga (Transform)' pack (packSagaDFC.js, 7 masters): the 4.21c saga master pixel for pixel but in two places — the title bar is the transform front's (its icon well at the left, rows 89–223) and the ribbon is cut 110 px short (its tip at 1635 px) for the grey reverse-P/T tab notched into the left border; the art window is the saga's (752–1384 × 237–1758 px on all seven)",
      "colourless = the pack's 'Land Frame' (saga/dfc/l.png), as the saga's (owner decision 2026-09-29); the pack has no artifact frame",
      "the icon in the well is the profile's icon rider (DFC_ICON_RIDER, the card's family — NEO's closed fan, TLA's ▲): the well is painted empty, as on the transform front's masters; the back's P/T is text (SAGA_DFC_REVERSE_PT, left-aligned at the tab, as the prints and the pack's 'Reverse PT' set it)",
      "the chapter badge and the row divider are the saga's published pieces (saga/chapter/badge.png, saga/chapter/divider.png); the pack's masks (Pinline, Title — the transform pack's maskTitle.png — Type, Frame, Banner, Banner (Right), Rules, Rules (Right), Border) and its 'Holo Stamp' are not used and not published",
    ],
  },
  // --- TODO 5.1a: the transform bodies (see the section above CC_TEMPLATES).
  m15dfcfront: {
    colors: { ...perColor((k) => [layer(transformFrame("front", k))]), a: [layer(transformFrame("front", "a"))], ...dfcPairMasters("m15dfcfront") },
    // No plates of its own: the profile draws M15's (m15/pt/<k>.png), which
    // the pack draws at M15's bounds.
    pack: "packM15TransformFront.js 'Transform (Front)' (groupDFC.js)",
    transforms: NATIVE_1500,
    notes: [...DFC_FRONT_NOTES, DFC_PAIR_NOTE],
  },
  m15dfcback: {
    colors: { ...perColor((k) => [layer(transformFrame("new/back", k))]), a: [layer(transformFrame("new/back", "a"))], ...dfcPairMasters("m15dfcback") },
    plates: DFC_BACK_PT,
    tones: dfcBackTonesFor("m15dfcback", (k) => dfcBackTones(TRANSFORM_MASK.newBackTitle, k)),
    pack: "packM15TransformBackNew.js 'Transform (Back) (New)' (groupDFC.js)",
    transforms: dfcBackToneTransform(TRANSFORM_MASK.newBackTitle),
    notes: [...DFC_BACK_NOTES("Transform (Back) (New)", "RIGHT, with the ▼ baked in"), DFC_PAIR_NOTE],
  },
  m15dfcbackleft: {
    colors: { ...perColor((k) => [layer(transformFrame("back", k))]), a: [layer(transformFrame("back", "a"))], ...dfcPairMasters("m15dfcbackleft") },
    // The same dark plates as the ▼ back: the profile draws m15dfcback's.
    tones: dfcBackTonesFor("m15dfcbackleft", (k) => dfcBackTones(TRANSFORM_MASK.backTitle, k)),
    pack: "packM15TransformBack.js 'Transform (Back)' (groupDFC.js)",
    transforms: dfcBackToneTransform(TRANSFORM_MASK.backTitle),
    notes: [...DFC_BACK_NOTES("Transform (Back)", "LEFT, an empty black disc"), DFC_PAIR_NOTE],
  },
  m15dfclandfront: {
    colors: perColor(() => [layer(`${TRANSFORM}/frontL.png`)]),
    // M15's plates, as m15dfcfront.
    pack: "packM15TransformFront.js 'Transform (Front)' Land Frame (groupDFC.js)",
    transforms: NATIVE_1500,
    notes: [
      ...DFC_LAND_NOTES("frontL.png", "INR #287 Westvale Abbey"),
      "the icon well and the reverse-P/T tab are the master's, as on m15dfcfront; the tab prints the back's P/T when the back is a creature (INR #287 prints Ormendahl's 9/7) and empty otherwise",
      "P/T plate = M15's (m15/pt/<k>.png, the profile's): a land creature front (none printed) would draw it; no plate set of its own",
    ],
  },
  m15dfclandback: {
    colors: perColor(() => [layer(`${TRANSFORM}/new/backL.png`)]),
    tones: () => dfcBackTones(TRANSFORM_MASK.newBackTitle, "l"),
    pack: "packM15TransformBackNew.js 'Transform (Back) (New)' Land Frame (groupDFC.js)",
    transforms: dfcBackToneTransform(TRANSFORM_MASK.newBackTitle),
    notes: [
      ...DFC_LAND_NOTES("new/backL.png", "FIN #31 Cooking Campsite"),
      "toned onto FIN #31 (the one plain M15 land back scanned: the FIN / TLA land backs; XLN / RIX / LCI print the parchment land back CC lacks, TODO 5.8): CC's land back has DARK bars (luma 127) and a grey box (158) where the print has light tan bars (155) with DARK name and type ink and a cream box (209) — bars ×1.22, box ×1.32 through the masks, the rims kept; the profile prints dark ink on it",
      "no P/T plate (a land back prints none) and no indicator; no cost (hideCost)",
    ],
  },
  // --- TODO 5.1b: the modal bodies (see the section above CC_TEMPLATES).
  m15mdfcfront: {
    colors: { ...perColor((k) => [layer(modalFrame(k, false))]), a: [layer(modalFrame("a", false))], ...dfcPairMasters("m15mdfcfront") },
    // No plates of its own: the profile draws M15's (m15/pt/<k>.png).
    pack: "packModalRegular.js 'Modal Regular' fronts (groupModal-1.js)",
    transforms: NATIVE_1500,
    strip: MDFC_STRIP_CUTS.m15mdfcfront,
    notes: [...MDFC_FRONT_NOTES, DFC_PAIR_NOTE, MDFC_STRIP_NOTE],
  },
  m15mdfcback: {
    colors: { ...perColor((k) => [layer(modalFrame(k, true))]), a: [layer(modalFrame("a", true))], ...dfcPairMasters("m15mdfcback") },
    // The transform pack's dark plates: the profile draws m15dfcback's.
    tones: dfcBackTonesFor("m15mdfcback", (k) => mdfcBackTones(k, MDFC_BACK_TONES)),
    pack: "packModalRegular.js 'Modal Regular' backs (groupModal-1.js)",
    transforms: `${NATIVE_1500}; ${mdfcBackToneTransform(MDFC_BACK_TONES)}`,
    strip: MDFC_STRIP_CUTS.m15mdfcback,
    notes: [...MDFC_BACK_NOTES, DFC_PAIR_NOTE, MDFC_STRIP_NOTE],
  },
  m15mdfclandfront: {
    colors: perColor((k) =>
      k === "c"
        ? [layer(`${MODAL}/l.png`)]
        : [layer(modalFrame(k, false)), replacing(modalLandTint(k), MODAL_MASK.frame), replacing(modalLandTint(k), MODAL_MASK.rules)],
    ),
    pack: "packModalRegular.js 'Modal Regular' fronts + packM15RegularNew.js land tints (a PipGlyph recipe)",
    transforms: MODAL_LAND_TRANSFORM(true),
    strip: MDFC_STRIP_CUTS.m15mdfclandfront,
    notes: [...MDFC_LAND_NOTES(true), MDFC_STRIP_NOTE],
  },
  m15mdfclandback: {
    colors: perColor((k) => (k === "c" ? [layer(`${MODAL}/lb.png`)] : [layer(modalFrame(k, true)), replacing(modalLandTint(k), MODAL_MASK.frame)])),
    tones: (k) => mdfcBackTones(k, MDFC_LAND_BACK_TONES),
    pack: "packModalRegular.js 'Modal Regular' backs + packM15RegularNew.js land tints (a PipGlyph recipe)",
    transforms: `${MODAL_LAND_TRANSFORM(false)}; ${mdfcBackToneTransform(MDFC_LAND_BACK_TONES)}`,
    strip: MDFC_STRIP_CUTS.m15mdfclandback,
    notes: [...MDFC_LAND_NOTES(false), MDFC_STRIP_NOTE],
  },
  // --- TODO 4.10a: the 1997 frame (see the section above CC_TEMPLATES).
  retro: {
    colors: {
      ...perColor((k) => [layer(`${SEVENTH}/${k}.png`)], ["w", "u", "b", "r", "g"]),
      c: [layer(`${SEVENTH}/a.png`)],
      m: [layer(RETRO_GOLD_MSE)],
    },
    printRecipe: (key) => seventhPrintRecipe("retro", key),
    pack: "packSeventh.js 'Seventh Edition' (w u b r g, a) + MSE magic-old mcard.jpg (m)",
    transforms: SEVENTH_TRANSFORM,
    notes: [
      ...SEVENTH_NOTES,
      "c = the pack's ARTIFACT frame a.png, as before (the 1997 frame printed no colourless non-artifact before 2021; the pack's c.png is MH3's 2024 frame)",
      "m = today's MSE gold (scripts/frame-inputs/retro-m-mse.png, the former public/frames/retro/m.png: magic-old mcard.jpg at 1500×2100, window cut, corners normalised), re-cut with the same edge map and NOT toned — Card Conjurer's gold failed proof 1 by eye; its art ring stays the MSE drawing's (up to 4.8 px wider than the gold prints')",
    ],
  },
  retroland: {
    colors: {
      c: [layer(`${SEVENTH}/l.png`)],
      ...perColor((k) => [layer(`${SEVENTH}/${k}l.png`)], ["w", "u", "b", "r", "g"]),
      m: [layer(`${SEVENTH}/l.png`), replacing(`${SEVENTH}/m.png`, `${SEVENTH}/rules.svg`)],
      ...oldFramePairs("retroland"),
    },
    printRecipe: (key) => seventhPrintRecipe("retroland", key),
    // A pair's sides: the coloured land on the plain land's cut (4.6h).
    builtSideRecipe: (key, cutOf) => seventhPrintRecipe("retroland", key, { cutOf }),
    pack: "packSeventh.js 'Seventh Edition' lands (l, wl ul bl rl gl)",
    transforms: SEVENTH_TRANSFORM,
    notes: [
      ...SEVENTH_NOTES,
      "c = the plain land l.png (the orange box of Fifth Edition 1997 on); w–g = the pack's coloured land boxes (wl … gl: the land frame, the box and its rings in the colour), toned onto the seven black-bordered basics of each colour (MIR, TMP, USG, MMQ, INV, ODY, ONS); the rings (the pack's Pinline mask) are their own region",
      "m = a render STAND-IN, never ticked: the plain land with the pack's gold text box laid in through its Rules mask, the box toned onto the gold prints' box. No three-colour 1997 land was measured; two-colour lands print a blend (TODO 4.6h)",
      OLD_PAIR_NOTE.retroland,
    ],
  },
  // --- TODO 4.10b: the 2003 frame (see the section above CC_TEMPLATES).
  modern: {
    colors: { ...perColor((k) => [layer(`${EIGHTH}/${EIGHTH_MASTER_OF.modern[k]}.png`)]), ...oldFramePairs("modern") },
    printRecipe: (key) => eighthPrintRecipe("modern", key),
    plates: EIGHTH_PT,
    plateGains: EIGHTH_PT_GAINS,
    pack: "pack8th.js '8th Edition' (w u b r g m, a) + its P/T plates",
    transforms: EIGHTH_TRANSFORM,
    notes: [
      ...EIGHTH_NOTES,
      "c = the pack's ARTIFACT frame a.png, as before (the pack's c.png is the translucent Eldrazi frame: TODO 4.10d); m = the pack's gold, the look of a THREE-colour card (a two-colour gold card wears two-colour pinlines: TODO 4.6h)",
      "P/T plates = the pack's own (322 × 176, native size), each multiplied by a per-channel gain onto its prints' plate face (plateGains: gold × 0.90 / 0.84 / 0.64, blue × 0.86 / 0.91 / 0.94, red × 1.08 / 1.09 / 1.15, the rest within 5 %), drawn at the printed box through the profile's plateRect; c takes the artifact plate; `modernland` draws this set",
      OLD_PAIR_NOTE.modern,
    ],
  },
  modernland: {
    colors: { ...perColor((k) => [layer(`${EIGHTH}/${EIGHTH_MASTER_OF.modernland[k]}.png`)]), ...oldFramePairs("modernland") },
    printRecipe: (key) => eighthPrintRecipe("modernland", key),
    pack: "pack8th.js '8th Edition' lands (l, wl ul bl rl gl, ml)",
    transforms: EIGHTH_TRANSFORM,
    notes: [
      ...EIGHTH_NOTES,
      "c = the plain land l.png, toned on 13 lands with no colour of their own; w–g = the pack's coloured land frames (wl … gl), toned on the eight basics of each colour (CHK RAV TSP LRW ALA ISD RTR THS); m = the pack's gold land ml.png, toned on 9 three- and five-colour lands (two-colour lands print a blend: TODO 4.6h)",
      OLD_PAIR_NOTE.modernland,
    ],
  },
};

/** A template's tones for a colour key: the same list for every key (the
 *  emblem), or per key (the transform backs, DFC_BACK_TONES). */
export function tonesFor(def, key) {
  if (!def.tones) return [];
  return typeof def.tones === "function" ? def.tones(key) : def.tones;
}

/** How provenance describes the text-box tokens' re-cut (TOKEN_REGULAR_RECUT). */
function recutTransform(r) {
  return `native 1500x2100, no resample; composited in CC's order, then re-cut: rows ${r.fromY}–${r.toY - 1} (the window's straight sides through the top of the text box) moved down ${r.shift} px as one piece, the rows opened above them filled from the window's sides, each seam cross-faded over ${r.blend} rows (premultiplied); corners rounded to the importer radius`;
}

/** How provenance describes the flip masters' lower-half re-cut
 *  (FLIP_LOWER_RECUT, layout v39). */
function flipLowerRecutTransform(r) {
  return `native 1500x2100, no resample; the lower half re-cut onto the prints: rows ${r.fromY}–${r.splitY - 1} (the window's lower rows, its inner line, the pinline, the upside-down type bar's outline and the first rows of its bevel) moved up ${-r.shiftTop} px and rows ${r.splitY}–${r.toY - 1} (the rest of the bevel, the bar's face, its bottom outline, the pinline below and the text box's top edge into its paper) moved up ${-r.shiftBottom} px, the ${r.shiftBottom - r.shiftTop} rows opened between them the bevel plateau repeated and the ${-r.shiftBottom} rows opened below the block the paper under it; the seams cross-faded over ${r.blendTop} rows inside the window, ${r.blendSplit} at the split and ${r.blendBottom} inside the paper (premultiplied); every row above ${r.fromY + r.shiftTop} and from ${r.toY} on copied 1:1; corners rounded to the importer radius`;
}

/** How provenance describes the textless tokens' re-cut (TOKEN_TEXTLESS_RECUT). */
function textlessRecutTransform(r) {
  return `native 1500x2100, no resample; composited in CC's order, then re-cut: rows ${r.fromY}–${r.toY - 1} (the window's straight sides through the type pill's shadow) moved down ${r.shift} px as one piece over the top ${r.shift} rows of the frame texture below them, the rows opened above them filled from the window's sides and cross-faded over ${r.blend} rows, the shadow's last ${r.blendBottom} rows faded into the texture (premultiplied); corners rounded to the importer radius`;
}

/** How provenance describes the emblem's touches (EMBLEM_RAY_BRIDGE, then
 *  EMBLEM_TONES). */
function emblemTransform(b, [pill, silver, type, box]) {
  const gains = pill.gain.map(([d, g]) => `${g} at ${d}`).join(", ");
  return [
    "native 1500x2100, pixels copied 1:1 (no resample) but for these touches:",
    `the spark's centre ray bridged over (rows ${b.fromY}–${b.toY - 1}, columns ${b.x0}–${b.x1 - 1} blended across from columns ${b.anchors[0]} and ${b.anchors[1]}, opaque; the ray's tip at row ${b.toY}, corners rounded to ${b.radius} px, drawn with its own right edge's profile, sampled on rows ${b.edgeRows[0]}–${b.edgeRows[1] - 1});`,
    `the name pill's body (rows ${pill.fromY}–${pill.toY - 1}, the pixels 4-connected to (${pill.seed.x}, ${pill.seed.y}) with luma ≥ ${pill.minLuma}, inside the pill's dark outline) has its colour multiplied by a gain piecewise-linear in the distance from x ${pill.centreX} (${gains} px) and is made opaque;`,
    `the silver (rows ${silver.bodyFromY}–${silver.bodyToY - 1} but for the spark's pure-white tail and glow; rows ${silver.fromY}–${silver.bodyFromY - 1} and ${silver.bodyToY}–${silver.toY - 1} from either edge to the first pixel of luma ≥ ${silver.stopLuma}) has its colour multiplied by a gain bilinear in the signed offset from x ${silver.centreX} — each half fitted on its own side of the prints, the centre segment joining them — and the row (${silver.gain.length} × ${silver.dx.length} knots, ${Math.min(...silver.gain.flat())}–${Math.max(...silver.gain.flat())});`,
    `the type pill's body (rows ${type.fromY}–${type.toY - 1}) × ${type.gain[0][1]} and the text box (rows ${box.fromY}–${box.toY - 1}, inside its light rim) × ${box.gain[0][1]}, alpha kept;`,
    "corners rounded to the importer radius",
  ].join(" ");
}

/** How provenance describes the full-art textless tokens' re-cut
 *  (M20_TOKEN_TEXTLESS_RECUT). */
function m20TextlessRecutTransform(r) {
  return `native 1500x2100, no resample; composited in CC's order, then re-cut: rows ${r.fromY}–${r.toY - 1} (the type pill with its glow and bottom rim) moved down ${r.shift} px as one piece over the top ${r.shift} rows of the clear lower window, the rows opened above them repeating the clear window and the black ring (hard cuts: only the ring and clear art meet either seam); corners rounded to the importer radius`;
}

/** Templates deliberately NOT imported yet, and why. */
export const CC_DEFERRED = {};

/**
 * Composite RGBA layers (each `{ data, mask?, invert?, opacity?, gain?, recolour?, lumaRamp? }`, raw 8-bit
 * RGBA of the same size; `mask` may be a LIST, whose alphas multiply — CC's
 * intersection) in order: a layer's alpha is multiplied by its
 * mask's ALPHA, then drawn source-over onto the accumulator — exactly CC's
 * drawFrames (a black canvas, the masks drawn 'source-in', the image drawn
 * 'source-in', the result 'source-over'). CC's masks are solid colours
 * (title red, rules green, border black): only their alpha means anything.
 * `invert` keeps the layer everywhere EXCEPT the mask by SUBTRACTING the
 * mask's coverage: alpha − mask alpha (floored at 0). The one inverted mask
 * (4.39's Border) outlines a region the frame image paints itself, and on
 * its anti-aliased inner edge the frame's alpha IS the ring's coverage (the
 * art window is clear): subtraction leaves 0 there. alpha × (1 − mask
 * alpha) left alpha × (1 − alpha) — a 1 px line of α 10–14 at the ring's
 * straight inner edges, up to 64 at its rounded corners — a faint rounded
 * rectangle over the art (owner evidence 2026-09-26). The two agree wherever
 * the mask is 0 or 255 or the frame is opaque (the bars that reach into the
 * ring). `gain` then lifts the layer's alpha and clamps it at 1 (4.33's
 * colourless walker rim). `replace` (4.34) puts the layer IN PLACE of what
 * is under it where the mask covers: a premultiplied lerp from the
 * accumulator to the layer by the mask's alpha (the layer's own alpha kept),
 * so a tinted box stands instead of the dark one below, and the mask's
 * anti-aliased edge blends the two. A `recolour` layer (4.33's gold walker)
 * changes only the colour below it — weight = its alpha relative to the
 * alpha below (at most 1) × mask × opacity × its luminance ramp — and keeps
 * the alpha. Returns a Float32Array RGBA with alpha in 0..1.
 */
export function compositeLayers(images, width, height) {
  const n = width * height;
  const acc = new Float32Array(n * 4);
  for (const [i, img] of images.entries()) {
    if (img.recolour && i === 0) throw new Error("compositeLayers: a recolour layer needs a layer below it");
    for (let p = 0; p < n; p += 1) {
      const o = p * 4;
      let a = img.data[o + 3] / 255;
      if (img.replace && i > 0) {
        const m = img.mask ? img.mask[o + 3] / 255 : 1;
        if (m === 0) continue;
        if (img.opacity !== undefined) a *= img.opacity;
        const ab = acc[o + 3];
        const outA = ab * (1 - m) + a * m;
        for (let c = 0; c < 3; c += 1) {
          acc[o + c] = outA === 0 ? 0 : (acc[o + c] * ab * (1 - m) + img.data[o + c] * a * m) / outA;
        }
        acc[o + 3] = outA;
        continue;
      }
      if (img.erase) {
        // CC's erase (destination-out, TODO 4.6f): the layer's alpha cuts
        // what is below; its colour is never drawn.
        if (i === 0) throw new Error("compositeLayers: an erase layer needs a layer below it");
        if (img.opacity !== undefined) a *= img.opacity;
        acc[o + 3] *= 1 - a;
        continue;
      }
      if (img.recolour) {
        // Colour only: mix into what is below by the layer's weight, keep
        // the alpha below (see `recolour`).
        const below = acc[o + 3];
        if (below === 0 || a === 0) continue;
        let w = Math.min(1, a / below);
        if (img.mask) w *= img.mask[o + 3] / 255;
        if (img.opacity !== undefined) w *= img.opacity;
        if (img.lumaRamp) {
          const [lo, hi] = img.lumaRamp;
          const lum = 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2];
          w *= Math.min(1, Math.max(0, (lum - lo) / (hi - lo)));
        }
        // Paper onto paper only (the see-through Universes Beyond frame):
        // a layer pixel more opaque than `maxAlpha` is that drawing's rim,
        // never its paper; and the colour BELOW must be paper too — its
        // luma ramps the weight the same way, so the lines, rims and bevels
        // of the layers below keep their own pixels.
        if (img.maxAlpha !== undefined && a > img.maxAlpha) continue;
        if (img.belowLumaRamp) {
          const [lo, hi] = img.belowLumaRamp;
          const lum = 0.299 * acc[o] + 0.587 * acc[o + 1] + 0.114 * acc[o + 2];
          w *= Math.min(1, Math.max(0, (lum - lo) / (hi - lo)));
        }
        if (w === 0) continue;
        for (let c = 0; c < 3; c += 1) acc[o + c] = acc[o + c] * (1 - w) + img.data[o + c] * w;
        continue;
      }
      if (img.mask) {
        // A list of masks is CC's intersection (each drawn 'source-in'):
        // their alphas multiply (TODO 4.6.0 — a region through a ramp).
        const m = Array.isArray(img.mask)
          ? img.mask.reduce((k, mask) => k * (mask[o + 3] / 255), 1)
          : img.mask[o + 3] / 255;
        a = img.invert ? Math.max(0, a - m) : a * m;
      }
      if (img.opacity !== undefined) a *= img.opacity;
      if (img.gain !== undefined) a = Math.min(1, a * img.gain);
      if (i === 0) {
        acc[o] = img.data[o];
        acc[o + 1] = img.data[o + 1];
        acc[o + 2] = img.data[o + 2];
        acc[o + 3] = a;
        continue;
      }
      if (a === 0) continue;
      const ab = acc[o + 3];
      const outA = a + ab * (1 - a);
      for (let c = 0; c < 3; c += 1) {
        acc[o + c] = outA === 0 ? 0 : (img.data[o + c] * a + acc[o + c] * ab * (1 - a)) / outA;
      }
      acc[o + 3] = outA;
    }
  }
  return acc;
}

/**
 * Move a horizontal band of an 8-bit RGBA image down (TOKEN_TEXTLESS_RECUT,
 * TOKEN_REGULAR_RECUT): rows [fromY, toY) land `shift` px lower, the `shift`
 * rows that opens at fromY repeat the rows just above it, and the rows below
 * the moved band keep their place, so the band covers the top `shift` rows
 * of what was below it. Each seam is cross-faded in premultiplied space: the top one over
 * `blend` rows, from the original rows into the repeated ones; the bottom
 * one over `blendBottom` rows (default `blend`; 0 = a hard cut), from the
 * moved rows into the original ones. Returns a new buffer.
 */
export function recutBand(buf, width, height, { fromY, toY, shift, blend, blendBottom = blend }) {
  if (
    !(shift > 0) ||
    !(fromY >= shift) ||
    !(toY > fromY) ||
    toY + shift > height ||
    !(blend >= 0) ||
    !(blendBottom >= 0) ||
    fromY + blend > toY + shift - blendBottom
  ) {
    throw new Error(`recutBand: bad band ${JSON.stringify({ fromY, toY, shift, blend, blendBottom, height })}`);
  }
  const out = Buffer.from(buf);
  const row = width * 4;
  const mix = (y, a, b, t) => {
    // premultiplied lerp of row a (weight 1 − t) and row b (weight t) into y
    for (let x = 0; x < width; x += 1) {
      const ia = a * row + x * 4;
      const ib = b * row + x * 4;
      const o = y * row + x * 4;
      const aa = (buf[ia + 3] / 255) * (1 - t);
      const ab = (buf[ib + 3] / 255) * t;
      const alpha = aa + ab;
      for (let c = 0; c < 3; c += 1) {
        out[o + c] = alpha === 0 ? 0 : Math.round((buf[ia + c] * aa + buf[ib + c] * ab) / alpha);
      }
      out[o + 3] = Math.round(alpha * 255);
    }
  };
  for (let y = fromY; y < toY + shift; y += 1) {
    const src = y - shift;
    if (y < fromY + blend) mix(y, y, src, (y - fromY + 1) / (blend + 1));
    else if (y >= toY + shift - blendBottom) mix(y, src, y, (y - (toY + shift - blendBottom) + 1) / (blendBottom + 1));
    else buf.copy(out, y * row, src * row, (src + 1) * row);
  }
  return out;
}

/**
 * The split-bar full-art basics (TODO 4.40): move the type BAR and the
 * MEDALLION that sits on it onto the prints, each by its own whole-px
 * distance (ZEN_BASIC_RECUT, SNC_BASIC_RECUT — measured on every printing
 * of the look). Three steps on an 8-bit RGBA image, nothing resampled:
 *   1. where the medallion is moved (`medallion.dy` ≠ 0), its disc
 *      (radius r + pad) outside the bar's rows (`medallion.keepRows`, else
 *      the moved band's) is cleared to the row's own
 *      pixel just beside the disc (`clearAt`, the art window's α 0 on
 *      these packs — asserted: a cleared pixel must come from α 0);
 *   2. the bar's rows [fromY, toY) move by `bar.dy` (either way); the rows
 *      it leaves repeat the nearest row outside the band (the window's α 0
 *      and the border's black, which run straight down there);
 *   3. the medallion's disc is drawn back from the SOURCE at its own move,
 *      over the moved bar, its edge feathered over `feather` px from the
 *      radius r + pad.
 * Returns a new buffer.
 */
export function recutBarAndMedallion(buf, width, height, { bar, medallion }) {
  const { fromY, toY, dy } = bar;
  const { cx, cy, r, pad, feather, dy: mdy } = medallion;
  const ints = [fromY, toY, dy, cx, cy, r, pad, feather, mdy];
  if (!ints.every(Number.isInteger) || !(toY > fromY) || fromY + Math.min(dy, 0) < 0 || toY + Math.max(dy, 0) > height || !(r > 0) || pad < 0 || feather < 1) {
    throw new Error(`recutBarAndMedallion: bad recut ${JSON.stringify({ bar, medallion, height })}`);
  }
  const row = width * 4;
  const out = Buffer.from(buf);
  const R = r + pad;
  // The bar's own rows inside the disc (default: the moved band's).
  const [keepFrom, keepTo] = medallion.keepRows ?? [fromY, toY];
  // 1. the old medallion's caps, outside the bar, cleared.
  if (mdy !== 0) {
    for (let y = Math.max(0, cy - R); y <= Math.min(height - 1, cy + R); y += 1) {
      if (y >= keepFrom && y < keepTo) continue;
      const half = Math.sqrt(Math.max(0, R * R - (y - cy) * (y - cy)));
      const x0 = Math.max(0, Math.floor(cx - half) - 1);
      const x1 = Math.min(width - 1, Math.ceil(cx + half) + 1);
      const beside = y * row + Math.max(0, x0 - 1) * 4;
      if (buf[beside + 3] !== 0) {
        throw new Error(`recutBarAndMedallion: the pixel beside the medallion at (${x0 - 1}, ${y}) is not clear (α ${buf[beside + 3]})`);
      }
      for (let x = x0; x <= x1; x += 1) buf.copy(out, y * row + x * 4, beside, beside + 4);
    }
  }
  // 2. the bar's rows moved; the rows it leaves repeat the nearest row
  // outside the band.
  const moved = Buffer.from(out);
  const lo = Math.min(fromY, fromY + dy);
  const hi = Math.max(toY, toY + dy);
  for (let y = lo; y < hi; y += 1) {
    let src = y - dy;
    if (src >= fromY && src < toY) {
      moved.copy(out, y * row, src * row, (src + 1) * row);
    } else {
      src = dy > 0 ? fromY - 1 : toY;
      moved.copy(out, y * row, src * row, (src + 1) * row);
    }
  }
  // 3. the medallion, from the source, at its own move.
  const ncy = cy + mdy;
  for (let y = Math.max(0, ncy - R - feather); y <= Math.min(height - 1, ncy + R + feather); y += 1) {
    const sy = y - mdy;
    if (sy < 0 || sy >= height) continue;
    for (let x = Math.max(0, cx - R - feather); x <= Math.min(width - 1, cx + R + feather); x += 1) {
      const d = Math.hypot(x - cx, y - ncy);
      const t = d <= R ? 1 : d >= R + feather ? 0 : 1 - (d - R) / feather;
      if (t === 0) continue;
      const o = y * row + x * 4;
      const s = sy * row + x * 4;
      const as = (buf[s + 3] / 255) * t;
      const ao = (out[o + 3] / 255) * (1 - t);
      const a = as + ao;
      for (let c = 0; c < 3; c += 1) out[o + c] = a === 0 ? 0 : Math.round((buf[s + c] * as + out[o + c] * ao) / a);
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

/**
 * PipGlyph's own WHITE medallion symbol (TODO 4.40, owner Round 64): CC's
 * white sun (`sw.svg`) keeps only its SHAPE — its alpha — and is repainted
 * as the prints draw it (BFZ #250, AKH #250, MH1 #250, SNC #272, BRO #278:
 * a cream-white sun barely lighter than the bar, set off by a soft dark
 * shadow down and to the left and a dark line round the central disc):
 * every covered pixel takes `fill`, and under the shape a shadow of the
 * shape — moved by (dx, dy) px, box-blurred `blur` px three times (≈ a
 * gaussian), in `shadow` at `shadowOpacity` — shows through its gaps and
 * past its edges. 8-bit RGBA in, a new buffer out; nothing else of CC's
 * pixels (its lavender rim) is kept.
 */
export function shadeWhiteMedallionSymbol(buf, width, height, { fill, shadow, shadowOpacity, dx, dy, blur }) {
  const n = width * height;
  const shape = new Float32Array(n);
  for (let p = 0; p < n; p += 1) shape[p] = buf[p * 4 + 3] / 255;
  // The shadow's coverage: the shape moved, then blurred (separable boxes).
  let sh = new Float32Array(n);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x - dx;
      const sy = y - dy;
      if (sx >= 0 && sy >= 0 && sx < width && sy < height) sh[y * width + x] = shape[sy * width + sx];
    }
  }
  const boxPass = (src, horizontal) => {
    const out = new Float32Array(n);
    const len = horizontal ? width : height;
    const lines = horizontal ? height : width;
    for (let l = 0; l < lines; l += 1) {
      let acc = 0;
      const at = (i) => (horizontal ? l * width + i : i * width + l);
      for (let i = -blur; i <= blur; i += 1) acc += i >= 0 && i < len ? src[at(i)] : 0;
      for (let i = 0; i < len; i += 1) {
        out[at(i)] = acc / (2 * blur + 1);
        const add = i + blur + 1;
        const drop = i - blur;
        if (add < len) acc += src[at(add)];
        if (drop >= 0) acc -= src[at(drop)];
      }
    }
    return out;
  };
  for (let k = 0; k < 3; k += 1) sh = boxPass(boxPass(sh, true), false);
  const out = Buffer.alloc(n * 4);
  for (let p = 0; p < n; p += 1) {
    const a = shape[p];
    const s = Math.min(1, sh[p]) * shadowOpacity * (1 - a);
    const alpha = a + s;
    const o = p * 4;
    for (let c = 0; c < 3; c += 1) out[o + c] = alpha === 0 ? 0 : Math.round((fill[c] * a + shadow[c] * s) / alpha);
    out[o + 3] = Math.round(alpha * 255);
  }
  return out;
}

/** The provenance line of a white medallion symbol's shading. */
export function describeWhiteMedallionSymbol({ fill, shadow, shadowOpacity, dx, dy, blur }) {
  return `PipGlyph's own shading of CC's white sun: its alpha (shape) only, filled ${fill.join(",")}, over a shadow of the shape moved ${dx},${dy} px, blurred ${blur} px ×3, in ${shadow.join(",")} at ${Math.round(shadowOpacity * 100)} % (owner Round 64: the prints' shaded cream sun, BFZ #250 / AKH #250 / MH1 #250 / SNC #272 / BRO #278)`;
}

/** The provenance line of a recutBarAndMedallion recipe. */
export function describeBarRecut({ bar, medallion }) {
  const way = (d) => (d === 0 ? "kept in place" : `moved ${Math.abs(d)} px ${d > 0 ? "down" : "up"}`);
  return `the type bar (rows ${bar.fromY}–${bar.toY - 1}) ${way(bar.dy)} and the medallion (centre ${medallion.cx}, ${medallion.cy}, r ${medallion.r} + ${medallion.pad}) ${way(medallion.dy)}, onto the prints (no resample; the rows the bar leaves repeat the window's clear row / the border's black, the medallion drawn back over the bar with a ${medallion.feather} px feathered edge)`;
}

/**
 * Move a block of an 8-bit RGBA image UP in two pieces (FLIP_LOWER_RECUT):
 * rows [fromY, splitY) land `shiftTop` px higher and rows [splitY, toY)
 * `shiftBottom` px higher (both negative, the top piece moving at least as
 * far), so the rows between the two pieces' new places — splitY + shiftTop
 * up to splitY + shiftBottom — repeat the bottom piece's first rows, and
 * the rows the bottom piece leaves at [toY + shiftBottom, toY) repeat the
 * rows just below it; everything above fromY + shiftTop and from toY on
 * keeps its place. Three seams, each cross-faded in premultiplied space (0
 * = a hard cut): the top one over `blendTop` rows from the original rows
 * into the moved ones, the split over `blendSplit` rows from the top piece's
 * continuation into the bottom piece, the bottom over `blendBottom` rows
 * from the moved rows into the original ones. Returns a new buffer.
 */
export function recutBlockUp(buf, width, height, { fromY, splitY, toY, shiftTop, shiftBottom, blendTop, blendSplit, blendBottom }) {
  const ok =
    Number.isInteger(shiftTop) &&
    Number.isInteger(shiftBottom) &&
    shiftTop < 0 &&
    shiftBottom < 0 &&
    shiftTop <= shiftBottom &&
    Number.isInteger(fromY) &&
    Number.isInteger(splitY) &&
    Number.isInteger(toY) &&
    fromY + shiftTop >= 0 &&
    fromY < splitY &&
    splitY < toY &&
    toY - shiftBottom <= height &&
    [blendTop, blendSplit, blendBottom].every((b) => Number.isInteger(b) && b >= 0) &&
    fromY + shiftTop + blendTop <= splitY + shiftTop &&
    splitY + shiftTop + blendSplit <= toY - blendBottom;
  if (!ok) {
    throw new Error(
      `recutBlockUp: bad block ${JSON.stringify({ fromY, splitY, toY, shiftTop, shiftBottom, blendTop, blendSplit, blendBottom, height })}`,
    );
  }
  const out = Buffer.from(buf);
  const row = width * 4;
  const mix = (y, a, b, t) => {
    // premultiplied lerp of row a (weight 1 − t) and row b (weight t) into y
    for (let x = 0; x < width; x += 1) {
      const ia = a * row + x * 4;
      const ib = b * row + x * 4;
      const o = y * row + x * 4;
      const aa = (buf[ia + 3] / 255) * (1 - t);
      const ab = (buf[ib + 3] / 255) * t;
      const alpha = aa + ab;
      for (let c = 0; c < 3; c += 1) {
        out[o + c] = alpha === 0 ? 0 : Math.round((buf[ia + c] * aa + buf[ib + c] * ab) / alpha);
      }
      out[o + 3] = Math.round(alpha * 255);
    }
  };
  const topStart = fromY + shiftTop;
  const split = splitY + shiftTop;
  // The top piece: its rows, `shiftTop` higher; the first `blendTop` rows
  // fade from the original rows into it.
  for (let y = topStart; y < split; y += 1) {
    const src = y - shiftTop;
    if (y < topStart + blendTop) mix(y, y, src, (y - topStart + 1) / (blendTop + 1));
    else buf.copy(out, y * row, src * row, (src + 1) * row);
  }
  // The bottom piece, `shiftBottom` higher, extended over the rows the two
  // moves open between them (its own first rows again) and below it (the
  // rows under the block); the split fades from the top piece's
  // continuation into it, the bottom seam from it into the original rows.
  for (let y = split; y < toY; y += 1) {
    const src = y - shiftBottom;
    if (y < split + blendSplit) mix(y, y - shiftTop, src, (y - split + 1) / (blendSplit + 1));
    else if (y >= toY - blendBottom) mix(y, src, y, (y - (toY - blendBottom) + 1) / (blendBottom + 1));
    else buf.copy(out, y * row, src * row, (src + 1) * row);
  }
  return out;
}

/**
 * Move every row of an 8-bit RGBA image down `dy` px (4.34: the borderless
 * land's title bar onto its type bar). The rows it opens at the top are
 * transparent; rows pushed past the bottom are dropped. Returns a new
 * buffer.
 */
export function shiftRows(buf, width, height, dy) {
  if (!Number.isInteger(dy) || dy < 0 || dy >= height) {
    throw new Error(`shiftRows: bad shift ${dy} for ${height} rows`);
  }
  const out = Buffer.alloc(buf.length);
  const row = width * 4;
  buf.copy(out, dy * row, 0, (height - dy) * row);
  return out;
}

/**
 * The RGBA at (x, y) of an 8-bit RGBA image, asserted FLAT: its 5×5
 * neighbourhood is that one value (4.34: a title bar's tint is read from
 * the middle of its flat interior, so a source that moved fails the import
 * instead of tinting a box with a bevel's colour).
 */
export function flatPixelAt(buf, width, height, { x, y }) {
  const at = (px, py) => {
    const o = (py * width + px) * 4;
    return [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]];
  };
  const value = at(x, y);
  for (let py = y - 2; py <= y + 2; py += 1) {
    for (let px = x - 2; px <= x + 2; px += 1) {
      if (px < 0 || py < 0 || px >= width || py >= height || at(px, py).some((v, c) => v !== value[c])) {
        throw new Error(`flatPixelAt: (${x}, ${y}) is not in a flat region (${at(px, py)} at (${px}, ${py}) vs ${value})`);
      }
    }
  }
  return value;
}

/**
 * Re-tint a NEUTRAL structure (4.34: genericShowcase's grey 'Land Frame'
 * text box, flat `from`, its bevels lighter and its shadow darker) to the
 * colour `to`: each pixel is `from` lerped toward white or black by some t,
 * and becomes `to` lerped the same way by the same t — the relation every
 * genericShowcase colour frame's box has to its own tint. t is read from
 * the pixel's channel mean (a neutral structure's channels agree); alpha is
 * kept. Returns a new buffer.
 */
export function retintStructure(buf, from, to) {
  const out = Buffer.from(buf);
  const f = (from[0] + from[1] + from[2]) / 3;
  if (!(f > 0 && f < 255)) throw new Error(`retintStructure: \`from\` must be a mid tone, got ${from}`);
  for (let o = 0; o < buf.length; o += 4) {
    const v = (buf[o] + buf[o + 1] + buf[o + 2]) / 3;
    const lighter = v >= f;
    const t = lighter ? (v - f) / (255 - f) : 1 - v / f;
    for (let c = 0; c < 3; c += 1) {
      out[o + c] = Math.round(lighter ? to[c] + t * (255 - to[c]) : to[c] * (1 - t));
    }
  }
  return out;
}

/** Rec. 601 luma of the 8-bit RGBA pixel at byte offset `o`. */
function lumaAt(buf, o) {
  return 0.299 * buf[o] + 0.587 * buf[o + 1] + 0.114 * buf[o + 2];
}

/** A piecewise-linear gain ([[d, g], …], d ascending) at distance `d`,
 *  held at the first / last knot outside them. */
export function gainAt(knots, d) {
  if (d <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i += 1) {
    const [d1, g1] = knots[i];
    if (d <= d1) {
      const [d0, g0] = knots[i - 1];
      return g0 + ((g1 - g0) * (d - d0)) / (d1 - d0);
    }
  }
  return knots[knots.length - 1][1];
}

/**
 * Tone one region of an 8-bit RGBA image (EMBLEM_NAME_PILL_TONE,
 * EMBLEM_TYPE_PILL_TONE, EMBLEM_TEXT_BOX_TONE): the pixels 4-connected to
 * `seed` within rows [fromY, toY) whose luma is ≥ `minLuma` — a darker
 * outline bounds the region — get their colour multiplied by
 * gainAt(gain, |x − centreX|) (rounded, clamped to 255) and alpha 255, or
 * their own alpha with `keepAlpha`. Everything else is copied as it is.
 * Returns a new buffer.
 */
export function toneRegion(buf, width, height, { seed, fromY, toY, minLuma, centreX, gain, keepAlpha = false }) {
  const knotsOk =
    Array.isArray(gain) &&
    gain.length > 0 &&
    gain.every(([d, g], i) => Number.isFinite(d) && Number.isFinite(g) && g >= 0 && (i === 0 || d > gain[i - 1][0]));
  if (
    !(fromY >= 0) ||
    !(toY > fromY) ||
    toY > height ||
    !knotsOk ||
    !(seed.x >= 0 && seed.x < width && seed.y >= fromY && seed.y < toY)
  ) {
    throw new Error(`toneRegion: bad tone ${JSON.stringify({ seed, fromY, toY, minLuma, gain, width, height })}`);
  }
  const out = Buffer.from(buf);
  const start = seed.y * width + seed.x;
  if (lumaAt(buf, start * 4) < minLuma) {
    throw new Error(`toneRegion: the seed (${seed.x}, ${seed.y}) is darker than luma ${minLuma} — not inside the region`);
  }
  const taken = new Uint8Array(width * height);
  const stack = [start];
  taken[start] = 1;
  while (stack.length) {
    const p = stack.pop();
    const x = p % width;
    const y = (p - x) / width;
    const o = p * 4;
    const g = gainAt(gain, Math.abs(x - centreX));
    for (let c = 0; c < 3; c += 1) out[o + c] = Math.min(255, Math.round(buf[o + c] * g));
    if (!keepAlpha) out[o + 3] = 255;
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || nx >= width || ny < fromY || ny >= toY) continue;
      const q = ny * width + nx;
      if (taken[q] || lumaAt(buf, q * 4) < minLuma) continue;
      taken[q] = 1;
      stack.push(q);
    }
  }
  return out;
}

/** Knots at `v`: the segment [i, i + 1] and the fraction along it, held
 *  at the ends. */
function knotAt(knots, v) {
  if (v <= knots[0]) return [0, 0];
  const last = knots.length - 1;
  if (v >= knots[last]) return [Math.max(0, last - 1), last === 0 ? 0 : 1];
  let i = 0;
  while (v > knots[i + 1]) i += 1;
  return [i, (v - knots[i]) / (knots[i + 1] - knots[i])];
}

/** EMBLEM_SILVER_TONE's gain at (dx, y), dx = x − centreX (negative on the
 *  left): bilinear in the knots `dx` × `rows`, held past the outer ones — so
 *  each half follows its own knots and the segment between the halves'
 *  innermost knots joins them without a seam. */
export function silverGainAt({ dx: dxKnots, rows, gain }, dx, y) {
  const [i, t] = knotAt(dxKnots, dx);
  const [j, u] = knotAt(rows, y);
  const i1 = Math.min(i + 1, dxKnots.length - 1);
  const j1 = Math.min(j + 1, rows.length - 1);
  return (
    gain[j][i] * (1 - t) * (1 - u) + gain[j][i1] * t * (1 - u) + gain[j1][i] * (1 - t) * u + gain[j1][i1] * t * u
  );
}

/**
 * Tone the emblem's silver (EMBLEM_SILVER_TONE): in rows [bodyFromY,
 * bodyToY) every pixel with alpha > 0 but the translucent pure-white ones
 * (the spark's tail and glow); in rows [fromY, bodyFromY) and [bodyToY,
 * toY), each row from either edge inwards up to (not including) its first
 * pixel of luma ≥ `stopLuma` — the silver beside the bars, not the bars'
 * rims. Colour × silverGainAt(spec, x − centreX, y), rounded, clamped to
 * 255; alpha kept. Returns a new buffer.
 */
export function toneSilver(buf, width, height, spec) {
  const { fromY, bodyFromY, bodyToY, toY, stopLuma, centreX, dx, rows, gain } = spec;
  const ascending = (k) => Array.isArray(k) && k.length > 0 && k.every((v, i) => Number.isFinite(v) && (i === 0 || v > k[i - 1]));
  if (
    !(fromY >= 0 && fromY <= bodyFromY && bodyFromY < bodyToY && bodyToY <= toY && toY <= height) ||
    !ascending(dx) ||
    !ascending(rows) ||
    !Array.isArray(gain) ||
    gain.length !== rows.length ||
    !gain.every((r) => Array.isArray(r) && r.length === dx.length && r.every((g) => Number.isFinite(g) && g >= 0))
  ) {
    throw new Error(`toneSilver: bad tone ${JSON.stringify({ fromY, bodyFromY, bodyToY, toY, dx, rows, width, height })}`);
  }
  const out = Buffer.from(buf);
  const tone = (x, y) => {
    const o = (y * width + x) * 4;
    if (buf[o + 3] === 0) return;
    const g = silverGainAt(spec, x - centreX, y);
    for (let c = 0; c < 3; c += 1) out[o + c] = Math.min(255, Math.round(buf[o + c] * g));
  };
  for (let y = fromY; y < toY; y += 1) {
    if (y >= bodyFromY && y < bodyToY) {
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        const pureWhite = buf[o] === 255 && buf[o + 1] === 255 && buf[o + 2] === 255;
        if (pureWhite && buf[o + 3] < 255) continue;
        tone(x, y);
      }
      continue;
    }
    let x = 0;
    for (; x < width && lumaAt(buf, (y * width + x) * 4) < stopLuma; x += 1) tone(x, y);
    // A row with no rim (the strip above the name bar) was toned whole.
    for (let r = width - 1; r > x && lumaAt(buf, (y * width + r) * 4) < stopLuma; r -= 1) tone(r, y);
  }
  return out;
}

/**
 * Tone a MASKED region of an 8-bit RGBA image (TODO 5.1a, the transform
 * backs' bars and box — DFC_BACK_TONES): every pixel the mask's alpha
 * covers has its colour multiplied by `gain`, weighted by the mask's
 * coverage (an anti-aliased mask edge blends) and faded to ×1 across the
 * pixel's own luma from `lumaRamp[0]` (the whole gain) to `lumaRamp[1]`
 * (none) — the well's white ring, the ▼ glyph and the light rims inside
 * CC's Title mask keep their tone while the bar's flat face takes the gain.
 * Rounded, clamped to 255; alpha kept. Returns a new buffer. `mask` is the
 * mask's raw RGBA at the image's size.
 */
export function toneMasked(buf, width, height, mask, { gain, lumaRamp = [...DFC_BACK_TONE_LUMA_RAMP] }) {
  const [lo, hi] = lumaRamp;
  const ramped = isRampedGain(gain);
  if ((!ramped && !(Number.isFinite(gain) && gain >= 0)) || !(lo >= 0 && hi > lo && hi <= 255)) {
    throw new Error(`toneMasked: bad tone ${JSON.stringify({ gain, lumaRamp })}`);
  }
  const n = width * height;
  if (!mask || mask.length !== n * 4) throw new Error(`toneMasked: the mask is not ${width}x${height} RGBA`);
  // A ramped gain (TODO 5.1d, a pair back's text box): the left colour's
  // gain lerped into the right's across the ramp, per column — the box
  // under it is the two colours' boxes lerped across the same ramp.
  const gainAt = ramped ? rampedGainRow(gain, width) : null;
  const out = Buffer.from(buf);
  for (let p = 0; p < n; p += 1) {
    const o = p * 4;
    const m = mask[o + 3] / 255;
    if (m === 0 || buf[o + 3] === 0) continue;
    const l = lumaAt(buf, o);
    // 1 at or below lo, 0 at or above hi (smoothstep between).
    const t = l <= lo ? 1 : l >= hi ? 0 : 1 - ((l - lo) / (hi - lo)) ** 2 * (3 - 2 * ((l - lo) / (hi - lo)));
    const g = 1 + ((gainAt ? gainAt[p % width] : gain) - 1) * m * t;
    if (g === 1) continue;
    for (let c = 0; c < 3; c += 1) out[o + c] = Math.min(255, Math.round(buf[o + c] * g));
  }
  return out;
}

/** A tone gain that changes across the card: `{ left, right, ramp }` — the
 *  left gain up to the ramp's start, the right from its end, lerped between
 *  (pair-ramp.mjs rampShare; TODO 5.1d, the pair backs' box). */
export function isRampedGain(gain) {
  return Boolean(gain) && typeof gain === "object" && Number.isFinite(gain.left) && Number.isFinite(gain.right) && Array.isArray(gain.ramp);
}

/** The per-column gains of a ramped gain over `width` columns (pixel
 *  centres, % of the width — the ramp mask's own rule). */
export function rampedGainRow({ left, right, ramp }, width) {
  if (!(left >= 0 && right >= 0)) throw new Error(`rampedGainRow: bad gains ${left} / ${right}`);
  const row = new Float64Array(width);
  for (let x = 0; x < width; x += 1) row[x] = left + (right - left) * rampShare(((x + 0.5) / width) * 100, ramp);
  return row;
}

/** One entry of a recipe's `tones`: the silver (it has `bodyFromY`), a
 *  masked region (it names a `mask`; `masks` maps the mask path to its raw
 *  RGBA at the image's size) or an outlined region (toneRegion). */
export function applyTone(buf, width, height, tone, masks = {}) {
  if ("bodyFromY" in tone) return toneSilver(buf, width, height, tone);
  if ("mask" in tone) return toneMasked(buf, width, height, masks[tone.mask], tone);
  return toneRegion(buf, width, height, tone);
}

/**
 * Close the frame over the top of a clear ray (EMBLEM_RAY_BRIDGE; see it for
 * the why). On an 8-bit RGBA composite:
 *  1. the ray's right edge profile — on rows [edgeRows), the edge's α-½ line
 *     (scanning right from x0 + 10 for the first α ≥ ½ past the clear run)
 *     and the mean colour 0–10 px outside it, by whole px of distance; the
 *     outline's colour is the mean at 2–4 px, the silver's at 10;
 *  2. the ray's two edges at row `toY` (the α-½ lines of the clear run
 *     scanning right from x0), xl and xr;
 *  3. rows [fromY, toY) × columns [x0, x1): each row's pixels at the two
 *     anchors blended across (alpha 255); left of xl, the frame's own pixels
 *     fade back in over the last `fadeRows` rows;
 *  4. the tip: every pixel within the profile's reach of the rounded-top
 *     cut-out (top edge at toY, from xl to xr, corners of `radius`) — above
 *     it, or in its rounded corners — takes the outline's colour mixed
 *     towards the silver under it by the profile at that distance, and
 *     towards it again by ((xr − x) / (xr − xl)) ^ fadePow (light at the
 *     left edge); a rounded corner's pixels take its alpha from the distance
 *     (½ px anti-aliasing), never less than their own.
 * Returns a new buffer.
 */
export function bridgeRayTip(buf, width, height, { fromY, toY, x0, x1, anchors, fadeRows, radius, fadePow, edgeRows }) {
  if (
    !(fromY >= 0 && toY > fromY && toY + radius + 1 < height) ||
    !(anchors[0] >= 0 && anchors[0] < x0 && x0 < x1 && x1 <= anchors[1] && anchors[1] < width) ||
    !(fadeRows > 0 && fadeRows <= toY - fromY) ||
    !(radius >= 0 && fadePow > 0) ||
    !(edgeRows[0] > toY && edgeRows[1] > edgeRows[0] && edgeRows[1] <= height)
  ) {
    throw new Error(`bridgeRayTip: bad bridge ${JSON.stringify({ fromY, toY, x0, x1, anchors, fadeRows, radius, fadePow, edgeRows })}`);
  }
  const at = (x, y) => (y * width + x) * 4;
  const alpha = (x, y) => buf[at(x, y) + 3] / 255;
  const rgb = (x, y) => [buf[at(x, y)], buf[at(x, y) + 1], buf[at(x, y) + 2]];
  const luma3 = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  /** The α-½ lines of the first clear run right of `from` on row y. */
  const edges = (y, from) => {
    let x = from;
    while (x < x1 && alpha(x, y) >= 0.5) x += 1;
    if (x >= x1 || x === 0) return null;
    const left = x - 0.5 + (alpha(x - 1, y) - 0.5) / (alpha(x - 1, y) - alpha(x, y));
    while (x < x1 && alpha(x, y) < 0.5) x += 1;
    if (x >= x1) return null;
    const right = x - 0.5 + (0.5 - alpha(x - 1, y)) / (alpha(x, y) - alpha(x - 1, y));
    return { left, right, firstOpaque: x };
  };
  // 1. The right edge's profile.
  const sums = Array.from({ length: 11 }, () => [0, 0, 0, 0]);
  for (let y = edgeRows[0]; y < edgeRows[1]; y += 1) {
    const e = edges(y, x0);
    if (!e) throw new Error(`bridgeRayTip: no clear ray on row ${y}`);
    for (let x = e.firstOpaque; x <= e.firstOpaque + 10 && x < width; x += 1) {
      const d = Math.round(x + 0.5 - e.right);
      if (d < 0 || d > 10) continue;
      const c = rgb(x, y);
      for (let k = 0; k < 3; k += 1) sums[d][k] += c[k];
      sums[d][3] += 1;
    }
  }
  const mean = (d) => {
    if (!sums[d][3]) throw new Error(`bridgeRayTip: no edge sample ${d} px out`);
    return sums[d].slice(0, 3).map((v) => v / sums[d][3]);
  };
  const outline = [0, 1, 2].map((k) => (mean(2)[k] + mean(3)[k] + mean(4)[k]) / 3);
  const lo = luma3(outline);
  const hi = luma3(mean(10));
  /** 0 = the outline, 1 = the silver, at `d` px out (0 inside 2 px). */
  const profile = [0, 0, ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => Math.min(1, Math.max(0, (luma3(mean(d)) - lo) / (hi - lo))))];
  const profileAt = (d) => {
    if (d >= 10) return 1;
    const i = Math.floor(d);
    return profile[i] + (profile[i + 1] - profile[i]) * (d - i);
  };
  // 2. The ray's edges where its new tip sits.
  const tip = edges(toY, x0);
  if (!tip) throw new Error(`bridgeRayTip: no clear ray on row ${toY}`);
  const { left: xl, right: xr } = tip;
  const out = Buffer.from(buf);
  // 3. The silver closed over.
  const base = new Float64Array((toY - fromY) * (x1 - x0) * 3);
  for (let y = fromY; y < toY; y += 1) {
    const a = rgb(anchors[0], y);
    const b = rgb(anchors[1], y);
    for (let x = x0; x < x1; x += 1) {
      const t = (x - anchors[0]) / (anchors[1] - anchors[0]);
      const keep = x + 0.5 < xl ? Math.min(1, Math.max(0, (y + 0.5 - (toY - fadeRows)) / fadeRows)) : 0;
      const own = rgb(x, y);
      const o = at(x, y);
      const bi = ((y - fromY) * (x1 - x0) + (x - x0)) * 3;
      for (let k = 0; k < 3; k += 1) {
        const v = (a[k] * (1 - t) + b[k] * t) * (1 - keep) + own[k] * keep;
        base[bi + k] = v;
        out[o + k] = Math.round(v);
      }
      out[o + 3] = 255;
    }
  }
  // 4. The tip.
  const leftSilver = rgb(Math.floor(xl) - 1, toY);
  for (let y = fromY; y <= toY + Math.ceil(radius); y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const qx = Math.max(xl + radius - cx, cx - (xr - radius), 0);
      const qy = Math.max(toY + radius - cy, 0);
      const d = Math.hypot(qx, qy) - radius;
      const o = at(x, y);
      if (y >= toY && (d <= -0.5 || buf[o + 3] === 255)) continue;
      if (d >= 10) continue;
      const f = Math.min(1, Math.max(0, (xr - cx) / (xr - xl))) ** fadePow;
      const p = profileAt(Math.max(d, 0));
      const w = p + (1 - p) * f;
      const under = y < toY ? [0, 1, 2].map((k) => base[((y - fromY) * (x1 - x0) + (x - x0)) * 3 + k]) : cx < (xl + xr) / 2 ? leftSilver : outline;
      for (let k = 0; k < 3; k += 1) out[o + k] = Math.min(255, Math.max(0, Math.round(outline[k] * (1 - w) + under[k] * w)));
      out[o + 3] = y < toY ? 255 : Math.max(buf[o + 3], Math.round(Math.min(1, Math.max(0, d + 0.5)) * 255));
    }
  }
  return out;
}

/** Alpha out everything outside a rounded rectangle (1 px anti-aliased). */
export function roundCorners(acc, width, height, radius) {
  const r = radius;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cx = x < r ? r - x - 0.5 : x >= width - r ? x - (width - r) + 0.5 : 0;
      const cy = y < r ? r - y - 0.5 : y >= height - r ? y - (height - r) + 0.5 : 0;
      if (cx === 0 || cy === 0) continue;
      const d = Math.sqrt(cx * cx + cy * cy) - r;
      if (d <= -0.5) continue;
      const k = d >= 0.5 ? 0 : 0.5 - d;
      acc[(y * width + x) * 4 + 3] *= k;
    }
  }
}

/** Same as roundCorners, on 8-bit RGBA (after the final downscale): the
 *  card corner mask the bake applies too (lib/cards/card-corner.ts, TODO
 *  3.26), so a master and a bake cut at one radius agree pixel for pixel. */
export function roundCornersRgba8(buf, width, height, radius, keep = []) {
  // A recipe's `keepCorners` (TODO 4.11: the ring's top corners, design that
  // runs into the corner on print): those corner boxes are put back after
  // the cut, so a square output keeps them (lib/frames/square-corners.ts
  // "frame"); every round output cuts them at render.
  const n = Math.ceil(radius);
  const boxes = keep.map((corner) => {
    const x0 = corner === "tr" || corner === "br" ? width - n : 0;
    const y0 = corner === "bl" || corner === "br" ? height - n : 0;
    const saved = Buffer.alloc(n * n * 4);
    for (let y = 0; y < n; y += 1) Buffer.from(buf.buffer, buf.byteOffset, buf.length).copy(saved, y * n * 4, ((y0 + y) * width + x0) * 4, ((y0 + y) * width + x0 + n) * 4);
    return { x0, y0, saved };
  });
  applyCardCornerMask(buf, width, height, radius);
  for (const { x0, y0, saved } of boxes) {
    for (let y = 0; y < n; y += 1) buf.set(saved.subarray(y * n * 4, (y + 1) * n * 4), ((y0 + y) * width + x0) * 4);
  }
}

/** Crop `box` out of an 8-bit RGBA image, keeping only what the mask's
 *  ALPHA covers (same size as the image; alpha multiplied, colour kept). */
export function cutThroughMask(buf, mask, width, box) {
  const out = Buffer.alloc(box.width * box.height * 4);
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const src = ((box.y + y) * width + box.x + x) * 4;
      const dst = (y * box.width + x) * 4;
      out[dst] = buf[src];
      out[dst + 1] = buf[src + 1];
      out[dst + 2] = buf[src + 2];
      out[dst + 3] = Math.round((buf[src + 3] * mask[src + 3]) / 255);
    }
  }
  return out;
}

/**
 * A mask's full-alpha INTERIOR as a 0/1 map, eroded by `erodePx` pixels
 * (4-neighbourhood iterations): 1 where the mask's alpha is 255 and every
 * pixel within `erodePx` of it is too (TODO 5.1c: the strip rider's cut
 * runs inside the tab's dark outline). `mask` is raw RGBA at width × height.
 */
export function insideMaskEroded(mask, width, height, erodePx) {
  const n = width * height;
  if (!mask || mask.length !== n * 4) throw new Error(`insideMaskEroded: the mask is not ${width}x${height} RGBA`);
  if (!(Number.isInteger(erodePx) && erodePx >= 0)) throw new Error(`insideMaskEroded: bad erosion ${erodePx}`);
  let cur = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) cur[p] = mask[p * 4 + 3] === 255 ? 1 : 0;
  for (let i = 0; i < erodePx; i += 1) {
    const next = new Uint8Array(n);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const p = y * width + x;
        next[p] = cur[p] && cur[p - 1] && cur[p + 1] && cur[p - width] && cur[p + width] ? 1 : 0;
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * A 0/1 map snapped to `block` × `block` px blocks aligned to the image's
 * origin: a block is kept whole when every pixel of it is set, else dropped
 * (TODO 5.1c: with `block` 2 the 750 bake's 2:1 resample reads exactly one
 * block per output pixel, so the cut's alpha lands 0 / 255 there too). A
 * `block` of 1 is the map itself.
 */
export function snapToBlocks(map, width, height, block) {
  if (!(Number.isInteger(block) && block >= 1)) throw new Error(`snapToBlocks: bad block ${block}`);
  if (map.length !== width * height) throw new Error(`snapToBlocks: the map is not ${width}x${height}`);
  if (block === 1) return map;
  const out = new Uint8Array(width * height);
  for (let y = 0; y + block <= height; y += block) {
    for (let x = 0; x + block <= width; x += block) {
      let all = true;
      for (let dy = 0; dy < block && all; dy += 1) for (let dx = 0; dx < block; dx += 1) if (!map[(y + dy) * width + x + dx]) { all = false; break; }
      if (!all) continue;
      for (let dy = 0; dy < block; dy += 1) for (let dx = 0; dx < block; dx += 1) out[(y + dy) * width + x + dx] = 1;
    }
  }
  return out;
}

/** The strip rider's cut for a template's spec (MDFC_STRIP_CUTS): the
 *  mask's full-alpha interior, eroded by `spec.erode` px and snapped to
 *  `spec.snap`-px blocks of the HD grid. `mask` is raw RGBA at width ×
 *  height. */
export function stripRiderInterior(mask, width, height, spec) {
  return snapToBlocks(insideMaskEroded(mask, width, height, spec.erode), width, height, spec.snap);
}

/**
 * The strip rider piece of one master (TODO 5.1c): `box` cropped out of the
 * master's 8-bit RGBA, the colour the master's everywhere, the alpha the
 * master's where `inside` (insideMaskEroded) is set and 0 elsewhere — never
 * a partial pixel of the cut's own, so a piece drawn 1:1 over its master is
 * the master (0 px differ at HD, and at the 750 bake too when `inside` is
 * the block-snapped interior of stripRiderInterior).
 */
export function cutStripRider(master, inside, width, box) {
  const out = Buffer.alloc(box.width * box.height * 4);
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const sx = box.x + x;
      const sy = box.y + y;
      const src = (sy * width + sx) * 4;
      const dst = (y * box.width + x) * 4;
      out[dst] = master[src];
      out[dst + 1] = master[src + 1];
      out[dst + 2] = master[src + 2];
      out[dst + 3] = inside[sy * width + sx] ? master[src + 3] : 0;
    }
  }
  return out;
}

/**
 * What a cut strip piece must be: alpha 255 inside the eroded mask and 0
 * outside (no partial pixel — the master is opaque there), the colour the
 * master's on every opaque pixel, nothing inside the mask left clear, and
 * the mask's interior entirely inside the box. Returns the counts and the
 * failures.
 */
export function stripRiderFindings(piece, master, inside, width, height, box) {
  let opaque = 0;
  let partial = 0;
  let colourOff = 0;
  let outsideAlpha = 0;
  let insideClear = 0;
  let insideOutsideBox = 0;
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const sx = box.x + x;
      const sy = box.y + y;
      const src = (sy * width + sx) * 4;
      const dst = (y * box.width + x) * 4;
      const a = piece[dst + 3];
      const inner = inside[sy * width + sx] === 1;
      if (a === 255) opaque += 1;
      else if (a > 0) partial += 1;
      if (inner && a === 0) insideClear += 1;
      if (!inner && a !== 0) outsideAlpha += 1;
      if (a > 0 && (piece[dst] !== master[src] || piece[dst + 1] !== master[src + 1] || piece[dst + 2] !== master[src + 2])) colourOff += 1;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (inside[y * width + x] && (x < box.x || x >= box.x + box.width || y < box.y || y >= box.y + box.height)) insideOutsideBox += 1;
    }
  }
  const failures = [];
  if (partial) failures.push(`${partial} partial-alpha px (the cut must be 0 / 255)`);
  if (colourOff) failures.push(`${colourOff} px whose colour is not the master's`);
  if (outsideAlpha) failures.push(`${outsideAlpha} px with alpha outside the eroded mask`);
  if (insideClear) failures.push(`${insideClear} px clear inside the eroded mask (the master has a clear pixel in the tab?)`);
  if (insideOutsideBox) failures.push(`${insideOutsideBox} px of the eroded mask fall outside the piece's box`);
  if (opaque === 0) failures.push("no opaque pixel at all");
  return { opaque, partial, colourOff, outsideAlpha, insideClear, insideOutsideBox, failures };
}

/** Float accumulator → 8-bit RGBA bytes. */
export function toRgba8(acc) {
  const out = Buffer.alloc(acc.length);
  for (let i = 0; i < acc.length; i += 4) {
    out[i] = Math.round(acc[i]);
    out[i + 1] = Math.round(acc[i + 1]);
    out[i + 2] = Math.round(acc[i + 2]);
    out[i + 3] = Math.round(acc[i + 3] * 255);
  }
  return out;
}

/** One layer as provenance prints it: "src", "src through mask",
 *  "src through maskA ∩ maskB", "src outside mask", "… at 35%", "… recolouring
 *  the layers below …", and 4.34's "src moved down N px replacing through
 *  mask", "src re-tinted from r,g,b to the tint of other at (x, y) replacing
 *  through mask". */
export function describeLayer(l) {
  // One of the template's own finished masters (TODO 4.6h, builtLayer).
  if (typeof l.built === "string") {
    const on = l.cutOf ? ` (each on the cut of ${l.cutOf})` : "";
    return l.right
      ? `(built:${l.built} | built:${l.right} across ${rampName(l.ramp)})${on} through the regions ${l.regions.join(" + ")}`
      : `built:${l.built}`;
  }
  const moved = l.dy ? ` moved down ${l.dy} px` : l.barRecut ? " with its bar and medallion moved onto the prints (barRecut)" : "";
  // A pair's box (TODO 4.56): re-tinted twice, the two lerped across a ramp.
  const tintAt = (t) => `${t.src} at (${t.x}, ${t.y})`;
  const tint = l.retint
    ? l.retint.tintOfRight
      ? ` re-tinted from ${l.retint.from.join(",")} to the tints of (${tintAt(l.retint.tintOf)} | ${tintAt(l.retint.tintOfRight)} across ${rampName(l.retint.ramp)})`
      : ` re-tinted from ${l.retint.from.join(",")} to the tint of ${tintAt(l.retint.tintOf)}`
    : "";
  const masks = Array.isArray(l.mask) ? l.mask.join(" ∩ ") : l.mask;
  const mask = masks ? ` ${l.replace ? "replacing through" : l.invert ? "outside" : "through"} ${masks}${l.maskBarRecut ? " (the mask's bar and medallion moved as the frame's: barRecut)" : ""}` : "";
  const gain = l.gain !== undefined ? ` with its alpha ×${l.gain.toFixed(4)} (clamped at 1)` : "";
  // A pair layer (pairLayer, TODO 4.6b): two files blended across a ramp.
  const src = l.right ? `(${l.src} | ${l.right} across ${rampName(l.ramp)})` : l.src;
  // A layer at CC's bounds (4.6f's floating crown pieces), and CC's erase.
  const at = l.at ? ` at ${l.at.leftPct}/${l.at.topPct}/${l.at.widthPct}×${l.at.heightPct} %` : "";
  if (l.erase) return `${src}${at} erased from the layers below (CC's erase: destination-out)`;
  if (l.recolour) {
    const ramp = l.lumaRamp ? `, weighted by its own luminance from ${l.lumaRamp[0]} (0) to ${l.lumaRamp[1]} (full)` : "";
    const below = l.belowLumaRamp ? ` and by the luminance below from ${l.belowLumaRamp[0]} (0) to ${l.belowLumaRamp[1]} (full)` : "";
    const cap = l.maxAlpha !== undefined ? `, never where its own alpha is above ${Math.round(l.maxAlpha * 255)}` : "";
    return `${src}${mask} recolouring the layers below (their alpha kept)${l.opacity !== undefined ? ` at ${Math.round(l.opacity * 100)}%` : ""}${ramp}${below}${cap}`;
  }
  return `${src}${at}${moved}${tint}${mask}${l.opacity !== undefined ? ` at ${Math.round(l.opacity * 100)}%` : ""}${gain}`;
}

/** One `finish` composite as provenance prints it. */
export function describeFinish(f) {
  const only = f.colors ? ` (colour${f.colors.length > 1 ? "s" : ""} ${f.colors.join(", ")} only)` : "";
  if (f.op === "opaque") return `every pixel through ${f.mask} made opaque in its own colour (α' = α + (255 − α) × mask)${only}`;
  if (f.op === "tint") {
    return `a flat rgb(${f.rgb.join(", ")}) at ${Math.round(f.opacity * 100)}% source-over through ${f.mask}, on the pixels CC draws translucent (full weight at α ≤ ${f.alphaFull}, none at α ≥ ${f.alphaNone})${only}`;
  }
  if (f.op === "rampGain") {
    return `a gain × ${f.gain.join(" / ")} on the ${f.side} side of the ${f.ramp.join("→")} %W ramp (fading across it) through ${f.mask}, on the pixels CC draws translucent (full weight at α ≤ ${f.alphaFull}, none at α ≥ ${f.alphaNone})${only}`;
  }
  throw new Error(`describeFinish: unknown op ${JSON.stringify(f)}`);
}

/** The `finish` composites one colour of a template takes, in order: a
 *  composite with `colors` applies to those colour keys only (round 14's
 *  colourless type pill: the plain templates' `c`). */
export function finishFor(def, key) {
  return (def.finish ?? []).filter((f) => !f.colors || f.colors.includes(key));
}

/**
 * The `finish` composites (TODO 4.48 / 4.50, owner decisions 2026-09-29):
 * PipGlyph composites over an 8-bit RGBA composite of CC's layers, each
 * through a mask (its ALPHA, same size as the image; `masks` maps the mask
 * path to its raw RGBA), in order. Colours are straight (not premultiplied).
 *   "opaque" — each pixel the mask covers keeps its colour and gains
 *              coverage: α' = α + (255 − α) × mask. (Every pixel a pack's
 *              Type mask covers is pill: its outline, bevel and interior.)
 *   "tint"   — a flat `rgb` drawn source-over at `opacity` × mask × w,
 *              where w = 1 at α ≤ alphaFull, 0 at α ≥ alphaNone, linear
 *              between: only what CC draws translucent takes it.
 * Returns a new buffer.
 */
export function compositeFinish(buf, width, height, finish, masks) {
  const out = Buffer.from(buf);
  const n = width * height;
  for (const f of finish) {
    const mask = masks[f.mask];
    if (!mask || mask.length !== n * 4) throw new Error(`compositeFinish: no ${width}x${height} mask for ${f.mask}`);
    for (let p = 0; p < n; p += 1) {
      const o = p * 4;
      const m = mask[o + 3] / 255;
      if (m === 0) continue;
      const a = out[o + 3];
      if (f.op === "opaque") {
        out[o + 3] = Math.round(a + (255 - a) * m);
        continue;
      }
      if (f.op === "rampGain") {
        // A per-channel gain on one SIDE of a pair's ramp (TODO 4.48: the
        // white half of a two-colour name pill toned to print's metal): full
        // weight where that side's share is 1, fading across the ramp, only on
        // what CC draws translucent (alphaFull / alphaNone, as "tint"); hue
        // and bevel kept (a multiplication, not a flat colour).
        const x = p % width;
        const share = rampShare(((x + 0.5) / width) * 100, f.ramp);
        const side = f.side === "left" ? 1 - share : share;
        const wa = a <= f.alphaFull ? 1 : a >= f.alphaNone ? 0 : (f.alphaNone - a) / (f.alphaNone - f.alphaFull);
        const w = m * side * wa;
        if (w === 0) continue;
        for (let c = 0; c < 3; c += 1) out[o + c] = Math.min(255, Math.max(0, Math.round(out[o + c] * (1 + (f.gain[c] - 1) * w))));
        continue;
      }
      if (f.op !== "tint") throw new Error(`compositeFinish: unknown op ${f.op}`);
      const w = a <= f.alphaFull ? 1 : a >= f.alphaNone ? 0 : (f.alphaNone - a) / (f.alphaNone - f.alphaFull);
      const t = f.opacity * m * w;
      if (t === 0) continue;
      const ab = a / 255;
      const outA = t + ab * (1 - t);
      for (let c = 0; c < 3; c += 1) {
        out[o + c] = Math.round((f.rgb[c] * t + out[o + c] * ab * (1 - t)) / outA);
      }
      out[o + 3] = Math.round(outA * 255);
    }
  }
  return out;
}


/** The crowned twins a template with its crown baked into the masters may
 *  build (TODO 4.6f: the borderless floating crown): the seven colours, the
 *  ten pairs and the ten hybrid pairs, each `-legendary`
 *  (lib/cards/frame-reference-registry.ts LEGENDARY_MASTER_KEYS). */
// …and `a-legendary`: the artifact stand-in's crowned twin on the borderless
// double-faced bodies (TODO 5.7; built by scripts/build-dfc-borderless-frames.mjs).
export const LEGENDARY_MASTER_KEYS = [...[...COLORS, ...TWO_COLOR_PAIRS, ...TWO_COLOR_PAIRS.map((pair) => `${pair}-h`)].map(legendaryKey), legendaryKey("a")];

/** Every master key a recipe may name, in build order: the seven colours,
 *  then the two-colour pair masters (TODO 4.6b: gold-split `<pair>`, hybrid
 *  `<pair>-h`; lib/cards/frame-reference-registry.ts TWO_COLOR_MASTER_KEYS),
 *  then the crowned twins (4.6f). */
export const MASTER_KEYS = ["a", ...COLORS, ...TWO_COLOR_PAIRS, ...TWO_COLOR_PAIRS.map((pair) => `${pair}-h`), ...LEGENDARY_MASTER_KEYS];

/** The masters a template builds (every key its recipe names, minus
 *  `excluded`), in MASTER_KEYS order. */
export function builtColors(def) {
  return MASTER_KEYS.filter((k) => def.colors[k] && !def.excluded?.[k]);
}

/** Every Card Conjurer file a template needs (layers, masks, plates,
 *  symbol discs). */
export function sourceFilesFor(def) {
  const files = new Set();
  for (const layers of Object.values(def.colors)) {
    for (const l of layers) {
      // A finished master of this template (4.6h) is no pack file.
      if (typeof l.built === "string") continue;
      files.add(l.src);
      if (l.right) files.add(l.right);
      // A procedural mask (a ramp) is no Card Conjurer file.
      for (const mask of Array.isArray(l.mask) ? l.mask : l.mask ? [l.mask] : []) {
        if (!mask.startsWith("procedural:")) files.add(mask);
      }
      if (l.retint) files.add(l.retint.tintOf.src);
      if (l.retint?.tintOfRight) files.add(l.retint.tintOfRight.src);
    }
  }
  for (const f of def.finish ?? []) files.add(f.mask);
  for (const plate of Object.values(def.plates ?? {})) files.add(plate);
  for (const symbol of Object.values(def.symbols ?? {})) files.add(symbol);
  if (def.shield) files.add(def.shield.mask);
  for (const src of Object.values(def.ptCut?.image ?? {})) files.add(src);
  for (const mask of Object.values(def.ptCut?.masks ?? {})) files.add(mask);
  // A recipe's half masks (4.21b's split) and its painted shield's mask
  // (battle): importer inputs, checked and recorded.
  if (def.halfMasks) for (const src of [def.halfMasks.left, def.halfMasks.right]) files.add(src);
  if (def.paintedShield) files.add(def.paintedShield.mask);
  // The mask a template's page pieces are cut through (TODO 4.26: the
  // adventure's bookLeft).
  if (def.page) files.add(def.page.mask);
  // A pack's own bitmaps published beside the masters, and the masks kept
  // for a later recipe (4.21c's saga).
  for (const src of Object.values(def.pieces ?? {})) files.add(src);
  for (const src of Object.values(def.maskInputs ?? {})) files.add(src);
  // A masked tone's mask (TODO 5.1a, the transform backs); a print recipe's
  // rings mask (TODO 4.10a, the 1997 lands).
  for (const key of builtColors(def)) {
    for (const tone of tonesFor(def, key)) if (tone.mask) files.add(tone.mask);
    const printRecipe = isBuiltRecipe(def.colors[key]) ? null : def.printRecipe?.(key);
    if (printRecipe?.rings) files.add(printRecipe.rings);
    // …and its region masks (TODO 4.10b, the 2003 frame).
    for (const mask of Object.values(printRecipe?.regionMasks ?? {})) files.add(mask);
  }
  // A toned file's masks (CC_SOURCE_TONES; the LOTR ring's Rules mask, TODO
  // 4.11): importer inputs too.
  for (const file of [...files]) for (const mask of Object.values(sourceTonesOf(file)?.masks ?? {})) files.add(mask);
  // …and a diff region's reference file (the MUL Tarkir wings, TODO 4.11).
  for (const file of [...files]) for (const d of [...Object.values(sourceTonesOf(file)?.diff ?? {}), ...Object.values(sourceTonesOf(file)?.box ?? {})]) if (d.file) files.add(d.file);
  return [...files].sort();
}

/** The pixel box a pack draws an image at (`bounds`, fractions of the card)
 *  on a `width × height` card — CC's drawImage at its bounds, to the
 *  nearest pixel. */
export function boundsPx(bounds, width, height) {
  return {
    x: Math.round(bounds.x * width),
    y: Math.round(bounds.y * height),
    width: Math.round(bounds.width * width),
    height: Math.round(bounds.height * height),
  };
}

/** How provenance records a `ptCut` (4.21a's flip plates). */
export function describePtCut(cut, width, height) {
  const at = boundsPx(cut.bounds, width, height);
  return {
    image: { ...cut.image },
    bounds: cut.bounds,
    drawnAt: `${at.width}x${at.height} at (${at.x}, ${at.y}) of the ${width}x${height} card`,
    masks: { ...cut.masks },
    boxes: Object.fromEntries(Object.entries(cut.boxes).map(([name, box]) => [name, { ...box }])),
    output: `pt/<colour>-<${Object.keys(cut.boxes).join("|")}>.png, native size`,
  };
}

// ---------------------------------------------------------------------------
// Two-colour frames and the crown band (TODO 4.6.0 — the importer half of
// the plumbing, additive: nothing above builds with it yet; 4.6a / 4.6b
// build the crown bands and pair masters with it). Design 2026-09-29 §1.1 /
// §1.2, measured on the prints:
//   • every split ramp is UNTILTED — the prints measure 0.00 ± 0.36 %W from
//     10.8 to 55.9 %H, where CC's maskRightHalf.png tilts +1.35 %W;
//   • a mixed cost (hybrid and mono pips) prints GOLD-SPLIT, not hybrid;
//   • a pair is a premultiplied LERP of the two colours' layers, never CC's
//     stacking: opaque pixels come out the same, but stacking doubles a
//     translucent edge (the crown's shadow over the art, α 160 against 99).
// ---------------------------------------------------------------------------

// The ramps (PAIR_RAMPS: pinline 40→60, a hybrid's frame band 44→57, text
// box 45→57, crown 45→55 %W), the untilted ramp mask, the premultiplied lerp
// and the ten pairs live in ./pair-ramp.mjs ONLY — the one module the pair
// masters (4.6b) and the pair crown bands (4.6a) both read; import them from
// there, never through this file.

/**
 * What each region of a two-colour master is made of — a pure port of Card
 * Conjurer's cardFrameProperties (creator-23.js:577–755, its default M15
 * style) with the corrections above. `kind`: "m15" (a nonland card),
 * "artifact" (the m15artifact frame) or "land" (m15land); `dress`: "split"
 * (the gold card) or "hybrid". Keys are CC's frame letters, lower-cased:
 * a colour (w u b r g), "m" gold, "a" artifact, "l" the land / grey bars;
 * a land's colour regions are its land tints ("wl"). `right` is the
 * second colour through the region's ramp (PAIR_RAMPS), null for a
 * region drawn whole. `pt` is the plate (none on a land). A hybrid ARTIFACT
 * is the gold-split recipe: m15artifact has no hybrid plate yet (`pt/h`).
 */
export function twoColorRecipe(pair, dress, kind) {
  if (!TWO_COLOR_PAIRS.includes(pair)) throw new Error(`twoColorRecipe: not a pair in printed order: ${pair}`);
  const [a, b] = pair.split("");
  if (kind === "land") {
    return {
      frame: { left: "l", right: null },
      pinline: { left: `${a}l`, right: `${b}l`, ramp: PAIR_RAMPS.pinline },
      rules: { left: `${a}l`, right: `${b}l`, ramp: PAIR_RAMPS.rules },
      typeTitle: "l",
      pt: null,
      crown: { left: a, right: b, ramp: PAIR_RAMPS.crown },
    };
  }
  const hybrid = dress === "hybrid" && kind !== "artifact";
  return {
    frame: kind === "artifact"
      ? { left: "a", right: null }
      : hybrid
        ? { left: a, right: b, ramp: PAIR_RAMPS.frame }
        : { left: "m", right: null },
    pinline: { left: a, right: b, ramp: PAIR_RAMPS.pinline },
    rules: { left: a, right: b, ramp: PAIR_RAMPS.rules },
    typeTitle: hybrid ? "l" : "m",
    pt: hybrid ? "c" : "m",
    crown: { left: a, right: b, ramp: PAIR_RAMPS.crown },
  };
}

/**
 * The standard legendary crown band (TODO 4.6a; design §1.1): CC's
 * `img/frames/m15/crowns/new/<key>.png` (1922 × 493, native 2010 × 2814)
 * over CC's black "Legend Crown Border Cover", composited at 2010 × 2814,
 * downscaled once to 1500 × 2100, corner cut, and cropped to the rows the
 * band covers — the overlay FrameProfile.overlays stretches over
 * 0 / 0 / 100 × 19.52 %. Rects in card %.
 */
export const CROWN_BAND = {
  source: "img/frames/m15/crowns/new",
  keys: ["w", "u", "b", "r", "g", "m", "a", "l", "c"],
  crown: { leftPct: 2.19, topPct: 1.88, widthPct: 95.62, heightPct: 17.52 },
  cover: { leftPct: 0, topPct: 0, widthPct: 100, heightPct: 4.87 },
  compositeSize: { width: 2010, height: 2814 },
  rows: 410,
};

/** The top `rows` rows of an 8-bit RGBA image (the crown band's crop). */
export function cropRows(buf, width, rows) {
  return Buffer.from(buf.subarray(0, width * rows * 4));
}

// ---------------------------------------------------------------------------
// Overlay bands (TODO 4.6a): printed anatomy drawn OVER a frame master
// (FrameProfile.overlays in lib/cards/template-layout.ts). Built by
// scripts/import-cc-frames.mjs (`--only m15crown`) into
// .frames-build/<folder>/<key>.png + .webp, published to the bucket like a
// master, never committed.
// ---------------------------------------------------------------------------

/** The crown band's keys, in the order the importer builds them: CC's nine
 *  crown letters (w u b r g, m gold, a artifact silver, l land grey, c the
 *  colourless grey), then the ten pairs in printed order — a pair is the
 *  first colour's crown on the left, lerped into the second's through the
 *  untilted crown ramp (pair-ramp.mjs PAIR_RAMPS.crown, 45→55 %W: the same
 *  module and the same canonical order as 4.6b's pair masters). The
 *  profile's slot lists the same keys (lib/cards/template-layout.ts
 *  M15_CROWN; a unit test holds them together). */
export const CROWN_BAND_KEYS = [...CROWN_BAND.keys, ...TWO_COLOR_PAIRS];

/**
 * The Nyx inner crown (TODO 4.7): Card Conjurer's 'Inner Crown (Nyx)'
 * (packM15InnerCrownsNew.js, `img/frames/m15/innerCrowns/new/nyx/<k>.png`,
 * 1353 × 64 at the pack's native 2010 × 2814) — the starfield strip a
 * legendary Nyx print carries INSIDE its crown, between the crown's arch
 * and the title bar, where a plain legendary card's crown is flat. CC draws
 * it over the crown at 329 / 70 px (16.37 / 2.49 / 67.31 × 2.27 %); here it
 * is the last layer of the crown band's composite, 1:1 at native size, so a
 * crowned Nyx card draws ONE band (`m15nyxcrown/<key>.png`: the m15crown
 * recipe + this strip). Keys: the Nyx masters' seven letters.
 */
export const NYX_INNER_CROWN = {
  source: "img/frames/m15/innerCrowns/new/nyx",
  box: { x: 329, y: 70, width: 1353, height: 64 },
  keys: ["w", "u", "b", "r", "g", "m", "a"],
};

/** The Nyx crown band's keys: the seven letters, then the ten pairs (the
 *  crown AND the strip split through the crown ramp, as m15crown's pairs). */
export const NYX_CROWN_BAND_KEYS = [...NYX_INNER_CROWN.keys, ...TWO_COLOR_PAIRS];

/** One key's inner-crown layer: a letter's strip, or a pair's two strips
 *  lerped through the crown ramp. */
export function innerCrownRecipe(inner, key) {
  if (TWO_COLOR_PAIRS.includes(key)) {
    const [a, b] = key.split("");
    return { left: `${inner.source}/${a}.png`, right: `${inner.source}/${b}.png`, ramp: PAIR_RAMPS.crown };
  }
  if (!inner.keys.includes(key)) throw new Error(`innerCrownRecipe: no inner crown for key ${key}`);
  return { left: `${inner.source}/${key}.png`, right: null, ramp: null };
}

/** How provenance prints an inner-crown layer. */
export function describeInnerCrown(inner, recipe) {
  const strip = recipe.right ? `${recipe.left} ⟷ ${recipe.right} lerped through ${rampName(recipe.ramp)}` : recipe.left;
  return `${strip} at ${inner.box.x},${inner.box.y} ${inner.box.width}×${inner.box.height} px of the 2010×2814 composite (1:1), over the crown`;
}

/**
 * The Universes Beyond crown band (TODO 4.25): CC's 'Legend Crowns
 * (Universes Beyond)' of its accurate group (packUBLegendCrownsNew.js,
 * `img/frames/m15/ub/crowns/new/<key>.png`) — the standard crown's
 * geometry, bounds, masks and border cover with the UB pack's smooth art,
 * so the same recipe at the same rects. "c" is the colourless crown of
 * the see-through spell frame (TODO 4.25 follow-up): the pack's
 * `ub/crowns/new/c.png`, which is the M15 pack's colourless crown byte for
 * byte (sha1 7861428e…) — so `m15ubcrown/c` is `m15crown/c`'s pixels, under
 * this band's own name. The artifact and land frames map their colourless
 * key to "a" and "l".
 */
export const UB_CROWN_BAND = Object.freeze({
  ...CROWN_BAND,
  source: "img/frames/m15/ub/crowns/new",
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "a", "l", "c"]),
});
export const UB_CROWN_BAND_KEYS = [...UB_CROWN_BAND.keys, ...TWO_COLOR_PAIRS];

/** CC's 'Legend Crown Border Cover': img/black.png (1×1 black) stretched
 *  over the cover rect, drawn under the crown and over the frame. */
const CROWN_COVER_SRC = "img/black.png";

// --- 4.6f (wave 2b): the extended-art legendary crown, an OVERLAY band.
// CC's autoExtendedArtFrame (creator-23.js:1311–1362) draws, for a
// Legendary card, the same FLOATING crown as the borderless frame — but with
// its 'Crown Border Cover' as a BLACK strip (makeExtendedArtFrameByLetter
// :2296–2365: img/black.png at 3.94/2.77/92.14×1.77 %, NOT erased) under the
// crown (3.07/1.91/93.87×10.24 %), and the outline ON TOP (2.8/1.72/94.4×
// 10.62 %: pushed first, and drawFrames draws the list reversed, :388). The
// prints: FDN #442 / #455 / #463 / #466 / #470 stop the crown under the title
// bar with art beside and below it. Nothing is erased, so the crown is an
// overlay band over the extendedart masters: composited 1:1 at 1500×2100
// (every piece is 1500-native), cropped to the outline's rows 0–259. One key
// per colour: the colours, gold, and the colourless grey (CC's C crown; no
// pair keys — the frame draws no pair masters, so a two-colour legend wears
// the gold crown). Since TODO 4.7 the masters are Card Conjurer's own
// extended frames, so the band sits at CC's bounds (EXTENDED_CROWN's slot
// starts at row 0; it sat 10 px lower over the old MSE masters).
export const EXTENDED_CROWN_BAND = Object.freeze({
  source: CROWNS,
  // The seven colour keys, then (TODO 4.7 follow-up, owner Round 63) the
  // ten pairs, the first colour's crown lerped into the second's across
  // PAIR_RAMPS.crownFloating (40→60 %W, the borderless pairs'; FRC #96 R|W,
  // FDN #479 W|B print the split crown over the pair masters). No `a`: a
  // colourless artifact keeps CC's grey C crown (owner Round 67 — C measured
  // closer on 8 of 11 scans).
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "c", ...TWO_COLOR_PAIRS]),
  cover: BORDERLESS_CROWN.erase,
  crown: BORDERLESS_CROWN.crown,
  outline: BORDERLESS_CROWN.outline,
  compositeSize: Object.freeze({ width: OUT_W, height: OUT_H }),
  rows: 260,
});

/** The extended-art crown band's layers for a key, in CC's draw order: the
 *  black cover strip (drawn, not erased), the floating crown, the outline
 *  on top. */
export function extendedCrownLayers(key) {
  if (!EXTENDED_CROWN_BAND.keys.includes(key)) throw new Error(`extendedCrownLayers: no crown for key ${key}`);
  const pair = TWO_COLOR_PAIRS.includes(key) ? key.split("") : null;
  return [
    placed(BORDERLESS_CROWN.eraseSrc, EXTENDED_CROWN_BAND.cover),
    pair
      ? placed(floatingCrown(pair[0]), EXTENDED_CROWN_BAND.crown, { right: floatingCrown(pair[1]), ramp: [...BORDERLESS_CROWN.ramp] })
      : placed(floatingCrown(key), EXTENDED_CROWN_BAND.crown),
    placed(BORDERLESS_CROWN.outlineSrc, EXTENDED_CROWN_BAND.outline),
  ];
}

/**
 * What the importer checks on the full 1500 × 2100 extended-crown composite
 * before it crops the band (pure): `lastAlphaRow` must be below the band's
 * rows; `peakRow`, the first opaque row at the centre column, is the
 * outline's peak at 36 ± 1 (CC's 0.0172 × 2100); the cover strip is opaque
 * black in a crown dip (x 446, row 70: rows 58–94 of the strip, above the
 * crown's edge at row 90 there).
 */
export function extendedCrownFindings(buf, width, height, rows) {
  let lastAlphaRow = -1;
  for (let y = height - 1; y >= 0 && lastAlphaRow < 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      if (buf[(y * width + x) * 4 + 3] > 0) {
        lastAlphaRow = y;
        break;
      }
    }
  }
  const cx = Math.floor(width / 2);
  let peakRow = -1;
  for (let y = 0; y < rows && peakRow < 0; y += 1) if (buf[(y * width + cx) * 4 + 3] >= 250) peakRow = y;
  const dip = (70 * width + Math.round(width * 0.2973)) * 4;
  const cover = [buf[dip], buf[dip + 1], buf[dip + 2], buf[dip + 3]];
  const failures = [];
  if (lastAlphaRow >= rows) failures.push(`alpha down to row ${lastAlphaRow}, past the band's ${rows} rows`);
  if (Math.abs(peakRow - 36) > 1) failures.push(`the outline's peak at row ${peakRow}, CC's is 36 ± 1`);
  if (cover[3] !== 255 || cover[0] + cover[1] + cover[2] > 30) failures.push(`the cover strip at (446, 70) is ${cover}, not opaque black`);
  return { lastAlphaRow, peakRow, cover, failures };
}

// ---------------------------------------------------------------------------
// The double-faced bodies' crowns (TODO 5.1d; the 4.6f note of the 5.0
// design): CUT bands. Card Conjurer's own DFC crowns — 'Legend Crowns'
// (packTransformLegendCrowns.js: `m15/transform/crowns/regular/<k>.png`,
// cut around the LEFT well; `regular/new/<k>.png`, cut around the ▼ back's
// RIGHT well) and 'Regular Legend Crowns' (packModalLegendCrowns.js:
// `modal/crowns/regular/<k>.png`, cut around the housing), all 1418 × 350 at
// 0.0274 / 0.0191 / 0.9454 × 0.1667 (x 41, y 40, 1:1 at HD) — carry the OLDER
// flat crown art (a smooth gradient), not the textured band our m15crown is
// built from (`crowns/new`), so none of them is published. The honest route
// (the design's words) is a cut of OUR band through the twins' alpha — with
// one more step, because our band has no pixels where the twin has crown:
// the band's hole is cut for the plain M15 bar (x 92 → 1408), while a DFC
// bar starts past the well (x 228) and the crown wraps the well all round
// (MID #246 Tovolar, VOW #21, MOM #190 Zilortha's ▼ back, KHM #112 Tergrid
// both faces: the crown's texture continues to the well's ring, with the
// ring on top). So, inside the WELL REGION (DFC_CROWN_WELLS: the columns
// from the band's leg to the inset bar, rows 93–225):
//   • the alpha is the twin's — the well's circle (or the drop housing)
//     cleared, the crown around it, the bar's edge where the bar starts;
//   • the colour is the band's own LEG texture (its interior columns,
//     mirror-tiled across the region on the same rows — the mottle the
//     prints show around the well, never CC's flat gradient) — or, on the
//     modal body, the band's own leg pixels where the housing's tip cuts
//     into the leg — darkened only where the twin is darker than half its
//     own leg (DFC_CROWN_SHADE_KNEE): CC's outline around the hole, not its
//     smooth gradient (the prints' annulus reads 0.8–1.0 of the leg: MID
//     #246 front 1.04, its back 0.97, VOW #21 0.78, MOM #190 0.80);
//   • the wrap under the bar keeps the band's own pixels and geometry (the
//     twin's wrap ends 3 rows higher): both holes end above it — the
//     transform twins' well is a circle (fitted on the twin's hole, 0.8 px:
//     (143.6, 160.5) r 60.9 on the left, rows 100–221), the modal twin's a
//     teardrop whose point reaches x 59 at row 160 and whose bottom is at
//     row 218 — so the region's rows 93–225 take them whole.
// Everything outside the region is the m15crown band byte for byte: the
// same crown the owner signed off on m15, on a bar the transform and modal
// packs draw within 1 px of the accurate pack's (the dark ring rows 100–103
// / 218–221 against 100–103 / 219–222). Measured against the twins
// (scratchpad dfc-1d/research/twins.json): outside the well columns the
// twin's alpha lies entirely INSIDE the band's (0 twin-only pixels in
// x 280–1220; the band's extra pixels there are its cover and the wrap's
// last 3 rows), and the twins' alphas are the same for every colour letter
// (the `a` twin differs by ≤ 48 levels on 3,077 px). Keys: the band's
// colours, `m`, `a`, `l` (no `c`: a DFC body's colourless is the artifact
// stand-in, `c` → `a`, or a land's `l`) and the ten pairs — a pair's cut
// reads the twin of the colour whose half the well is in.
// ---------------------------------------------------------------------------

/** CC's DFC crown bounds (card %): every twin is 1418 × 350 placed at
 *  (41, 40) — 1:1 at HD. */
export const DFC_CROWN_TWIN_BOUNDS = Object.freeze({ leftPct: 2.74, topPct: 1.91, widthPct: 94.54, heightPct: 16.67 });
/** The twins' native size. */
export const DFC_CROWN_TWIN_SIZE = Object.freeze({ width: 1418, height: 350 });
/** Below this share of the twin's own leg luminance a twin pixel darkens
 *  the cut (its outline around the hole); above it the band's texture
 *  shows as it is. */
export const DFC_CROWN_SHADE_KNEE = 0.5;
/** The well regions, in band pixels (1500 × 410): `region` — the columns
 *  and rows that take the twin's alpha and the synthesised colour (the
 *  twin's hole lies inside them: rows 100–221 on the transform twins,
 *  104–218 on the modal one); `keep` — within the region, band pixels left
 *  of `x1` keep their own colour (the modal leg the housing's tip cuts
 *  into); `texture` — the band's leg columns the fill is tiled from
 *  (mirror-tiled from the region's inner edge); `ref` — where the twin's
 *  leg luminance is read; `circleRows` — the twin's hole rows a circle is
 *  fitted on, a measurement of the well (null on the modal twin: its hole
 *  is a teardrop). */
export const DFC_CROWN_WELLS = Object.freeze({
  left: Object.freeze({
    side: "left",
    region: Object.freeze({ x0: 80, x1: 236, y0: 93, y1: 225 }),
    keep: null,
    texture: Object.freeze({ x0: 60, x1: 78 }),
    ref: Object.freeze({ x0: 60, x1: 78, y0: 105, y1: 230 }),
    circleRows: Object.freeze([Object.freeze([100, 221])]),
  }),
  right: Object.freeze({
    side: "right",
    region: Object.freeze({ x0: 1264, x1: 1420, y0: 93, y1: 225 }),
    keep: null,
    texture: Object.freeze({ x0: 1422, x1: 1440 }),
    ref: Object.freeze({ x0: 1422, x1: 1440, y0: 105, y1: 230 }),
    circleRows: Object.freeze([Object.freeze([100, 221])]),
  }),
  modal: Object.freeze({
    side: "left",
    region: Object.freeze({ x0: 40, x1: 236, y0: 93, y1: 225 }),
    keep: Object.freeze({ x1: 84 }),
    texture: Object.freeze({ x0: 60, x1: 78 }),
    ref: Object.freeze({ x0: 60, x1: 78, y0: 105, y1: 230 }),
    circleRows: null,
  }),
});
/** A twin (1418 × 350 raw RGBA) placed on a 1500 × `rows` canvas at CC's
 *  bounds, 1:1. */
export function placeTwin(twin, rows = CROWN_BAND.rows) {
  const box = rectPx(DFC_CROWN_TWIN_BOUNDS, OUT_W, OUT_H);
  if (box.width !== DFC_CROWN_TWIN_SIZE.width || box.height !== DFC_CROWN_TWIN_SIZE.height) throw new Error(`placeTwin: CC's bounds are ${box.width}x${box.height} at HD, the twins 1418x350`);
  return placeOnCanvas(twin, box, OUT_W, rows);
}

/**
 * The well's circle, fitted (algebraic least squares) on the chords of the
 * twin's hole: on each of the well's circle rows, the longest run of
 * alpha < 128 inside the region's columns is the hole; its ends (±½ px) are
 * the points. Returns { cx, cy, r, points, maxErr } — maxErr the worst
 * point's distance from the circle.
 */
export function fitWellCircle(placedTwin, well, width = OUT_W) {
  const { region, circleRows } = well;
  if (!circleRows) return null;
  const pts = [];
  for (const [r0, r1] of circleRows) {
    for (let y = r0; y <= r1; y += 1) {
      let best = null;
      let start = null;
      for (let x = region.x0; x <= region.x1; x += 1) {
        const clear = x < region.x1 && placedTwin[(y * width + x) * 4 + 3] < 128;
        if (clear && start === null) start = x;
        if (!clear && start !== null) {
          if (!best || x - start > best[1] - best[0]) best = [start, x];
          start = null;
        }
      }
      if (best && best[1] - best[0] > 10) pts.push([best[0] - 0.5, y], [best[1] - 0.5, y]);
    }
  }
  if (pts.length < 6) throw new Error("fitWellCircle: too few hole chords");
  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, S = 0, Sxz = 0, Syz = 0, Sz = 0;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    Sxx += x * x; Sxy += x * y; Syy += y * y; Sx += x; Sy += y; S += 1; Sxz += x * z; Syz += y * z; Sz += z;
  }
  const A = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, S]];
  const b = [-Sxz, -Syz, -Sz];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  const sol = [0, 1, 2].map((i) => det(A.map((row, j) => row.map((v, k) => (k === i ? b[j] : v)))) / D);
  const cx = -sol[0] / 2;
  const cy = -sol[1] / 2;
  const r = Math.sqrt(cx * cx + cy * cy - sol[2]);
  let maxErr = 0;
  for (const [x, y] of pts) maxErr = Math.max(maxErr, Math.abs(Math.hypot(x - cx, y - cy) - r));
  return { cx, cy, r, points: pts.length, maxErr };
}

/** The twin's leg luminance (mean over `ref`, opaque pixels only). */
export function twinLegLuma(placedTwin, well, width = OUT_W) {
  const { ref } = well;
  let sum = 0;
  let n = 0;
  for (let y = ref.y0; y < ref.y1; y += 1) {
    for (let x = ref.x0; x < ref.x1; x += 1) {
      const o = (y * width + x) * 4;
      if (placedTwin[o + 3] < 250) continue;
      sum += lumaAt(placedTwin, o);
      n += 1;
    }
  }
  if (n < 100) throw new Error("twinLegLuma: the twin has no opaque leg at the reference columns");
  return sum / n;
}

/** The band's texture column a region column reads: the leg's interior
 *  columns mirror-tiled from the region's inner edge outward. */
export function textureColumn(x, well) {
  const { texture, region, side } = well;
  const w = texture.x1 - texture.x0;
  const k = side === "left" ? x - region.x0 : region.x1 - 1 - x;
  const m = ((k % (2 * w)) + 2 * w) % (2 * w);
  const t = m < w ? m : 2 * w - 1 - m;
  return side === "left" ? texture.x0 + t : texture.x1 - 1 - t;
}

/**
 * One DFC crown piece: `band` (our m15crown band, 1500 × 410 raw RGBA) cut
 * through `placedTwin` (the CC twin placed by placeTwin) at `well` — see the
 * section comment. Returns { piece, circle, refLuma } (`circle` null on a
 * well with no circle rows, the modal teardrop).
 */
export function cutCrownBand(band, placedTwin, well, width = OUT_W, rows = CROWN_BAND.rows) {
  const { region, keep } = well;
  const circle = fitWellCircle(placedTwin, well, width);
  const refLuma = twinLegLuma(placedTwin, well, width);
  const piece = Buffer.from(band);
  const shadeOf = (o) => {
    if (placedTwin[o + 3] === 0) return 1;
    const l = lumaAt(placedTwin, o) / refLuma;
    return Math.min(1, l / DFC_CROWN_SHADE_KNEE);
  };
  for (let y = region.y0; y <= region.y1 && y < rows; y += 1) {
    for (let x = region.x0; x < region.x1; x += 1) {
      const o = (y * width + x) * 4;
      const kept = keep && x < keep.x1 && band[o + 3] >= 250;
      const src = kept ? o : (y * width + textureColumn(x, well)) * 4;
      const shade = shadeOf(o);
      for (let c = 0; c < 3; c += 1) piece[o + c] = Math.round(band[src + c] * shade);
      piece[o + 3] = placedTwin[o + 3];
    }
  }
  return { piece, circle, refLuma };
}

/**
 * The last row of the twin's hole (the well or the housing): the lowest row
 * from the region's top down to 40 rows past its bottom with a clear run
 * (alpha < 128) of at least 20 px that starts and ends strictly inside the
 * region's inner columns — the bar's hole reaches the region's right edge
 * and the rows past the twin's wrap are clear edge to edge, so neither
 * counts. The hole must end inside the region (the transform twins' circle
 * ends at row 221, the modal teardrop at 218).
 */
export function twinHoleBottom(placedTwin, well, width = OUT_W, rows = CROWN_BAND.rows) {
  const { region } = well;
  const x0 = region.x0 + 20;
  const x1 = region.x1 - 20;
  let bottom = -1;
  for (let y = region.y0; y <= Math.min(rows - 1, region.y1 + 40); y += 1) {
    let start = null;
    for (let x = x0; x <= x1; x += 1) {
      const clear = x < x1 && placedTwin[(y * width + x) * 4 + 3] < 128;
      if (clear && start === null) start = x;
      if (!clear && start !== null) {
        if (start > x0 && x < x1 && x - start >= 20) bottom = y;
        start = null;
      }
    }
  }
  return bottom;
}

/**
 * What the importer (and the unit test, on the published pieces) checks on a
 * cut band: outside the well region the piece IS the band; inside the
 * region its alpha is the twin's; the twin's hole ends inside the region's
 * rows (twinHoleBottom — the band's wrap below it is kept, 3 rows longer
 * than the twin's); on a well with circle rows the fitted circle is a circle
 * (maxErr ≤ 1.5 px) of the expected size and the piece is clear inside it;
 * the fill's colour is the band's leg's (within 8 levels per channel, over
 * the unshaded fill).
 */
export function cutCrownFindings(piece, band, placedTwin, well, circle, width = OUT_W, rows = CROWN_BAND.rows) {
  const { region, keep } = well;
  const failures = [];
  let outsideDiff = 0;
  let alphaDiff = 0;
  let circleLeak = 0;
  const holeBottom = twinHoleBottom(placedTwin, well, width, rows);
  const fill = [0, 0, 0];
  const leg = [0, 0, 0];
  let nFill = 0;
  let nLeg = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const inCols = x >= region.x0 && x < region.x1;
      const inRegion = inCols && y >= region.y0 && y <= region.y1;
      if (!inRegion) {
        if (piece[o] !== band[o] || piece[o + 1] !== band[o + 1] || piece[o + 2] !== band[o + 2] || piece[o + 3] !== band[o + 3]) outsideDiff += 1;
        continue;
      }
      if (piece[o + 3] !== placedTwin[o + 3]) alphaDiff += 1;
      const d = circle ? Math.hypot(x + 0.5 - circle.cx, y + 0.5 - circle.cy) : Infinity;
      if (circle && d < circle.r - 2 && piece[o + 3] !== 0) circleLeak += 1;
      if (piece[o + 3] >= 250 && !(keep && x < keep.x1) && (!circle || d > circle.r + 6)) {
        // Unshaded fill only: where the twin is at least its leg's brightness.
        const l = lumaAt(placedTwin, o);
        if (l >= DFC_CROWN_SHADE_KNEE * 255 * 0.75) { for (let c = 0; c < 3; c += 1) fill[c] += piece[o + c]; nFill += 1; }
      }
    }
  }
  for (let y = well.ref.y0; y < well.ref.y1; y += 1) {
    for (let x = well.texture.x0; x < well.texture.x1; x += 1) {
      const o = (y * width + x) * 4;
      if (band[o + 3] < 250) continue;
      for (let c = 0; c < 3; c += 1) leg[c] += band[o + c];
      nLeg += 1;
    }
  }
  const fillMean = nFill ? fill.map((v) => Math.round(v / nFill)) : null;
  const legMean = nLeg ? leg.map((v) => Math.round(v / nLeg)) : null;
  if (outsideDiff) failures.push(`${outsideDiff} px outside the well region differ from the band`);
  if (alphaDiff) failures.push(`${alphaDiff} px inside the well region do not take the twin's alpha`);
  if (holeBottom < 0 || holeBottom > region.y1) failures.push(`the twin's hole ends at row ${holeBottom}, outside the well region's rows ${region.y0}–${region.y1}`);
  if (circle && circle.maxErr > 1.5) failures.push(`the twin's hole is not a circle (worst point ${circle.maxErr.toFixed(2)} px off)`);
  if (circle && !(circle.r > 55 && circle.r < 66)) failures.push(`the well's circle has radius ${circle.r.toFixed(1)}, expected 55–66`);
  if (circleLeak) failures.push(`${circleLeak} px inside the well's circle are not clear`);
  return { outsideDiff, alphaDiff, circleLeak, holeBottom, fillMean, legMean, failures };
}

/** The cut crown folders, by bucket folder: the twin's pack dir and the
 *  well. */
export const DFC_CROWN_CUTS = Object.freeze({
  m15dfccrown: Object.freeze({ twinDir: "img/frames/m15/transform/crowns/regular", well: DFC_CROWN_WELLS.left, pack: "Transform 'Legend Crowns' (packTransformLegendCrowns.js: the front / 2016–22 back crown, cut around the LEFT well)" }),
  m15dfccrownright: Object.freeze({ twinDir: "img/frames/m15/transform/crowns/regular/new", well: DFC_CROWN_WELLS.right, pack: "Transform 'Legend Crowns' (packTransformLegendCrowns.js: the '(Back)' crown of the ▼ back, cut around the RIGHT well)" }),
  m15mdfccrown: Object.freeze({ twinDir: "img/frames/modal/crowns/regular", well: DFC_CROWN_WELLS.modal, pack: "Modal 'Regular Legend Crowns' (packModalLegendCrowns.js: cut around the housing)" }),
});
/** The cut bands' keys: the band's colours, m, a, l (never c) and the pairs. */
export const DFC_CROWN_KEYS = Object.freeze([...CROWN_BAND.keys.filter((k) => k !== "c"), ...TWO_COLOR_PAIRS]);

/** The twin letter a cut band key reads: the key, or — for a pair — the
 *  colour whose half the well is in (the first on a left well, the second
 *  on the right). */
export function twinLetterFor(key, well) {
  if (TWO_COLOR_PAIRS.includes(key)) return well.side === "right" ? key[1] : key[0];
  if (!DFC_CROWN_KEYS.includes(key)) throw new Error(`twinLetterFor: no DFC crown for key ${key}`);
  return key;
}

/** A cut band's recipe for a key: the band it cuts and the twin it reads. */
export function cutCrownRecipe(folder, key) {
  const def = DFC_CROWN_CUTS[folder];
  if (!def) throw new Error(`cutCrownRecipe: no cut crown folder ${folder}`);
  return { band: `m15crown/${key}`, twin: `${def.twinDir}/${twinLetterFor(key, def.well)}.png`, well: def.well };
}

/** How provenance prints a cut band key's recipe. */
export function describeCutCrown(folder, key, bandSha) {
  const r = cutCrownRecipe(folder, key);
  const w = r.well;
  return [
    `${r.band}.png (the published band, sha256 ${bandSha.slice(0, 12)}) cut at the well region x ${w.region.x0}–${w.region.x1 - 1} × y ${w.region.y0}–${w.region.y1} through the alpha of ${r.twin} at ${DFC_CROWN_TWIN_BOUNDS.leftPct}/${DFC_CROWN_TWIN_BOUNDS.topPct}/${DFC_CROWN_TWIN_BOUNDS.widthPct}×${DFC_CROWN_TWIN_BOUNDS.heightPct} % (1:1)`,
    `the colour inside the region: the band's leg columns ${w.texture.x0}–${w.texture.x1 - 1} mirror-tiled on the same rows${w.keep ? ` (the band's own pixels left of x ${w.keep.x1})` : ""}, darkened where the twin is below ${DFC_CROWN_SHADE_KNEE} of its leg's luminance (its outline round the hole); the wrap under the bar the band's own (both holes end above it)`,
  ];
}

/** Every Card Conjurer file a cut band folder reads (the band is ours). */
export function cutCrownSourceFiles(folder) {
  return [...new Set(DFC_CROWN_KEYS.map((key) => cutCrownRecipe(folder, key).twin))].sort();
}

const DFC_CROWN_NOTES = (what, bodies) => [
  `the legendary crown on ${bodies} (TODO 5.1d): OUR m15crown band — the textured 'Legend Crowns (New)' art the owner signed off on m15 — cut through the alpha of Card Conjurer's ${what}, which carries the OLDER flat crown art and is never published; outside the well region the piece is the band byte for byte`,
  "inside the well region (the columns from the band's leg to the inset bar, rows 93–225) the alpha is the twin's (the well cleared, the crown round it — the prints wrap the crown round the well with the ring on top: MID #246, VOW #21, MOM #190, KHM #112) and the colour the band's own leg texture mirror-tiled on the same rows (the band has no pixels there: its hole is the plain M15 bar's), darkened only where the twin is darker than half its own leg (CC's outline round the hole, never its gradient — the prints' annulus reads 0.8–1.0 of the leg); the wrap under the bar is the band's own: the transform twins' well is a circle ((143.6, 160.5) r 60.9 on the left, fitted ≤ 1 px, rows 100–221), the modal twin's hole a teardrop (its point at x 59, row 160; its bottom at row 218) — both end above the wrap",
  "keys: the band's w u b r g, m (gold), a (the artifact stand-in's silver: a DFC body's colourless is `c` → `a`), l (the land grey) and the ten pairs (the pair band cut through the twin of the colour whose half the well is in); never c",
];

const NYX_CROWN_NOTES = [
  "the legendary crown of the Nyx dress (TODO 4.7), drawn over the m15nyx masters: the m15crown band's recipe — the black 'Legend Crown Border Cover', then the crown — with Card Conjurer's Nyx inner crown (innerCrowns/new/nyx/<k>.png, 1353x64) on top at the pack's bounds (329/70 px of 2010x2814: 16.37/2.49/67.31x2.27 %), composited at 2010x2814, downscaled once, corners cut, rows 0–409 kept",
  "keys: w u b r g, m (gold), a (the colourless key's silver: m15nyx maps c → a) and the ten pairs — the first colour's crown and strip on the left, the second's on the right, through m15crown's untilted crown ramp 45→55 %W; never l or c (no Nyx land or see-through master)",
];

// --- TODO 4.48: the M20 full-art token's legendary crown, an OVERLAY band.
// Every crowned M20+ token (51 printings, 2020 → 2026: TFDN #13 Scion of the
// Deep, TTDC #18, TCMM #60, TAFR #8 / #13, TOTJ #6, TLTR #20, TM3C #11 …)
// wears Card Conjurer's FLOATING crown — the borderless frame's — round its
// name pill: at CC's borderless bounds (crown 3.07/1.91/93.87×10.24 %, the
// outline UNDER it at 2.8/1.72/94.4×10.62 %, both 1500-native, 1:1) its
// scallops, wings and wrap sit on the prints' (measured 2026-10-15 against
// the crown's edge into the black border, 1500 × 2100: the top edge +2.5 px
// on the 2023+ prints — the name pill itself prints +1.3 px below CC's, used
// as drawn (4.48) — the wings +4 / +1 px; the 2021 AFR scans −1 px). The
// crown's hole is the pill's interior: it repaints only the pill's rims and
// ends (rows 89–103 and 218–232 at full width, ~36 px at each end), as the
// prints' crown carries the rims. Nothing is erased or covered: the token
// master has no ring at the top for the crown to replace (its border is the
// black card edge). Composited over a clear canvas and cropped to the
// outline's rows 0–259. Keys: the colours, gold (`m`, also a pair drawn
// gold), CC's grey C crown (the plain templates' charcoal `c`), CC's silver
// A crown (the artifact templates' `c` → `a`: TNEO #16 Tamiyo's Notebook,
// TONE #9) and the ten pairs — the first colour's crown on the left, the
// second's on the right, lerped across the token's own split
// (PAIR_RAMPS.m20Token, 40→60 %W: TDMU #21 R|G, TMKM #13 G|W).
export const M20_TOKEN_CROWN_BAND = Object.freeze({
  source: CROWNS,
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "c", "a", ...TWO_COLOR_PAIRS]),
  crown: BORDERLESS_CROWN.crown,
  outline: BORDERLESS_CROWN.outline,
  compositeSize: Object.freeze({ width: OUT_W, height: OUT_H }),
  rows: 260,
});

/** The M20 token crown band's layers for a key, in CC's draw order (the
 *  borderless frame's): the outline, then the crown — a pair's two crowns
 *  lerped across the token's split. */
export function m20TokenCrownLayers(key) {
  if (!M20_TOKEN_CROWN_BAND.keys.includes(key)) throw new Error(`m20TokenCrownLayers: no crown for key ${key}`);
  const crown = TWO_COLOR_PAIRS.includes(key)
    ? placed(floatingCrown(key[0]), M20_TOKEN_CROWN_BAND.crown, { right: floatingCrown(key[1]), ramp: [...PAIR_RAMPS.m20Token] })
    : placed(floatingCrown(key), M20_TOKEN_CROWN_BAND.crown);
  return [placed(BORDERLESS_CROWN.outlineSrc, M20_TOKEN_CROWN_BAND.outline), crown];
}

/** The pill interior the crown must leave alone (1500 × 2100 px): CC's
 *  name pill between its rims, inside its rounded ends. */
export const M20_TOKEN_PILL_HOLE = Object.freeze({ x0: 120, x1: 1380, y0: 106, y1: 216 });

/**
 * What the importer checks on the full 1500 × 2100 M20 token crown
 * composite before it crops the band (pure): `lastAlphaRow` below the
 * band's rows; `peakRow`, the first opaque row at the centre column, the
 * outline's peak at 36 ± 1 (CC's 0.0172 × 2100); and NOTHING over the name
 * pill's interior (M20_TOKEN_PILL_HOLE: the pill and its text show through).
 */
export function m20TokenCrownFindings(buf, width, height, rows) {
  let lastAlphaRow = -1;
  for (let y = height - 1; y >= 0 && lastAlphaRow < 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      if (buf[(y * width + x) * 4 + 3] > 0) {
        lastAlphaRow = y;
        break;
      }
    }
  }
  const cx = Math.floor(width / 2);
  let peakRow = -1;
  for (let y = 0; y < rows && peakRow < 0; y += 1) if (buf[(y * width + cx) * 4 + 3] >= 250) peakRow = y;
  const h = M20_TOKEN_PILL_HOLE;
  let holeMaxAlpha = 0;
  for (let y = h.y0; y < h.y1; y += 1) for (let x = h.x0; x < h.x1; x += 1) holeMaxAlpha = Math.max(holeMaxAlpha, buf[(y * width + x) * 4 + 3]);
  const failures = [];
  if (lastAlphaRow >= rows) failures.push(`alpha down to row ${lastAlphaRow}, past the band's ${rows} rows`);
  if (Math.abs(peakRow - 36) > 1) failures.push(`the outline's peak at row ${peakRow}, CC's is 36 ± 1`);
  if (holeMaxAlpha > 0) failures.push(`α ${holeMaxAlpha} over the name pill's interior`);
  return { lastAlphaRow, peakRow, holeMaxAlpha, failures, summary: `pill interior α ≤ ${holeMaxAlpha}` };
}

/** The overlay bands the importer builds, by bucket folder. */
export const CC_OVERLAY_BANDS = {
  // TODO 4.11: the Lord of the Rings scroll's crown — a generic band, the
  // pack's crown at its own bounds (SCROLL_CROWN_BAND).
  // TODO 4.11: the Lord of the Rings ring's crown — a generic band, the
  // pack's crown at its own bounds, 1:1 (RING_CROWN_BAND).
  lotrcrown: {
    pack: RING_PACK,
    band: RING_CROWN_BAND,
    keys: RING_CROWN_BAND.keys,
    layers: ringCrownLayers,
    findings: ringCrownFindings,
    keepCorners: RING_KEEP_CORNERS,
    notes: [
      "the ring showcase's legendary crown (TODO 4.11): the pack's 'Legendary Crown' (lotr/crown/<k>.png, 1500x272 at crownBounds 0/0) at 1:1 — the scalloped cream title bar with the frame field round it, which every print of the run carries (all sixty are legendary: LTR #302–331, #794–823); it repaints the card's whole top, its two top corners kept square like the masters'",
      "keys = the pack's eight crowns: w u b r g, m (gold), a (the artifact's blue-grey — a colourless artifact draws master a) and l (the land's brown — the template's keyMap c → l); no pairs (no pair masters)",
      "its field toned with the masters' (RING_SOURCE_TONES)",
    ],
  },
  // TODO 4.11 wave 2: the dossier's crown — a generic band, the pack's
  // crown at its own bounds, the pairs lerped (DOSSIER_CROWN_BAND).
  dossiercrown: {
    pack: DOSSIER_PACK,
    band: DOSSIER_CROWN_BAND,
    keys: DOSSIER_CROWN_BAND.keys,
    layers: dossierCrownLayers,
    findings: dossierCrownFindings,
    notes: [
      "the dossier showcase's legendary crown (TODO 4.11): the pack's 'Legendary Crown' (dossier/crown/<k>.png, 1790x419) at its crownBounds (33/2010, 0) on a clear 2010x2814 canvas, downscaled once to 1500x2100 (Lanczos) and cropped to rows 0–315 — the torn paper strip in the card's colour above the title band that every legendary dossier print carries (MKM #337, #344, #350, #352, #354–375's legends; plain: #336, #343, #358). No cover strip: the crown is drawn over the master's own top",
      `keys = the pack's seven crowns (w u b r g, m gold, c = the artifact's slate crown/a.png) and the ten pairs, the first colour's crown left and the second's right lerped across ${DOSSIER_CROWN_RAMP[0]} → ${DOSSIER_CROWN_RAMP[1]} %W (print's two-colour legends: #356, #359, #360, #362, #363, #365, #370, #373)`,
      "the green and blue crowns toned onto print as the file loads (DOSSIER_PRINT_TONES: the pack draws them 11–12 levels off the frame's own accents, which print uses for the crown too)",
    ],
  },
  lotrscrollcrown: {
    pack: SCROLL_PACK,
    band: SCROLL_CROWN_BAND,
    keys: SCROLL_CROWN_BAND.keys,
    layers: scrollCrownLayers,
    findings: scrollCrownFindings,
    notes: [
      "the scroll showcase's legendary crown (TODO 4.11): the pack's 'Legendary Crown' (scroll/crowns/<k>.png, 1909x70) at its crownBounds (49/2010, 43/2814) on a clear 2010x2814 canvas, downscaled once to 1500x2100 (Lanczos) and cropped to rows 0–99 — the rolled top edge of the title scroll every legendary scroll print carries (LTR #470, #526, LTC #422; plain: #457, #700, LTC #412). No cover strip: the crown is drawn over the master's own title scroll",
      "keys = the pack's eight crowns: w u b r g, m (gold), a (the artifact's light blue — a colourless artifact draws master a) and l (the land's brown — the template's keyMap c → l); no pairs (no pair masters)",
    ],
  },
  // TODO 4.48: the M20 full-art token's crown — a generic band, the
  // borderless frame's floating crown at its own bounds.
  m20tokencrown: {
    pack: "M15 'Legend Crowns (Floating)' (packM15LegendCrownsFloating.js), drawn as CC's autoBorderlessFrame draws the crown and its outline (creator-23.js:1227–1266) — over the full-art token masters (groupToken-2.js)",
    band: M20_TOKEN_CROWN_BAND,
    keys: M20_TOKEN_CROWN_BAND.keys,
    layers: m20TokenCrownLayers,
    findings: m20TokenCrownFindings,
    notes: [
      "the full-art token's legendary crown (TODO 4.48): CC's floating crown with its outline UNDER it, at CC's borderless bounds (crown 3.07/1.91/93.87x10.24 %, outline 2.8/1.72/94.4x10.62 %), composited 1:1 at 1500x2100 (every piece 1500-native) over a clear canvas and cropped to rows 0–259 (the outline's extent); nothing erased or covered — an overlay band over the m20token* masters (frames bucket)",
      "measured 2026-10-15 on 11 crowned M20+ prints (Scryfall PNGs at 1500x2100; TFDN #13, TOTJ #6, TTDC #18 / #19, TMOM #6, TLCC #7, TLTR #20, TCMM #60, TAFR #8 / #13, TM3C #11): the crown's top edge into the black border +2.5 px from CC's on the 2023+ prints (median), its wings +4 / +1 px — used as drawn, as the name pill (+1.3 px, TODO 4.48); the crown's hole is the pill's interior (rows 104–217 between the ends: α 0 there, checked), so it repaints only the pill's rims and ends, as the prints' crown carries them",
      "keys = w u b r g, m (gold: three or more colours, or a pair drawn gold), c (CC's grey C crown, on the plain templates' charcoal colourless), a (CC's silver A crown, the artifact templates' colourless: keyMap c → a; TNEO #16, TONE #9) and the ten pairs — the first colour's crown on the left, the second's on the right, lerped (premultiplied) across PAIR_RAMPS.m20Token (40→60 %W, the token's own split: TDMU #21 R|G, TMKM #13 G|W)",
    ],
  },
  // 4.6f (wave 2b): the extended-art crown — a generic band (`layers` /
  // `findings`), composited 1:1 at the card's size.
  extendedcrown: {
    pack: "M15 'Legend Crowns (Floating)' (packM15LegendCrownsFloating.js), drawn as CC's autoExtendedArtFrame does (creator-23.js:1311–1362, makeExtendedArtFrameByLetter :2296–2365)",
    band: EXTENDED_CROWN_BAND,
    keys: EXTENDED_CROWN_BAND.keys,
    layers: extendedCrownLayers,
    findings: extendedCrownFindings,
    notes: [
      "the extended-art legendary crown (TODO 4.6f, wave 2b): CC's floating crown over its BLACK 'Crown Border Cover' strip (drawn, not erased — the borderless frame erases it) with the outline ON TOP, as autoExtendedArtFrame draws them, composited 1:1 at 1500x2100 (every piece 1500-native) and cropped to rows 0–259 (the outline's extent); an overlay band over the extendedart masters (Card Conjurer's extended frames since TODO 4.7, frames bucket)",
      "keys = the seven colour keys of the extendedart template: w u b r g, m (gold: a three-colour card, or a pair drawn gold), c (CC's colourless crown, over the see-through colourless master and the artifact one alike: the overlay is keyed by the card's colour — owner Round 67 kept it after CC's artifact crown measured no closer: C nearer on 8 of 11 colourless legendary artifacts); CC's artifact crowns (and their 'Alt') are not used",
      "the ten pairs (TODO 4.7 follow-up): the pair's two floating crowns lerped across PAIR_RAMPS.crownFloating (40→60 %W, the borderless pairs' measure), first canonical colour on the left, drawn over the pair masters; measured 2026-10-14 on ten crowned two-colour extended-art prints (FRC #96, FDN #476 / #479 / #481–483, WOE #360, OTJ #366 / #367, WOC #39): median |ΔRGB| over the band's visible pixels 15.3–24.0 against 51.0–121.7 for the gold crown",
      "the band's slot is CC's bounds (lib/cards/template-layout.ts EXTENDED_CROWN, from row 0): since TODO 4.7 the extendedart masters are Card Conjurer's extended frames, whose title bar tops out at 4.98 %H as FDN #442 / #455 print it (over the old MSE masters, whose bar topped out at 5.43 %H, the slot sat 10 px lower)",
    ],
  },
  m15crown: {
    pack: "M15 'Legend Crowns (New)' (packM15LegendCrownsNew.js, groupAccurate.js — the pack the M15 masters come from)",
    band: CROWN_BAND,
    keys: CROWN_BAND_KEYS,
    notes: [
      "the standard legendary crown, drawn over the m15, m15artifact and m15land masters (TODO 4.6a; design 2026-09-29 §1.1): CC's autoM15NewFrame draws the black 'Legend Crown Border Cover' then the crown after the P/T plate — here composited alone at 2010x2814, downscaled once, corners cut, rows 0–409 kept",
      "a pair (wu … gu) is the first colour's crown on the left, the second's on the right, blended through an UNTILTED ramp 45→55 %W (the prints' crown split, each pixel de-shaded against the two single-colour crowns, measures 45.5 / 49.3 / 53.6 %W at 10 / 50 / 90 % on FDN's gold pairs, 46.4 / 49.4 / 53.6 on TLA's hybrids) as a premultiplied lerp — CC's stacking (maskRightHalf.png, tilted +1.35 %W) would double the crown's shadow over the art",
      "the older 'regular' crowns (crowns/m15Crown?.png, 1900x469) are a different pack and never mixed in",
    ],
  },
  // TODO 4.7: the Nyx dress's crown — the m15crown recipe with CC's Nyx
  // inner crown as its last layer (`inner`).
  m15nyxcrown: {
    pack: "M15 'Legend Crowns (New)' (packM15LegendCrownsNew.js) + 'Inner Crowns' Nyx (packM15InnerCrownsNew.js), groupAccurate.js",
    band: CROWN_BAND,
    keys: NYX_CROWN_BAND_KEYS,
    inner: NYX_INNER_CROWN,
    notes: NYX_CROWN_NOTES,
  },
  // TODO 4.25: the Universes Beyond crown — the same recipe over the UB
  // pack's crowns.
  m15ubcrown: {
    pack: "'Legend Crowns (Universes Beyond)' (packUBLegendCrownsNew.js, groupAccurate.js — the pack the Universes Beyond masters come from)",
    band: UB_CROWN_BAND,
    keys: UB_CROWN_BAND_KEYS,
    notes: [
      "the Universes Beyond legendary crown, drawn over the m15ub, m15ubartifact and m15ubland masters (TODO 4.25): m15crown's recipe — the black 'Legend Crown Border Cover', then the crown at the same bounds (the pack's own: 44/2010, 53/2814, 1922x493) — over the UB pack's smooth crowns, composited at 2010x2814, downscaled once, corners cut, rows 0–409 kept",
      "keys: w u b r g, m (gold), a (the artifact silver), l (the land grey) and c (the colourless crown of the see-through spell frame, TODO 4.25 follow-up: the pack's ub/crowns/new/c.png, the M15 pack's colourless crown byte for byte — m15crown/c's pixels under this band's name), then the ten pairs, the first colour's crown lerped into the second's through the untilted 45→55 %W crown ramp as m15crown's are",
      "the pack's FLOATING crowns (m15/ub/crowns/floating, packUBLegendCrownsFloating.js) belong to the UB full-art / extended looks and are not imported; the older 'regular' UB crowns (m15/ub/crowns/m15Crown?.png) are a different pack and never mixed in",
    ],
  },
  // TODO 5.1d: the double-faced bodies' crowns — our m15crown band cut
  // through CC's DFC crown twins' alpha round the well / housing (`cut`).
  m15dfccrown: {
    pack: DFC_CROWN_CUTS.m15dfccrown.pack,
    band: CROWN_BAND,
    keys: DFC_CROWN_KEYS,
    cut: DFC_CROWN_CUTS.m15dfccrown,
    notes: DFC_CROWN_NOTES("transform 'Legend Crown' twin (m15/transform/crowns/regular/<k>.png, cut round the LEFT well)", "the transform front, the transform land front and the 2016–22 transform back"),
  },
  m15dfccrownright: {
    pack: DFC_CROWN_CUTS.m15dfccrownright.pack,
    band: CROWN_BAND,
    keys: DFC_CROWN_KEYS,
    cut: DFC_CROWN_CUTS.m15dfccrownright,
    notes: DFC_CROWN_NOTES("transform 'Legend Crown (Back)' twin (m15/transform/crowns/regular/new/<k>.png, cut round the ▼ back's RIGHT well)", "the ▼ transform back"),
  },
  m15mdfccrown: {
    pack: DFC_CROWN_CUTS.m15mdfccrown.pack,
    band: CROWN_BAND,
    keys: DFC_CROWN_KEYS,
    cut: DFC_CROWN_CUTS.m15mdfccrown,
    notes: DFC_CROWN_NOTES("modal 'Regular Legend Crown' twin (modal/crowns/regular/<k>.png, cut round the housing — its tip reaches into the crown's leg, which keeps its own pixels under the twin's alpha)", "the modal front and the modal back"),
  },
  // TODO 4.11: the MUL Tarkir dragon-wing showcase's crown — a generic band,
  // the pack's crown at its own bounds, 1:1 (TARKIR_CROWN_BAND).
  tarkirdragoncrown: {
    pack: TARKIR_PACK,
    band: TARKIR_CROWN_BAND,
    keys: TARKIR_CROWN_BAND.keys,
    layers: tarkirCrownLayers,
    findings: tarkirCrownFindings,
    notes: [
      "the Tarkir showcase's legendary crown (TODO 4.11): the pack's 'Legend Crown' (tarkir/crowns/<k>.png, 1145x65 at crownBounds 180/51 px) at 1:1 over a clear card, rows 0–119 kept — the row of dragon-wing spikes along the title bar's top that every printing of the run carries (MUL #1, #60 and their twins are all legendary); drawn over the master's own bar",
      `keys = w u b r g, m (gold), c (the artifact crown, tarkir/crowns/a.png — the master c is the artifact frame) and the ten pairs: the first colour's crown left, the second's right, lerped across ${rampName(TARKIR_PAIR_RAMP)} — the pack's own 'Right Half' mask (tarkir/maskFrame.png) — as MUL #60 Taigam (white-blue) prints it, its centre bulb the two blended`,
      "the w and u crowns toned with the masters (TARKIR_SOURCE_TONES)",
    ],
  },
  // TODO 4.11 (wave 1): the Zendikar Rising hedron showcase's crown — a
  // generic band (ZNR_CROWN_BAND), the pack's crown at CC's bounds, 1:1.
  fullartcrown: {
    pack: `${ZNR_PACK}: its '… Crown' pieces`,
    band: ZNR_CROWN_BAND,
    keys: ZNR_CROWN_BAND.keys,
    layers: znrCrownLayers,
    findings: znrCrownFindings,
    notes: [
      "the ZNR showcase's legendary crown (TODO 4.11): the pack's crown (m15ZendikarRisingCrown<K>.png, 1412x245 — the title pill's two ends drawn bigger, with their hedron points) at CC's bounds 2.94/2.34/94.14x11.67 % over a clear canvas, 1:1 at 1500x2100, rows 0–299 kept; nothing erased — it covers the title piece's ends whole, as CC draws it over them; an overlay band over the fullart masters (frames bucket)",
      "keys = w u b r g, m (gold: three or more colours, or a pair — the template draws no pair masters), c (the colourless crown over the see-through frame) and the ten pairs: the first colour's crown on the left, the second's on the right, lerped across PAIR_RAMPS.crown (45→55 %W, where neither end draws anything) — #313 Phylath, World Sculptor prints the red end left and the green right over its gold bars; the pack's A and L crowns are not imported (no artifact or land master)",
      "the prints: #300 Moraug (R), #312 Omnath (4 colours: gold), #313 Phylath (R|G) — the ends' outline and points land on CC's within 2 px once the title bar is registered",
    ],
  },
};

// ---------------------------------------------------------------------------
// Rider sets (TODO 5.1a): small images a profile draws at a slot keyed by
// something other than the card's colour — the transform icon glyphs, keyed
// by the icon family's glyph for the face's role (FrameOverlaySlot
// `anatomy: "dfcIcon"`, lib/cards/anatomy.ts resolveFrameOverlays). Built
// by scripts/import-cc-frames.mjs (`--only dfcicon`) into
// .frames-build/<folder>/<key>.png + .webp at `size` × `size`, published
// like a master, never committed.
// ---------------------------------------------------------------------------

/** The rider sets the importer builds, by bucket folder. */
/** The 1993 frame's five colour symbols (TODO 4.10c / 4.24, symbol style
 *  "original" — lib/cards/symbol-style.ts): Card Conjurer's old set, one
 *  600 × 600 SVG per colour holding the WHOLE pip (its pale disc and the
 *  1993 drawing). Rasterised at 216 px — three times the 72 px cost disc of
 *  the HD bake, so no bake upsamples one. The folder and the letters are
 *  the style's (ORIGINAL_SYMBOL_FOLDER, ORIGINAL_SYMBOL_LETTERS; a unit test
 *  holds them together). */
export const MANA_ORIGINAL_SIZE = 216;
export const MANA_ORIGINAL_FILES = Object.fromEntries(["w", "u", "b", "r", "g"].map((c) => [c, `img/manaSymbols/old/old${c}.svg`]));

export const CC_RIDERS = {
  manaoriginal: {
    pack: "img/manaSymbols/old (the set CC's creator loads for its Alpha / Beta / Unlimited and Legends packs: manaSymbols 'old' in creator-23.js)",
    size: MANA_ORIGINAL_SIZE,
    files: MANA_ORIGINAL_FILES,
    output: `${MANA_ORIGINAL_SIZE}x${MANA_ORIGINAL_SIZE} mana symbols (a whole pip each: the disc in its own colour and the 1993 drawing in black; clear outside the disc)`,
    notes: [
      "the 1993 frame's five colour symbols (TODO 4.10c / 4.24; symbol style \"original\" on agclassic and alphaland): mana-font has only the old sun (`w-original`), so all five come from this ONE set and are drawn as images in the cost row and the rules text, through the path an owner's custom pip uses — never a font glyph on our own disc",
      "proof 3 (2026-10-08, Scryfall scans of 14 sets on the 1993 frame): the ringed twelve-ray sun is printed by nine sets, Alpha 1993 → Fallen Empires 1994 (LEA LEB 2ED ARN ATQ 3ED LEG DRK FEM); Fourth Edition 1995, Ice Age, Chronicles, Homelands and Alliances print today's sun. The drop, skull, flame and tree are today's shapes drawn to fill the disc; Alpha / Beta / Unlimited print a rougher skull than this file's",
      "each SVG is rasterised at 216 px (sharp, density 300, Lanczos): three times the HD bake's 72 px cost disc, so neither bake upsamples; generic and hybrid symbols, {C}, {X} and {T} stay the font's (the era's {T} is mana-font `tap-3ed`, Revised's tilted T)",
    ],
  },
  dfcicon: {
    pack: "packM15TransformTypes.js 'Transform Icons' (groupDFC.js) — the 12 of CC's 14 icon files that a printing wears",
    size: DFC_ICON_SIZE,
    files: DFC_ICON_FILES,
    notes: [
      "the transform icon glyphs (TODO 5.1a; design 2026-10-02 §2.1, frames.md §1.4 / §4.6): each file is a black disc with the glyph in white — CC draws it INSIDE the master's well at 5.94 / 5.05 / 7.34 × 5.24 % (89 / 106, 110 × 110 px at HD), replacing the default ▲ the front master carries; rasterised at 220 px (2× the drawn 110, so the HD bake never upsamples; sharp at density 300 for the SVGs, Lanczos for the two PNGs)",
      "the family → glyph map (lib/cards/dfc.ts DFC_ICON_GLYPHS): arrows ▲ `default` / ▼ `downarrow` (BOT 2022-11 → today; the ▼ is baked into the m15dfcback master, so `downarrow` is published but drawn by no wave-1 profile); sunmoondfc `sun` / `moon` (SOI, EMN, MID, VOW); mooneldrazidfc `fullmoon` / `emrakul` (EMN); compasslanddfc `compass` / `land` (XLN, RIX, LCI); fandfc `fanclosed` / `fanopen` (NEO); originpwdfc `spark` / `planeswalker` (ORI — the walker bodies, TODO 5.13, ask first)",
      "keys are lowercase (the frames bucket's object keys are: downarrow, fanclosed, fanopen); CC's Lesson and Hammer icons have no DFC printing (BOT prints the plain ▲ / ▼) and are not built; the silver / SLD waxing-and-waning moon and upside-down families have no file",
    ],
  },
};

/** A card-% rect as a pixel box on a W × H canvas (CC's bounds, rounded). */
export function rectPx(rect, width, height) {
  return {
    x: Math.round((rect.leftPct / 100) * width),
    y: Math.round((rect.topPct / 100) * height),
    width: Math.round((rect.widthPct / 100) * width),
    height: Math.round((rect.heightPct / 100) * height),
  };
}

/** A W × H transparent 8-bit RGBA canvas with `img` (box.width ×
 *  box.height RGBA) placed at the box — CC drawing an image at its bounds. */
export function placeOnCanvas(img, box, width, height) {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < box.height; y += 1) {
    const ty = box.y + y;
    if (ty < 0 || ty >= height) continue;
    for (let x = 0; x < box.width; x += 1) {
      const tx = box.x + x;
      if (tx < 0 || tx >= width) continue;
      img.copy(out, (ty * width + tx) * 4, (y * box.width + x) * 4, (y * box.width + x) * 4 + 4);
    }
  }
  return out;
}

/**
 * One crown band key's recipe: the black cover, then the crown — a mono key
 * CC's crown letter as it is, a pair the first colour's crown lerped into
 * the second's through the crown ramp. Throws for a key the band doesn't
 * build.
 */
export function crownBandRecipe(key, band = CROWN_BAND) {
  if (TWO_COLOR_PAIRS.includes(key)) {
    const [a, b] = key.split("");
    return {
      cover: CROWN_COVER_SRC,
      left: `${band.source}/${a}.png`,
      right: `${band.source}/${b}.png`,
      ramp: PAIR_RAMPS.crown,
    };
  }
  if (!band.keys.includes(key)) throw new Error(`crownBandRecipe: no crown for key ${key}`);
  return { cover: CROWN_COVER_SRC, left: `${band.source}/${key}.png`, right: null, ramp: null };
}

const pctBox = (r) => `${r.leftPct}/${r.topPct}/${r.widthPct}×${r.heightPct} %`;

/** How provenance prints a crown band key's recipe. */
export function describeCrownBand(recipe, band = CROWN_BAND) {
  const crown = recipe.right
    ? `${recipe.left} ⟷ ${recipe.right} lerped through ${rampName(recipe.ramp)}`
    : recipe.left;
  return [`${recipe.cover} over ${pctBox(band.cover)}`, `${crown} at ${pctBox(band.crown)}`];
}

/** Every Card Conjurer file the crown band reads. */
export function crownBandSourceFiles(keys = CROWN_BAND_KEYS, band = CROWN_BAND) {
  const files = new Set();
  for (const key of keys) {
    const recipe = crownBandRecipe(key, band);
    files.add(recipe.cover);
    files.add(recipe.left);
    if (recipe.right) files.add(recipe.right);
  }
  return [...files].sort();
}

/**
 * What the importer checks on a full 1500 × 2100 crown composite before it
 * crops the band (pure; the numbers go in its log and the unit test):
 *   • `lastAlphaRow` — the lowest row with any alpha; the crop keeps rows
 *     0 … rows − 1, so it must be below `rows`;
 *   • `peakRow` — the first row at the card's centre column that is not the
 *     cover's black (the crown's peak; the prints: row 42 ± 2 at HD);
 *   • `artMaxAlpha` / `artPartial` — inside `artSlot` (card %), the most
 *     opaque pixel and the share with α > 0.05: the crown only shadows the
 *     top of the art, never covers it — α ≤ 119 in the M15 slot, where the
 *     frame's own window edge sits over the darkest of it; α ≤ 79 on the art
 *     you can see, rows 238–244 px (all 19 bands, after v35). The importer
 *     refuses a band above 127.
 */
export function crownBandFindings(buf, width, height, rows, artSlot) {
  let lastAlphaRow = -1;
  for (let y = height - 1; y >= 0 && lastAlphaRow < 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      if (buf[(y * width + x) * 4 + 3] > 0) {
        lastAlphaRow = y;
        break;
      }
    }
  }
  const cx = Math.floor(width / 2);
  let peakRow = -1;
  for (let y = 0; y < rows; y += 1) {
    const o = (y * width + cx) * 4;
    if (buf[o + 3] > 0 && buf[o] + buf[o + 1] + buf[o + 2] > 3 * 40) {
      peakRow = y;
      break;
    }
  }
  const box = rectPx(artSlot, width, height);
  let artMaxAlpha = 0;
  let artPartial = 0;
  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      const a = buf[(y * width + x) * 4 + 3];
      if (a > artMaxAlpha) artMaxAlpha = a;
      if (a > 0.05 * 255) artPartial += 1;
    }
  }
  return { lastAlphaRow, peakRow, artMaxAlpha, artPartialPct: (artPartial / (box.width * box.height)) * 100 };
}

// ---------------------------------------------------------------------------
// The holofoil stamp's notch pieces (TODO 4.9c): Card Conjurer's holo-stamp
// arch, drawn OVER a master (FrameOverlaySlot "holoStamp" — lib/cards/
// template-layout.ts M15_HOLO_STAMP / M15PW_HOLO_STAMP), built by
// scripts/import-cc-frames.mjs (`--only m15holostamp,m15pwholostamp`) into
// .frames-build/<folder>/<key>.png + .webp and published to the bucket like a
// master, never committed.
//
// Every one of CC's pieces holds a capture of WotC's hologram inside its
// oval (the planeswalker symbol tiled in silver — all 11 M15 and 8 walker
// pieces; `m15/holoStamps/stamp.png` too), so NOTHING of a piece reaches the
// bucket as it is (owner 2026-09-29: cleaned of any hologram capture before
// the bucket). The recipe takes ONE piece per pack as the arch's GEOMETRY —
// CC's U, the one flat saturated rim (0,117,190), which decomposes exactly
// into its three sources (the translucent white bevel, the rim, the black)
// — tints the rim to the master's own bar (sampled where it is flat), keeps
// the bevel and the black, and cuts the oval region (the slot's oval plus
// HOLO_STAMP_CUT_MARGIN_PX) to transparent. The tint is the point, not a
// convenience: CC's holo pack predates its accurate M15 pack, so its W rim
// is a bluish white (252,254,255) against our cream bar (244,243,236), its
// R (239,56,39) and G (0,123,67) more saturated than ours (209,77,53 /
// 42,108,69), its C (192,191,188) darker than our grey (223,224,224) —
// only U matches. The walker rims match our walker masters exactly, so the
// tinted w u b r g m reproduce CC's own pieces; the colourless walker, which
// CC has no piece for, is sampled like the rest. The snow and devoid frames
// carry no pieces of their own: their bars are M15's pixels (snow) or the
// colourless grey (devoid), so their entries map onto these keys.
//
// The two-colour PAIR frames (the 4.9c follow-up, owner round 26,
// 2026-10-03) take the same geometry with the rim tinted PER COLUMN: a pair
// master's bar under the notch is its pinline layer, the two colours lerped
// across PAIR_RAMPS.pinline (40→60 %W = 600–900 px) — and the notch sits at
// 654–846 px, INSIDE the ramp, so its left foot stands on an ≈ 20 % blend
// and its right on ≈ 80 %. One flat tint can't meet both; the rim takes the
// bar's own colour at each column, read off the pair master itself (rows
// 1940–1947 at every x of the piece's bounds), so the arch is that bar
// lifted — the foot matches the bar pixel for pixel on both sides and the
// rim runs through the ramp over the oval exactly as the pinline does. ONE
// piece per pair serves every pair master: the bar's flat rows (1941–1949)
// are the same bytes on m15/<pair>, m15/<pair>-h (the hybrid dress's grey
// L bars are its title and type bars; its text-box pinline is the pair's),
// m15artifact/<pair>, m15land/<pair> and the snow pairs m15snow/<pair> /
// m15snowland/<pair> (4.6f wave 2c; their white bars are the title and type
// bars, and the snow pack's pinline is M15's — measured: the bar under the
// notch is m15's pair bar at every column; the land and snow pairs differ
// only on the bar's anti-aliased top rows, by ≤ 5 levels, as the mono `l`
// key does on m15land) — the importer refuses the key if any of them drifts.
// ---------------------------------------------------------------------------

/** Where a master's bar is sampled (card px): the centre column's run of
 *  flat bar rows — every sampled pixel must agree within `tolerance`. A
 *  per-column key (`rampKeys`) reads the same rows at every column of the
 *  piece's bounds instead of `x`. */
const M15_BAR_SAMPLE = Object.freeze({ x: 750, rows: [1940, 1947], tolerance: 2 });
const M15PW_BAR_SAMPLE = Object.freeze({ x: 750, rows: [1932, 1935], tolerance: 2 });

/** The mono keys of the M15 notch (the colour's bar; m gold; c the
 *  colourless grey; a the artifact silver; l the land taupe). */
const M15_NOTCH_MONO_KEYS = ["w", "u", "b", "r", "g", "m", "a", "l", "c"];

/** The Universes Beyond notch's box on the 1500 × 2100 card (TODO 4.25):
 *  CC's 637.97, 1891.04 + 222.58 × 102.24 on whole pixels. */
export const UB_NOTCH_BOX = Object.freeze({ x: 638, y: 1891, width: 223, height: 102 });
/** The piece row its feet are read at (the bar's rows 1940–1947 at HD). */
const UB_NOTCH_FOOT_Y = 1944 - UB_NOTCH_BOX.y;
const UB_NOTCH_MONO_KEYS = ["w", "u", "b", "r", "g", "m", "a", "l", "c"];

/** The notch pieces the importer builds, by bucket folder. `shape` is the
 *  CC piece whose geometry every key takes, at CC's bounds (1:1 at HD);
 *  `arc` its rim colour; `barOf` the master (template/key under the build
 *  or cache dir) whose bar tints each key's rim; `oval` the slot's oval.
 *  `rampKeys` are the keys tinted PER COLUMN (the pairs: their bar is a
 *  ramp), and `barSharedBy` names the other masters each of those keys is
 *  drawn over, whose bar must be the sampled one's within the tolerance at
 *  every column — else the importer refuses the key (a dress whose bar
 *  drifted needs its own key). */
export const HOLO_STAMP_NOTCHES = {
  m15holostamp: {
    pack: "M15 'Holo Stamps' (packM15HoloStamps.js)",
    shape: {
      src: "img/frames/m15/holoStamps/m15HoloStampU.png",
      size: { width: 192, height: 96 },
      // 2 px below CC's bounds (90.34 %): see M15_HOLO_STAMP's note.
      bounds: { leftPct: 43.6, topPct: 90.34 + (2 / 2100) * 100, widthPct: 12.8, heightPct: 4.58 },
      arc: [0, 117, 190],
    },
    keys: [...M15_NOTCH_MONO_KEYS, ...TWO_COLOR_PAIRS],
    barOf: {
      w: "m15/w",
      u: "m15/u",
      b: "m15/b",
      r: "m15/r",
      g: "m15/g",
      m: "m15/m",
      c: "m15/c",
      a: "m15artifact/c",
      l: "m15land/c",
      // A pair's rim is read off m15's gold-split pair master, per column.
      ...Object.fromEntries(TWO_COLOR_PAIRS.map((pair) => [pair, `m15/${pair}`])),
    },
    rampKeys: [...TWO_COLOR_PAIRS],
    // Every other pair master the pair key is drawn over (the hybrid dress,
    // the artifact and land pairs, 4.6f wave 2c's snow and snow-land
    // pairs): the importer checks each one's bar under the notch against
    // the sampled one at every column.
    barSharedBy: Object.fromEntries(
      TWO_COLOR_PAIRS.map((pair) => [
        pair,
        // …and the Vehicle frame's pairs (TODO 4.5c): m15artifact's
        // pinline layer over the bronze frame.
        // …and the Nyx dress's pairs (TODO 4.7): m15's pinline layer over
        // the starfield masters, both dresses.
        [`m15/${pair}-h`, `m15artifact/${pair}`, `m15vehicle/${pair}`, `m15nyx/${pair}`, `m15nyx/${pair}-h`, `m15land/${pair}`, `m15snow/${pair}`, `m15snowland/${pair}`],
      ]),
    ),
    barSample: M15_BAR_SAMPLE,
    oval: { leftPct: 45.54, topPct: 91.72, widthPct: 8.94, heightPct: 3.2 },
    cutMarginPx: 2,
    notes: [
      "the holofoil stamp's notch on the M15 family (TODO 4.9c): CC's arch — the text box's bottom pinline lifted over the stamp with its bevel — 1:1 at HD, 2 px below CC's bounds 43.6/90.34/12.8×4.58 % (654–846 × 1899–1995 px): the piece's rim foot is 11 rows, cut for CC's older M15 bar, and our accurate-pack bar is 12 (1938–1949), so at CC's bounds the foot stood 1 px proud of the bar's top and its black covered the bar's last 2 rows — a step at both feet; 2 px lower the foot's bottom edge is the bar's",
      "ONE geometry for every key: CC's U piece (its bevel, rim and black decomposed exactly), the rim tinted to OUR master's bar sampled at x 750, rows 1940–1947 (flat within 2 levels) — CC's per-key pieces predate its accurate M15 pack and their rims don't match our bars (W bluish white vs cream, R and G over-saturated, C darker); the unused CC pieces W B R G M A L C A2 A3 were fetched and inspected, never published",
      "a = the artifact silver sampled from m15artifact/c (the nearest of CC's three artifact rims is A2, 222,223,224); l = the land taupe from m15land/c; the snow frames' bars are these pixels and the devoid frames' the colourless grey, so their PROFILES entries map onto these keys",
      "the ten two-colour PAIR keys (the 4.9c follow-up, owner round 26, 2026-10-03): the same geometry with the rim tinted PER COLUMN to the pair master's own bar — the pinline layer lerped across the untilted 40→60 %W ramp (scripts/lib/pair-ramp.mjs), which the notch's 654–846 px sit inside — read off m15/<pair>.png at rows 1940–1947 for every column of the piece's bounds (each column flat within 2 levels), so the foot is the bar it stands on at every column of both feet and the arch runs through the ramp as the pinline does; one piece per pair serves m15/<pair>-h (the hybrid dress's grey L bars are its title and type bars; its text-box pinline is the pair's), m15artifact/<pair>, m15land/<pair> and the snow pairs m15snow/<pair> and m15snowland/<pair> (4.6f wave 2c: their WHITE bars are the title and type bars too; the snow pack's pinline is M15's, so the bar under the notch is m15's pair bar byte for byte at every column), whose bars are checked against the sample at every column (the land and snow pairs differ only on the bar's anti-aliased top rows above the sampled ones — row 1938, ≤ 5 levels — like the mono l key on m15land) — the importer refuses a pair whose shared masters drift",
      "the oval region — the slot's oval 45.54/91.72/8.94×3.2 % (683–817 × 1926–1993) plus 2 px — is cut to transparent in CARD coordinates (the piece's hologram, 685–815 × 1930–1993 once placed, sits inside), whatever CC's piece held there (its hologram capture: the planeswalker symbol tiled, WotC's mark), and the black around it is CC's own; our oval bitmap (lib/cards/holo-stamp-art.ts) covers the cut with a 3 px black margin",
    ],
  },
  // TODO 4.25: the Universes Beyond TRIANGLE stamp's notch.
  m15ubholostamp: {
    pack: "'Universes Beyond' holo stamps (packUBNew.js '… Holo Stamp', groupAccurate.js)",
    shape: {
      src: "img/frames/m15/new/ub/stamp/u.png",
      nativeSize: { width: 299, height: 137 },
      size: { width: UB_NOTCH_BOX.width, height: UB_NOTCH_BOX.height },
      bounds: {
        leftPct: (UB_NOTCH_BOX.x / 1500) * 100,
        topPct: (UB_NOTCH_BOX.y / 2100) * 100,
        widthPct: (UB_NOTCH_BOX.width / 1500) * 100,
        heightPct: (UB_NOTCH_BOX.height / 2100) * 100,
      },
      arc: [0, 117, 190],
    },
    keys: [...UB_NOTCH_MONO_KEYS, ...TWO_COLOR_PAIRS],
    barOf: {
      w: "m15ub/w",
      u: "m15ub/u",
      b: "m15ub/b",
      r: "m15ub/r",
      g: "m15ub/g",
      m: "m15ub/m",
      c: "m15ub/c",
      a: "m15ubartifact/c",
      l: "m15ubland/c",
      ...Object.fromEntries(TWO_COLOR_PAIRS.map((pair) => [pair, `m15ub/${pair}`])),
    },
    rampKeys: [...TWO_COLOR_PAIRS],
    barSharedBy: Object.fromEntries(TWO_COLOR_PAIRS.map((pair) => [pair, [`m15ub/${pair}-h`, `m15ubartifact/${pair}`, `m15ubland/${pair}`]])),
    barSample: M15_BAR_SAMPLE,
    triangle: UB_STAMP_HOLE,
    cutMarginPx: 2,
    notes: [
      `the Universes Beyond triangle stamp's notch (TODO 4.25): CC's piece — the text box's bottom pinline stepped up and over the stamp with its bevel — is 299x137 on the pack's 2015-wide card (bounds 857/2015, 2534/2814), so it is resampled ONCE (Lanczos) to ${UB_NOTCH_BOX.width}x${UB_NOTCH_BOX.height} at ${UB_NOTCH_BOX.x},${UB_NOTCH_BOX.y} px of the 1500x2100 card (CC's box is 637.97,1891.04 + 222.58x102.24), the resampling's ringing snapped back onto the flat rim and black (snapResampledPiece), and drawn 1:1 from there`,
      "ONE geometry for every key, as m15holostamp: CC's U piece (its rim the exact 0,117,190, decomposed into bevel, rim and black), the rim tinted to OUR master's bar sampled at x 750, rows 1940–1947; CC's own per-key pieces carry the same flat rims (w 244,243,236, r 209,77,53, m 233,212,125, a 223,225,225, l 165,152,138 — the accurate pack's pinlines), so the tinted keys reproduce them outside the cut",
      "keys: w u b r g, m (gold), a (the artifact silver, sampled from m15ubartifact/c), l (the land taupe, from m15ubland/c) and c (the see-through spell frame's white rim, sampled from m15ub/c — TODO 4.25 follow-up, as m15holostamp's c is from m15/c); then the ten pairs, the rim tinted PER COLUMN to m15ub/<pair>.png's bar (the pinline's 40→60 %W ramp, which the notch sits inside), the same bar on the hybrid, artifact and land pair masters (checked column by column)",
      "the triangle — CC's 'Gray Holo Stamp' shape fitted (lib/cards/holo-stamp.ts UB_STAMP_HOLE) plus 2 px — is cut to transparent: every colour piece holds a capture of WotC's hologram there, which is never published; our own triangle bitmap (lib/cards/holo-stamp-art.ts) covers the cut. The pack's gray.png is the fit's reference only and is not read by the build",
    ],
  },
  // TODO 4.11: the Lord of the Rings scroll's triangle notch — the pack's
  // own piece per key, composited like the masters (SCROLL_NOTCH).
  // TODO 4.11: the Lord of the Rings ring's triangle notch — the pack's own
  // piece per key, 1:1 (RING_NOTCH).
  lotrholostamp: {
    pack: RING_PACK,
    pieces: RING_NOTCH.pieces,
    keys: RING_NOTCH.keys,
    shape: RING_NOTCH.shape,
    placeAt: RING_NOTCH.placeAt,
    compositeSize: RING_NOTCH.compositeSize,
    triangle: UB_STAMP_HOLE,
    cutMarginPx: 2,
    blackoutPx: 2,
    stampShape: `${RING}/stamp/gray.png`,
    blackoutStampGrowPx: 1,
    notes: [
      `the ring showcase's triangle stamp notch (TODO 4.11): the pack's per-colour 'Holo Stamp' (lotr/stamp/<k>.png, 212x95) — the text box's rim stepped up round a black trapezoid over the stamp — at its stampBounds (644/1893 px), 1:1 (the pack is 1500 px native), cut to its box ${RING_NOTCH_BOX.width}x${RING_NOTCH_BOX.height} at ${RING_NOTCH_BOX.x},${RING_NOTCH_BOX.y} px — 1 px round the piece and 10 px past its foot, so the stamp hole's apex (1992.5) and its ring fit; below the piece the box is clear but for that ring, over the master's black border`,
      "the pack's OWN piece per key (w u b r g, m gold, a the artifact's blue-grey, l the land's brown — the template maps a colourless land's c → l and a colourless artifact's c → a): the rim is the text box's own edge in the frame's colour, so m15holostamp's one-geometry tint does not apply; no pairs (no pair masters)",
      "the hologram: the pack's 'Gray Holo Stamp' shape (lotr/stamp/gray.png) placed the same way, grown 1 px, painted opaque black — the pack draws its triangle 8–10 px HIGHER than the printed stamp (its top edge at 1915 px against the hole's 1924.6; LTR #302 / #313 print the Universes Beyond stamp, the hole 687–812 × 1924.6–1992.5) — then the Universes Beyond hole (lib/cards/holo-stamp.ts UB_STAMP_HOLE) plus 2 px cut to transparent and the 2 px round it painted black: no pixel of the capture is published; our own triangle bitmap (lib/cards/holo-stamp-art.ts) covers the cut",
    ],
  },
  // TODO 4.11 wave 2: the D&D Sourcebook's OVAL notch — the pack's one
  // piece, 1:1, its hologram oval cut (DND_NOTCH).
  dndsourcebookholostamp: {
    pack: DND_PACK,
    pieces: DND_NOTCH.pieces,
    keys: DND_NOTCH.keys,
    shape: DND_NOTCH.shape,
    placeAt: DND_NOTCH.placeAt,
    compositeSize: DND_NOTCH.compositeSize,
    oval: DND_NOTCH.oval,
    capture: DND_NOTCH.capture,
    cutMarginPx: 2,
    blackoutPx: 2,
    notes: [
      `the sourcebook's oval stamp notch (TODO 4.11): the pack's one 'Holo Stamp' (dndSourcebook/holo.png, 186x78) — the black border arched up into the page's foot round the hologram oval — at its bounds (657/1917 px), 1:1 (the pack is 1500 px native), cut to its box ${DND_NOTCH_BOX.width}x${DND_NOTCH_BOX.height} at ${DND_NOTCH_BOX.x},${DND_NOTCH_BOX.y} px — 1 px round the piece and 8 px past its foot, so the cut's black ring fits; below the piece the box is clear but for that ring, over the master's black border`,
      "keys = the masters' w u b r g m c, every one the same piece: the pack draws one stamp, and every master is the same page",
      `the hologram: the pack paints a capture of WotC's oval in the well (${DND_CAPTURE_PX.x}–${DND_CAPTURE_PX.x + DND_CAPTURE_PX.width} × ${DND_CAPTURE_PX.y}–${DND_CAPTURE_PX.y + DND_CAPTURE_PX.height} px, measured on the piece); the prints' oval (${DND_STAMP_OVAL_PX.width} × ${DND_STAMP_OVAL_PX.height} at ${DND_STAMP_OVAL_PX.x}, ${DND_STAMP_OVAL_PX.y} — the 49 stamped AFR / CLB prints, on the well's centre) plus 2 px is cut to transparent and the 2 px round it painted opaque black, and the importer holds every lit pixel of the well inside the cut and its ring: no pixel of the capture is published; our own oval bitmap (lib/cards/holo-stamp-art.ts) covers the cut`,
    ],
  },
  // TODO 4.11: the MUL Tarkir showcase's OVAL notch — the pack's one piece,
  // 1:1, its hologram oval cut (TARKIR_NOTCH).
  tarkirdragonholostamp: {
    pack: TARKIR_PACK,
    pieces: TARKIR_NOTCH.pieces,
    keys: TARKIR_NOTCH.keys,
    shape: TARKIR_NOTCH.shape,
    placeAt: TARKIR_NOTCH.placeAt,
    compositeSize: TARKIR_NOTCH.compositeSize,
    oval: TARKIR_NOTCH.oval,
    capture: TARKIR_NOTCH.capture,
    cutMarginPx: 2,
    blackoutPx: 2,
    notes: [
      `the Tarkir showcase's oval stamp notch (TODO 4.11): the pack's one 'Holo Stamp' (tarkir/stamp.png, 225x101) — the text box's bottom rim arched over a black well round the hologram oval — at its stampBounds (638/1888 px), 1:1 (the pack is 1500 px native), cut to its box ${TARKIR_NOTCH_BOX.width}x${TARKIR_NOTCH_BOX.height} at ${TARKIR_NOTCH_BOX.x},${TARKIR_NOTCH_BOX.y} px — 1 px round the piece and 8 px past its foot, so the cut's black ring fits; below the piece the box is clear but for that ring, over the master's black border`,
      "keys = the masters' w u b r g m c, every one the same piece: the pack draws one stamp for every colour, and the masters' rim under it is the same pixels on every key (they differ only on the wings)",
      `the hologram: the pack paints a capture of WotC's oval in the well (${TARKIR_CAPTURE_PX.x}–${TARKIR_CAPTURE_PX.x + TARKIR_CAPTURE_PX.width} × ${TARKIR_CAPTURE_PX.y}–${TARKIR_CAPTURE_PX.y + TARKIR_CAPTURE_PX.height} px, measured on the piece); the prints' oval (${TARKIR_STAMP_OVAL_PX.width} × ${TARKIR_STAMP_OVAL_PX.height} at ${TARKIR_STAMP_OVAL_PX.x}, ${TARKIR_STAMP_OVAL_PX.y} — MUL #1 / #60 / #131 / #190, on the well's centre) plus 2 px is cut to transparent and the 2 px round it painted opaque black, and the importer holds every lit pixel of the well inside the cut and its ring: no pixel of the capture is published; our own oval bitmap (lib/cards/holo-stamp-art.ts) covers the cut`,
    ],
  },
  // TODO 4.11 wave 2: the Doctor Who TARDIS's triangle notch — the pack's
  // one piece, 1:1, its capture blacked out, the Universes Beyond hole cut
  // (TARDIS_NOTCH).
  tardisholostamp: {
    pack: TARDIS_PACK,
    pieces: TARDIS_NOTCH.pieces,
    keys: TARDIS_NOTCH.keys,
    shape: TARDIS_NOTCH.shape,
    placeAt: TARDIS_NOTCH.placeAt,
    compositeSize: TARDIS_NOTCH.compositeSize,
    triangle: UB_STAMP_HOLE,
    capture: TARDIS_NOTCH.capture,
    blackoutCapturePx: 1,
    cutMarginPx: 2,
    blackoutPx: 2,
    notes: [
      `the TARDIS showcase's triangle stamp notch (TODO 4.11): the pack's one 'Gold Holo Stamp' (tardis/stamp.png, 176x80) — a black trapezoid over the box's foot round the stamp — at its stampBounds (662/1909 px), 1:1 (the pack is 1500 px native), cut to its box ${TARDIS_NOTCH_BOX.width}x${TARDIS_NOTCH_BOX.height} at ${TARDIS_NOTCH_BOX.x},${TARDIS_NOTCH_BOX.y} px — 1 px round the piece and 9 px past its foot, so the stamp hole's apex (1992.5) and its ring fit; below the piece the box is clear but for that ring, over the master's black border`,
      "keys = the masters' w u b r g m c and the ten pairs, every one the same piece (every master is the same box under the trapezoid)",
      "the hologram: the pack paints a capture of WotC's hologram in the trapezoid (its triangle 693–806 × 1922–1985 px) — every lit pixel of it is painted opaque black first (grown 1 px), then the Universes Beyond hole (lib/cards/holo-stamp.ts UB_STAMP_HOLE: the run's prints set the stamp there, 686–816 px wide at row 1925, 708–793 at 1950, the apex on 1990–1991) plus 2 px cut to transparent and the 2 px round it painted black: no pixel of the capture is published; our own triangle bitmap (lib/cards/holo-stamp-art.ts) covers the cut. The pack's 'Gray Holo Stamp' is not read",
    ],
  },
  // TODO 4.11 wave 2: the dossier's OVAL notch — the pack's one piece,
  // placed and downscaled with the card, its capture blacked out, the
  // prints' oval cut (DOSSIER_NOTCH).
  dossierholostamp: {
    pack: DOSSIER_PACK,
    pieces: DOSSIER_NOTCH.pieces,
    keys: DOSSIER_NOTCH.keys,
    shape: DOSSIER_NOTCH.shape,
    placeAt: DOSSIER_NOTCH.placeAt,
    compositeSize: DOSSIER_NOTCH.compositeSize,
    oval: DOSSIER_NOTCH.oval,
    capture: DOSSIER_NOTCH.capture,
    clearAboveY: DOSSIER_NOTCH.clearAboveY,
    blackoutCapturePx: 2,
    cutMarginPx: 2,
    blackoutPx: 2,
    notes: [
      `the dossier's oval stamp notch (TODO 4.11): the pack's one 'Holo Stamp' (dossier/stamp.png, 295x134) — the black border arched up into the page's foot round the hologram — placed at its bounds (857/2010, 2540/2814) on a clear 2010x2814 canvas, downscaled ONCE with the canvas (Lanczos, as the masters are) and cut to its box ${DOSSIER_NOTCH_BOX.width}x${DOSSIER_NOTCH_BOX.height} at ${DOSSIER_NOTCH_BOX.x},${DOSSIER_NOTCH_BOX.y} px of the 1500x2100 card, drawn 1:1 from there; the arch is print's (its top 1908 px against print's 1909, its feet 1942–1945 against 1943–1946)`,
      "keys = the masters' w u b r g m c and the ten pairs, every one the same piece (the masters and the pair masters are the same page under the arch)",
      `the hologram: the pack paints a capture of WotC's oval in the well (${DOSSIER_CAPTURE_PX.x}–${DOSSIER_CAPTURE_PX.x + DOSSIER_CAPTURE_PX.width} × ${DOSSIER_CAPTURE_PX.y}–${DOSSIER_CAPTURE_PX.y + DOSSIER_CAPTURE_PX.height} px once placed and downscaled), 5–7 px below where print sets it — every lit pixel of it is painted opaque black first (grown 2 px; print's well is black round the hologram), then the prints' oval (${DOSSIER_STAMP_OVAL_PX.width} × ${DOSSIER_STAMP_OVAL_PX.height} at ${DOSSIER_STAMP_OVAL_PX.x}, ${DOSSIER_STAMP_OVAL_PX.y} — 29 stamped MKM prints, all within 1 px) plus 2 px is cut to transparent and the 2 px round it painted black: no pixel of the capture is published; our own oval bitmap (lib/cards/holo-stamp-art.ts) covers the cut`,
    ],
  },
  // TODO 4.11 wave 2: the Enchanting Tales OVAL notch — the pack's piece per
  // colour, resampled once to its HD box, its hologram oval cut
  // (ETALES_NOTCH).
  enchantingtalesholostamp: {
    pack: ETALES_PACK,
    pieces: ETALES_NOTCH.pieces,
    keys: ETALES_NOTCH.keys,
    shape: ETALES_NOTCH.shape,
    nativeSize: ETALES_NOTCH.nativeSize,
    placeAt: ETALES_NOTCH.placeAt,
    compositeSize: ETALES_NOTCH.compositeSize,
    oval: ETALES_NOTCH.oval,
    capture: ETALES_NOTCH.capture,
    cutMarginPx: 2,
    blackoutPx: 0,
    wellTone: ETALES_WELL_TONE,
    notes: [
      `the Enchanting Tales oval stamp notch (TODO 4.11 wave 2): the pack's 'Holo Stamp' per colour (enchantingTales/stamp/<k>.png, 306x176) — the text box's bottom rim arched up over a well in the footer's own tone round the hologram oval — drawn at its stampBounds (890/2548, 229x132 of 2010x2814 = 664.2/1901.5, 170.9x98.5 px at HD): resampled ONCE (Lanczos) to ${ETALES_NOTCH.placeAt.width}x${ETALES_NOTCH.placeAt.height} and placed on print at ${ETALES_NOTCH.placeAt.x},${ETALES_NOTCH.placeAt.y} px — 3 px up with the master's lower block (ETALES_LOWER_RECUT) and 2 px right (the 45 stamped prints' arch centred on 751.5 px) — cut to its box ${ETALES_NOTCH_BOX.width}x${ETALES_NOTCH_BOX.height} at ${ETALES_NOTCH_BOX.x},${ETALES_NOTCH_BOX.y} px (1 px round the piece)`,
      "keys = the masters' w u b r g m and c (the white piece, as the c master is the white frame)",
      `the hologram: the pack paints a capture of WotC's oval in the well; the prints' oval (${ETALES_STAMP_OVAL_PX.width} × ${ETALES_STAMP_OVAL_PX.height} at ${ETALES_STAMP_OVAL_PX.x}, ${ETALES_STAMP_OVAL_PX.y} — the 45 stamped WOT prints) plus 2 px is cut to transparent and the importer holds every lit pixel of the oval's box inside the cut: no pixel of the capture is published; the well round the cut keeps the footer's own tone (no black ring, blackoutPx 0: print draws none); our own oval bitmap (lib/cards/holo-stamp-art.ts) covers the cut`,
      "the well flattened into the master's footer tone (ETALES_WELL_TONE: every pixel within 12 levels of the same key's footer, read at 750, 2060 on the master, takes it, alpha kept; from the piece's row 51 — card row 1948, the master's flat footer — every pixel of the piece outside the cut is the footer tone, opaque; what the piece leaves clear stays clear): the pack draws the well's outer ellipse 4–8 levels darker than the footer with a light low-α fringe, a faint line print does not have",
    ],
  },
  lotrscrollholostamp: {
    pack: SCROLL_PACK,
    pieces: SCROLL_NOTCH.pieces,
    keys: SCROLL_NOTCH.keys,
    shape: SCROLL_NOTCH.shape,
    placeAt: SCROLL_NOTCH.placeAt,
    compositeSize: SCROLL_NOTCH.compositeSize,
    triangle: UB_STAMP_HOLE,
    cutMarginPx: 2,
    blackoutPx: 2,
    stampShape: `${SCROLL}/stamps/gray.png`,
    notes: [
      `the scroll showcase's triangle stamp notch (TODO 4.11): the pack's per-colour 'Holo Stamp' (scroll/stamps/<k>.png, 349x181) — the text box's parchment edge stepped up and round a black trapezoid over the stamp — placed at its stampBounds (834/2010, 2518/2814) on a clear 2010x2814 canvas, downscaled ONCE with the canvas (Lanczos, as the masters are) and cut to its box ${SCROLL_NOTCH_BOX.width}x${SCROLL_NOTCH_BOX.height} at ${SCROLL_NOTCH_BOX.x},${SCROLL_NOTCH_BOX.y} px of the 1500x2100 card, drawn 1:1 from there`,
      "the pack's OWN piece per key (w u b r g, m gold, a the artifact's light blue, l the land's brown — the template maps a colourless land's c → l and a colourless artifact's c → a): the scroll's rim is textured parchment in the frame's colour, not one flat bar, so m15holostamp's one-geometry tint does not apply; no pairs (no pair masters)",
      "the triangle — the Universes Beyond stamp's (lib/cards/holo-stamp.ts UB_STAMP_HOLE: the scroll prints wear the same physical stamp, LTR #457 / #470 / #700, LTC #412: 705–797 px wide at row 1950, apex 1992–1993, against the hole's 708–793 / 1992.5) plus 2 px — is cut to transparent, and the 2 px round the cut painted the trapezoid's opaque black: every colour piece holds a capture of the hologram there, drawn ~2 px larger and higher than the stamp (the pack's 'Gray Stamp' gray.png, 680–822 × 1914–1997 px once placed and downscaled, against the hole's 680.4–818.8 × 1917.9–1999.2), which is never published; our own triangle bitmap (lib/cards/holo-stamp-art.ts) covers the cut with its 3 px black margin. gray.png is read only by the check: placed and downscaled like a piece, it reaches α ≤ 8 outside the cut and its ring",
    ],
  },
  m15pwholostamp: {
    pack: "Planeswalker 'Holo Stamps' (packPlaneswalkerHoloStamps.js)",
    shape: {
      src: "img/frames/planeswalker/holo/u.png",
      size: { width: 182, height: 107 },
      bounds: { leftPct: 43.94, topPct: 90.15, widthPct: 12.14, heightPct: 5.1 },
      arc: [0, 117, 190],
    },
    keys: ["w", "u", "b", "r", "g", "m", "c"],
    barOf: { w: "m15pw/w", u: "m15pw/u", b: "m15pw/b", r: "m15pw/r", g: "m15pw/g", m: "m15pw/m", c: "m15pw/c" },
    barSample: M15PW_BAR_SAMPLE,
    oval: { leftPct: 45.54, topPct: 91.72 - (7 / 2100) * 100, widthPct: 8.94, heightPct: 3.2 },
    cutMarginPx: 2,
    notes: [
      "the planeswalker's notch (TODO 4.9c): CC's walker arch — a flat rim under a black line, no bevel, as the walker's box prints — at CC's bounds 43.94/90.15/12.14×5.1 % (659–841 × 1893–2000 px, 1:1 at HD)",
      "the same recipe as m15holostamp over the walker masters' bars (x 750, rows 1928–1935): CC's own walker rims match them exactly, so w u b r g m reproduce CC's pieces outside the cut; c — the colourless walker's grey (181,181,181), which CC has no piece for — is sampled like the rest",
      "the oval sits 7 px higher than M15's (45.54/91.39/8.94×3.2 %: 683–817 × 1919–1986), where CC's walker piece holds its hologram; cut to transparent plus 2 px like M15's",
    ],
  },
};

/** The flat bar colour of a master (8-bit RGBA, W × H) at the sample: the
 *  mean of the rows, every pixel within the tolerance of it, or a throw. */
export function sampleBar(master, width, sample) {
  const [r0, r1] = sample.rows;
  const px = [];
  for (let y = r0; y <= r1; y += 1) {
    const o = (y * width + sample.x) * 4;
    if (master[o + 3] !== 255) throw new Error(`bar sample at (${sample.x}, ${y}) is not opaque (α ${master[o + 3]})`);
    px.push([master[o], master[o + 1], master[o + 2]]);
  }
  const mean = [0, 1, 2].map((c) => Math.round(px.reduce((s, p) => s + p[c], 0) / px.length));
  for (const p of px) {
    for (let c = 0; c < 3; c += 1) {
      if (Math.abs(p[c] - mean[c]) > sample.tolerance) throw new Error(`bar sample at x ${sample.x} rows ${r0}–${r1} is not flat: ${p} vs ${mean}`);
    }
  }
  return mean;
}

/**
 * A master's bar at EVERY column of a notch shape's bounds (a per-column
 * tint, `rampKeys`): `sample`'s rows read at each card x from the shape's
 * left edge across its width, each column flat within the tolerance (the
 * untilted ramp lerps two flat bars, so every column is flat) — one
 * `[r, g, b]` per piece column, or a throw. The mono keys read one column
 * (sampleBar); this is the pair's bar as it is, never two constants lerped.
 */
export function sampleBarColumns(master, width, sample, shape) {
  const origin = rectPx(shape.bounds, OUT_W, OUT_H);
  const out = [];
  for (let i = 0; i < shape.size.width; i += 1) out.push(sampleBar(master, width, { ...sample, x: origin.x + i }));
  return out;
}

/** True when `tint` is a per-column tint (one `[r, g, b]` per piece
 *  column) rather than one flat colour. */
export function isColumnTint(tint) {
  return Array.isArray(tint[0]);
}

/** The tint at a piece column: the column's own for a per-column tint,
 *  the one flat colour otherwise. */
export function tintAt(tint, x) {
  return isColumnTint(tint) ? tint[x] : tint;
}

/**
 * The gap between two bars at every column, for the shared-bar check: the
 * largest channel difference and the first column it is found at. Both
 * are per-column tints of the same length.
 */
export function columnTintGap(a, b) {
  let max = 0;
  let at = null;
  for (let x = 0; x < a.length; x += 1) {
    for (let c = 0; c < 3; c += 1) {
      const d = Math.abs(a[x][c] - b[x][c]);
      if (d > max) {
        max = d;
        at = x;
      }
    }
  }
  return { max, at };
}

/**
 * One notch key from the shape piece (8-bit RGBA at its native size): each
 * pixel decomposed into the bevel's white, the rim (`arc`) and black —
 * w = r / 255 (only the white has red), a = (b − 255 w) / arc.b, k = the
 * rest — and recomposed with `tint` for the rim (one flat colour, or the
 * pixel's own column of a per-column tint), the alpha untouched; then every
 * pixel whose centre lies inside the cut ellipse made transparent. The
 * ellipse is the slot's oval grown by the margin, in the piece's own pixels
 * (CC's bounds rounded to whole card px: the piece is 1:1 at HD).
 */
export function buildNotch(shape, piece, tint, oval, cutMarginPx) {
  const { width, height } = shape.size;
  const out = Buffer.alloc(width * height * 4);
  const [, , arcB] = shape.arc;
  const perColumn = isColumnTint(tint);
  if (perColumn && tint.length !== width) throw new Error(`buildNotch: a per-column tint needs ${width} columns, got ${tint.length}`);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    const a = piece[o + 3];
    if (a === 0) continue;
    const t = perColumn ? tint[i % width] : tint;
    const w = Math.min(1, piece[o] / 255);
    const arc = Math.max(0, Math.min(1 - w, (piece[o + 2] - 255 * w) / arcB));
    for (let c = 0; c < 3; c += 1) out[o + c] = Math.round(Math.min(255, 255 * w + t[c] * arc));
    out[o + 3] = a;
  }
  cutOval(out, shape, oval, cutMarginPx);
  return out;
}

/**
 * Whether a piece pixel's centre lies inside a notch's cut grown by `grow`
 * px — the slot's oval (a card-percent rect: an ellipse) or a round
 * triangle in card px (`{ points, radius }`: the Universes Beyond stamp,
 * TODO 4.25), each grown by the margin first.
 */
export function cutInside(shape, cut, marginPx) {
  const origin = rectPx(shape.bounds, OUT_W, OUT_H);
  if (cut.points) {
    return (x, y, grow = 0) => roundTriangleDistance(cut, x + 0.5 + origin.x, y + 0.5 + origin.y) <= marginPx + grow;
  }
  const e = cutEllipse(shape, cut, marginPx);
  return (x, y, grow = 0) => {
    const dx = (x + 0.5 - e.cx) / (e.rx + grow);
    const dy = (y + 0.5 - e.cy) / (e.ry + grow);
    return dx * dx + dy * dy <= 1;
  };
}

/** The cut a notch folder declares: its triangle, else its oval. */
export const notchCutOf = (def) => def.triangle ?? def.oval;

/**
 * A shape piece that is NOT 1:1 at HD (`shape.nativeSize`: the Universes
 * Beyond stamp is 299 × 137 on a 2015-wide card) brought to `shape.size`:
 * the caller resamples it (Lanczos), and this takes the resampling's
 * ringing back out of the flat regions — an opaque pixel within `slack`
 * levels of the rim colour becomes the rim colour, one within `slack` of
 * black becomes black — so the rim decomposes exactly as a native piece's
 * does. In place.
 */
export function snapResampledPiece(shape, piece, slack = 10) {
  const [ar, ag, ab] = shape.arc;
  for (let o = 0; o < piece.length; o += 4) {
    if (piece[o + 3] < 250) continue;
    if (Math.abs(piece[o] - ar) <= slack && Math.abs(piece[o + 1] - ag) <= slack && Math.abs(piece[o + 2] - ab) <= slack) {
      piece[o] = ar;
      piece[o + 1] = ag;
      piece[o + 2] = ab;
      piece[o + 3] = 255;
    } else if (piece[o] <= slack && piece[o + 1] <= slack && piece[o + 2] <= slack) {
      piece[o] = 0;
      piece[o + 1] = 0;
      piece[o + 2] = 0;
      piece[o + 3] = 255;
    }
  }
  return piece;
}

/** The cut ellipse of a shape's slot oval, in the piece's pixels. */
export function cutEllipse(shape, oval, marginPx) {
  const origin = rectPx(shape.bounds, OUT_W, OUT_H);
  const cx = ((oval.leftPct + oval.widthPct / 2) / 100) * OUT_W - origin.x;
  const cy = ((oval.topPct + oval.heightPct / 2) / 100) * OUT_H - origin.y;
  return { cx, cy, rx: ((oval.widthPct / 100) * OUT_W) / 2 + marginPx, ry: ((oval.heightPct / 100) * OUT_H) / 2 + marginPx };
}

/** Make every pixel whose centre lies inside the cut (the ellipse, or the
 *  round triangle — cutInside) transparent. */
export function cutOval(buf, shape, oval, marginPx) {
  const { width, height } = shape.size;
  const inside = cutInside(shape, oval, marginPx);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (inside(x, y)) buf.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
    }
  }
}

/**
 * What the importer (and the unit test, on the published objects) checks
 * on a built notch (8-bit RGBA at the shape's size, pure):
 *   • `cutClear` — every pixel inside the cut ellipse is fully transparent;
 *   • `ringBlack` — the pixels in the 4 px band outside the cut are CC's
 *     black (r + g + b ≤ 60 at any alpha: the piece's bottom row is a
 *     half-transparent black) or transparent: nothing of the hologram
 *     survives at the cut's edge;
 *   • `foot` — the rim's foot (the piece's row at the bar's height, at
 *     every column of both feet where CC's piece is solid rim: NOTCH_FOOT's
 *     runs, or one point `{ x, y }`) is the tint of that column, so the
 *     arch joins the master's bar without a seam — on a pair, the bar's
 *     own ramp colour on each side;
 *   • `alphaKept` — outside the cut, the alpha is the shape piece's.
 */
export function notchFindings(buf, shape, piece, tint, oval, cutMarginPx, foot) {
  const { width, height } = shape.size;
  const inside = cutInside(shape, oval, cutMarginPx);
  let cutClear = true;
  let ringBlack = true;
  let alphaKept = true;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (inside(x, y, 0)) {
        if (buf[o + 3] !== 0 || buf[o] || buf[o + 1] || buf[o + 2]) cutClear = false;
        continue;
      }
      if (piece && buf[o + 3] !== piece[o + 3]) alphaKept = false;
      if (inside(x, y, 4) && buf[o + 3] !== 0 && buf[o] + buf[o + 1] + buf[o + 2] > 60) ringBlack = false;
    }
  }
  let footOk = true;
  let footPx = null;
  let footFailure = null;
  for (const x of footColumns(foot)) {
    const fo = (foot.y * width + x) * 4;
    const have = [buf[fo], buf[fo + 1], buf[fo + 2], buf[fo + 3]];
    const want = tintAt(tint, x);
    footPx ??= have;
    if (have[3] === 255 && [0, 1, 2].every((c) => Math.abs(have[c] - want[c]) <= 1)) continue;
    footOk = false;
    footFailure = `the rim's foot at (${x}, ${foot.y}) is ${have}, the tint there is ${want}`;
    break;
  }
  const failures = [];
  if (!cutClear) failures.push("a pixel inside the cut ellipse is not transparent");
  if (!ringBlack) failures.push("a pixel in the 4 px band outside the cut is neither CC's black nor transparent");
  if (footFailure) failures.push(footFailure);
  if (piece && !alphaKept) failures.push("the alpha outside the cut differs from the shape piece's");
  return { cutClear, ringBlack, footOk, footPx, alphaKept, failures };
}

/** The piece columns a foot reads: the runs' every column, or the one x. */
export function footColumns(foot) {
  if (foot.runs) return foot.runs.flatMap(([x0, x1]) => Array.from({ length: x1 - x0 + 1 }, (_, i) => x0 + i));
  return [foot.x];
}

/**
 * Whether CC's piece is solid rim (exactly `arc`, opaque) at every column
 * a foot reads — the importer refuses a foot the source piece doesn't
 * hold, so the published-object test (which has no piece) reads real rim.
 */
export function footRunsSolid(shape, piece, foot) {
  const { width } = shape.size;
  const [ar, ag, ab] = shape.arc;
  const off = [];
  for (const x of footColumns(foot)) {
    const o = (foot.y * width + x) * 4;
    if (piece[o] !== ar || piece[o + 1] !== ag || piece[o + 2] !== ab || piece[o + 3] !== 255) off.push(x);
  }
  return off;
}

/** Where a notch's rim foot is read (piece px): the row at the bar's
 *  height, and the columns of BOTH feet that are solid rim in CC's piece
 *  there (measured on the U pieces, 2026-10-03; footRunsSolid holds it) —
 *  654 + 4…12 and 654 + 180…188 at HD on M15, each foot inside the pair
 *  ramp on its own side. */
export const NOTCH_FOOT = Object.freeze({
  m15holostamp: Object.freeze({ y: 44, runs: Object.freeze([Object.freeze([4, 12]), Object.freeze([180, 188])]) }),
  // The Universes Beyond notch (TODO 4.25): both feet of the resampled
  // piece, 638 + 2…10 and 638 + 212…220 at HD.
  m15ubholostamp: Object.freeze({ y: UB_NOTCH_FOOT_Y, runs: Object.freeze([Object.freeze([2, 10]), Object.freeze([212, 220])]) }),
  m15pwholostamp: Object.freeze({ y: 36, runs: Object.freeze([Object.freeze([2, 12]), Object.freeze([170, 181])]) }),
});

/** Every Card Conjurer file a notch folder reads. */
export function notchSourceFiles(def) {
  // A notch made of the pack's own piece per key (TODO 4.11: the scroll).
  if (def.pieces) {
    const pieces = Object.values(def.pieces);
    // …and a toned piece's mask (the LOTR ring's Rules mask, TODO 4.11).
    const masks = pieces.flatMap((src) => [...Object.values(sourceTonesOf(src)?.masks ?? {}), ...[...Object.values(sourceTonesOf(src)?.diff ?? {}), ...Object.values(sourceTonesOf(src)?.box ?? {})].map((d) => d.file).filter(Boolean)]);
    return [...new Set([...pieces, ...masks, ...(def.stampShape ? [def.stampShape] : [])])].sort();
  }
  return [def.shape.src];
}

/** A per-column tint in three words: its colour at the piece's first,
 *  centre and last column, with their card x. */
export function describeColumnTint(def, tint) {
  const origin = rectPx(def.shape.bounds, OUT_W, OUT_H);
  const w = def.shape.size.width;
  const at = (i) => `${tint[i].join(",")} at x ${origin.x + i}`;
  return `${at(0)} → ${at(Math.floor(w / 2))} → ${at(w - 1)}`;
}

/** How provenance prints one notch key's recipe: a flat tint names its
 *  colour and sample column; a per-column tint (a pair) names the bar's
 *  ramp across the piece and the masters that share it. */
export function describeNotch(def, key, tint) {
  const origin = rectPx(def.shape.bounds, OUT_W, OUT_H);
  const rows = `rows ${def.barSample.rows[0]}–${def.barSample.rows[1]}`;
  const rim = isColumnTint(tint)
    ? `rim tinted per column to ${def.barOf[key]}.png's bar across x ${origin.x}–${origin.x + def.shape.size.width - 1} (${rows}; ${describeColumnTint(def, tint)} — the pinline's ${rampName(PAIR_RAMPS.pinline)}), the same bar on ${(def.barSharedBy?.[key] ?? []).map((rel) => `${rel}.png`).join(", ")}`
    : `rim tinted to ${def.barOf[key]}.png's bar (${tint.join(",")}) sampled at x ${def.barSample.x}, ${rows}`;
  return [
    `${def.shape.src} (the arch's geometry: bevel, rim and black) at ${def.shape.bounds.leftPct}/${def.shape.bounds.topPct}/${def.shape.bounds.widthPct}×${def.shape.bounds.heightPct} %`,
    rim,
    def.triangle
      ? `the triangle ${def.triangle.points.map((p) => p.join(",")).join(" / ")} px, corner radius ${def.triangle.radius}, plus ${def.cutMarginPx} px cut to transparent`
      : `the oval ${def.oval.leftPct}/${def.oval.topPct.toFixed(2)}/${def.oval.widthPct}×${def.oval.heightPct} % plus ${def.cutMarginPx} px cut to transparent`,
  ];
}
