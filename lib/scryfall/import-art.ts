import "server-only";

import { userFolder } from "@/lib/media/user-storage";
import {
  assessPrintImageQuality,
  fetchScryfallImage,
  pickPrintImageUrl,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import { logScryfallCall } from "@/lib/scryfall/rate-limit";
import { scryfallFaceArtist } from "@/lib/scryfall/import-mapper";
import { randomId } from "@/lib/ids";

// ---------------------------------------------------------------------------
// A printing's picture stored in the user's own `card-art` folder — the ONE
// path both POST /api/scryfall/import-art (the creator's import) and the
// Bulk Customize batch (lib/tools/bulk-customize/step.ts) take.
//
// The caller has resolved the card from Scryfall ITSELF (by id, never a URL
// from the browser) and has checked the `import_art` quota and the upload
// limit. This picks the image from the card, gates its quality, charges the
// quota only once an image resolved, fetches the bytes host-locked
// (fetchScryfallImage) and uploads them with the service role into the
// caller's folder (lib/media/user-storage.ts — users hold no storage write
// policy since 0126).
// ---------------------------------------------------------------------------

export type ImportArtMode = "print" | "art" | "print-back" | "art-back";

const MAX_BYTES = 8 * 1024 * 1024;

function extensionFromContentType(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "bin";
}

export type StoredScryfallArt =
  | {
      ok: true;
      publicUrl: string;
      /** The requested face's artist (TODO 1.8). */
      artist: string | null;
      /** A low-resolution scan: a non-blocking note. */
      warning: string | null;
    }
  | { ok: false; status: number; error: string };

export async function storeScryfallArt(
  userId: string,
  card: ScryfallCard,
  mode: ImportArtMode,
): Promise<StoredScryfallArt> {
  // Quality gate before the budget is charged. A "placeholder"/"missing"
  // scan would bake a junk frame into the user's card — reject print
  // imports outright; art crops of a placeholder are equally useless.
  const imageQuality = assessPrintImageQuality(card);
  if (imageQuality === "unusable") {
    return {
      ok: false,
      status: 422,
      error: "Scryfall only has a placeholder image for this printing — try a different printing.",
    };
  }

  // For "*-back" modes, source the image from `card_faces[1]`. If the
  // card has only one face, fail with 404 — the caller asked for art
  // that doesn't exist.
  const isBack = mode === "art-back" || mode === "print-back";
  const faceImages = isBack
    ? card.card_faces?.[1]?.image_uris ?? null
    : card.image_uris ?? card.card_faces?.[0]?.image_uris ?? null;

  if (isBack && !card.card_faces?.[1]) {
    return { ok: false, status: 404, error: "This card has no back face." };
  }

  const wantsArt = mode === "art" || mode === "art-back";
  const imageUrl = wantsArt
    ? faceImages?.art_crop ?? faceImages?.normal ?? null
    : faceImages?.png ?? faceImages?.large ?? faceImages?.normal ?? null;

  // Front-face print still goes through the original picker so historic
  // behavior is unchanged.
  const finalImageUrl = !isBack && mode === "print" ? pickPrintImageUrl(card) : imageUrl;

  if (!finalImageUrl) {
    return { ok: false, status: 404, error: "Scryfall has no image for this card." };
  }

  // Charged only now (TODO 1.8): the face and its image URL both resolved.
  // "No back face" and "no image" — a split, adventure or flip card asked
  // for back-face art it doesn't have — never spend the user's quota.
  await logScryfallCall(userId, "import_art");

  // Pull the bytes. fetchScryfallImage host-locks the URL.
  const fetched = await fetchScryfallImage(finalImageUrl);
  if (!fetched) {
    return { ok: false, status: 502, error: "Could not download artwork from Scryfall." };
  }

  if (fetched.blob.size > MAX_BYTES) {
    return { ok: false, status: 413, error: "Imported image is too large." };
  }

  // Upload into the caller's own card-art folder (service role; the folder
  // comes from the caller's user id, the name is ours).
  const ext = extensionFromContentType(fetched.contentType);
  const name = `${randomId()}.${ext}`;
  const art = userFolder("card-art", userId);
  const arrayBuffer = await fetched.blob.arrayBuffer();
  const { error: uploadError } = await art.upload(name, arrayBuffer, {
    cacheControl: "3600",
    contentType: fetched.contentType,
    upsert: false,
  });

  if (uploadError) {
    return { ok: false, status: 500, error: uploadError.message };
  }

  return {
    ok: true,
    publicUrl: art.publicUrl(name),
    artist: scryfallFaceArtist(card, isBack ? 1 : 0) ?? null,
    warning: imageQuality === "lowres" ? "This printing only has a low-resolution scan on Scryfall." : null,
  };
}
