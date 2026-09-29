import { ownStorageObject } from "@/lib/media/storage-hosts";
import { defaultMediaFor, isDefaultProfileMedia } from "@/lib/profile/default-media";

// ---------------------------------------------------------------------------
// isAllowedMediaUrl — may a surface DRAW this user-media URL?
//
// The display-side twin of migration 0127's media URL guards (and the sibling
// of isStoredRenderUrl in lib/cards/render-cdn.ts, which does the same for a
// card's bake). Since 0127 an API role can only store, in each picture
// column, an object in OUR storage — the right bucket, the writer's own
// folder — or a built-in image; a Scryfall printing image for a deck entry.
// Rows written before it could hold any https URL: an outside host (a
// viewer-IP tracking pixel, an unmoderated picture that skipped the strip
// and the scan). Every public surface that draws one of these columns with a
// raw <img>, next/image, an OG image or JSON-LD checks it here first and
// falls back (the built-in avatar / banner, no cover, no art) — never draws
// the outside value.
//
// The database can't know its own public host (0127 lists the origins in
// public.storage_origins); this checks the deployment's own
// (NEXT_PUBLIC_SUPABASE_URL + the legacy project host, lib/media/storage-
// hosts.ts), which is stricter.
//
// Client-safe: CardPreview runs it in the browser.
// ---------------------------------------------------------------------------

export type MediaKind =
  | "card-art"
  | "watermark"
  | "set-icon"
  | "avatar"
  | "banner"
  | "deck-cover"
  | "pip"
  | "deck-card-image";

/** The buckets each stored kind may live in — the table in migration 0127's
 *  media_url_allowed() (a unit test keeps the two in step). */
export const MEDIA_KIND_BUCKETS: Readonly<Record<Exclude<MediaKind, "deck-card-image">, readonly string[]>> = {
  "card-art": ["card-art"],
  watermark: ["card-art"],
  "set-icon": ["set-covers", "card-art"],
  "deck-cover": ["set-covers", "card-art"],
  avatar: ["profile-media"],
  banner: ["profile-media"],
  pip: ["custom-pips"],
};

/** A deck entry's Scryfall printing image — the only outside host the product
 *  stores (lib/decks/import-plan.ts scryfallImageOnly). Same pattern as 0127. */
const SCRYFALL_IMAGE = /^https:\/\/cards\.scryfall\.io\/[A-Za-z0-9_./-]+(\?[0-9]{1,20})?$/;

/** Google's profile picture, copied at a Google sign-up by handle_new_user
 *  (0046; 0127 keeps only this host). Never writable through the API. */
const GOOGLE_AVATAR = /^https:\/\/lh[0-9]{1,2}\.googleusercontent\.com\/[A-Za-z0-9_./=-]+$/;

/** PipGlyph's own built-in images (public/defaults), site-relative or on
 *  the production site — the art the dev and preview seed cards use
 *  (supabase/seeds/10_dev_data.sql). The same pattern as 0127. */
const BUILT_IN_ART =
  /^(https:\/\/(www\.)?pipglyph\.com)?\/defaults\/(avatars\/avatar|banners\/banner)-(0[1-9]|1[0-9]|2[0-5])\.webp$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/**
 * True when a surface may draw `url` as a picture of this kind.
 *
 *   * storage kinds: a public object on our storage host, in one of the
 *     kind's buckets, directly inside a user folder — and, when `ownerId` is
 *     given, THAT user's folder. Card pictures (art, watermark, set icon) are
 *     drawn by CardPreview, which knows no owner: a remix saved before 0127
 *     shares its parent's art object, which is ours and was scanned.
 *   * avatar / banner: also a built-in image (`/defaults/…`, 0095); an avatar
 *     also a Google profile picture (Google sign-ups).
 *   * card-art: also PipGlyph's own built-in images (the seed cards).
 *   * deck-card-image: a Scryfall printing image only.
 */
export function isAllowedMediaUrl(
  kind: MediaKind,
  url: string | null | undefined,
  ownerId?: string | null,
): url is string {
  if (!url) return false;
  if (kind === "deck-card-image") return SCRYFALL_IMAGE.test(url) && !url.includes("..");
  if (kind === "avatar" || kind === "banner") {
    if (isDefaultProfileMedia(url, kind)) return true;
    if (kind === "avatar" && GOOGLE_AVATAR.test(url)) return true;
  }
  if (kind === "card-art" && BUILT_IN_ART.test(url)) return true;
  const object = ownStorageObject(url);
  if (!object || !MEDIA_KIND_BUCKETS[kind].includes(object.bucket)) return false;
  const [folder, name, ...rest] = object.key.split("/");
  if (rest.length > 0 || !UUID.test(folder ?? "") || !FILE_NAME.test(name ?? "") || name.includes("..")) {
    return false;
  }
  return !ownerId || folder === ownerId;
}

/** `url` when a surface may draw it (isAllowedMediaUrl), else null. */
export function drawableMediaUrl(
  kind: MediaKind,
  url: string | null | undefined,
  ownerId?: string | null,
): string | null {
  return isAllowedMediaUrl(kind, url, ownerId) ? url : null;
}

/**
 * The avatar / banner a surface draws for a profile: its own value when
 * isAllowedMediaUrl accepts it for that profile, else a built-in image
 * picked from the profile id (every profile shows one, 0095) — or null when
 * there is no id to pick with.
 */
export function profileMediaSrc(
  kind: "avatar" | "banner",
  url: string | null | undefined,
  profileId: string | null | undefined,
): string | null {
  if (isAllowedMediaUrl(kind, url, profileId)) return url;
  return profileId ? defaultMediaFor(kind, profileId) : null;
}
