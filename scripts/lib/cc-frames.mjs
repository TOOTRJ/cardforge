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
/** A layer shown everywhere EXCEPT through a mask — how a borderless key
 *  drops a pack's Border mask (4.39). The mask is a region the frame image
 *  itself paints (its black ring), so the mask's COVERAGE is subtracted
 *  (alpha − mask alpha), not multiplied out: see compositeLayers. */
const outside = (src, mask) => ({ src, mask, invert: true });

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
 * The emblem's name pill, toned onto the prints (owner evidence
 * 2026-09-29: our pill read luma 94–97 against the prints' 54–60, the name's
 * ink included). Why: CC's pack draws frame.png ALONE — packEmblem.js has no
 * darkening layer and creator-23.js does nothing for version 'emblem' — and
 * that file paints the pill as a light gradient, luma ~140 at the ends to
 * ~50 at the centre (median 90 over the name band, rows 128–199 ×
 * 150–1349), where the six M20-design prints (TFDN #24 / #25, TM20 #11,
 * TDSK #17, TBLB #30, TFRA #16; Scryfall PNGs at 1500 × 2100) print a dark
 * pill, luma ~97 at the ends and 45–60 across its length. The silver
 * around it is within the prints' range, so only the pill is toned.
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
 * template → { colors: colour → layers, plates?, symbols?, shield?, recut?,
 * tone?, excluded?, pack?, transforms?, notes }.
 * `plates` are written at native size to <template>/pt/<colour>.png;
 * `symbols` (a basic land's mana-symbol disc, TODO 3.24) the same way to
 * <template>/symbol/<colour>.png, for the colours listed only.
 * `shield` cuts part of each built master out through a mask (its alpha)
 * into <template>/loyalty/<colour>.png, cropped to `box`.
 * `recut` moves a band of each composite down before the downscale
 * (recutBand; the textless tokens, TOKEN_TEXTLESS_RECUT; the text-box
 * tokens, TOKEN_REGULAR_RECUT).
 * `tone` multiplies one outlined region of each composite by a gain before
 * the downscale (toneRegion; the emblem's name pill, EMBLEM_NAME_PILL_TONE).
 * `excluded` colours are NOT built: the template keeps its current master
 * for them. `pack` / `transforms` name the CC pack and what was done to its
 * pixels (recorded in provenance). `notes` records every substitution, so
 * provenance says why a colour is not a 1:1 Card Conjurer file.
 */
export const CC_TEMPLATES = {
  m15: {
    colors: perColor((k) => [layer(`${NEW}/${k}.png`)]),
    plates: REG_PT,
    notes: [
      "colourless = CC's see-through 'Eldrazi' frame (new/c.png): the M15 profile draws the art under the frame for 'c' (underFrameArt, TODO 4.17), like printed colourless Eldrazi (owner decision 2026-09-25)",
    ],
  },
  m15artifact: {
    colors: {
      c: [layer(`${NEW}/a.png`)],
      ...perColor((k) => colouredArtifact(`${NEW}/a.png`, `${NEW}/${k}.png`, M15_BASE_MASKS, M15_INTERIOR_MASKS), WUBRGM),
    },
    plates: ARTIFACT_PT,
    notes: ["coloured artifacts = artifact frame + border, colour pinline/title/type/text box through CC's masks"],
  },
  m15land: {
    colors: perColor((k) => [layer(k === "c" ? `${NEW}/l.png` : `${NEW}/l${k}.png`)]),
    notes: ["colourless land = CC's land frame new/l.png"],
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
    tone: EMBLEM_NAME_PILL_TONE,
    pack: "packEmblem.js 'Planeswalker Emblems'",
    transforms: toneTransform(EMBLEM_NAME_PILL_TONE),
    notes: [
      "source: CC 'Planeswalker Emblems' (packEmblem.js), the M20 design: the source's name in the dark title bar, a silver frame with the art in a planeswalker-spark cut-out, a type bar reading \"Emblem\", a light text box (TFDN #24 / #25, TBLB #30, TDSK #17, TFRA #16)",
      "every colour key = the same silver master (CR 114: an emblem is colourless; the emblem kind forces c). w/u/b/r/g/m are built so each key has a master and are never offered",
      "the spark's tail through the type bar and the text box is CC's own 80 % white (alpha 204) over the art, as the prints show the art faintly there",
      "the name pill's body is toned onto the prints (EMBLEM_NAME_PILL_TONE): CC's pack draws frame.png alone, and its pill is a light gradient (median luma 90 over the name band) where the six M20-design prints print a dark one (52); the gain by distance from the pill's centre is a least-squares fit on the prints, and the body is made opaque as printed",
    ],
  },
};

/** How provenance describes the text-box tokens' re-cut (TOKEN_REGULAR_RECUT). */
function recutTransform(r) {
  return `native 1500x2100, no resample; composited in CC's order, then re-cut: rows ${r.fromY}–${r.toY - 1} (the window's straight sides through the top of the text box) moved down ${r.shift} px as one piece, the rows opened above them filled from the window's sides, each seam cross-faded over ${r.blend} rows (premultiplied); corners rounded to the importer radius`;
}

/** How provenance describes the textless tokens' re-cut (TOKEN_TEXTLESS_RECUT). */
function textlessRecutTransform(r) {
  return `native 1500x2100, no resample; composited in CC's order, then re-cut: rows ${r.fromY}–${r.toY - 1} (the window's straight sides through the type pill's shadow) moved down ${r.shift} px as one piece over the top ${r.shift} rows of the frame texture below them, the rows opened above them filled from the window's sides and cross-faded over ${r.blend} rows, the shadow's last ${r.blendBottom} rows faded into the texture (premultiplied); corners rounded to the importer radius`;
}

/** How provenance describes the emblem's pill tone (EMBLEM_NAME_PILL_TONE). */
function toneTransform(t) {
  const gains = t.gain.map(([d, g]) => `${g} at ${d}`).join(", ");
  return `native 1500x2100, pixels copied 1:1 (no resample) but for the name pill's body: rows ${t.fromY}–${t.toY - 1}, the pixels 4-connected to (${t.seed.x}, ${t.seed.y}) with luma ≥ ${t.minLuma} (inside the pill's dark outline), colour multiplied by a gain piecewise-linear in the distance from x ${t.centreX} (${gains} px) and made opaque; corners rounded to the importer radius`;
}

/** Templates deliberately NOT imported yet, and why. */
export const CC_DEFERRED = {};

/**
 * Composite RGBA layers (each `{ data, mask?, invert?, opacity? }`, raw 8-bit
 * RGBA of the same size) in order: a layer's alpha is multiplied by its
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
 * ring). Returns a Float32Array RGBA with alpha in 0..1.
 */
export function compositeLayers(images, width, height) {
  const n = width * height;
  const acc = new Float32Array(n * 4);
  for (const [i, img] of images.entries()) {
    for (let p = 0; p < n; p += 1) {
      const o = p * 4;
      let a = img.data[o + 3] / 255;
      if (img.mask) {
        const m = img.mask[o + 3] / 255;
        a = img.invert ? Math.max(0, a - m) : a * m;
      }
      if (img.opacity !== undefined) a *= img.opacity;
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
 * Tone one region of an 8-bit RGBA image (EMBLEM_NAME_PILL_TONE): the pixels
 * 4-connected to `seed` within rows [fromY, toY) whose luma is ≥ `minLuma`
 * — a dark outline bounds the region — get their colour multiplied by
 * gainAt(gain, |x − centreX|) (rounded, clamped to 255) and alpha 255.
 * Everything else is copied as it is. Returns a new buffer.
 */
export function toneRegion(buf, width, height, { seed, fromY, toY, minLuma, centreX, gain }) {
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
    out[o + 3] = 255;
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
 *  "src outside mask", "… at 35%". */
export function describeLayer(l) {
  const mask = l.mask ? ` ${l.invert ? "outside" : "through"} ${l.mask}` : "";
  return `${l.src}${mask}${l.opacity !== undefined ? ` at ${Math.round(l.opacity * 100)}%` : ""}`;
}

/** The colours a template builds (all seven minus `excluded`). */
export function builtColors(def) {
  return COLORS.filter((k) => def.colors[k] && !def.excluded?.[k]);
}

/** Every Card Conjurer file a template needs (layers, masks, plates,
 *  symbol discs). */
export function sourceFilesFor(def) {
  const files = new Set();
  for (const layers of Object.values(def.colors)) {
    for (const l of layers) {
      files.add(l.src);
      if (l.mask) files.add(l.mask);
    }
  }
  for (const plate of Object.values(def.plates ?? {})) files.add(plate);
  for (const symbol of Object.values(def.symbols ?? {})) files.add(symbol);
  if (def.shield) files.add(def.shield.mask);
  return [...files].sort();
}
