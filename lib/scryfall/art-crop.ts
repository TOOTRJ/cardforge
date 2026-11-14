import "server-only";

import { assessPrintImageQuality, fetchScryfallImage, type ScryfallCard } from "@/lib/scryfall/client";
import { logScryfallCall } from "@/lib/scryfall/rate-limit";

// ---------------------------------------------------------------------------
// A printing's ART as bytes — for a model to repaint (Re-art deck's "from
// the card's own art": lib/tools/re-art, lib/tools/bulk-customize/step.ts).
//
// NOTHING IS STORED here (lib/scryfall/import-art.ts is the module that
// stores a printing's picture in the user's folder, and whose callers count
// an upload): the bytes go to the image model and the picture it paints is
// stored as the AI picture it is (lib/ai/random-art.ts).
//
// The caller has resolved the card from Scryfall ITSELF (by id, never a URL
// from the browser) and has checked the `import_art` quota. Like
// storeScryfallArt, the quota is charged only once a picture resolved, and
// the fetch is host-locked (fetchScryfallImage).
// ---------------------------------------------------------------------------

/** Card art on Scryfall is far below this; a bigger answer is not art. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * The ART CROP alone — never the print scan: a restyle of a whole card would
 * repaint its frame and its text.
 */
export async function fetchScryfallArtCrop(
  userId: string,
  card: ScryfallCard,
  face: "front" | "back",
): Promise<{ ok: true; bytes: Uint8Array; contentType: string } | { ok: false; error: string }> {
  if (assessPrintImageQuality(card) === "unusable") {
    return { ok: false, error: "Scryfall only has a placeholder image for this printing — there is no art to restyle." };
  }
  if (face === "back" && !card.card_faces?.[1]) return { ok: false, error: "This card has no back face." };
  const images = face === "back" ? (card.card_faces?.[1]?.image_uris ?? null) : (card.image_uris ?? card.card_faces?.[0]?.image_uris ?? null);
  const url = images?.art_crop ?? null;
  if (!url) return { ok: false, error: "Scryfall has no art for this card to restyle." };
  await logScryfallCall(userId, "import_art");
  const fetched = await fetchScryfallImage(url);
  if (!fetched) return { ok: false, error: "Could not download the card's art from Scryfall — try it again." };
  if (fetched.blob.size === 0 || fetched.blob.size > MAX_BYTES) return { ok: false, error: "The card's art on Scryfall can't be used." };
  return { ok: true, bytes: new Uint8Array(await fetched.blob.arrayBuffer()), contentType: fetched.contentType };
}
