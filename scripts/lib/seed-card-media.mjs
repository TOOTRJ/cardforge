// ---------------------------------------------------------------------------
// seed-card-media.mjs — the pictures `npm run seed:dev -- --copy-cards-from`
// re-hosts when it copies a production card into a dev database
// (scripts/seed-dev.mjs).
//
// Every picture column a card DRAWS must end up in the target's own storage,
// in the new owner's folder: a dev / preview deployment draws only its own
// storage host (lib/media/media-urls.ts isAllowedMediaUrl), and migration
// 0127 only lets a remix save copy a parent's picture it recognises as ours.
// Until 2026-09-29 only art_url (and the renders) were re-hosted, so a copied
// card's custom watermark, set icon and second-face art still pointed at
// production — dropped from every dev preview and bake, and a remix of such a
// card failed to save. A built-in image (`/defaults/…`, or on pipglyph.com)
// is PipGlyph's own and is kept as it is.
// ---------------------------------------------------------------------------

const BUILT_IN = /^(https:\/\/(www\.)?pipglyph\.com)?\/defaults\//;

/** The file extension of `url` (3–4 letters), or `fallback`. */
export function extensionOf(url, fallback) {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // a site-relative path
  }
  const match = /\.([a-z0-9]{3,4})$/i.exec(pathname);
  return match ? match[1].toLowerCase() : fallback;
}

/**
 * The copied card's picture fields: `art_url`, `set_icon_url`, `watermark`
 * (a custom one's `url`) and `back_face` (its `art_url`), each re-hosted into
 * `ownerId`'s folder by `rehost(sourceUrl, bucket, objectPath)` → the new
 * public URL, or null when the source couldn't be copied. A picture that
 * can't be copied is dropped (null art / set icon, no custom watermark, no
 * second-face art) rather than left pointing at production. Object names
 * follow the server's shapes (`{id}.ext`, `icon-{id}`, `wm-{id}`,
 * `back-{id}`), so re-running overwrites in place.
 */
export async function rehostCardMedia(source, ownerId, rehost) {
  const own = async (url, bucket, stem) => {
    if (!url || typeof url !== "string") return null;
    if (BUILT_IN.test(url)) return url;
    if (!/^https?:\/\//.test(url)) return null;
    return (await rehost(url, bucket, `${ownerId}/${stem}.${extensionOf(url, "webp")}`)) ?? null;
  };

  const art_url = await own(source.art_url, "card-art", source.id);
  const set_icon_url = await own(source.set_icon_url, "set-covers", `icon-${source.id}`);

  let watermark = source.watermark ?? null;
  if (watermark && typeof watermark === "object" && watermark.kind === "custom") {
    const url = await own(watermark.url, "card-art", `wm-${source.id}`);
    watermark = url ? { ...watermark, url } : null;
  }

  let back_face = source.back_face ?? null;
  if (back_face && typeof back_face === "object" && back_face.art_url) {
    const url = await own(back_face.art_url, "card-art", `back-${source.id}`);
    back_face = { ...back_face };
    if (url) back_face.art_url = url;
    else delete back_face.art_url;
  }

  return { art_url, set_icon_url, watermark, back_face };
}
