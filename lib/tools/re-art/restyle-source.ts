import "server-only";

import { isAllowedServerImageFetchUrl } from "@/lib/validation/card";
import { ownStorageObject } from "@/lib/media/storage-hosts";
import type { RestyleSource } from "@/lib/ai/image-gen";

// ---------------------------------------------------------------------------
// A card's own STORED picture, fetched for a restyle (Re-art deck's "from
// the card's own art", for a card of the maker's with no printing). The
// address is a column its owner writes, so only one the server may fetch is
// fetched at all (the app's own storage host and Scryfall —
// lib/validation/card.ts isAllowedServerImageFetchUrl; the bake's rule),
// with a timeout, no redirects, an image content type and a size limit.
// Anything else is "no art to restyle": never a request to an address a
// card names.
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 10_000;
/** Card art may be 20 MiB (lib/cards/art-upload-limits.ts). */
const MAX_BYTES = 25 * 1024 * 1024;

export async function fetchStoredArt(url: string | null | undefined): Promise<RestyleSource | null> {
  if (!url || !isAllowedServerImageFetchUrl(url)) return null;
  try {
    // No redirect is followed: the address was judged, not where it leads.
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store", redirect: "error" });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    // A size the server states is believed before the body is read.
    if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
    return { bytes, contentType };
  } catch {
    return null;
  }
}

/**
 * Whether a picture Re-art has on record is still IN STORAGE — asked before
 * an earlier picture is put back on a card (0215): a row written before
 * pictures were kept can name a file the tool removed since (a re-roll from
 * another deck did), and a card must never be given a dead picture.
 *
 *   * "yes": the object answers, or the address isn't one of our storage
 *     objects at all (a built-in picture: nothing of ours to have removed);
 *   * "no": storage says it isn't there (a 4xx that is no rate limit);
 *   * "unknown": storage was busy or didn't answer — never read as "gone".
 *
 * A HEAD on the object's own public address (the one host the server may
 * fetch a card's art from), no redirect followed, five seconds.
 */
export async function storedArtExists(url: string | null | undefined): Promise<"yes" | "no" | "unknown"> {
  if (!url) return "no";
  if (!ownStorageObject(url)) return "yes";
  if (!isAllowedServerImageFetchUrl(url)) return "unknown";
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5_000), cache: "no-store", redirect: "error" });
    if (response.ok) return "yes";
    return response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 408 ? "no" : "unknown";
  } catch {
    return "unknown";
  }
}
