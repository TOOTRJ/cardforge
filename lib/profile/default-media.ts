// ---------------------------------------------------------------------------
// Default profile avatars + banners — 25 of each in public/defaults, painted by
// scripts/generate-default-profile-media.mjs. Every new profile is assigned a
// random pair by the DB (migration 0095, assign_default_profile_media), so a
// profile is never imageless; the user can swap to another default or upload
// their own in onboarding and settings.
//
// The stored value is a SITE-RELATIVE path ("/defaults/avatars/avatar-07.webp")
// so the same row renders in production, previews and local dev. Anything that
// needs an absolute URL (OG images, JSON-LD, emails) goes through
// absoluteProfileMediaUrl(). Keep the counts in sync with the migration's
// random_default_avatar()/random_default_banner().
// Client-safe: no server imports.
// ---------------------------------------------------------------------------

export type ProfileMediaKind = "avatar" | "banner";

const DEFAULT_MEDIA_COUNT: Record<ProfileMediaKind, number> = {
  avatar: 25,
  banner: 25,
};

const FOLDER: Record<ProfileMediaKind, string> = {
  avatar: "avatars",
  banner: "banners",
};

const DEFAULT_MEDIA_PATTERN = /^\/defaults\/(avatars\/avatar|banners\/banner)-(\d{2})\.webp$/;

/** 1-based index → stored path. */
function defaultMediaPath(kind: ProfileMediaKind, index: number): string {
  const n = String(index).padStart(2, "0");
  return `/defaults/${FOLDER[kind]}/${kind}-${n}.webp`;
}

export function listDefaultMedia(kind: ProfileMediaKind): string[] {
  return Array.from({ length: DEFAULT_MEDIA_COUNT[kind] }, (_, i) =>
    defaultMediaPath(kind, i + 1),
  );
}

export function randomDefaultMedia(kind: ProfileMediaKind, exclude?: string | null): string {
  const all = listDefaultMedia(kind).filter((path) => path !== exclude);
  return all[Math.floor(Math.random() * all.length)];
}

/** True for a path this module minted AND that exists (index in range). */
export function isDefaultProfileMedia(
  url: string | null | undefined,
  kind?: ProfileMediaKind,
): boolean {
  if (!url) return false;
  const match = DEFAULT_MEDIA_PATTERN.exec(url);
  if (!match) return false;
  const matchedKind: ProfileMediaKind = match[1].startsWith("avatars") ? "avatar" : "banner";
  if (kind && kind !== matchedKind) return false;
  const index = Number(match[2]);
  return index >= 1 && index <= DEFAULT_MEDIA_COUNT[matchedKind];
}

/** Absolute form for contexts that can't resolve a relative path. Uploaded
 *  media is already absolute and passes through untouched. */
export function absoluteProfileMediaUrl(
  url: string | null | undefined,
  siteBaseUrl: string,
): string | null {
  if (!url) return null;
  return isDefaultProfileMedia(url) ? `${siteBaseUrl}${url}` : url;
}
