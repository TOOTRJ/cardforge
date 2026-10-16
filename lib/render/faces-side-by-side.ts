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
 *  taller face's height, and where each face's top row goes. Every DFC body
 *  is the same size on both faces (both tops 0, the gutter 1/25 of the
 *  face's width); a BATTLE (TODO 5.5) is a landscape front beside a
 *  portrait back — the shorter face is centred on the taller one's height
 *  (whole px) and the gutter is 1/25 of the NARROWER face's width, the
 *  portrait card's: the same 60 / 30 px as every other two-faced card. */
export function sideBySideSize(
  front: { width: number; height: number },
  back: { width: number; height: number },
): { width: number; height: number; gutter: number; frontTop: number; backTop: number } {
  const gutter = faceGutterPx(Math.min(front.width, back.width));
  const height = Math.max(front.height, back.height);
  return {
    width: front.width + gutter + back.width,
    height,
    gutter,
    frontTop: Math.floor((height - front.height) / 2),
    backTop: Math.floor((height - back.height) / 2),
  };
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
  const { width, height, gutter, frontTop, backTop } = sideBySideSize(front, back);
  // Transparent black everywhere a face isn't (Buffer.alloc zero-fills).
  const canvas = Buffer.alloc(width * height * 4);
  const blit = (face: { data: Buffer; width: number; height: number }, left: number, top: number) => {
    const rowBytes = face.width * 4;
    for (let y = 0; y < face.height; y++) {
      face.data.copy(canvas, ((y + top) * width + left) * 4, y * rowBytes, (y + 1) * rowBytes);
    }
  };
  blit(front, 0, frontTop);
  blit(back, front.width + gutter, backTop);
  return sharp(canvas, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
