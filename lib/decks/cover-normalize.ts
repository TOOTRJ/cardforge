import "server-only";
import sharp from "sharp";
import { DECK_COVER_HEIGHT, DECK_COVER_WIDTH } from "@/lib/decks/cover";

// ---------------------------------------------------------------------------
// The server half of the deck cover standard (lib/decks/cover.ts): every
// surface that shows a deck cover — the deck page's hero, the public decks
// grid, the dashboard tiles, the OG image — is a 16:9 box with
// `object-cover` and the deck's shared focal point, so one image crops
// identically everywhere. An uploaded cover is normalised here to exactly
// 1600×900 WebP before it is stored (lib/media/upload-cover-server.ts,
// TODO DK6.5), so it needs no cropping at all and weighs ~150 KB instead of
// a multi-MB PNG.
// ---------------------------------------------------------------------------

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
