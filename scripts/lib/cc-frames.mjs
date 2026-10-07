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
import { PAIR_RAMPS, TWO_COLOR_PAIRS, rampName, rampShare } from "./pair-ramp.mjs";

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
    { ...M20_TOKEN_SOLID_TYPE_PILL, mask: typeMask },
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
      }
    : perColor((k) => [layer(m20TokenFrame(dir, H, k))]);
  const notes = artifact
    ? [
        `source: CC '${H}' token pack Artifact Frame (tokenFrameA${H}.png) — TODO 4.50`,
        `coloured artifact tokens = the silver artifact master whole + the colour's master through the pack's Pinline mask (${M20_TOKEN_PINLINE[height]}): silver pills and box, the colour on the rims, pinline and strip, as TDSK #7 / TSOC #8 print; NOT 4.16's m15artifact recipe (the token pills stay silver)`,
      ]
    : [
        `source: CC '${H}' token pack (tokenFrame{W,U,B,R,G,M}${H}.png) — the full-art token design, M20 → today (TODO 4.48)`,
        `colourless = CC's frameC.png (charcoal pills, box α≈166; TEOE #1 Sliver, TMH3 #38 Eldrazi Spawn)`,
      ];
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

const MDFC_STRIP_NOTE =
  "the flipside strip RIDERS (TODO 5.1c, strip/<key>.png): this template's masters' tabs cut through CC's Flipside mask (reminder.svg, the whole tab — the ◀ and the outline stay dark), eroded 1 px so the cut runs inside the tab's dark outline and snapped to the HD grid's 2 × 2 px blocks so the 750 bake's 2:1 resample reads whole blocks (a piece over its own master is byte-identical at HD and at 750); drawn by both renderers over the strip the master paints, keyed by the OTHER face's colour (the prints paint the strip in the colour of the face it describes: STX #147, the pathways, KHM #114), only when that key differs from the master's own; `l` = the grey land modal's tab (the land pair's c master) for a two-colour land other face (MH3 #252–261's hybrid fronts) and, on a back, a front in the hybrid dress";

const DFC_PAIR_NOTE =
  "two-colour pair masters (TODO 5.1d / 5.12): 4.6b's recipe over this body's own Card Conjurer pack files and masks — the gold frame whole, the text box lerped across the UNTILTED rules ramp (45→57 %W) through the pack's Rules mask, the pinline across the pinline ramp (40→60) through the pack's Pinline mask, by a premultiplied lerp (scripts/lib/pair-ramp.mjs), first canonical colour on the left (WU WB UB UR BR BG RG RW GW GU); measured on the prints' title rings (per-row crossings at HD): LCI #233 41.7 / 49.5 / 57.4, MH3 #252 42.2 / 51.9 / 59.7, the Innistrad printings (MID #218 / #231, INR #241) 45.5 / 51 / 56 — the 40→60 ramp of the FDN / TLA prints serves every DFC face";

/**
 * template → { colors: colour → layers, finish?, plates?, symbols?, shield?,
 * ptCut?, pieces?, maskInputs?, recut?, recutUp?, bridge?, tones?, excluded?,
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
export const CC_TEMPLATES = {
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
    notes: [
      "source: CC 'Adventure' (packAdventure.js): the M15 frame with the storybook's two pages — replaces the MSE composite (build-adventure-frame.mjs: the MSE m15 master + double_page + null_page), whose window ran 10 / 6 px narrow and whose paper was re-drawn",
      "colourless = CC's 'Artifact Frame' (adventure/a.png) as a RENDER STAND-IN only (owner decision 2026-09-29): no colourless adventure was ever printed and the pack has no colourless frame, so the key keeps a master for a stray colourless card and is never offered (no reference, never ticked)",
      "P/T plate = M15's (m15/pt/<k>.png): the pack draws CC's m15PT<K>.png at M15's bounds, so the ADVENTURE profile keeps M15's plate and box",
      "the book masks (bookLeft, bookLeftMulticolor, bookRight) are 4.26's per-page colour inputs, not published",
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
export function roundCornersRgba8(buf, width, height, radius) {
  applyCardCornerMask(buf, width, height, radius);
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
  const moved = l.dy ? ` moved down ${l.dy} px` : "";
  // A pair's box (TODO 4.56): re-tinted twice, the two lerped across a ramp.
  const tintAt = (t) => `${t.src} at (${t.x}, ${t.y})`;
  const tint = l.retint
    ? l.retint.tintOfRight
      ? ` re-tinted from ${l.retint.from.join(",")} to the tints of (${tintAt(l.retint.tintOf)} | ${tintAt(l.retint.tintOfRight)} across ${rampName(l.retint.ramp)})`
      : ` re-tinted from ${l.retint.from.join(",")} to the tint of ${tintAt(l.retint.tintOf)}`
    : "";
  const masks = Array.isArray(l.mask) ? l.mask.join(" ∩ ") : l.mask;
  const mask = masks ? ` ${l.replace ? "replacing through" : l.invert ? "outside" : "through"} ${masks}` : "";
  const gain = l.gain !== undefined ? ` with its alpha ×${l.gain.toFixed(4)} (clamped at 1)` : "";
  // A pair layer (pairLayer, TODO 4.6b): two files blended across a ramp.
  const src = l.right ? `(${l.src} | ${l.right} across ${rampName(l.ramp)})` : l.src;
  // A layer at CC's bounds (4.6f's floating crown pieces), and CC's erase.
  const at = l.at ? ` at ${l.at.leftPct}/${l.at.topPct}/${l.at.widthPct}×${l.at.heightPct} %` : "";
  if (l.erase) return `${src}${at} erased from the layers below (CC's erase: destination-out)`;
  if (l.recolour) {
    const ramp = l.lumaRamp ? `, weighted by its own luminance from ${l.lumaRamp[0]} (0) to ${l.lumaRamp[1]} (full)` : "";
    return `${src}${mask} recolouring the layers below (their alpha kept)${l.opacity !== undefined ? ` at ${Math.round(l.opacity * 100)}%` : ""}${ramp}`;
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
export const LEGENDARY_MASTER_KEYS = [...COLORS, ...TWO_COLOR_PAIRS, ...TWO_COLOR_PAIRS.map((pair) => `${pair}-h`)].map(legendaryKey);

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
  // A pack's own bitmaps published beside the masters, and the masks kept
  // for a later recipe (4.21c's saga).
  for (const src of Object.values(def.pieces ?? {})) files.add(src);
  for (const src of Object.values(def.maskInputs ?? {})) files.add(src);
  // A masked tone's mask (TODO 5.1a, the transform backs).
  for (const key of builtColors(def)) {
    for (const tone of tonesFor(def, key)) if (tone.mask) files.add(tone.mask);
  }
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
// overlay band over the extendedart masters (MSE-built, in git — the CC
// pieces never join them): composited 1:1 at 1500×2100 (every piece is
// 1500-native), cropped to the outline's rows 0–259. One key per master:
// the colours, gold, and the colourless grey (CC's C crown over our MSE
// colourless master; no pair keys — the frame draws no pair masters, so a
// two-colour legend wears the gold crown). The band's slot sits 10 px lower
// than CC's bounds (lib/cards/template-layout.ts EXTENDED_CROWN): our MSE
// master's title bar tops out 0.45 %H below the print's.
export const EXTENDED_CROWN_BAND = Object.freeze({
  source: CROWNS,
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "c"]),
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
  return [
    placed(BORDERLESS_CROWN.eraseSrc, EXTENDED_CROWN_BAND.cover),
    placed(floatingCrown(key), EXTENDED_CROWN_BAND.crown),
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

/** The overlay bands the importer builds, by bucket folder. */
export const CC_OVERLAY_BANDS = {
  // 4.6f (wave 2b): the extended-art crown — a generic band (`layers` /
  // `findings`), composited 1:1 at the card's size.
  extendedcrown: {
    pack: "M15 'Legend Crowns (Floating)' (packM15LegendCrownsFloating.js), drawn as CC's autoExtendedArtFrame does (creator-23.js:1311–1362, makeExtendedArtFrameByLetter :2296–2365)",
    band: EXTENDED_CROWN_BAND,
    keys: EXTENDED_CROWN_BAND.keys,
    layers: extendedCrownLayers,
    findings: extendedCrownFindings,
    notes: [
      "the extended-art legendary crown (TODO 4.6f, wave 2b): CC's floating crown over its BLACK 'Crown Border Cover' strip (drawn, not erased — the borderless frame erases it) with the outline ON TOP, as autoExtendedArtFrame draws them, composited 1:1 at 1500x2100 (every piece 1500-native) and cropped to rows 0–259 (the outline's extent); an overlay band over the extendedart masters, which are MSE-built and in git — Card Conjurer pixels never join them",
      "keys = the seven colour keys of the extendedart masters: w u b r g, m (gold: a three-colour card, or a pair, which this frame draws gold — no pair masters), c (CC's colourless crown over our MSE colourless master; CC's own rule would pick the artifact crown for a colourless card, which is the m15artifact dress's call); CC's unlisted 'Artifact Legend Crown (Alt)' is not used",
      "the band's slot sits 10 px (0.476 %H) lower than CC's bounds (lib/cards/template-layout.ts EXTENDED_CROWN): the MSE master's title bar tops out at 5.43 %H where FDN #442 / #455 and CC's m15/new/extended put it at 4.98, so the crown's hole hugs OUR bar; 4.7's CC-built extendedart master takes the offset back to 0",
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
export const CC_RIDERS = {
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
export function crownBandRecipe(key) {
  if (TWO_COLOR_PAIRS.includes(key)) {
    const [a, b] = key.split("");
    return {
      cover: CROWN_COVER_SRC,
      left: `${CROWN_BAND.source}/${a}.png`,
      right: `${CROWN_BAND.source}/${b}.png`,
      ramp: PAIR_RAMPS.crown,
    };
  }
  if (!CROWN_BAND.keys.includes(key)) throw new Error(`crownBandRecipe: no crown for key ${key}`);
  return { cover: CROWN_COVER_SRC, left: `${CROWN_BAND.source}/${key}.png`, right: null, ramp: null };
}

const pctBox = (r) => `${r.leftPct}/${r.topPct}/${r.widthPct}×${r.heightPct} %`;

/** How provenance prints a crown band key's recipe. */
export function describeCrownBand(recipe) {
  const crown = recipe.right
    ? `${recipe.left} ⟷ ${recipe.right} lerped through ${rampName(recipe.ramp)}`
    : recipe.left;
  return [`${recipe.cover} over ${pctBox(CROWN_BAND.cover)}`, `${crown} at ${pctBox(CROWN_BAND.crown)}`];
}

/** Every Card Conjurer file the crown band reads. */
export function crownBandSourceFiles(keys = CROWN_BAND_KEYS) {
  const files = new Set();
  for (const key of keys) {
    const recipe = crownBandRecipe(key);
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
        [`m15/${pair}-h`, `m15artifact/${pair}`, `m15land/${pair}`, `m15snow/${pair}`, `m15snowland/${pair}`],
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

/** The cut ellipse of a shape's slot oval, in the piece's pixels. */
export function cutEllipse(shape, oval, marginPx) {
  const origin = rectPx(shape.bounds, OUT_W, OUT_H);
  const cx = ((oval.leftPct + oval.widthPct / 2) / 100) * OUT_W - origin.x;
  const cy = ((oval.topPct + oval.heightPct / 2) / 100) * OUT_H - origin.y;
  return { cx, cy, rx: ((oval.widthPct / 100) * OUT_W) / 2 + marginPx, ry: ((oval.heightPct / 100) * OUT_H) / 2 + marginPx };
}

/** Make every pixel whose centre lies inside the cut ellipse transparent. */
export function cutOval(buf, shape, oval, marginPx) {
  const { width, height } = shape.size;
  const e = cutEllipse(shape, oval, marginPx);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x + 0.5 - e.cx) / e.rx;
      const dy = (y + 0.5 - e.cy) / e.ry;
      if (dx * dx + dy * dy <= 1) buf.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
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
  const e = cutEllipse(shape, oval, cutMarginPx);
  const inside = (x, y, grow) => {
    const dx = (x + 0.5 - e.cx) / (e.rx + grow);
    const dy = (y + 0.5 - e.cy) / (e.ry + grow);
    return dx * dx + dy * dy <= 1;
  };
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
  m15pwholostamp: Object.freeze({ y: 36, runs: Object.freeze([Object.freeze([2, 12]), Object.freeze([170, 181])]) }),
});

/** Every Card Conjurer file a notch folder reads. */
export function notchSourceFiles(def) {
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
    `the oval ${def.oval.leftPct}/${def.oval.topPct.toFixed(2)}/${def.oval.widthPct}×${def.oval.heightPct} % plus ${def.cutMarginPx} px cut to transparent`,
  ];
}
