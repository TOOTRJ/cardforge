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
import { PAIR_RAMPS, TWO_COLOR_PAIRS, rampName } from "./pair-ramp.mjs";

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

/** A twoColorRecipe letter → its accurate-M15 file: a colour, "m", "a" or
 *  "l" → new/<k>.png; a land tint "wl" → new/lw.png (CC reverses it). */
function m15FrameFile(letter) {
  return letter.length === 2 && letter[1] === "l" ? `${NEW}/l${letter[0]}.png` : `${NEW}/${letter}.png`;
}

/** A pair layer: the recipe region's left file blended into its right file
 *  across the region's ramp (lerpLayers over rampMask), through `mask`. */
function pairLayer(region, mask) {
  return {
    src: m15FrameFile(region.left),
    right: m15FrameFile(region.right),
    ramp: [...region.ramp],
    ...(mask ? { mask } : {}),
  };
}

/** The layers of one pair master (see above). `kind`: "m15", "artifact" or
 *  "land"; `dress`: "split" or "hybrid" (hybrid only on "m15"). */
export function pairMasterLayers(pair, dress, kind) {
  const r = twoColorRecipe(pair, dress, kind);
  if (kind === "artifact") {
    return [
      layer(m15FrameFile(r.frame.left), M15_MASK.border),
      layer(m15FrameFile(r.frame.left), M15_MASK.frame),
      pairLayer(r.rules, M15_MASK.rules),
      layer(m15FrameFile(r.typeTitle), M15_MASK.title),
      layer(m15FrameFile(r.typeTitle), M15_MASK.type),
      pairLayer(r.pinline, M15_MASK.pinline),
    ];
  }
  const base = r.frame.right ? pairLayer(r.frame) : layer(m15FrameFile(r.frame.left));
  // The bars are the base's own unless the base is a split frame (hybrid:
  // grey l bars over a two-colour frame).
  const bars = r.frame.right
    ? [layer(m15FrameFile(r.typeTitle), M15_MASK.title), layer(m15FrameFile(r.typeTitle), M15_MASK.type)]
    : [];
  return [base, pairLayer(r.rules, M15_MASK.rules), ...bars, pairLayer(r.pinline, M15_MASK.pinline)];
}

/** A template's pair masters: `{ wu: layers, …, "wu-h": layers, … }`. */
function pairMasters(kind, dresses) {
  return Object.fromEntries(
    dresses.flatMap((dress) =>
      TWO_COLOR_PAIRS.map((pair) => [dress === "hybrid" ? `${pair}-h` : pair, pairMasterLayers(pair, dress, kind)]),
    ),
  );
}

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
// and a split box; their pair masters are 4.6's (borderlessLandLayers takes
// the letters, so a pair adds the right-hand pinline and box through 4.6's
// procedural ramp). Until then `m` is the three-and-more-colour land
// (Command Tower CMM #659, SNC #291–295): gold bars, box and pinline.
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
 * l). A mono-colour land passes one letter three times; 4.6's pair masters
 * pass the grey `l` bars and a letter pair for the box and pinline.
 */
export function borderlessLandLayers({ frame, box, pinline }) {
  return [
    layer(borderlessFrame(frame)),
    replacing(borderlessFrame(frame), REG_TYPE_MASK, { dy: BORDERLESS_TITLE_TO_TYPE_DY }),
    replacing(TINTED_BOX_STRUCTURE.src, REG_RULES_MASK, {
      retint: { from: TINTED_BOX_STRUCTURE.from, tintOf: { src: borderlessFrame(box), ...BORDERLESS_TINT_POINT } },
    }),
    layer(borderlessFrame(pinline), BORDERLESS_PINLINE_MASK),
  ];
}

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

/**
 * template → { colors: colour → layers, finish?, plates?, symbols?, shield?,
 * ptCut?, recut?, recutUp?, bridge?, tones?, excluded?, pack?, transforms?,
 * notes }.
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
  m15snow: {
    colors: perColor((k) => [layer(k === "c" ? `${SNOW}/a.png` : `${SNOW}/${k}.png`)]),
    plates: ARTIFACT_PT,
    notes: ["colourless snow = CC's snow artifact frame (colourless snow nonland prints are artifacts)"],
  },
  m15snowland: {
    colors: perColor((k) => [layer(k === "c" ? `${SNOW}/l.png` : `${SNOW}/l${k}.png`)]),
    notes: [],
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
  m15borderless: {
    colors: perColor((k) => [layer(borderlessFrame(k))]),
    plates: BORDERLESS_PT,
    pack: "packBorderless.js 'Borderless (Alt)' (groupShowcase-5.js:49)",
    transforms: "native 1500x2100, pixels copied 1:1 (no resample), corners rounded to the importer radius",
    notes: [
      "colourless = CC's see-through colourless frame (m15GenericShowcaseFrameC.png): the art runs under the frame, as on m15 'c' (4.17)",
      "colourless P/T plate = the pack's 'Colorless Power/Toughness' pt/l.png (the unlisted pt/c.png is not used)",
      "CC's 'Land Frame' (m15GenericShowcaseFrameL.png) is not imported here: it is 4.34's m15borderlessland",
    ],
  },
  // 4.32 — its artifact skin, mirroring m15artifact.
  m15borderlessartifact: {
    colors: {
      c: [layer(borderlessFrame("a"))],
      // A coloured artifact wears the colour frame (see notes).
      ...perColor((k) => [layer(borderlessFrame(k))], WUBRGM),
    },
    plates: { ...BORDERLESS_PT, c: `${BORDERLESS}/pt/a.png` },
    pack: "packBorderless.js 'Borderless (Alt)' (groupShowcase-5.js:49)",
    transforms: "native 1500x2100, pixels copied 1:1 (no resample), corners rounded to the importer radius",
    notes: [
      "colourless artifact = CC's 'Artifact Frame' (m15GenericShowcaseFrameA.png) with the 'Artifact Power/Toughness' plate pt/a.png",
      "coloured artifacts = the colour frame, whole (same bytes as m15borderless). 4.16's recipe (artifact frame + border, colour interior) keeps the ARTIFACT frame only where the colour doesn't draw: the frame body and the border. A full-bleed frame has no frame body, and the Border region (bottom bar + fins) of the Artifact frame matches every colour's (premultiplied; measured 2026-09-26). Drawn through the pack's masks it would only add damage: a partial-alpha seam row at 92.76-92.81 % H between the Pinline and Border masks, and the bars' outer bevel (0.13 % of the frame's alpha lies outside the five masks)",
    ],
  },
  // 4.34 — the borderless nonbasic land: the colour on the title bar, the
  // type bar AND the text box (borderlessLandLayers).
  m15borderlessland: {
    colors: perColor((k) => {
      const letter = borderlessLandLetter(k);
      return borderlessLandLayers({ frame: letter, box: letter, pinline: letter });
    }),
    pack: "packBorderless.js 'Borderless (Alt)' (groupShowcase-5.js:49) + the text-box structure of packGenericShowcase.js 'Borderless' (groupShowcase-5.js:48)",
    transforms: `native 1500x2100, no resample; a PipGlyph composite of the packs' pixels: the colour's frame whole, its title bar moved down ${BORDERLESS_TITLE_TO_TYPE_DY} px onto the type bar (replacing it through CC's Type mask), genericShowcase's neutral text box re-tinted to the colour's title-bar tint (the flat pixel at (${BORDERLESS_TINT_POINT.x}, ${BORDERLESS_TINT_POINT.y})) at its own alpha (replacing the dark box through CC's Rules mask), the pinline through the pack's Pinline mask on top; corners rounded to the importer radius`,
    notes: [
      "the print's land look (2026-09-29, 50+ borderless land printings): title bar, type bar and text box all wear the colour's title-bar tint; a borderless spell tints only its title bar (m15borderless)",
      "colourless = CC's 'Land Frame' (m15GenericShowcaseFrameL.png): grey bars and box, the land's brown-grey pinline (the prints' #a5988a on CMM #663 / FRA #379), never the see-through 'Colorless Frame'",
      "m = the three-and-more-colour land (gold bars, box and pinline: CMM #659, SNC #291); two-colour lands print grey L bars with a split pinline and box — 4.6's pair masters (borderlessLandLayers with a letter pair)",
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
};

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

/** One entry of a recipe's `tones`: the silver (it has `bodyFromY`) or an
 *  outlined region (toneRegion). */
export function applyTone(buf, width, height, tone) {
  return "bodyFromY" in tone ? toneSilver(buf, width, height, tone) : toneRegion(buf, width, height, tone);
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
  const tint = l.retint
    ? ` re-tinted from ${l.retint.from.join(",")} to the tint of ${l.retint.tintOf.src} at (${l.retint.tintOf.x}, ${l.retint.tintOf.y})`
    : "";
  const masks = Array.isArray(l.mask) ? l.mask.join(" ∩ ") : l.mask;
  const mask = masks ? ` ${l.replace ? "replacing through" : l.invert ? "outside" : "through"} ${masks}` : "";
  const gain = l.gain !== undefined ? ` with its alpha ×${l.gain.toFixed(4)} (clamped at 1)` : "";
  // A pair layer (pairLayer, TODO 4.6b): two files blended across a ramp.
  const src = l.right ? `(${l.src} | ${l.right} across ${rampName(l.ramp)})` : l.src;
  if (l.recolour) {
    const ramp = l.lumaRamp ? `, weighted by its own luminance from ${l.lumaRamp[0]} (0) to ${l.lumaRamp[1]} (full)` : "";
    return `${src}${mask} recolouring the layers below (their alpha kept)${l.opacity !== undefined ? ` at ${Math.round(l.opacity * 100)}%` : ""}${ramp}`;
  }
  return `${src}${moved}${tint}${mask}${l.opacity !== undefined ? ` at ${Math.round(l.opacity * 100)}%` : ""}${gain}`;
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


/** Every master key a recipe may name, in build order: the seven colours,
 *  then the two-colour pair masters (TODO 4.6b: gold-split `<pair>`, hybrid
 *  `<pair>-h`; lib/cards/frame-reference-registry.ts TWO_COLOR_MASTER_KEYS). */
export const MASTER_KEYS = [...COLORS, ...TWO_COLOR_PAIRS, ...TWO_COLOR_PAIRS.map((pair) => `${pair}-h`)];

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
    }
  }
  for (const f of def.finish ?? []) files.add(f.mask);
  for (const plate of Object.values(def.plates ?? {})) files.add(plate);
  for (const symbol of Object.values(def.symbols ?? {})) files.add(symbol);
  if (def.shield) files.add(def.shield.mask);
  for (const src of Object.values(def.ptCut?.image ?? {})) files.add(src);
  for (const mask of Object.values(def.ptCut?.masks ?? {})) files.add(mask);
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

/** The overlay bands the importer builds, by bucket folder. */
export const CC_OVERLAY_BANDS = {
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
