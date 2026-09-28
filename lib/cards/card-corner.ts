// ---------------------------------------------------------------------------
// ONE card corner radius (TODO 3.26, owner-approved 2026-09-27).
//
// Every surface that cuts a card's corner reads it from here: the CSS clip
// on display surfaces (app/globals.css .card-corners / .card-corners-
// landscape / .card-hover-glare — tests/unit/cards/card-corner.test.ts keeps
// them equal to CARD_CORNER_CSS), the bake's transparent corner mask, the OG
// composite's card box and the Card Conjurer importer's master cut
// (scripts/lib/cc-frames.mjs).
//
// The radius is a fraction of the card's SHORT side — the physical card
// width, in portrait AND landscape — so the corner is circular in both
// orientations: 64.5 px at 1500×2100 and at 2100×1500. Scryfall's non-Alpha
// scans cut 32.2–32.3 px on 745 (4.32–4.34 %); Alpha (LEA) prints are ~7 %
// and get the same 4.3 % (one constant for every template, owner decision).
//
// This module has NO imports: scripts/*.mjs load it through Node's type
// stripping with an explicit `.ts` specifier (as scripts/import-cc-frames.mjs
// loads lib/frames/edge-contract.ts), so keep it to erasable TypeScript.
// ---------------------------------------------------------------------------

/** The card corner radius as a fraction of the card's SHORT side. */
export const CARD_CORNER_OF_SHORT_SIDE = 0.043;

/**
 * The corner radius in px for a `width`×`height` card image: 4.3 % of the
 * short side. NEVER round it — 1500 × 0.043 is exactly 64.5 and the mask
 * works on the fractional radius (Math.round would give 65).
 */
export function cardCornerRadiusPx(width: number, height: number): number {
  return CARD_CORNER_OF_SHORT_SIDE * Math.min(width, height);
}

/**
 * The CSS twin: an elliptical `border-radius` (horizontal % / vertical %)
 * that draws the same CIRCULAR corner on any 5:7 (portrait) or 7:5
 * (landscape) box. The long-side percentage is 4.3 × 5/7 = 3.0714. Never put
 * the portrait value on a landscape box — that is a 90 × 46 px ellipse at HD.
 */
export const CARD_CORNER_CSS = {
  portrait: "4.3% / 3.0714%",
  landscape: "3.0714% / 4.3%",
} as const;

/**
 * Cut the card's rounded corner into 8-bit RGBA pixels in place: every
 * pixel outside the rounded rectangle has its ALPHA scaled by the coverage
 * k = clamp(0.5 − d, 0, 1), where d is the pixel centre's distance past the
 * arc — a 1 px anti-aliased edge. RGB is never touched, and the radius stays
 * fractional (64.5 at HD). The same formula as the Card Conjurer importer's
 * master cut (scripts/lib/cc-frames.mjs roundCornersRgba8 delegates here),
 * so a master and a bake cut at the same radius agree pixel for pixel.
 *
 * Only the four corner boxes are visited; every other pixel has cx or cy of
 * 0 and is left alone, exactly as a full-image scan would.
 */
export function applyCardCornerMask(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  radius: number = cardCornerRadiusPx(width, height),
): void {
  const r = radius;
  if (!(r > 0)) return;
  // x < r ⟺ x < ceil(r); x ≥ width − r ⟺ x ≥ ceil(width − r). The far box
  // starts after the near one so a radius over half the side never visits a
  // pixel twice.
  const nearX = Math.min(Math.ceil(r), width);
  const farX = Math.max(nearX, Math.ceil(width - r));
  const nearY = Math.min(Math.ceil(r), height);
  const farY = Math.max(nearY, Math.ceil(height - r));
  const cut = (y0: number, y1: number, x0: number, x1: number) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const cx = x < r ? r - x - 0.5 : x >= width - r ? x - (width - r) + 0.5 : 0;
        const cy = y < r ? r - y - 0.5 : y >= height - r ? y - (height - r) + 0.5 : 0;
        if (cx === 0 || cy === 0) continue;
        const d = Math.sqrt(cx * cx + cy * cy) - r;
        if (d <= -0.5) continue;
        const k = d >= 0.5 ? 0 : 0.5 - d;
        const o = (y * width + x) * 4 + 3;
        rgba[o] = Math.round(rgba[o] * k);
      }
    }
  };
  cut(0, nearY, 0, nearX); // top-left
  cut(0, nearY, farX, width); // top-right
  cut(farY, height, 0, nearX); // bottom-left
  cut(farY, height, farX, width); // bottom-right
}

/** A square output's fill for one corner: an sRGB colour, or null — keep
 *  the pixels the render drew there (art or frame design in the corner). */
export type CornerFill = readonly [number, number, number] | null;
/** One CornerFill per corner, in the order top-left, top-right,
 *  bottom-left, bottom-right (lib/frames/square-corners.ts says which). */
export type CardCornerFills = readonly [CornerFill, CornerFill, CornerFill, CornerFill];

/**
 * Square a ROUND card in place — 8-bit straight RGBA whose alpha is
 * applyCardCornerMask's coverage (a round bake, or a raster just masked):
 * in each corner box, a corner with a fill has every see-through pixel
 * composited over it (RGB·α + fill·(1 − α), then opaque) — the fill outside
 * the arc, a blend on the 1 px ramp, the card untouched; a corner whose
 * fill is null is only made opaque again, which gives back exactly what was
 * drawn there (the mask never touches RGB — so null needs the unresized
 * raster, never a downscaled bake, whose see-through RGB is gone).
 *
 * The ONE way a square output is made (TODO 3.26): the bake's square mode
 * (lib/render/satori-png.ts) and a free Square download squared from the
 * stored round bake (lib/render/stored-render.ts) run it with the same
 * fills, so they agree. Only the four corner boxes are visited.
 */
export function squareCardCorners(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  fills: CardCornerFills,
  radius: number = cardCornerRadiusPx(width, height),
): void {
  const r = radius;
  if (!(r > 0)) return;
  const nearX = Math.min(Math.ceil(r), width);
  const farX = Math.max(nearX, Math.ceil(width - r));
  const nearY = Math.min(Math.ceil(r), height);
  const farY = Math.max(nearY, Math.ceil(height - r));
  const square = (y0: number, y1: number, x0: number, x1: number, fill: CornerFill) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const o = (y * width + x) * 4;
        const a = rgba[o + 3];
        if (a === 255) continue;
        if (fill) {
          for (let c = 0; c < 3; c += 1) rgba[o + c] = Math.round((rgba[o + c] * a + fill[c] * (255 - a)) / 255);
        }
        rgba[o + 3] = 255;
      }
    }
  };
  square(0, nearY, 0, nearX, fills[0]); // top-left
  square(0, nearY, farX, width, fills[1]); // top-right
  square(farY, height, 0, nearX, fills[2]); // bottom-left
  square(farY, height, farX, width, fills[3]); // bottom-right
}
