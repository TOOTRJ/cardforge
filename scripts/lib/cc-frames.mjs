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
const TOKEN = "img/frames/token/m15/regular";

/** A layer: a frame image, optionally shown only through a greyscale mask. */
const layer = (src, mask) => (mask ? { src, mask } : { src });

/** Regular M15 P/T plates (CC keeps one set for regular, snow and tokens). */
const REG_PT = Object.fromEntries(COLORS.map((k) => [k, `${REG}/m15PT${k.toUpperCase()}.png`]));
const ARTIFACT_PT = { ...REG_PT, c: `${REG}/m15PTA.png` };

/** Coloured artifact = silver artifact frame + the colour frame through the
 *  pinline mask (CC's own recipe for "Artifact Frame" + "<Colour> Pinline"). */
const artifactBlend = (base, colourOf, mask) =>
  Object.fromEntries(
    COLORS.map((k) => [k, k === "c" ? [layer(base)] : [layer(base), layer(colourOf(k), mask)]]),
  );

const perColor = (fn) => Object.fromEntries(COLORS.map((k) => [k, fn(k)]));

/**
 * template → { colors: colour → layers, plates?: colour → file, notes }.
 * `notes` records every substitution, so provenance says why a colour is
 * not a 1:1 Card Conjurer file.
 */
export const CC_TEMPLATES = {
  m15: {
    colors: perColor((k) => [layer(`${NEW}/${k}.png`)]),
    plates: REG_PT,
    notes: [],
  },
  m15artifact: {
    colors: artifactBlend(`${NEW}/a.png`, (k) => `${NEW}/${k}.png`, `${NEW}/pinline.png`),
    plates: ARTIFACT_PT,
    notes: ["coloured artifacts = silver artifact frame + the colour frame through CC's pinline mask"],
  },
  m15land: {
    colors: perColor((k) => [layer(k === "c" ? `${NEW}/l.png` : `${NEW}/l${k}.png`)]),
    notes: ["colourless land = CC's generic land frame (the pack has no ll.png)"],
  },
  m15snow: {
    colors: perColor((k) => [layer(k === "c" ? `${SNOW}/a.png` : `${SNOW}/${k}.png`)]),
    plates: ARTIFACT_PT,
    notes: ["colourless snow = CC's snow artifact frame"],
  },
  m15snowland: {
    colors: perColor((k) => [layer(k === "c" ? `${SNOW}/l.png` : `${SNOW}/l${k}.png`)]),
    notes: [],
  },
  m15devoid: {
    colors: perColor((k) => [
      layer(k === "c" ? `${NEW}/c.png` : `${DEVOID}/m15DevoidFrame${k.toUpperCase()}.png`),
    ]),
    plates: perColor(() => `${DEVOID}/m15DevoidPT.png`),
    notes: ["true colourless = the plain colourless (Eldrazi) frame; devoid colours keep their pinline"],
  },
  m15pw: {
    colors: perColor((k) => [layer(`${PW}/planeswalkerFrame${k === "c" ? "A" : k.toUpperCase()}.png`)]),
    notes: ["colourless planeswalker = CC's artifact planeswalker frame; the loyalty shield stays PipGlyph's"],
  },
  m15token: {
    colors: perColor((k) => [layer(k === "c" ? `${TOKEN}/a.png` : `${TOKEN}/${k}.png`)]),
    notes: [
      "colourless token = the silver artifact token frame (real colourless tokens are artifacts)",
      "CC's token frame has a type bar + rules box: the M15TOKEN profile must be re-measured before it ships (4.4)",
    ],
  },
  m15tokenartifact: {
    colors: artifactBlend(`${TOKEN}/a.png`, (k) => `${TOKEN}/${k}.png`, `${TOKEN}/pinline.svg`),
    notes: ["coloured artifact tokens = silver token frame + colour through CC's pinline mask"],
  },
};

/**
 * Composite RGBA layers (each `{ data, mask? }`, raw 8-bit RGBA of the same
 * size) in order: a layer's alpha is multiplied by its mask's luminance ×
 * mask alpha, then drawn source-over onto the accumulator. Returns a
 * Float32Array RGBA with alpha in 0..1.
 */
export function compositeLayers(images, width, height) {
  const n = width * height;
  const acc = new Float32Array(n * 4);
  for (const [i, img] of images.entries()) {
    for (let p = 0; p < n; p += 1) {
      const o = p * 4;
      let a = img.data[o + 3] / 255;
      if (img.mask) {
        const m = img.mask;
        const lum = (0.299 * m[o] + 0.587 * m[o + 1] + 0.114 * m[o + 2]) / 255;
        a *= lum * (m[o + 3] / 255);
      }
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
