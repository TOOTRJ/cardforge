import "server-only";

import sharp from "sharp";
import { ROOT_BACKDROP_RGB } from "@/lib/frames/square-corners";

// ---------------------------------------------------------------------------
// A card's JPEG download (TODO 6.18): the SQUARE PNG the route already
// produces (a free viewer's stored bake squared by flattenStoredCorners, or a
// live square render), re-encoded. Nothing here draws: the corners are the
// Square PNG's — the border's colour from lib/frames/square-corners.ts, or
// the art/design a live square render kept.
//
//   quality 92      high enough that rules text and pips stay crisp, at a
//                   fraction of the PNG's size.
//   4:4:4 chroma    no chroma subsampling: 4:2:0 smears the red/blue edges of
//                   pips and coloured type into their neighbours.
//   sRGB            the renderer draws sRGB; sharp's output colour space.
//   no metadata     sharp strips EXIF / ICC / XMP unless asked to keep them
//                   (never call withMetadata/keepMetadata here); a JPEG with
//                   no profile is read as sRGB.
//   flatten         a Square PNG is opaque, so this only drops its (all-255)
//                   alpha channel; were a pixel ever translucent it would sit
//                   on the card root's #101015, as it does in the render.
// ---------------------------------------------------------------------------

export const CARD_JPEG_QUALITY = 92;

const [r, g, b] = ROOT_BACKDROP_RGB;

/** Encode a square card PNG as the download JPEG. */
export async function encodeCardJpeg(squarePng: Uint8Array): Promise<Buffer> {
  return sharp(squarePng)
    .flatten({ background: { r, g, b } })
    .toColourspace("srgb")
    .jpeg({ quality: CARD_JPEG_QUALITY, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
