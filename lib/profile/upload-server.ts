"use server";

import "server-only";

import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { scanImageUrl } from "@/lib/moderation/image-scan";
import { prepareUploadBytes } from "@/lib/media/upload-bytes";
import {
  fileNameInFolder,
  isUserStorageConfigured,
  userFolder,
} from "@/lib/media/user-storage";
import {
  checkUploadRateLimit,
  uploadRateLimitFailure,
  type UploadLimitFields,
} from "@/lib/media/upload-rate-limit";
import {
  isDefaultProfileMedia,
  type ProfileMediaKind,
} from "@/lib/profile/default-media";
import { revalidateProfileMedia, revalidateProfilePage } from "@/lib/profile/username";
import { randomId } from "@/lib/ids";

// ---------------------------------------------------------------------------
// Profile-media upload (avatar / banner). Mirrors lib/cards/upload-art-
// server.ts: validates bytes via Sharp, uploads to the `profile-media`
// bucket under `{owner_id}/{kind}.{ext}`, and writes the public URL onto
// the corresponding profiles column (avatar_url or banner_url).
//
// Objects are written and removed with the service role, only ever inside
// the signed-in user's own folder (lib/media/user-storage.ts — users hold no
// storage write policy since migration 0126).
//
// Two kinds share one bucket so we can pin a single 8 MB cap. Per-kind size hints (banner is much wider) are a
// UI/UX detail enforced on the client; the server's job is "no bigger than
// MAX_BYTES, no non-image formats."
// ---------------------------------------------------------------------------

const MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp", "gif"]);

const ALLOWED_DECLARED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const EXTENSION_BY_FORMAT: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  gif: "gif",
};

const CONTENT_TYPE_BY_FORMAT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Pulls the bucket-relative key out of a Supabase Storage public URL so we
 * can pass it to `.remove()`. Returns null if the URL doesn't belong to the
 * given bucket (e.g. a stale URL from before this code shipped, or a hand-
 * pasted one). Tolerant of trailing query strings.
 */
function extractBucketPath(url: string, bucket: string): string | null {
  try {
    const u = new URL(url);
    const marker = `/storage/v1/object/public/${bucket}/`;
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(u.pathname.slice(idx + marker.length));
  } catch {
    return null;
  }
}

export type UploadProfileMediaResult =
  | { ok: true; publicUrl: string }
  | ({ ok: false; error: string } & UploadLimitFields);

export async function uploadProfileMediaServerAction(
  kind: ProfileMediaKind,
  formData: FormData,
): Promise<UploadProfileMediaResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  if (!isUserStorageConfigured()) {
    return { ok: false, error: "Uploads aren't available right now." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to upload media." };
  }
  // `kind` arrives from the browser and names the stored file: only the two
  // known kinds get that far.
  if (kind !== "avatar" && kind !== "banner") {
    return { ok: false, error: "Unknown image kind." };
  }
  // 30 a minute / 300 a day per user (lib/media/upload-rate-limit.ts).
  const limit = await checkUploadRateLimit(user.id);
  if (!limit.ok) return uploadRateLimitFailure(limit);

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "No file uploaded." };
  }

  if (file.type && !ALLOWED_DECLARED_MIME_TYPES.has(file.type)) {
    return {
      ok: false,
      error: "Only PNG, JPEG, WebP, and GIF images are allowed.",
    };
  }
  if (file.size === 0) {
    return { ok: false, error: "Empty file." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image must be 8 MB or smaller." };
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    return { ok: false, error: "That doesn't look like a valid image." };
  }

  const format = metadata.format;
  if (!format || !ALLOWED_FORMATS.has(format)) {
    return {
      ok: false,
      error: "Only PNG, JPEG, WebP, and GIF images are allowed.",
    };
  }

  // Upright pixels, no EXIF orientation tag (lib/media/orientation.ts): the
  // settings page shows a phone-photo avatar upright, and so must the
  // profile OG image, which is drawn by Satori (TODO 3.14). No camera
  // metadata — a selfie's GPS is where someone lives (TODO 3.14a).
  let stored: Buffer;
  try {
    stored = await prepareUploadBytes(buffer, metadata, { maxBytes: MAX_BYTES });
  } catch {
    return { ok: false, error: "That doesn't look like a valid image." };
  }

  const ext = EXTENSION_BY_FORMAT[format] ?? "bin";
  // Random filename per upload (a new public URL, so no CDN copy of the old
  // image can answer for it). The previous object (if any) is deleted just
  // below so the bucket doesn't accumulate dead files per user.
  const name = `${kind}-${randomId()}.${ext}`;
  const media = userFolder("profile-media", user.id);
  const supabase = await createClient();

  // Remember the previous object for this kind; it is deleted only AFTER
  // the new upload, its moderation scan and the profile update all
  // succeed. Deleting first meant a failed upload (or a flagged image) left
  // the profile pointing at an object that no longer existed.
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select(kind === "avatar" ? "avatar_url" : "banner_url")
    .eq("id", user.id)
    .maybeSingle();
  const previousUrl =
    (existingProfile as Record<string, string | null> | null)?.[
      kind === "avatar" ? "avatar_url" : "banner_url"
    ] ?? null;
  const previousName = ownMediaName(user.id, previousUrl);

  const { error: uploadErr } = await media.upload(name, stored, {
    cacheControl: "3600",
    contentType: CONTENT_TYPE_BY_FORMAT[format] ?? "application/octet-stream",
    upsert: false,
  });

  if (uploadErr) {
    return { ok: false, error: uploadErr.message };
  }

  const publicUrl = media.publicUrl(name);

  // NSFW auto-scan, same as card art (lib/cards/upload-art-server.ts) — the
  // profile copy of this pipeline predates the scan and never got it, so an
  // avatar/banner was the one human upload that skipped moderation. Fails
  // open on a missing key; a positive flag removes the object and rejects.
  const scan = await scanImageUrl(publicUrl);
  if (scan.flagged) {
    await media.remove([name]);
    return {
      ok: false,
      error: "That image was flagged by our content filter and can't be used.",
    };
  }

  const update =
    kind === "avatar"
      ? { avatar_url: publicUrl }
      : { banner_url: publicUrl };
  const { error: updateErr } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", user.id);

  if (updateErr) {
    // The new object is orphaned but the profile still shows the OLD image —
    // remove the new one so nothing dangles.
    await media.remove([name]);
    return { ok: false, error: updateErr.message };
  }

  // Best-effort cleanup of the previous object, now that the row points at
  // the new one — only ever an object in this user's own folder.
  if (previousName && previousName !== name) {
    await media.remove([previousName]);
  }

  // Bust both the settings page (so the form re-renders the new URL) and
  // any profile view of this user.
  revalidatePath("/settings");
  await revalidateProfilePage(supabase, user.id);

  return { ok: true, publicUrl };
}

/** File name of the object behind a stored avatar/banner URL — only when it
 *  sits in `userId`'s own profile-media folder. A default path, an OAuth
 *  avatar, or a URL pointing into ANOTHER user's folder (profiles.avatar_url
 *  is the owner's to write) is null: the service role never deletes it. */
function ownMediaName(userId: string, url: string | null): string | null {
  const path = url ? extractBucketPath(url, "profile-media") : null;
  return path ? fileNameInFolder(userId, path) : null;
}

/** The file name behind the profile's current avatar/banner, if it is one of
 *  the user's own uploads (see ownMediaName). */
async function storedMediaName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  kind: ProfileMediaKind,
): Promise<string | null> {
  const column = kind === "avatar" ? "avatar_url" : "banner_url";
  const { data } = await supabase
    .from("profiles")
    .select(column)
    .eq("id", userId)
    .maybeSingle();
  const currentUrl = (data as Record<string, string | null> | null)?.[column] ?? null;
  return ownMediaName(userId, currentUrl);
}

/** Use one of the built-in images (public/defaults). `path` must be a value
 *  from lib/profile/default-media — anything else is refused, so this can
 *  never be used to point a profile at an arbitrary URL. */
export async function chooseDefaultProfileMediaAction(
  kind: ProfileMediaKind,
  path: string,
): Promise<UploadProfileMediaResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (!isDefaultProfileMedia(path, kind)) {
    return { ok: false, error: "That isn't one of the built-in images." };
  }

  const supabase = await createClient();
  const previousName = await storedMediaName(supabase, user.id, kind);
  const { error } = await supabase
    .from("profiles")
    .update(kind === "avatar" ? { avatar_url: path } : { banner_url: path })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't save that image. Please try again." };

  // The uploaded image goes only once the row no longer points at it (a
  // failed update must not leave the profile on a deleted object).
  // Best-effort: without service-role storage the file is merely orphaned.
  if (previousName && isUserStorageConfigured()) {
    await userFolder("profile-media", user.id).remove([previousName]);
  }

  await revalidateProfileMedia(supabase, user.id);
  return { ok: true, publicUrl: path };
}
