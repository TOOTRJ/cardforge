#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-deck-covers.mjs — the 16 default deck backgrounds (TODO DK6.1, owner
// decision D12): two per colour identity (white, blue, black, red, green,
// multicolour, colourless) plus two neutrals, drawn behind every deck that
// has no cover of its own (lib/decks/cover.ts deckCoverOf).
//
//   node scripts/build-deck-covers.mjs              # write all 16
//   node scripts/build-deck-covers.mjs --only red-1,blue-2
//   node scripts/build-deck-covers.mjs --out /tmp/covers   # somewhere else
//
// Output: public/defaults/deck-covers/<key>.webp, 2400 × 1350 (16:9).
//
// PipGlyph's own pictures, made here from SVG and a seeded random source —
// no AI, no photograph, no third-party image, no MTG artwork, no mana symbol
// and no brand mark. The same run writes the same pixels (every random
// choice comes from the cover's own seed; librsvg's feTurbulence is seeded).
//
// They are made to sit BEHIND card thumbnails and white title text:
//   * dark to mid values, the brand navy (lib/brand/constants.ts) tinted
//     toward the colour — never a bright field;
//   * the light and the detail live at the top and the right edge, where
//     the hero's fan of cards stands in front of them; the middle band is
//     calm (low contrast) and the left third and the bottom are a darker,
//     quiet band for the title;
//   * a vignette, and a fine grain so a 1600 px-wide hero never bands;
//   * centre-crop safe: a phone shows the middle third at most, which reads
//     on its own (no motif depends on an edge).
// ---------------------------------------------------------------------------

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const W = 2400;
const H = 1350;
const QUALITY = 86;
/** The budget per file (DK6.1: "at most ~250 KB each"). */
const MAX_BYTES = 250 * 1024;

// The brand anchors (lib/brand/constants.ts BRAND — a .ts file this plain
// node script can't import on every supported node; kept in step by
// tests/unit/decks/deck-covers.test.ts).
const NAVY = "#0d1320";
const SURFACE = "#1a2030";
const PURPLE = "#8e72c9";
const PURPLE_DEEP = "#6b4d9a";
const GOLD = "#d8b26e";
const GOLD_LIGHT = "#ecca8a";

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

/** mulberry32 — a tiny seeded PRNG; the same seed, the same sequence. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// SVG building blocks
// ---------------------------------------------------------------------------

function svgDoc(defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>${defs}</defs>
${body}
</svg>`;
}

/** A radial glow: `color` at `opacity` in the middle, nothing at the rim. */
function glow(id, color, opacity, stops = [0, 0.45, 1]) {
  return `<radialGradient id="${id}" cx="50%" cy="50%" r="50%">
    <stop offset="${stops[0]}" stop-color="${color}" stop-opacity="${opacity}"/>
    <stop offset="${stops[1]}" stop-color="${color}" stop-opacity="${round(opacity * 0.35 * 100) / 100}"/>
    <stop offset="${stops[2]}" stop-color="${color}" stop-opacity="0"/>
  </radialGradient>`;
}

function ellipse(id, cx, cy, rx, ry, extra = "") {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${id})" ${extra}/>`;
}

/** A turbulence field coloured `color`, alpha shaped by `gain`/`bias`
 *  (alpha = gain · noise + bias). `freq` is "fx fy". */
function noiseFilter(id, { freq, octaves = 4, seed, color, gain = 1.4, bias = -0.45, type = "fractalNoise", blur = 0 }) {
  const [r, g, b] = hexRgb(color).map((v) => round(v / 255));
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="${type}" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  ${gain} 0 0 0 ${bias}"/>
    ${blur ? `<feGaussianBlur stdDeviation="${blur}"/>` : ""}
  </filter>`;
}

function blurFilter(id, sd) {
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
}

function linear(id, angle, stops) {
  // angle in degrees, 0 = left → right, 90 = top → bottom
  const rad = (angle * Math.PI) / 180;
  const x = Math.cos(rad) / 2;
  const y = Math.sin(rad) / 2;
  return `<linearGradient id="${id}" x1="${round(50 - x * 100)}%" y1="${round(50 - y * 100)}%" x2="${round(50 + x * 100)}%" y2="${round(50 + y * 100)}%">
    ${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}
  </linearGradient>`;
}

function hexRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
}

/** Mix two hex colours, t = 0 → a, 1 → b. */
function mix(a, b, t) {
  const A = hexRgb(a);
  const B = hexRgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Soft particles (dust, embers, bokeh, stars) in a region, kept out of the
 *  calm middle band unless `allowCentre`. */
function particles(rand, { count, region, radius, color, opacity, filter, centreGap = true, stretch = 1, rotate = 0 }) {
  const [x0, y0, x1, y1] = region;
  let out = "";
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 20) {
    guard += 1;
    const x = x0 + rand() * (x1 - x0);
    const y = y0 + rand() * (y1 - y0);
    // The calm band: the middle 30 % of the width, the middle 40 % of the height.
    if (centreGap && x > W * 0.36 && x < W * 0.64 && y > H * 0.3 && y < H * 0.7 && rand() < 0.85) continue;
    const r = radius[0] + Math.pow(rand(), 2.2) * (radius[1] - radius[0]);
    const a = opacity[0] + rand() * (opacity[1] - opacity[0]);
    const fill = Array.isArray(color) ? color[Math.floor(rand() * color.length)] : color;
    out +=
      stretch === 1
        ? `<circle cx="${round(x)}" cy="${round(y)}" r="${round(r)}" fill="${fill}" fill-opacity="${round(a * 100) / 100}"/>`
        : `<ellipse cx="${round(x)}" cy="${round(y)}" rx="${round(r)}" ry="${round(r * stretch)}" fill="${fill}" fill-opacity="${round(a * 100) / 100}" transform="rotate(${round(rotate + (rand() - 0.5) * 24)} ${round(x)} ${round(y)})"/>`;
    placed += 1;
  }
  return `<g filter="url(#${filter})">${out}</g>`;
}

/** Light shafts from a point above the canvas. */
function shafts(rand, { origin, count, spread, length, width, color, opacity, filter }) {
  const [ox, oy] = origin;
  let out = "";
  for (let i = 0; i < count; i += 1) {
    const angle = ((spread[0] + rand() * (spread[1] - spread[0])) * Math.PI) / 180;
    const w = width[0] + rand() * (width[1] - width[0]);
    const len = length * (0.75 + rand() * 0.35);
    const ex = ox + Math.cos(angle) * len;
    const ey = oy + Math.sin(angle) * len;
    const nx = -Math.sin(angle) * w;
    const ny = Math.cos(angle) * w;
    const a = opacity[0] + rand() * (opacity[1] - opacity[0]);
    out += `<path d="M ${round(ox)} ${round(oy)} L ${round(ex - nx)} ${round(ey - ny)} L ${round(ex + nx)} ${round(ey + ny)} Z" fill="${color}" fill-opacity="${round(a * 100) / 100}"/>`;
  }
  return `<g filter="url(#${filter})">${out}</g>`;
}

/** The quiet band for the title (left third, bottom) and the vignette —
 *  the same on every cover, so every deck's title sits on the same calm. */
function finish(tint) {
  const shade = mix(NAVY, "#000000", 0.35);
  const defs = `
    ${linear("calmLeft", 0, [[0, shade, 0.7], [0.38, shade, 0.38], [0.62, shade, 0]])}
    ${linear("calmBottom", 90, [[0.5, shade, 0], [1, shade, 0.62]])}
    ${linear("calmTop", 90, [[0, shade, 0.22], [0.25, shade, 0]])}
    <radialGradient id="vignette" cx="58%" cy="44%" r="72%">
      <stop offset="0.5" stop-color="${shade}" stop-opacity="0"/>
      <stop offset="0.82" stop-color="${shade}" stop-opacity="0.32"/>
      <stop offset="1" stop-color="${shade}" stop-opacity="0.72"/>
    </radialGradient>
    ${linear("tintWash", 20, [[0, tint, 0.0], [1, tint, 0.06]])}`;
  const body = `
    <rect width="${W}" height="${H}" fill="url(#tintWash)"/>
    <rect width="${W}" height="${H}" fill="url(#calmLeft)"/>
    <rect width="${W}" height="${H}" fill="url(#calmBottom)"/>
    <rect width="${W}" height="${H}" fill="url(#calmTop)"/>
    <rect width="${W}" height="${H}" fill="url(#vignette)"/>`;
  return { defs, body };
}

// ---------------------------------------------------------------------------
// The sixteen covers
// ---------------------------------------------------------------------------

/** Each painter returns { defs, body } for the layers between the base and
 *  the shared finish. */
const COVERS = [
  {
    key: "white-1",
    title: "Dawn over the plains",
    seed: 101,
    base: ["#191b2a", "#2a2433", "#3b2f2a"],
    tint: GOLD_LIGHT,
    paint(rand) {
      const defs = `
        ${glow("sun", "#ffe6b0", 0.68)}
        ${glow("haze", GOLD, 0.4)}
        ${glow("cool", "#8ea0c8", 0.14)}
        ${blurFilter("soft", 26)}
        ${blurFilter("motes", 2.2)}
        ${noiseFilter("clouds", { freq: "0.0009 0.0042", octaves: 5, seed: 11, color: "#f6dcae", gain: 1.5, bias: -0.64 })}`;
      const body = `
        ${ellipse("cool", 600, 200, 1100, 520)}
        ${ellipse("haze", 1850, 980, 1500, 520)}
        ${ellipse("sun", 1900, 930, 620, 300)}
        <rect width="${W}" height="${H}" filter="url(#clouds)" opacity="0.34"/>
        ${shafts(rand, { origin: [1900, 980], count: 7, spread: [-150, -95], length: 1300, width: [30, 90], color: "#fff0cf", opacity: [0.025, 0.05], filter: "soft" })}
        ${particles(rand, { count: 70, region: [1300, 120, 2380, 1100], radius: [1.5, 4.5], color: ["#ffefc8", "#f2d79a"], opacity: [0.25, 0.7], filter: "motes" })}`;
      return { defs, body };
    },
  },
  {
    key: "white-2",
    title: "Cathedral light",
    seed: 102,
    base: ["#1a1d2b", "#26283a", "#2f2c36"],
    tint: "#f7efd1",
    paint(rand) {
      const defs = `
        ${glow("halo", "#fff3d2", 0.4)}
        ${glow("warm", GOLD, 0.26)}
        ${blurFilter("soft", 26)}
        ${blurFilter("ring", 3)}
        ${blurFilter("motes", 1.8)}
        ${noiseFilter("veil", { freq: "0.0016 0.0016", octaves: 4, seed: 23, color: "#e8dcc0", gain: 1.3, bias: -0.58 })}`;
      let rings = "";
      for (let i = 0; i < 6; i += 1) {
        rings += `<circle cx="1820" cy="380" r="${220 + i * 120}" fill="none" stroke="#f6e7c4" stroke-opacity="${round((0.16 - i * 0.022) * 100) / 100}" stroke-width="${3 - i * 0.3}"/>`;
      }
      const body = `
        ${ellipse("warm", 1800, 420, 1300, 900)}
        ${ellipse("halo", 1820, 380, 520, 520)}
        <g filter="url(#ring)">${rings}</g>
        ${shafts(rand, { origin: [1820, -200], count: 11, spread: [70, 125], length: 1800, width: [24, 80], color: "#fff4d8", opacity: [0.025, 0.06], filter: "soft" })}
        <rect width="${W}" height="${H}" filter="url(#veil)" opacity="0.3"/>
        ${particles(rand, { count: 90, region: [1100, 0, 2400, 1150], radius: [1.2, 3.8], color: ["#fff6de", "#f0d9a4"], opacity: [0.2, 0.65], filter: "motes" })}`;
      return { defs, body };
    },
  },
  {
    key: "blue-1",
    title: "Deep water",
    seed: 201,
    base: ["#06122a", "#0a2346", "#0b1b33"],
    tint: "#2f8fe0",
    paint(rand) {
      const defs = `
        ${glow("surface", "#5fb4ff", 0.38)}
        ${glow("deep", "#123a7a", 0.5)}
        ${linear("fadeDown", 90, [[0, "#ffffff", 1], [0.55, "#ffffff", 0.15], [0.8, "#ffffff", 0]])}
        <mask id="topOnly"><rect width="${W}" height="${H}" fill="url(#fadeDown)"/></mask>
        ${noiseFilter("shimmer", { freq: "0.0006 0.0042", octaves: 4, seed: 31, color: "#a9d6ff", gain: 1.5, bias: -0.6, blur: 6 })}
        ${blurFilter("soft", 22)}
        ${blurFilter("bubbles", 1.4)}`;
      // The surface seen from below: soft, wide bands of light where it
      // breaks, fading into the deep — no cell pattern, nothing that tiles.
      const body = `
        ${ellipse("deep", 1200, 900, 1700, 700)}
        ${ellipse("surface", 1650, 60, 1500, 520)}
        <g mask="url(#topOnly)"><rect width="${W}" height="${H}" filter="url(#shimmer)" opacity="0.42"/></g>
        ${shafts(rand, { origin: [1700, -260], count: 12, spread: [72, 120], length: 1750, width: [26, 96], color: "#a8d8ff", opacity: [0.03, 0.075], filter: "soft" })}
        ${particles(rand, { count: 46, region: [1350, 300, 2350, 1300], radius: [2, 7], color: "#cfeaff", opacity: [0.12, 0.38], filter: "bubbles" })}`;
      return { defs, body };
    },
  },
  {
    key: "blue-2",
    title: "Moonlit tide",
    seed: 202,
    base: ["#0a1430", "#10203f", "#0c1a30"],
    tint: "#5aa8e8",
    paint(rand) {
      const defs = `
        ${glow("moon", "#d6ecff", 0.5)}
        ${glow("moonHalo", "#6aa8e6", 0.28)}
        ${blurFilter("wave", 2.4)}
        ${blurFilter("soft", 30)}
        ${noiseFilter("mist", { freq: "0.0008 0.006", octaves: 5, seed: 41, color: "#9cc6ee", gain: 1.6, bias: -0.7 })}`;
      let waves = "";
      for (let i = 0; i < 18; i += 1) {
        const y = 860 + i * 30 + rand() * 12;
        const amp = 10 + rand() * 16;
        const len = 260 + rand() * 220;
        const phase = rand() * len;
        let d = `M -40 ${round(y)}`;
        for (let x = -40; x <= W + 40; x += 40) {
          d += ` L ${x} ${round(y + Math.sin(((x + phase) / len) * Math.PI * 2) * amp)}`;
        }
        const op = 0.05 + (1 - i / 18) * 0.12;
        waves += `<path d="${d}" fill="none" stroke="#bfe0ff" stroke-opacity="${round(op * 100) / 100}" stroke-width="${round(1.4 + rand() * 1.8)}"/>`;
      }
      const body = `
        ${ellipse("moonHalo", 1880, 300, 900, 600)}
        ${ellipse("moon", 1880, 300, 260, 260)}
        <rect width="${W}" height="${H}" filter="url(#mist)" opacity="0.4"/>
        <g filter="url(#wave)">${waves}</g>
        ${shafts(rand, { origin: [1880, 300], count: 3, spread: [86, 96], length: 1100, width: [30, 70], color: "#cfe6ff", opacity: [0.035, 0.06], filter: "soft" })}`;
      return { defs, body };
    },
  },
  {
    key: "black-1",
    title: "Smoke",
    seed: 301,
    base: ["#0b0a14", "#15111f", "#0c0b13"],
    tint: "#7055b0",
    paint() {
      const defs = `
        ${glow("ember", "#8a62c4", 0.3)}
        ${glow("void", "#000000", 0.5)}
        ${linear("smokeMask", 0, [[0, "#ffffff", 0.55], [0.35, "#ffffff", 0.18], [0.62, "#ffffff", 0.5], [1, "#ffffff", 1]])}
        <mask id="edges"><rect width="${W}" height="${H}" fill="url(#smokeMask)"/></mask>`;
      const smoke = {
        defs: `<filter id="smoke" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.0017 0.0032" numOctaves="5" seed="53" result="n"/>
          <feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="2" seed="59" result="w"/>
          <feDisplacementMap in="n" in2="w" scale="180" xChannelSelector="R" yChannelSelector="G" result="d"/>
          <feColorMatrix in="d" type="matrix" values="0 0 0 0 0.62  0 0 0 0 0.55  0 0 0 0 0.74  1.9 0 0 0 -0.82"/>
        </filter>`,
        body: `<rect x="${-PAD}" y="${-PAD}" width="${W + PAD * 2}" height="${H + PAD * 2}" filter="url(#smoke)"/>`,
      };
      const body = `
        ${ellipse("ember", 1900, 500, 1000, 760)}
        <g mask="url(#edges)" opacity="0.62">{{layer:smoke}}</g>
        ${ellipse("void", 700, 900, 1100, 600)}`;
      return { defs, body, layers: { smoke } };
    },
  },
  {
    key: "black-2",
    title: "Eclipse",
    seed: 302,
    base: ["#09080f", "#120f1c", "#0b0a12"],
    tint: "#5d4796",
    paint(rand) {
      const defs = `
        ${glow("corona", "#b49cf0", 0.42, [0.32, 0.5, 1])}
        ${glow("wide", "#5a3f98", 0.3)}
        <radialGradient id="disc" cx="50%" cy="50%" r="50%">
          <stop offset="0.9" stop-color="#07060b" stop-opacity="1"/>
          <stop offset="1" stop-color="#07060b" stop-opacity="0"/>
        </radialGradient>
        ${blurFilter("rim", 5)}
        ${blurFilter("spores", 1.6)}
        ${noiseFilter("fog", { freq: "0.0011 0.007", octaves: 5, seed: 67, color: "#8f7fb8", gain: 1.7, bias: -0.78 })}
        ${linear("fogMask", 90, [[0.45, "#ffffff", 0], [1, "#ffffff", 1]])}
        <mask id="low"><rect width="${W}" height="${H}" fill="url(#fogMask)"/></mask>`;
      const body = `
        ${ellipse("wide", 1820, 420, 1200, 820)}
        ${ellipse("corona", 1820, 420, 420, 420)}
        <circle cx="1820" cy="420" r="205" fill="none" stroke="#e4d8ff" stroke-opacity="0.55" stroke-width="5" filter="url(#rim)"/>
        ${ellipse("disc", 1820, 420, 214, 214)}
        <g mask="url(#low)"><rect width="${W}" height="${H}" filter="url(#fog)" opacity="0.55"/></g>
        ${particles(rand, { count: 60, region: [1000, 100, 2400, 1300], radius: [1.2, 3.4], color: ["#cbbcf2", "#9c86d6"], opacity: [0.18, 0.55], filter: "spores" })}`;
      return { defs, body };
    },
  },
  {
    key: "red-1",
    title: "Embers",
    seed: 401,
    base: ["#150a10", "#260d12", "#1a0c10"],
    tint: "#ee343b",
    paint(rand) {
      const defs = `
        ${glow("heat", "#ff5a2a", 0.5)}
        ${glow("core", "#ffb070", 0.32)}
        ${glow("crimson", "#9e1a2a", 0.4)}
        ${blurFilter("embers", 1.8)}
        ${blurFilter("glowEmbers", 7)}
        ${noiseFilter("haze", { freq: "0.0012 0.0028", octaves: 5, seed: 71, color: "#ff7a45", gain: 1.5, bias: -0.68 })}
        ${linear("hazeMask", 0, [[0.3, "#ffffff", 0], [1, "#ffffff", 1]])}
        <mask id="right"><rect width="${W}" height="${H}" fill="url(#hazeMask)"/></mask>`;
      const body = `
        ${ellipse("crimson", 1700, 1100, 1700, 700)}
        ${ellipse("heat", 1950, 1300, 1100, 520)}
        ${ellipse("core", 2000, 1350, 600, 260)}
        <g mask="url(#right)"><rect width="${W}" height="${H}" filter="url(#haze)" opacity="0.4"/></g>
        ${particles(rand, { count: 40, region: [1200, 200, 2400, 1350], radius: [4, 11], color: ["#ff8a3d", "#ff5a2a"], opacity: [0.12, 0.3], filter: "glowEmbers" })}
        ${particles(rand, { count: 130, region: [1050, 80, 2400, 1350], radius: [1.4, 4], color: ["#ffd08a", "#ff9a4a", "#ff6a2e"], opacity: [0.35, 0.9], filter: "embers", stretch: 2.6, rotate: -18 })}`;
      return { defs, body };
    },
  },
  {
    key: "red-2",
    title: "Forge glow",
    seed: 402,
    base: ["#170b0d", "#2a0f12", "#160a0c"],
    tint: "#ff6a3a",
    paint(rand) {
      const defs = `
        ${glow("forge", "#ff6b2c", 0.42)}
        ${glow("deep", "#7a1020", 0.5)}
        ${linear("flameMask", 0, [[0.45, "#ffffff", 0], [0.8, "#ffffff", 0.7], [1, "#ffffff", 1]])}
        <mask id="rightEdge"><rect width="${W}" height="${H}" fill="url(#flameMask)"/></mask>
        ${blurFilter("sparks", 1.5)}`;
      const flame = {
        defs: `<filter id="flame" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.0045 0.0011" numOctaves="5" seed="83" result="n"/>
          <feTurbulence type="fractalNoise" baseFrequency="0.004" numOctaves="2" seed="89" result="w"/>
          <feDisplacementMap in="n" in2="w" scale="120" xChannelSelector="R" yChannelSelector="G" result="d"/>
          <feColorMatrix in="d" type="matrix" values="0 0 0 0 1  0 0 0 0 0.42  0 0 0 0 0.18  1.9 0 0 0 -0.86"/>
        </filter>`,
        body: `<rect x="${-PAD}" y="${-PAD}" width="${W + PAD * 2}" height="${H + PAD * 2}" filter="url(#flame)"/>`,
      };
      const body = `
        ${ellipse("deep", 1500, 700, 1500, 900)}
        ${ellipse("forge", 2150, 760, 900, 820)}
        <g mask="url(#rightEdge)" opacity="0.55">{{layer:flame}}</g>
        ${particles(rand, { count: 80, region: [1400, 100, 2400, 1300], radius: [1.2, 3.2], color: ["#ffd9a0", "#ffa050"], opacity: [0.3, 0.85], filter: "sparks", stretch: 3.2, rotate: -60 })}`;
      return { defs, body, layers: { flame } };
    },
  },
  {
    key: "green-1",
    title: "Canopy light",
    seed: 501,
    base: ["#07140f", "#0c2418", "#0a1a14"],
    tint: "#2fbf6a",
    paint(rand) {
      const defs = `
        ${glow("sunpatch", "#d8f0a0", 0.32)}
        ${glow("leafglow", "#2e8f55", 0.42)}
        <filter id="leaves" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.0055" numOctaves="3" seed="97" result="n"/>
          <feColorMatrix in="n" type="luminanceToAlpha" result="l"/>
          <feComponentTransfer in="l"><feFuncA type="table" tableValues="0 0 0 0.9 1 1"/></feComponentTransfer>
          <feColorMatrix type="matrix" values="0 0 0 0 0.02  0 0 0 0 0.06  0 0 0 0 0.04  0 0 0 1 0"/>
          <feGaussianBlur stdDeviation="9"/>
        </filter>
        ${linear("leafMask", 90, [[0, "#ffffff", 0.95], [0.5, "#ffffff", 0.25], [0.75, "#ffffff", 0]])}
        <mask id="upper"><rect width="${W}" height="${H}" fill="url(#leafMask)"/></mask>
        ${blurFilter("bokeh", 9)}
        ${blurFilter("soft", 24)}`;
      const body = `
        ${ellipse("leafglow", 1700, 520, 1500, 900)}
        ${ellipse("sunpatch", 1850, 240, 760, 420)}
        ${shafts(rand, { origin: [2000, -300], count: 9, spread: [95, 128], length: 1800, width: [26, 84], color: "#e6f6b8", opacity: [0.025, 0.06], filter: "soft" })}
        ${particles(rand, { count: 34, region: [1300, 40, 2400, 900], radius: [14, 46], color: ["#d9f29b", "#9fdc7a", "#f1e6a0"], opacity: [0.08, 0.22], filter: "bokeh" })}
        <g mask="url(#upper)"><rect width="${W}" height="${H}" filter="url(#leaves)" opacity="0.6"/></g>`;
      return { defs, body };
    },
  },
  {
    key: "green-2",
    title: "Forest mist",
    seed: 502,
    base: ["#08150f", "#0f2a1c", "#0b1d15"],
    tint: "#4fcf7f",
    paint(rand) {
      const defs = `
        ${glow("dawn", "#c9e7a4", 0.3)}
        ${blurFilter("ridge", 6)}
        ${blurFilter("fireflies", 3)}
        ${noiseFilter("mist", { freq: "0.0009 0.006", octaves: 5, seed: 103, color: "#b8dcb8", gain: 1.6, bias: -0.72 })}`;
      // Layered tree lines: each a ragged horizon, lighter (hazier) further back.
      let ridges = "";
      // Far to near: lighter, hazier and softer further back (aerial
      // perspective), each a line of rounded crowns on a slow roll.
      const layers = [
        { y: 640, amp: 90, crown: [40, 80], color: "#2f5e45", op: 0.62, blur: 10 },
        { y: 780, amp: 100, crown: [50, 95], color: "#1f4834", op: 0.78, blur: 6 },
        { y: 930, amp: 110, crown: [60, 110], color: "#133525", op: 0.9, blur: 3.5 },
        { y: 1100, amp: 120, crown: [70, 130], color: "#0a2118", op: 0.97, blur: 2 },
      ];
      layers.forEach((layer, li) => {
        let d = `M -40 ${H + 40} L -40 ${layer.y}`;
        let x = -40;
        while (x <= W + 40) {
          const w = layer.crown[0] + rand() * (layer.crown[1] - layer.crown[0]);
          const roll = Math.sin(x / 260 + li * 1.7) * 0.6 + Math.sin(x / 97 + li) * 0.25;
          const top = layer.y - (roll + 0.9) * layer.amp * 0.5 - rand() * layer.amp * 0.35;
          d += ` Q ${round(x + w / 2)} ${round(top - w * 0.35)} ${round(x + w)} ${round(top + w * 0.15)}`;
          x += w;
        }
        d += ` L ${W + 40} ${H + 40} Z`;
        ridges += `<g filter="url(#ridge${li})"><path d="${d}" fill="${layer.color}" fill-opacity="${layer.op}"/></g>`;
      });
      const ridgeFilters = layers.map((layer, li) => blurFilter(`ridge${li}`, layer.blur)).join("");
      const body = `
        <defs>${ridgeFilters}</defs>
        ${ellipse("dawn", 1750, 520, 1400, 460)}
        ${ridges}
        <rect width="${W}" height="${H}" filter="url(#mist)" opacity="0.3"/>
        ${particles(rand, { count: 42, region: [1100, 500, 2400, 1250], radius: [2.4, 5.5], color: ["#e8f7a6", "#c4ee8a"], opacity: [0.35, 0.8], filter: "fireflies" })}`;
      return { defs, body };
    },
  },
  {
    key: "multicolor-1",
    title: "Gilded ribbons",
    seed: 601,
    base: ["#120f22", "#1d1730", "#121426"],
    tint: GOLD,
    paint(rand) {
      const defs = `
        ${glow("gold", GOLD, 0.34)}
        ${glow("violet", PURPLE_DEEP, 0.4)}
        ${linear("ribbon", 0, [[0, GOLD_LIGHT, 0], [0.4, GOLD_LIGHT, 0.85], [0.7, GOLD, 0.6], [1, "#b8904a", 0]])}
        ${linear("ribbon2", 0, [[0, PURPLE, 0], [0.5, PURPLE, 0.7], [1, PURPLE, 0]])}
        ${blurFilter("ribbonBlur", 10)}
        ${blurFilter("ribbonCore", 2)}
        ${blurFilter("dust", 1.6)}`;
      // Two loose bundles of silk, each strand its own curve — they cross,
      // drift apart and run off the right edge (never a parallel "wave").
      let ribbons = "";
      for (let i = 0; i < 12; i += 1) {
        const lower = i % 2 === 0;
        const y0 = (lower ? 760 : 300) + (rand() - 0.5) * 260;
        const x0 = 980 + rand() * 260;
        const c1 = [x0 + 380 + rand() * 260, y0 + (lower ? -1 : 1) * (180 + rand() * 260)];
        const c2 = [x0 + 820 + rand() * 300, y0 + (lower ? 1 : -1) * (120 + rand() * 300)];
        const end = [W + 80, y0 + (rand() - 0.5) * 420];
        const d = `M ${round(x0)} ${round(y0)} C ${round(c1[0])} ${round(c1[1])}, ${round(c2[0])} ${round(c2[1])}, ${round(end[0])} ${round(end[1])}`;
        const op = 0.14 + rand() * 0.26;
        ribbons += `<path d="${d}" fill="none" stroke="url(#${i % 4 === 3 ? "ribbon2" : "ribbon"})" stroke-opacity="${round(op * 100) / 100}" stroke-width="${round(3 + Math.pow(rand(), 2) * 26)}" stroke-linecap="round"/>`;
      }
      const body = `
        ${ellipse("violet", 1500, 600, 1500, 800)}
        ${ellipse("gold", 1900, 560, 900, 560)}
        <g filter="url(#ribbonBlur)">${ribbons}</g>
        <g filter="url(#ribbonCore)" opacity="0.5">${ribbons}</g>
        ${particles(rand, { count: 90, region: [1150, 80, 2400, 1250], radius: [1.2, 3.6], color: [GOLD_LIGHT, GOLD, "#fff1cc"], opacity: [0.25, 0.75], filter: "dust" })}`;
      return { defs, body };
    },
  },
  {
    key: "multicolor-2",
    title: "Aurora",
    seed: 602,
    base: ["#0b1122", "#121a30", "#0c1122"],
    tint: "#b794e6",
    paint(rand) {
      // Curtains of light in the five mana hues, muted toward navy and
      // folded by turbulence — a sky, never a symbol or a rainbow.
      const hues = ["#efe4c0", "#3d9be6", "#8a6cc8", "#e8574f", "#2fb36a"];
      const defs = `
        ${glow("centre", "#b794e6", 0.22)}
        ${linear("ray", 90, [[0, "#ffffff", 0], [0.5, "#ffffff", 0.3], [0.84, "#ffffff", 1], [1, "#ffffff", 0]])}
        <filter id="curtainSoft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="5 22"/></filter>
        <filter id="curtainGlow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="36 60"/></filter>
        ${blurFilter("stars", 1.1)}`;
      // Two curtains, each a run of thin vertical rays standing on a slow
      // curve: bright at the foot, fading upward — the hue drifts along
      // the run through the five muted mana colours.
      const hueAt = (t) => {
        const f = Math.min(hues.length - 1.0001, Math.max(0, t * (hues.length - 1)));
        const i = Math.floor(f);
        return mix(mix(hues[i], hues[i + 1], f - i), NAVY, 0.2);
      };
      let curtains = "";
      for (const run of [
        { x0: 1080, x1: 2460, foot: 760, amp: 120, rise: [260, 520], op: 0.55, phase: 0.6 },
        { x0: 1300, x1: 2460, foot: 560, amp: 90, rise: [200, 380], op: 0.32, phase: 2.1 },
      ]) {
        for (let x = run.x0; x <= run.x1; x += 7) {
          const t = (x - run.x0) / (run.x1 - run.x0);
          const foot = run.foot + Math.sin(t * Math.PI * 2.2 + run.phase) * run.amp + Math.sin(t * 19) * 14;
          const h = run.rise[0] + rand() * (run.rise[1] - run.rise[0]);
          const edge = Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5);
          const a = run.op * edge * (0.55 + rand() * 0.45);
          curtains += `<rect x="${x}" y="${round(foot - h)}" width="6" height="${round(h)}" fill="${hueAt(t)}" fill-opacity="${round(a * 100) / 100}" mask="url(#rayMask)"/>`;
        }
      }
      const rayMask = `<mask id="rayMask" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#ray)"/></mask>`;
      const body = `
        <defs>${rayMask}</defs>
        ${ellipse("centre", 1900, 760, 1200, 700)}
        <g filter="url(#curtainGlow)" opacity="0.8">${curtains}</g>
        <g filter="url(#curtainSoft)" opacity="0.9">${curtains}</g>
        ${particles(rand, { count: 170, region: [0, 0, 2400, 1000], radius: [0.9, 2.4], color: ["#ffffff", "#e8dcff", "#ffeec8"], opacity: [0.18, 0.7], filter: "stars" })}`;
      return { defs, body };
    },
  },
  {
    key: "colorless-1",
    title: "Brushed steel",
    seed: 701,
    base: ["#12151b", "#1d222b", "#14171d"],
    tint: "#a7adba",
    paint(rand) {
      const defs = `
        ${glow("sheen", "#c9d2e0", 0.3)}
        ${glow("cold", "#6f7a8f", 0.3)}
        ${noiseFilter("brushed", { freq: "0.0005 0.03", octaves: 2, seed: 113, color: "#c8ceda", gain: 1.1, bias: -0.5, blur: 1.4 })}
        ${blurFilter("lines", 1.4)}
        ${blurFilter("glint", 2)}
        ${blurFilter("band", 60)}
        ${linear("plateMask", 0, [[0.38, "#ffffff", 0], [0.72, "#ffffff", 0.75], [1, "#ffffff", 1]])}
        <mask id="plate"><rect width="${W}" height="${H}" fill="url(#plateMask)"/></mask>`;
      // A faint engineering grid, skewed so it reads as a machined plate,
      // never a symbol; a diagonal sheen across it.
      let grid = "";
      for (let x = 1100; x <= W + 300; x += 120) grid += `<line x1="${x}" y1="-50" x2="${x - 260}" y2="${H + 50}" stroke="#d6dce8" stroke-opacity="0.1" stroke-width="1.8"/>`;
      for (let y = 60; y <= H; y += 120) grid += `<line x1="1000" y1="${y}" x2="${W}" y2="${y + 36}" stroke="#d6dce8" stroke-opacity="0.07" stroke-width="1.6"/>`;
      const body = `
        ${ellipse("cold", 1500, 800, 1600, 800)}
        ${ellipse("sheen", 1900, 380, 1100, 380, `transform="rotate(-12 1900 380)"`)}
        <g mask="url(#plate)"><rect width="${W}" height="${H}" filter="url(#brushed)" opacity="0.22"/></g>
        <g mask="url(#plate)" filter="url(#lines)">${grid}</g>
        <path d="M 1500 -100 L 1820 -100 L 1260 1450 L 940 1450 Z" fill="#e6ecf6" fill-opacity="0.05" filter="url(#band)"/>
        <path d="M 2050 -100 L 2190 -100 L 1630 1450 L 1490 1450 Z" fill="#e6ecf6" fill-opacity="0.045" filter="url(#band)"/>
        ${particles(rand, { count: 18, region: [1400, 150, 2350, 1100], radius: [1.6, 3.4], color: "#f0f4fa", opacity: [0.25, 0.6], filter: "glint" })}`;
      return { defs, body };
    },
  },
  {
    key: "colorless-2",
    title: "Void ripples",
    seed: 702,
    base: ["#101016", "#191a22", "#111117"],
    tint: "#8d8aa6",
    paint(rand) {
      const defs = `
        ${glow("pale", "#b9b6cf", 0.24)}
        ${blurFilter("ripple", 2.2)}
        ${blurFilter("wide", 40)}
        ${noiseFilter("dust", { freq: "0.0018 0.0018", octaves: 4, seed: 127, color: "#9d9ab3", gain: 1.4, bias: -0.62 })}`;
      let rings = "";
      for (let i = 0; i < 16; i += 1) {
        const r = 160 + i * i * 9 + i * 46;
        const op = 0.22 * Math.pow(1 - i / 16, 1.3);
        rings += `<ellipse cx="2080" cy="560" rx="${round(r * 1.18)}" ry="${round(r)}" fill="none" stroke="#d7d4ea" stroke-opacity="${round(op * 100) / 100}" stroke-width="${round(1.2 + rand() * 1.6)}"/>`;
      }
      const body = `
        ${ellipse("pale", 2080, 560, 900, 700)}
        <rect width="${W}" height="${H}" filter="url(#dust)" opacity="0.3"/>
        <g filter="url(#ripple)">${rings}</g>
        <circle cx="2080" cy="560" r="120" fill="#06060a" fill-opacity="0.55" filter="url(#wide)"/>`;
      return { defs, body };
    },
  },
  {
    key: "neutral-1",
    title: "Astral navy",
    seed: 801,
    base: [NAVY, SURFACE, NAVY],
    tint: PURPLE,
    paint(rand) {
      const defs = `
        ${glow("violet", PURPLE_DEEP, 0.5)}
        ${glow("gold", GOLD, 0.22)}
        ${noiseFilter("wisps", { freq: "0.0011 0.0024", octaves: 5, seed: 131, color: "#9b82d6", gain: 1.6, bias: -0.74 })}
        ${linear("wispMask", 0, [[0.3, "#ffffff", 0], [0.75, "#ffffff", 0.9], [1, "#ffffff", 1]])}
        <mask id="wisp"><rect width="${W}" height="${H}" fill="url(#wispMask)"/></mask>
        ${blurFilter("stars", 1.1)}
        ${blurFilter("bright", 3.5)}`;
      const body = `
        ${ellipse("violet", 1750, 360, 1300, 760)}
        ${ellipse("gold", 2050, 1100, 900, 420)}
        <g mask="url(#wisp)"><rect width="${W}" height="${H}" filter="url(#wisps)" opacity="0.45"/></g>
        ${particles(rand, { count: 220, region: [0, 0, 2400, 1350], radius: [0.8, 2.2], color: ["#ffffff", "#dfe4f2", "#efe3c6"], opacity: [0.15, 0.7], filter: "stars" })}
        ${particles(rand, { count: 14, region: [1200, 60, 2400, 1200], radius: [2.6, 4.4], color: ["#ffffff", GOLD_LIGHT], opacity: [0.5, 0.85], filter: "bright" })}`;
      return { defs, body };
    },
  },
  {
    key: "neutral-2",
    title: "Nebula",
    seed: 802,
    base: ["#0b1020", "#131a30", "#0b1020"],
    tint: "#6b8fd6",
    paint(rand) {
      const defs = `
        ${noiseFilter("nebulaA", { freq: "0.0012 0.0018", octaves: 5, seed: 137, color: "#7a5cc0", gain: 1.6, bias: -0.66 })}
        ${noiseFilter("nebulaB", { freq: "0.0016 0.0012", octaves: 5, seed: 139, color: "#3f8fb8", gain: 1.6, bias: -0.74 })}
        ${linear("nebMask", 0, [[0.25, "#ffffff", 0], [0.7, "#ffffff", 0.85], [1, "#ffffff", 1]])}
        <mask id="neb"><rect width="${W}" height="${H}" fill="url(#nebMask)"/></mask>
        ${glow("core", "#c7b3ff", 0.22)}
        ${blurFilter("stars", 1.1)}`;
      const body = `
        <g mask="url(#neb)">
          <rect width="${W}" height="${H}" filter="url(#nebulaA)" opacity="0.7"/>
          <rect width="${W}" height="${H}" filter="url(#nebulaB)" opacity="0.5"/>
        </g>
        ${ellipse("core", 1850, 560, 900, 520)}
        ${particles(rand, { count: 240, region: [0, 0, 2400, 1350], radius: [0.8, 2.3], color: ["#ffffff", "#dfe8ff", "#f1e7ff"], opacity: [0.15, 0.75], filter: "stars" })}`;
      return { defs, body };
    },
  },
];

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/** librsvg works a filter only inside the canvas, so a displaced field
 *  samples nothing past the edge and shows a hard seam there. A painter's
 *  `layers` are drawn on a canvas PAD px larger all round, cut back to the
 *  cover and dropped in where the body says `{{layer:<name>}}`. */
const PAD = 320;

async function renderLayer({ defs, body }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W + PAD * 2}" height="${H + PAD * 2}">
<defs>${defs}</defs><g transform="translate(${PAD} ${PAD})">${body}</g></svg>`;
  const png = await sharp(Buffer.from(svg))
    .extract({ left: PAD, top: PAD, width: W, height: H })
    .png()
    .toBuffer();
  return `<image href="data:image/png;base64,${png.toString("base64")}" x="0" y="0" width="${W}" height="${H}"/>`;
}

async function coverSvg(cover) {
  const rand = rng(cover.seed);
  const [a, b, c] = cover.base;
  const baseDefs = `${linear("base", 28, [[0, a], [0.55, b], [1, c]])}`;
  const painted = cover.paint(rand);
  let body = painted.body;
  for (const [name, layer] of Object.entries(painted.layers ?? {})) {
    body = body.replace(`{{layer:${name}}}`, await renderLayer(layer));
  }
  const done = finish(cover.tint);
  return svgDoc(
    baseDefs + painted.defs + done.defs,
    `<rect width="${W}" height="${H}" fill="url(#base)"/>${body}${done.body}`,
  );
}

/** A fine, seeded film grain: luminance noise blended soft-light, so flat
 *  gradients never band on a wide screen. */
function grain(seed, amount = 16) {
  const rand = rng(seed ^ 0x9e3779b9);
  const px = Buffer.alloc(W * H);
  for (let i = 0; i < px.length; i += 1) px[i] = 128 + Math.round((rand() + rand() - 1) * amount);
  return sharp(px, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
}

/** A last lift toward MID values: the hero lays a navy scrim over the
 *  title side, so the picture itself may be a step brighter than the page —
 *  the colour has to read through the scrim. */
const LIFT = { brightness: 1.2, saturation: 1.08 };

async function renderCover(cover) {
  const png = await sharp(Buffer.from(await coverSvg(cover))).png().toBuffer();
  const lifted = await sharp(png).modulate(LIFT).png().toBuffer();
  const noise = await grain(cover.seed);
  return sharp(lifted)
    .composite([{ input: noise, blend: "soft-light" }])
    .removeAlpha()
    .webp({ quality: QUALITY, smartSubsample: true, effort: 6 })
    .toBuffer();
}

async function main() {
  const args = process.argv.slice(2);
  const onlyArg = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const only = onlyArg ? new Set(onlyArg.split(",")) : null;
  const outDir = args.includes("--out")
    ? path.resolve(args[args.indexOf("--out") + 1])
    : path.join(ROOT, "public", "defaults", "deck-covers");
  await mkdir(outDir, { recursive: true });

  for (const cover of COVERS) {
    if (only && !only.has(cover.key)) continue;
    const bytes = await renderCover(cover);
    const file = path.join(outDir, `${cover.key}.webp`);
    await writeFile(file, bytes);
    const kb = (bytes.byteLength / 1024).toFixed(0);
    const flag = bytes.byteLength > MAX_BYTES ? "  ⚠ over budget" : "";
    console.log(`${cover.key.padEnd(14)} ${kb.padStart(4)} KB  ${cover.title}${flag}`);
  }
}

await main();
