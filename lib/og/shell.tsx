import { isAllowedServerImageFetchUrl } from "@/lib/validation/card";
import { isDefaultProfileMedia } from "@/lib/profile/default-media";
import { toSatoriDataUrl } from "@/lib/render/art-source";
import { getSiteBaseUrl } from "@/lib/site-url";

// ---------------------------------------------------------------------------
// Server-side half of the OG toolkit: the image pre-fetch (it transcodes with
// sharp, so this module must stay out of the edge-runtime home image) plus
// every chrome primitive, re-exported from lib/og/chrome for the route files.
// ---------------------------------------------------------------------------

export * from "@/lib/og/chrome";

/** Fetch a remote image into a data URI so Satori never does its own
 *  network fetch (which would fail the whole render on a dead URL).
 *  Returns null on any failure — callers fall back to branded chrome. */
export async function fetchImageAsDataUri(
  url: string,
): Promise<string | null> {
  // A built-in avatar/banner is stored as a site-relative path
  // (lib/profile/default-media) — it is one of OUR static files, matched by a
  // strict pattern, so it is fetched from this deployment's own origin.
  if (isDefaultProfileMedia(url)) {
    url = `${getSiteBaseUrl()}${url}`;
  } else if (!isAllowedServerImageFetchUrl(url)) {
    // SSRF guard: only fetch from our storage bucket / Scryfall — never an
    // arbitrary user-supplied host (cover_url etc. flow in here).
    return null;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) return null;
    // Satori only decodes PNG/JPEG — WebP (every built-in avatar, many
    // uploads) and GIF are transcoded, the same path card art takes.
    return await toSatoriDataUrl(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}
