import "server-only";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// Deck cover standard. Every surface that shows a deck cover — the deck page
// header, the public decks grid, the dashboard tiles, the OG image — is a
// 16:9 box with `object-cover` and the deck's shared focal point, so one
// image crops identically everywhere. AI covers are generated at 16:9 and
// normalised here to exactly 1600×900 WebP before upload, so they need no
// cropping at all (and weigh ~150 KB instead of a multi-MB PNG).
// ---------------------------------------------------------------------------

export const DECK_COVER_WIDTH = 1600;
export const DECK_COVER_HEIGHT = 900;
const DECK_COVER_QUALITY = 82;
const DECK_COVER_CONTENT_TYPE = "image/webp";

/** Centre-crop + resize any image to the 16:9 cover standard, as WebP. */
export async function normalizeDeckCover(
  bytes: Uint8Array | ArrayBuffer | Buffer,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const out = await sharp(Buffer.from(bytes as ArrayBuffer), { animated: false })
    .rotate()
    .resize({
      width: DECK_COVER_WIDTH,
      height: DECK_COVER_HEIGHT,
      fit: "cover",
      position: "attention",
    })
    .webp({ quality: DECK_COVER_QUALITY })
    .toBuffer();
  return { bytes: new Uint8Array(out), contentType: DECK_COVER_CONTENT_TYPE };
}
