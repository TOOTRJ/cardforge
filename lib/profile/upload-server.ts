"use server";

import "server-only";

import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { scanImageUrl } from "@/lib/moderation/image-scan";
import {
  isDefaultProfileMedia,
  randomDefaultMedia,
  type ProfileMediaKind,
} from "@/lib/profile/default-media";

// ---------------------------------------------------------------------------
// Profile-media upload (avatar / banner). Mirrors lib/cards/upload-art-
// server.ts: validates bytes via Sharp, uploads to the `profile-media`
// bucket under `{owner_id}/{kind}.{ext}`, and writes the public URL onto
// the corresponding profiles column (avatar_url or banner_url).
//
// Two kinds share one bucket so we can pin a single set of RLS policies
// and a single 8 MB cap. Per-kind size hints (banner is much wider) are a
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
  | { ok: false; error: string };

export async function uploadProfileMediaServerAction(
  kind: ProfileMediaKind,
  formData: FormData,
): Promise<UploadProfileMediaResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in to upload media." };
  }

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

  const ext = EXTENSION_BY_FORMAT[format] ?? "bin";
  // Random filename per upload so we never hit ON-CONFLICT-UPDATE on
  // storage.objects — Postgres applies the UPDATE policy in that path on
  // top of INSERT, and upsert mode through the storage RLS layer was
  // throwing "new row violates row-level security policy" even for the
  // very first upload. Matches the proven card-art pattern exactly. The
  // previous object (if any) is deleted just below so the bucket doesn't
  // accumulate dead files per user.
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${user.id}/${kind}-${id}.${ext}`;
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
  const previousPath = previousUrl ? extractBucketPath(previousUrl, "profile-media") : null;

  const { error: uploadErr } = await supabase.storage
    .from("profile-media")
    .upload(path, buffer, {
      cacheControl: "3600",
      contentType: CONTENT_TYPE_BY_FORMAT[format] ?? "application/octet-stream",
      upsert: false,
    });

  if (uploadErr) {
    return { ok: false, error: uploadErr.message };
  }

  const { data } = supabase.storage.from("profile-media").getPublicUrl(path);
  const publicUrl = data.publicUrl;

  // NSFW auto-scan, same as card art (lib/cards/upload-art-server.ts) — the
  // profile copy of this pipeline predates the scan and never got it, so an
  // avatar/banner was the one human upload that skipped moderation. Fails
  // open on a missing key; a positive flag removes the object and rejects.
  const scan = await scanImageUrl(publicUrl);
  if (scan.flagged) {
    await supabase.storage.from("profile-media").remove([path]);
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
    await supabase.storage.from("profile-media").remove([path]);
    return { ok: false, error: updateErr.message };
  }

  // Best-effort cleanup of the previous object, now that the row points at
  // the new one. (A stale object in the user's own folder isn't a security
  // concern — RLS prevents cross-user access — just storage.)
  if (previousPath && previousPath !== path) {
    await supabase.storage.from("profile-media").remove([previousPath]);
  }

  // Bust both the settings page (so the form re-renders the new URL) and
  // any profile view of this user.
  revalidatePath("/settings");
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.username) {
    revalidatePath(`/profile/${profile.username}`);
  }

  return { ok: true, publicUrl };
}

/** Bucket object behind the profile's current avatar/banner, if it is one of
 *  ours (a default path or an OAuth avatar has nothing to delete). */
async function removeStoredMedia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  kind: ProfileMediaKind,
) {
  const column = kind === "avatar" ? "avatar_url" : "banner_url";
  const { data } = await supabase
    .from("profiles")
    .select(column)
    .eq("id", userId)
    .maybeSingle();
  const currentUrl = (data as Record<string, string | null> | null)?.[column] ?? null;
  const path = currentUrl ? extractBucketPath(currentUrl, "profile-media") : null;
  if (path) await supabase.storage.from("profile-media").remove([path]);
  return currentUrl;
}

async function revalidateProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  revalidatePath("/settings");
  revalidatePath("/onboarding");
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.username) revalidatePath(`/profile/${profile.username}`);
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
  await removeStoredMedia(supabase, user.id, kind);
  const { error } = await supabase
    .from("profiles")
    .update(kind === "avatar" ? { avatar_url: path } : { banner_url: path })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Couldn't save that image. Please try again." };

  await revalidateProfile(supabase, user.id);
  return { ok: true, publicUrl: path };
}

/** "Remove" never leaves a profile imageless: the upload is deleted and a
 *  random built-in image (different from the current one) takes its place. */
export async function clearProfileMediaServerAction(
  kind: ProfileMediaKind,
): Promise<UploadProfileMediaResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "Sign in first." };
  }

  const supabase = await createClient();
  const previous = await removeStoredMedia(supabase, user.id, kind);
  const replacement = randomDefaultMedia(kind, previous);
  const { error } = await supabase
    .from("profiles")
    .update(kind === "avatar" ? { avatar_url: replacement } : { banner_url: replacement })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  await revalidateProfile(supabase, user.id);
  return { ok: true, publicUrl: replacement };
}
