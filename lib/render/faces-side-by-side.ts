import "server-only";

import sharp from "sharp";

// ---------------------------------------------------------------------------
// Both faces of a double-faced card in ONE PNG (TODO 5.3c, owner decision
// 2026-10-05): the front on the left, the back on the right, the way people
// share a transform card — what `/api/cards/[id]/png?faces=both` serves.
//
// This module DRAWS nothing. Each face arrives as the finished PNG its own
// single-face download would be (the stored bake or a live render, the
// corner the request named, the viewer's mark and size), and is copied onto
// a transparent canvas pixel for pixel — raw RGBA rows, no blending, no
// resampling — so each half of the composite is byte-equal to `?face=front`
// / `?face=back` at the same options. Between them a transparent gutter of
// 1/25 of a face's width (60 px at HD, 30 at the free 750 px); round corners
// stay round (their transparent arcs are copied too), a Square download is
// the two opaque rectangles with the gap between.
//
// Never a print file (800 ppi, a bleed, MPC, the exports' print render — one
// face each, the route refuses) and never a JPEG (no alpha for the gutter).
// The stored bakes, the thumbs and the OG image are untouched.
// ---------------------------------------------------------------------------

/** The gutter between the faces, as a fraction of ONE face's width. */
export const FACE_GUTTER_OF_WIDTH = 1 / 25;

/** The gutter in px beside a face `faceWidth` px wide: 60 at HD (1500),
 *  30 at the free 750 px. */
export function faceGutterPx(faceWidth: number): number {
  return Math.round(faceWidth * FACE_GUTTER_OF_WIDTH);
}

/** The composite's size for two faces: the widths plus the gutter, the
 *  taller face's height (the faces are top-aligned; every DFC body today is
 *  the same size on both faces). */
export function sideBySideSize(
  front: { width: number; height: number },
  back: { width: number; height: number },
): { width: number; height: number; gutter: number } {
  const gutter = faceGutterPx(front.width);
  return { width: front.width + gutter + back.width, height: Math.max(front.height, back.height), gutter };
}

async function decodeRgba(png: Uint8Array): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Compose the two finished face PNGs side by side on a transparent canvas.
 * Returns the PNG (RGBA — the gutter needs its alpha).
 */
export async function composeFacesSideBySide(frontPng: Uint8Array, backPng: Uint8Array): Promise<Buffer> {
  const [front, back] = await Promise.all([decodeRgba(frontPng), decodeRgba(backPng)]);
  const { width, height, gutter } = sideBySideSize(front, back);
  // Transparent black everywhere a face isn't (Buffer.alloc zero-fills).
  const canvas = Buffer.alloc(width * height * 4);
  const blit = (face: { data: Buffer; width: number; height: number }, left: number) => {
    const rowBytes = face.width * 4;
    for (let y = 0; y < face.height; y++) {
      face.data.copy(canvas, (y * width + left) * 4, y * rowBytes, (y + 1) * rowBytes);
    }
  };
  blit(front, 0);
  blit(back, front.width + gutter);
  return sharp(canvas, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
