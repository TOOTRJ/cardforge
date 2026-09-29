import { ownStorageHosts } from "@/lib/media/storage-hosts";
// ---------------------------------------------------------------------------
// render-cdn — map a stored card-render URL (Supabase Storage, `card-renders`
// bucket) onto this deployment's `/render-cdn/<owner>/<object>?v=…` path,
// which the route handler at app/render-cdn/[...path]/route.ts proxies to the
// bucket and serves with an immutable one-year Cache-Control (the storage
// host answers browsers `no-cache`).
// Only URLs on our own storage hosts are mapped; anything else is returned
// untouched so a foreign or malformed value can never be proxied.
//
// `isStoredRenderUrl` is the display-side twin of migration 0126's
// cards_guard_render_columns (only the service role may point a card at a
// render): a surface that shows `rendered_image_url` / `rendered_thumb_url`
// as a picture checks the value is really a bake in our card-renders bucket
// — not an outside host (a tracking pixel, an unmoderated picture), not an
// upload in card-art — before it draws it, and otherwise falls back to the
// live preview. Rows written before 0126 could hold anything.
// ---------------------------------------------------------------------------

const RENDER_CDN_PREFIX = "/render-cdn";

const BUCKET_PATH = "/storage/v1/object/public/card-renders/";

/** The object key inside the card-renders bucket (`{owner}/{file}`) when
 *  `url` is a public URL of that bucket on one of our storage hosts; null
 *  for anything else (another host, another bucket, a malformed key). */
export function storedRenderObject(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!parsed.pathname.startsWith(BUCKET_PATH)) return null;
  if (!ownStorageHosts().has(parsed.host)) return null;
  const object = parsed.pathname.slice(BUCKET_PATH.length);
  if (!/^[A-Za-z0-9_\-./]+$/.test(object) || object.includes("..")) return null;
  return object;
}

/**
 * True when `url` is a bake in our card-renders bucket. With `card`, it must
 * also be THAT card's own object — `{ownerId}/{cardId}.png` or its
 * `.thumb.webp` (lib/cards/bake-core.ts renderObjectNames) — so a row can't
 * borrow another card's render either.
 */
export function isStoredRenderUrl(
  url: string | null | undefined,
  card?: { ownerId: string; cardId: string },
): url is string {
  const object = storedRenderObject(url);
  if (!object) return false;
  if (!card) return true;
  const base = `${card.ownerId}/${card.cardId}`;
  return object === `${base}.png` || object === `${base}.thumb.webp`;
}

const BAKE_OBJECT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:png|thumb\.webp)$/i;

/**
 * The card a card-renders object key belongs to — `{ownerId}/{cardId}.png`
 * or `{ownerId}/{cardId}.thumb.webp`, the only two names a bake writes
 * (lib/cards/bake-core.ts renderObjectNames) — lower-cased; null for any
 * other key. The /render-cdn route serves only these, tagged
 * `card-<cardId>` (lib/cards/cache-purge.ts), so every copy the CDN holds
 * can be purged when its card leaves public view.
 */
export function bakeObjectCardId(objectKey: string): string | null {
  const match = BAKE_OBJECT.exec(objectKey);
  return match ? match[1].toLowerCase() : null;
}

export function toRenderCdnUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const object = storedRenderObject(url);
  if (!object) return url;
  return `${RENDER_CDN_PREFIX}/${object}${new URL(url).search}`;
}
