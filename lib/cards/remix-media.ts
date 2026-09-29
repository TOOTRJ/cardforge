import "server-only";

import { randomId } from "@/lib/ids";
import { ownStorageObject } from "@/lib/media/storage-hosts";
import { isUserStorageConfigured, userFolder } from "@/lib/media/user-storage";
import { checkUploadRateLimit, UPLOAD_RATE_LIMITED } from "@/lib/media/upload-rate-limit";
import type { CardBackFace, CardWatermark } from "@/types/card";

// ---------------------------------------------------------------------------
// A remix of someone else's card gets its OWN copy of the parent's pictures.
//
// The creator prefills a remix from its parent (lib/creator/card-fields.ts
// remixValuesFrom): the art, the second face's art and a custom watermark
// all point into the PARENT owner's card-art folder. Migration 0127 lets a
// user store only their own objects in those columns, so the save copies
// each of them into the remixer's folder first (service role, through
// lib/media/user-storage.ts) and stores the copy's URL. It also means a
// remix no longer loses its art when the parent's owner deletes it or their
// account (remixes saved before 0127 still share the parent's object).
//
// Only a picture that IS the parent's current one is copied — anything else
// in another user's folder is left for the database to refuse. The parent
// may be the remixer's OWN card: a remix saved before 0127 still points at
// the original owner's object, so a remix of it copies that too (review
// 2026-09-29); pictures already in the remixer's folder are never copied.
// If the parent's object is gone (its owner deleted it), the save fails with
// a plain "couldn't copy" error instead of storing a dead link.
// ---------------------------------------------------------------------------

export type RemixMedia = {
  art_url: string | null | undefined;
  back_face: CardBackFace | null | undefined;
  watermark: CardWatermark | null | undefined;
};

type ParentMedia = {
  owner_id: string;
  art_url: string | null;
  back_face?: unknown;
  watermark?: unknown;
};

export type AdoptRemixMediaResult =
  | ({ ok: true } & RemixMedia)
  | { ok: false; error: string; code?: typeof UPLOAD_RATE_LIMITED };

const backArtOf = (face: unknown): string | null =>
  face && typeof face === "object" && typeof (face as CardBackFace).art_url === "string"
    ? ((face as CardBackFace).art_url as string)
    : null;

const watermarkUrlOf = (wm: unknown): string | null =>
  wm && typeof wm === "object" && (wm as CardWatermark).kind === "custom"
    ? (wm as { url: string }).url
    : null;

/** The card-art object key behind `url` when it is the parent's picture in
 *  another user's folder — i.e. one the remixer needs a copy of. */
function foreignParentArt(url: string | null | undefined, parentUrls: Set<string>, userId: string): string | null {
  if (!url || !parentUrls.has(url)) return null;
  const object = ownStorageObject(url);
  if (!object || object.bucket !== "card-art") return null;
  const folder = object.key.split("/")[0];
  return folder === userId ? null : object.key;
}

/**
 * Give `userId` their own copies of the parent's pictures that `data` still
 * uses, and return `data` with those URLs swapped for the copies'. Counts as
 * ONE upload against the rate limit when anything is copied.
 */
export async function adoptRemixMedia(
  userId: string,
  parent: ParentMedia,
  data: RemixMedia,
): Promise<AdoptRemixMediaResult> {
  const parentUrls = new Set(
    [parent.art_url, backArtOf(parent.back_face), watermarkUrlOf(parent.watermark)].filter(
      (url): url is string => Boolean(url),
    ),
  );
  const backArt = data.back_face?.art_url ?? null;
  const watermarkUrl = data.watermark?.kind === "custom" ? data.watermark.url : null;
  const sources = [data.art_url, backArt, watermarkUrl]
    .map((url) => ({ url, key: foreignParentArt(url, parentUrls, userId) }))
    .filter((s): s is { url: string; key: string } => s.key !== null);
  if (sources.length === 0) return { ok: true, ...data };

  if (!isUserStorageConfigured()) {
    return { ok: false, error: "Remixing another creator's art isn't available right now." };
  }
  const limit = await checkUploadRateLimit(userId);
  if (!limit.ok) return { ok: false, error: limit.message, code: limit.code };

  const folder = userFolder("card-art", userId);
  const copies = new Map<string, string>();
  for (const { url, key } of sources) {
    if (copies.has(url)) continue;
    const ext = /\.([A-Za-z0-9]{1,5})$/.exec(key)?.[1]?.toLowerCase() ?? "png";
    const name = `remix-${randomId()}.${ext}`;
    const { error } = await folder.copyIn(key, name);
    if (error) {
      console.error(`[remix-media] copying ${key} for ${userId} failed:`, error.message);
      return { ok: false, error: "Couldn't copy the original card's artwork — try again, or pick new art." };
    }
    copies.set(url, folder.publicUrl(name));
  }
  const swap = (url: string | null | undefined) => (url && copies.get(url)) || url;

  return {
    ok: true,
    art_url: swap(data.art_url),
    back_face: data.back_face && backArt ? { ...data.back_face, art_url: swap(backArt) ?? undefined } : data.back_face,
    watermark:
      data.watermark?.kind === "custom" ? { ...data.watermark, url: swap(data.watermark.url) as string } : data.watermark,
  };
}
