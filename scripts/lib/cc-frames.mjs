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
const PW = "img/frames/planeswalker/regular";
const TOKEN = "img/frames/token/m15/textless";

/** A layer: a frame image, optionally shown only through a greyscale mask. */
const layer = (src, mask) => (mask ? { src, mask } : { src });

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

/**
 * template → { colors: colour → layers, plates?, excluded?, notes }.
 * `excluded` colours are NOT built: the template keeps its current master
 * for them. `notes` records every substitution, so provenance says why a
 * colour is not a 1:1 Card Conjurer file.
 */
export const CC_TEMPLATES = {
  m15: {
    colors: perColor((k) => [layer(`${NEW}/${k}.png`)], WUBRGM),
    excluded: {
      c: "CC's colourless 'Eldrazi' frame (new/c.png) is see-through; it needs art drawn under the frame (TODO 4.17) — keep the current master",
    },
    plates: REG_PT,
    notes: [],
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
  m15pw: {
    colors: perColor((k) => [layer(`${PW}/planeswalkerFrame${k === "c" ? "A" : k.toUpperCase()}.png`)]),
    notes: [
      "colourless planeswalker = CC's artifact planeswalker frame",
      "CC's planeswalker masters paint the loyalty shield themselves: the M15PW profile must drop its loyalty.png plate in the same change (4.4/4.19)",
    ],
  },
  m15token: {
    colors: perColor((k) => [layer(k === "c" ? `${TOKEN}/a.png` : `${TOKEN}/${k}.png`)]),
    notes: [
      "source: CC 'Textless (Bordered M15)' — its geometry matches the M15TOKEN profile (art 12.5–81.3 %, type bar ~82 %)",
      "colourless token = the silver artifact token frame [decide: CC's land token frame for colourless creature tokens like Eldrazi Scions]",
    ],
  },
  m15tokenartifact: {
    colors: {
      c: [layer(`${TOKEN}/a.png`)],
      ...perColor((k) => colouredArtifact(`${TOKEN}/a.png`, `${TOKEN}/${k}.png`, TOKEN_BASE_MASKS, TOKEN_INTERIOR_MASKS), WUBRGM),
    },
    notes: ["coloured artifact tokens = artifact token frame, colour pinline/title/type through CC's token masks"],
  },
};

/** Templates deliberately NOT imported yet, and why. */
export const CC_DEFERRED = {
  m15devoid:
    "every CC devoid frame is see-through (text box alpha ~179, side strips 0): it needs full-bleed art under the frame (TODO 4.17) before it can ship",
};

/**
 * Composite RGBA layers (each `{ data, mask? }`, raw 8-bit RGBA of the same
 * size) in order: a layer's alpha is multiplied by its mask's ALPHA, then
 * drawn source-over onto the accumulator — exactly CC's drawFrames (a black
 * canvas, the masks drawn 'source-in', the image drawn 'source-in', the
 * result 'source-over'). CC's masks are solid colours (title red, rules
 * green, border black): only their alpha means anything. Returns a
 * Float32Array RGBA with alpha in 0..1.
 */
export function compositeLayers(images, width, height) {
  const n = width * height;
  const acc = new Float32Array(n * 4);
  for (const [i, img] of images.entries()) {
    for (let p = 0; p < n; p += 1) {
      const o = p * 4;
      let a = img.data[o + 3] / 255;
      if (img.mask) a *= img.mask[o + 3] / 255;
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

/** The colours a template builds (all seven minus `excluded`). */
export function builtColors(def) {
  return COLORS.filter((k) => def.colors[k] && !def.excluded?.[k]);
}

/** Every Card Conjurer file a template needs (layers, masks, plates). */
export function sourceFilesFor(def) {
  const files = new Set();
  for (const layers of Object.values(def.colors)) {
    for (const l of layers) {
      files.add(l.src);
      if (l.mask) files.add(l.mask);
    }
  }
  for (const plate of Object.values(def.plates ?? {})) files.add(plate);
  return [...files].sort();
}
