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

export const CC_REPO = "Investigamer/cardconjurer";
/** Pinned so a rerun reproduces the same pixels; bump deliberately. */
export const CC_COMMIT = "2fcddba8966156d484cedf54d8214996748dd5e1";
export const CC_RAW = `https://raw.githubusercontent.com/${CC_REPO}/${CC_COMMIT}`;

export const OUT_W = 1500;
export const OUT_H = 2100;
/** The existing masters' corner radius (2.6 % of the width). CC's frames
 *  have opaque black corners; ours are transparent. */
export const CORNER_RADIUS = Math.round(OUT_W * 0.026);
/** Same encode as scripts/generate-frame-webp.mjs. */
export const WEBP = { quality: 90, effort: 6 };

export const COLORS = ["w", "u", "b", "r", "g", "c", "m"];

const NEW = "img/frames/m15/new";
const REG = "img/frames/m15/regular";
const SNOW = "img/frames/m15/new/snow";
const DEVOID = "img/frames/m15/devoid";
const PW = "img/frames/planeswalker/regular";
const TOKEN = "img/frames/token/m15/textless";

/** A layer: a frame image, optionally shown only through a mask (its alpha),
 *  optionally at reduced opacity. */
const layer = (src, mask, opacity) => ({ src, ...(mask ? { mask } : {}), ...(opacity !== undefined ? { opacity } : {}) });
/** A layer shown everywhere EXCEPT through a mask (alpha × (1 − mask
 *  alpha)) — how a borderless key drops a pack's Border mask (4.39). */
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

const perColor = (fn, keys = COLORS) => Object.fromEntries(keys.map((k) => [k, fn(k)]));
const WUBRGM = ["w", "u", "b", "r", "g", "m"];

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

/**
 * template → { colors: colour → layers, plates?, symbols?, shield?,
 * excluded?, pack?, transforms?, notes }.
 * `plates` are written at native size to <template>/pt/<colour>.png;
 * `symbols` (a basic land's mana-symbol disc, TODO 3.24) the same way to
 * <template>/symbol/<colour>.png, for the colours listed only.
 * `shield` cuts part of each built master out through a mask (its alpha)
 * into <template>/loyalty/<colour>.png, cropped to `box`.
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
    notes: [
      "source: CC 'Textless (Bordered M15)' — its geometry matches the M15TOKEN profile (art 12.5–81.3 %, type bar ~82 %)",
      "colourless creature token = PipGlyph composite: CC's silver token frame at 35 % (frame) / 80 % (type bar) opacity over the art, like printed BFZ/MH1/WAR colourless tokens (owner decision 2026-09-25)",
    ],
  },
  m15tokenartifact: {
    colors: {
      c: [layer(`${TOKEN}/a.png`)],
      ...perColor((k) => colouredArtifact(`${TOKEN}/a.png`, `${TOKEN}/${k}.png`, TOKEN_BASE_MASKS, TOKEN_INTERIOR_MASKS), WUBRGM),
    },
    notes: ["coloured artifact tokens = artifact token frame, colour pinline/title/type through CC's token masks"],
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
    transforms: "native 1500x2100, no resample; the frame image with its Border mask's region erased (alpha x (1 - mask alpha)), corners rounded to the importer radius; symbol discs native 168x168",
    notes: [
      "re-sourced from CC (4.39): replaces the 744 px MSE magic-m15-full-art-basic-land-symbol composite that scripts/build-variation-frames.mjs upscaled",
      "borderless = m15fullartland without the Border mask (owner decision 4.35(a)); the bars keep their bevels and drop shadows",
      "light bars, as on the 263 bordered printings (owner decision 2026-09-26): FRA #382–396 print dark bars and resolve nearest",
      "colourless (Wastes) = the pack's 'Colorless Frame' l.png + the colourless disc sc.png (owner visual sign-off before it is verified)",
      "m = the pack's 'Multicolored Frame' m.png, built so the key keeps a master (the MSE build dressed m as colourless); no multicolour basic exists, so no symbol disc and never offered",
    ],
  },
};

/** Templates deliberately NOT imported yet, and why. */
export const CC_DEFERRED = {};

/**
 * Composite RGBA layers (each `{ data, mask?, invert?, opacity? }`, raw 8-bit
 * RGBA of the same size) in order: a layer's alpha is multiplied by its
 * mask's ALPHA, then drawn source-over onto the accumulator — exactly CC's
 * drawFrames (a black canvas, the masks drawn 'source-in', the image drawn
 * 'source-in', the result 'source-over'). CC's masks are solid colours
 * (title red, rules green, border black): only their alpha means anything.
 * `invert` keeps the layer everywhere EXCEPT the mask (alpha × (1 − mask
 * alpha)). Returns a Float32Array RGBA with alpha in 0..1.
 */
export function compositeLayers(images, width, height) {
  const n = width * height;
  const acc = new Float32Array(n * 4);
  for (const [i, img] of images.entries()) {
    for (let p = 0; p < n; p += 1) {
      const o = p * 4;
      let a = img.data[o + 3] / 255;
      if (img.mask) a *= img.invert ? 1 - img.mask[o + 3] / 255 : img.mask[o + 3] / 255;
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

/** Same as roundCorners, on 8-bit RGBA (after the final downscale). */
export function roundCornersRgba8(buf, width, height, radius) {
  const r = radius;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cx = x < r ? r - x - 0.5 : x >= width - r ? x - (width - r) + 0.5 : 0;
      const cy = y < r ? r - y - 0.5 : y >= height - r ? y - (height - r) + 0.5 : 0;
      if (cx === 0 || cy === 0) continue;
      const d = Math.sqrt(cx * cx + cy * cy) - r;
      if (d <= -0.5) continue;
      const k = d >= 0.5 ? 0 : 0.5 - d;
      const o = (y * width + x) * 4 + 3;
      buf[o] = Math.round(buf[o] * k);
    }
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
