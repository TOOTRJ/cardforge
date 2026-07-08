// ---------------------------------------------------------------------------
// Pure string builders for static brand assets (public/brand/*). Only
// scripts/generate-brand-assets.mjs consumes these — the React/Satori
// renders live in glyph.tsx and components/layout/logo.tsx. Unlike the
// Satori path, gradients and SVG filters are fine here: browsers and
// librsvg (sharp) render them properly.
//
// Erasable-syntax-only: node scripts import this via type-stripping
// (node ≥23.6; import with the explicit ".ts" extension).
// ---------------------------------------------------------------------------

// Explicit .ts extensions: node's type-stripping resolver (which runs this
// file via scripts/generate-brand-assets.mjs) does not resolve
// extensionless specifiers.
import { BRAND } from "./constants.ts";
import {
  ROSE_GEM_FACET_PATH,
  ROSE_GEM_PATH,
  ROSE_ORBIT_PIP,
  ROSE_RING,
  ROSE_STAR_CUT_PATH,
  ROSE_STAR_PATH,
  ROSE_TICKS_PATH,
  ROSE_WAKE,
} from "./geometry.ts";
import { WORDMARK } from "./wordmark.ts";

const XMLNS = `xmlns="http://www.w3.org/2000/svg"`;

/** userSpaceOnUse: objectBoundingBox gradients vanish on zero-width
 *  geometry like the tick strokes; every mark shares the 0–32 grid. */
const GOLD_GRAD = `<linearGradient id="pg-gold" gradientUnits="userSpaceOnUse" x1="5" y1="5" x2="27" y2="27"><stop offset="0%" stop-color="${BRAND.goldLight}"/><stop offset="100%" stop-color="${BRAND.goldDeep}"/></linearGradient>`;

/** Raised relief: bevel light from the upper-left + lift shadow. */
const POP_FILTER = `<filter id="pg-pop" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceAlpha" stdDeviation="0.7" result="blur"/><feSpecularLighting in="blur" surfaceScale="2.7" specularConstant="0.95" specularExponent="15" lighting-color="#ffe6b8" result="spec"><feDistantLight azimuth="235" elevation="36"/></feSpecularLighting><feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn"/><feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="lit"/><feDropShadow in="lit" dx="0.5" dy="1" stdDeviation="0.6" flood-color="#04070e" flood-opacity="0.9"/></filter>`;

/** Carved socket: dark inner edge at the top reads as chiseled. */
const CARVE_FILTER = `<filter id="pg-carve" x="-25%" y="-25%" width="150%" height="150%"><feOffset in="SourceAlpha" dx="0" dy="1.7" result="off"/><feGaussianBlur in="off" stdDeviation="1.5" result="blurred"/><feComposite operator="out" in="SourceAlpha" in2="blurred" result="strip"/><feFlood flood-color="#000000" flood-opacity="0.8" result="black"/><feComposite operator="in" in="black" in2="strip" result="shadow"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="shadow"/></feMerge></filter>`;

/** Two-layer lift with a light kiss — the Levitant float. */
const FLOAT_FILTER = `<filter id="pg-float" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur in="SourceAlpha" stdDeviation="0.5" result="blur"/><feSpecularLighting in="blur" surfaceScale="1.6" specularConstant="0.6" specularExponent="12" lighting-color="#ffe6b8" result="spec"><feDistantLight azimuth="235" elevation="40"/></feSpecularLighting><feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn"/><feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3="0.8" k4="0" result="lit"/><feDropShadow in="lit" dx="0" dy="1" stdDeviation="0.7" flood-color="#04070e" flood-opacity="0.9" result="s1"/><feDropShadow in="s1" dx="0" dy="3" stdDeviation="2.6" flood-color="#04070e" flood-opacity="0.45"/></filter>`;

/** Shadow-only lift for containers — flat faces under a distant light
 *  pick up a uniform sheen and wash out. */
const FLOAT_SHADOW_FILTER = `<filter id="pg-float-s" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="1" stdDeviation="0.7" flood-color="#04070e" flood-opacity="0.9" result="s1"/><feDropShadow in="s1" dx="0" dy="3" stdDeviation="2.6" flood-color="#04070e" flood-opacity="0.45"/></filter>`;

/** The Astral Rose in full color on the 0–32 grid. */
function roseInner({ gold }: { gold: string }): string {
  const wake = ROSE_WAKE.map(
    (s) =>
      `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${BRAND.goldLight}" opacity="0.85"/>`,
  ).join("");
  return (
    `<circle cx="${ROSE_RING.cx}" cy="${ROSE_RING.cy}" r="${ROSE_RING.r}" stroke="${gold}" stroke-width="0.9" opacity="0.55" fill="none"/>` +
    `<path d="${ROSE_TICKS_PATH}" stroke="${gold}" stroke-width="0.9" opacity="0.7" fill="none"/>` +
    `<path d="${ROSE_STAR_PATH}" fill="${gold}"/>` +
    `<path d="${ROSE_GEM_PATH}" fill="${BRAND.purpleDeep}" stroke="${BRAND.navy}" stroke-width="0.8"/>` +
    `<path d="${ROSE_GEM_FACET_PATH}" fill="${BRAND.purple}"/>` +
    `<circle cx="${ROSE_ORBIT_PIP.cx}" cy="${ROSE_ORBIT_PIP.cy}" r="${ROSE_ORBIT_PIP.r}" fill="${BRAND.purpleDeep}" stroke="${BRAND.purple}" stroke-width="0.7"/>` +
    wake
  );
}

/** One-color rose (gem cut out) for mono renders. */
function roseMonoInner(color: string): string {
  const wake = ROSE_WAKE.map(
    (s) =>
      `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${color}" opacity="0.85"/>`,
  ).join("");
  return (
    `<circle cx="${ROSE_RING.cx}" cy="${ROSE_RING.cy}" r="${ROSE_RING.r}" stroke="${color}" stroke-width="1.1" opacity="0.5" fill="none"/>` +
    `<path d="${ROSE_TICKS_PATH}" stroke="${color}" stroke-width="0.9" opacity="0.7" fill="none"/>` +
    `<path d="${ROSE_STAR_CUT_PATH}" fill="${color}" fill-rule="evenodd"/>` +
    `<circle cx="${ROSE_ORBIT_PIP.cx}" cy="${ROSE_ORBIT_PIP.cy}" r="${ROSE_ORBIT_PIP.r}" fill="${color}"/>` +
    wake
  );
}

type MarkVariant = "gradient" | "flat" | "mono";

/** Standalone mark on a transparent background. */
export function markSvg({
  variant,
  color = "#000000",
}: {
  variant: MarkVariant;
  color?: string;
}): string {
  const defs = variant === "gradient" ? `<defs>${GOLD_GRAD}</defs>` : "";
  const inner =
    variant === "mono"
      ? roseMonoInner(color)
      : roseInner({ gold: variant === "gradient" ? "url(#pg-gold)" : BRAND.gold });
  return `<svg viewBox="0 0 32 32" fill="none" ${XMLNS}>${defs}${inner}</svg>`;
}

/** Deep Seal — carved socket, gold rim, deep relief (the site header). */
export function sealSvg(): string {
  return (
    `<svg viewBox="-2 -2 36 36" fill="none" ${XMLNS}>` +
    `<defs>${GOLD_GRAD}${CARVE_FILTER}${POP_FILTER}</defs>` +
    `<circle cx="16" cy="16" r="15.3" fill="${BRAND.socket}" filter="url(#pg-carve)"/>` +
    `<circle cx="16" cy="16" r="15.3" stroke="url(#pg-gold)" stroke-width="0.9" opacity="0.8" fill="none"/>` +
    `<path d="M29.25 23.65 A15.3 15.3 0 0 1 2.75 23.65" stroke="${BRAND.goldLight}" stroke-width="0.7" opacity="0.16" fill="none"/>` +
    `<g filter="url(#pg-pop)" transform="translate(16 16) scale(0.88) translate(-16 -16)">${roseInner({ gold: "url(#pg-gold)" })}</g>` +
    `</svg>`
  );
}

/** Medallion — gold-bordered floating coin (avatars, social profiles). */
export function medallionSvg(): string {
  return (
    `<svg viewBox="-5 -5 42 42" fill="none" ${XMLNS}>` +
    `<defs>${GOLD_GRAD}${POP_FILTER}${FLOAT_SHADOW_FILTER}</defs>` +
    `<g filter="url(#pg-float-s)">` +
    `<circle cx="16" cy="16" r="15" fill="${BRAND.ink}"/>` +
    `<circle cx="16" cy="16" r="15" stroke="url(#pg-gold)" stroke-width="1.2" fill="none"/>` +
    `<circle cx="16" cy="16" r="13.5" stroke="${BRAND.purple}" stroke-width="0.4" opacity="0.35" fill="none"/>` +
    `<g transform="translate(16 16) scale(0.8) translate(-16 -16)" filter="url(#pg-pop)">${roseInner({ gold: "url(#pg-gold)" })}</g>` +
    `</g></svg>`
  );
}

/** Sigil Plaque — bordered rounded-square tile (app-icon form). */
export function plaqueSvg(): string {
  return (
    `<svg viewBox="-5 -5 42 42" fill="none" ${XMLNS}>` +
    `<defs>${GOLD_GRAD}${POP_FILTER}${FLOAT_SHADOW_FILTER}</defs>` +
    `<g filter="url(#pg-float-s)">` +
    `<rect x="2" y="2" width="28" height="28" rx="7" fill="#141a29"/>` +
    `<rect x="2" y="2" width="28" height="28" rx="7" stroke="url(#pg-gold)" stroke-width="1.1" fill="none"/>` +
    `<rect x="4.1" y="4.1" width="23.8" height="23.8" rx="5.4" stroke="${BRAND.purple}" stroke-width="0.4" opacity="0.3" fill="none"/>` +
    `<g transform="translate(16 16) scale(0.74) translate(-16 -16)" filter="url(#pg-pop)">${roseInner({ gold: "url(#pg-gold)" })}</g>` +
    `</g></svg>`
  );
}

/** Levitant — borderless float (hero moments). */
export function levitantSvg(): string {
  return (
    `<svg viewBox="-5 -5 42 42" fill="none" ${XMLNS}>` +
    `<defs>${GOLD_GRAD}${FLOAT_FILTER}</defs>` +
    `<g filter="url(#pg-float)">${roseInner({ gold: "url(#pg-gold)" })}</g>` +
    `</svg>`
  );
}

/** Full-bleed manifest icon square; `maskable` keeps the rose inside the
 *  80% safe zone so platform masks never clip it. */
export function manifestIconSvg({ maskable }: { maskable: boolean }): string {
  const scale = maskable ? 0.62 : 0.8;
  return (
    `<svg viewBox="0 0 32 32" fill="none" ${XMLNS}>` +
    `<defs>${GOLD_GRAD}</defs>` +
    `<rect x="0" y="0" width="32" height="32" fill="${BRAND.navy}"/>` +
    `<g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${roseInner({ gold: "url(#pg-gold)" })}</g>` +
    `</svg>`
  );
}

/** Outlined Cinzel "PipGlyph" wordmark, tight box, no font dependency. */
export function wordmarkSvg({ theme }: { theme: "dark" | "light" }): string {
  const fill = theme === "dark" ? BRAND.foreground : BRAND.surface;
  const pad = 4;
  const vb = `${WORDMARK.x1 - pad} ${WORDMARK.y1 - pad} ${WORDMARK.width + pad * 2} ${WORDMARK.height + pad * 2}`;
  return `<svg viewBox="${vb}" ${XMLNS}><path d="${WORDMARK.path}" fill="${fill}"/></svg>`;
}

/** Mark + wordmark lockup on a transparent background. Units: the mark is
 *  drawn 100 tall; the wordmark path is ~73 tall on its own baseline. */
export function lockupSvg({
  layout,
  theme,
}: {
  layout: "horizontal" | "stacked";
  theme: "dark" | "light";
}): string {
  const textFill = theme === "dark" ? BRAND.foreground : BRAND.surface;
  const mark = `<g transform="scale(3.125)">${roseInner({ gold: "url(#pg-gold)" })}</g>`; // 32 → 100
  const wm = (x: number, y: number, scale: number) =>
    `<g transform="translate(${x} ${y}) scale(${scale}) translate(${-WORDMARK.x1} ${-WORDMARK.y1})"><path d="${WORDMARK.path}" fill="${textFill}"/></g>`;
  if (layout === "horizontal") {
    // mark 100×100, gap 28, wordmark scaled to 62 tall, optically centered
    const s = 62 / WORDMARK.height;
    const w = 100 + 28 + WORDMARK.width * s;
    return `<svg viewBox="0 0 ${Math.ceil(w)} 100" fill="none" ${XMLNS}><defs>${GOLD_GRAD}</defs>${mark}${wm(128, 20, s)}</svg>`;
  }
  // stacked: mark centered over wordmark scaled to full width 240
  const s = 240 / WORDMARK.width;
  const wmH = WORDMARK.height * s;
  const h = 100 + 26 + wmH;
  return `<svg viewBox="0 0 240 ${Math.ceil(h)}" fill="none" ${XMLNS}><defs>${GOLD_GRAD}</defs><g transform="translate(70 0)">${mark}</g>${wm(0, 126, s)}</svg>`;
}

/** Social banner: navy gradient stage, centered lockup, WUBRG base strip. */
export function bannerSvg({
  width,
  height,
  manaPips,
}: {
  width: number;
  height: number;
  manaPips: ReadonlyArray<{ color: string; label: string }>;
}): string {
  const stripH = Math.round(height * 0.012) + 4;
  const pipW = width / manaPips.length;
  const strip = manaPips
    .map(
      (p, i) =>
        `<rect x="${i * pipW}" y="${height - stripH}" width="${pipW + 1}" height="${stripH}" fill="${p.color}" opacity="0.7"/>`,
    )
    .join("");
  // Horizontal lockup sized to ~46% of banner width, centered.
  // 558 = the horizontal lockup's intrinsic viewBox width (mark 100 +
  // gap 28 + wordmark 429.5 at 62 tall).
  const lockupW = Math.round(width * 0.46);
  const lockupH = Math.round(lockupW * (100 / 558));
  const lx = Math.round((width - lockupW) / 2);
  const ly = Math.round((height - stripH - lockupH) / 2);
  const s = lockupH / 100;
  const wmScale = (62 / WORDMARK.height) * s;
  return (
    `<svg viewBox="0 0 ${width} ${height}" ${XMLNS}>` +
    `<defs>${GOLD_GRAD}` +
    `<linearGradient id="pg-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${BRAND.navy}"/><stop offset="50%" stop-color="${BRAND.surface}"/><stop offset="100%" stop-color="${BRAND.navy}"/></linearGradient>` +
    `<radialGradient id="pg-glow" cx="0.3" cy="0.2" r="0.8"><stop offset="0%" stop-color="rgba(107,77,154,0.28)"/><stop offset="70%" stop-color="rgba(107,77,154,0)"/></radialGradient>` +
    `</defs>` +
    `<rect width="${width}" height="${height}" fill="url(#pg-bg)"/>` +
    `<rect width="${width}" height="${height}" fill="url(#pg-glow)"/>` +
    `<g transform="translate(${lx} ${ly}) scale(${s})"><g transform="scale(3.125)">${roseInner({ gold: "url(#pg-gold)" })}</g></g>` +
    `<g transform="translate(${lx + 128 * s} ${ly + 20 * s}) scale(${wmScale}) translate(${-WORDMARK.x1} ${-WORDMARK.y1})"><path d="${WORDMARK.path}" fill="${BRAND.foreground}"/></g>` +
    strip +
    `</svg>`
  );
}
