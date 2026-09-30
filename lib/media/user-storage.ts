import "server-only";

import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/ids";
import { ensureStorageOriginRegistered } from "@/lib/media/storage-origin";
import { CARD_ART_INCOMING_BUCKET } from "@/lib/cards/art-upload-limits";

// ---------------------------------------------------------------------------
// Writes into a user's storage folder — the ONLY way app code writes the
// user buckets (migration 0126). Card renders use it too, through
// lib/cards/bake-core.ts (`userFolder("card-renders", ownerId)` for the save
// bake, the admin sweep, card delete / go-private, a moderation hide and a
// frame-preview delete). The one other storage caller is account deletion
// (lib/account/actions.ts), which lists and empties the deleted user's own
// folders; tests/unit/media/storage-callers.test.ts keeps that list closed.
//
// Until 0126 each user bucket had owner-folder INSERT / UPDATE / DELETE
// policies, so a signed-in user could skip the upload actions and write
// `{their id}/anything` straight from the Supabase client: no byte sniff, no
// metadata strip (lib/media/upload-bytes.ts), no moderation scan, and — in
// card-renders — any picture in place of their card's watermarked bake.
// Users now hold no write policy on storage.objects at all. The server
// actions write with the service role instead, and this module is how they
// keep the one guarantee RLS used to give: an object lands in, or is removed
// from, the CALLER's folder and nowhere else.
//
//   * `userId` is the id the action got from its own auth check (or, for the
//     save bake, the verified card owner) — never a value from the request.
//   * Objects are addressed by a bare file name the server made up
//     (`{uuid}.jpg`, `avatar-{uuid}.png`, `W.png`); a name with a slash, a
//     leading dot or anything outside [A-Za-z0-9._-] is refused, so no
//     caller can reach another folder or a nested path.
//   * A path that came from stored data (a profile's old avatar URL) goes
//     through `fileNameInFolder()` first: another user's object is skipped,
//     never deleted by the service role.
//   * Before the first write, the deployment's storage origin is registered
//     with its database (lib/media/storage-origin.ts), so migration 0127's
//     media URL guards accept the URLs minted here — and no other project's.
//
// Reads stay public URLs; userFolder() never lists or downloads.
//
// The one exception to "the server writes every byte" is the card-art
// STAGING bucket (migration 0131, userUploadStaging() below): card art is too
// big for a Vercel Function's 4.5 MB request body, so the browser PUTs it to
// a signed URL this module mints for ONE server-made name in the caller's
// folder of a PRIVATE bucket. Nothing there is public or referenceable; the
// finish action (lib/cards/upload-art-server.ts) first claims the upload
// (a `{uuid}.claim` marker created only if absent, so racing finishes store
// it once), downloads it here, sniffs, strips and scans it like any upload,
// writes the real object through userFolder("card-art") and replaces the
// staged one with a tombstone (so the signed URL can't be used again).
// ---------------------------------------------------------------------------

export type UserStorageBucket =
  | "card-art"
  | "profile-media"
  | "set-covers"
  | "custom-pips"
  | "card-renders";

type BucketApi = ReturnType<ReturnType<typeof createAdminClient>["storage"]["from"]>;
type UploadBody = Parameters<BucketApi["upload"]>[1];
type UploadOptions = Parameters<BucketApi["upload"]>[2];

export type UserStorageResult = { error: { message: string } | null };

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** Service-role storage is available (SUPABASE_SECRET_KEY is set). Upload
 *  actions check this first and answer with a plain error when it isn't. */
export function isUserStorageConfigured(): boolean {
  return isAdminConfigured();
}

export function isValidFileName(name: string): boolean {
  return FILE_NAME.test(name) && !name.includes("..");
}

/** `{userId}/{fileName}` — the only key shape a user-folder write may use.
 *  Throws on a non-uuid owner or a file name that isn't a bare name. */
export function userObjectPath(userId: string, fileName: string): string {
  if (!isUuid(userId)) throw new Error("User storage: the owner id is not a uuid.");
  if (!isValidFileName(fileName)) throw new Error("User storage: invalid file name.");
  return `${userId}/${fileName}`;
}

/** The file name of `path` when it is an object directly inside `userId`'s
 *  folder; null for anything else (another user's folder, a nested path, a
 *  malformed name). Use it on paths read back from stored data. */
export function fileNameInFolder(userId: string, path: string): string | null {
  if (!isUuid(userId)) return null;
  const prefix = `${userId}/`;
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length);
  return isValidFileName(name) ? name : null;
}

const refused = (message: string): UserStorageResult => ({ error: { message } });

/**
 * One user's folder in one bucket, written with the service role. Every
 * method takes bare file names and resolves them inside `{userId}/`; an
 * invalid name is answered with an error result before any request is made.
 */
export function userFolder(bucket: UserStorageBucket, userId: string) {
  let api: BucketApi | null = null;
  const objects = () => (api ??= createAdminClient().storage.from(bucket));
  const keyOf = (name: string): string | null => {
    try {
      return userObjectPath(userId, name);
    } catch {
      return null;
    }
  };

  return {
    /** The full object key, `{userId}/{name}` (throws on an invalid name). */
    path: (name: string): string => userObjectPath(userId, name),

    async upload(name: string, body: UploadBody, options: UploadOptions): Promise<UserStorageResult> {
      const key = keyOf(name);
      if (!key) return refused("Invalid storage path.");
      await ensureStorageOriginRegistered();
      const { error } = await objects().upload(key, body, options);
      return { error: error ? { message: error.message } : null };
    },

    /**
     * Copy an existing object of the same bucket — `sourceKey` is
     * `{anyUser}/{name}`, as read back from stored data — INTO this user's
     * folder as `name`. Only a remix save uses it, to give the remixer their
     * own copy of the parent card's pictures (lib/cards/remix-media.ts,
     * migration 0127): the source is only read (every bucket is public-read
     * anyway), and the write lands in `{userId}/` like any other.
     */
    async copyIn(sourceKey: string, name: string): Promise<UserStorageResult> {
      const key = keyOf(name);
      const [folder, sourceName, ...rest] = sourceKey.split("/");
      if (!key || rest.length > 0 || !isUuid(folder ?? "") || !isValidFileName(sourceName ?? "")) {
        return refused("Invalid storage path.");
      }
      await ensureStorageOriginRegistered();
      const { error } = await objects().copy(sourceKey, key);
      return { error: error ? { message: error.message } : null };
    },

    async remove(names: string[]): Promise<UserStorageResult> {
      const keys = names.map(keyOf);
      if (keys.some((key) => key === null)) return refused("Invalid storage path.");
      if (keys.length === 0) return { error: null };
      const { error } = await objects().remove(keys as string[]);
      return { error: error ? { message: error.message } : null };
    },

    /** The public URL of `{userId}/{name}` (throws on an invalid name). */
    publicUrl: (name: string): string =>
      objects().getPublicUrl(userObjectPath(userId, name)).data.publicUrl,
  };
}

export type UserFolder = ReturnType<typeof userFolder>;

export type StagedUploadUrl = { path: string; token: string };

/** What a consumed staged object holds: 8 bytes that are not an image, so no
 *  finish can store them (see markConsumed). */
export const STAGED_TOMBSTONE: Uint8Array = new TextEncoder().encode("consumed");

/**
 * The caller's folder in the PRIVATE card-art staging bucket
 * (CARD_ART_INCOMING_BUCKET, migration 0131). Same rules as userFolder():
 * the service role, bare server-made names, keys forced into `{userId}/`.
 * It holds a card-art file only between the browser's upload and the finish
 * action; nothing here is public, and no picture column accepts it.
 */
export function userUploadStaging(userId: string) {
  let api: BucketApi | null = null;
  const objects = () => (api ??= createAdminClient().storage.from(CARD_ART_INCOMING_BUCKET));
  const keyOf = (name: string): string | null => {
    try {
      return userObjectPath(userId, name);
    } catch {
      return null;
    }
  };
  const remove = async (names: string[]): Promise<UserStorageResult> => {
    const keys = names.map(keyOf);
    if (keys.some((key) => key === null)) return refused("Invalid storage path.");
    if (keys.length === 0) return { error: null };
    const { error } = await objects().remove(keys as string[]);
    return { error: error ? { message: error.message } : null };
  };

  return {
    /** The full object key, `{userId}/{name}` (throws on an invalid name). */
    path: (name: string): string => userObjectPath(userId, name),

    /**
     * A signed upload URL for `{userId}/{name}` (valid 2 hours, one object,
     * no overwrite). The bucket's size and MIME limits apply to the upload;
     * the browser gets the key and token, never a write policy.
     */
    async createUploadUrl(name: string): Promise<{ data: StagedUploadUrl; error: null } | { data: null; error: { message: string } }> {
      const key = keyOf(name);
      if (!key) return { data: null, error: { message: "Invalid storage path." } };
      const { data, error } = await objects().createSignedUploadUrl(key);
      if (error || !data?.token) return { data: null, error: { message: error?.message ?? "No upload token." } };
      return { data: { path: key, token: data.token }, error: null };
    },

    /** The staged object's bytes (read with the service role). */
    async download(name: string): Promise<{ bytes: Buffer; error: null } | { bytes: null; error: { message: string } }> {
      const key = keyOf(name);
      if (!key) return { bytes: null, error: { message: "Invalid storage path." } };
      const { data, error } = await objects().download(key);
      if (error || !data) return { bytes: null, error: { message: error?.message ?? "Not found." } };
      return { bytes: Buffer.from(await data.arrayBuffer()), error: null };
    },

    remove,

    /**
     * Claim `name` for ONE finish: create it holding STAGED_TOMBSTONE, only if
     * it doesn't exist yet (upsert off). Storage keys are unique, so of any
     * number of finishes racing on one staged upload exactly one gets past
     * this; the others get an error. The user's signed URL can't touch it (a
     * token is for its own key only). Cleared like any staged object, by
     * removeOlderThan once the token has long expired.
     */
    async claim(name: string): Promise<UserStorageResult> {
      const key = keyOf(name);
      if (!key) return refused("Invalid storage path.");
      const { error } = await objects().upload(key, STAGED_TOMBSTONE, {
        upsert: false,
        contentType: "image/png",
        cacheControl: "0",
      });
      return { error: error ? { message: error.message } : null };
    },

    /**
     * Replace a staged object with STAGED_TOMBSTONE once its bytes are read.
     * A signed upload URL only refuses to OVERWRITE: had the object been
     * deleted, the same token (valid 2 hours) could put the key again and a
     * second finish would store a second file on one counted upload. Kept
     * occupied, the key takes no more PUTs; the tombstone (not an image) is
     * cleared by removeOlderThan once the token has long expired.
     */
    async markConsumed(name: string): Promise<UserStorageResult> {
      const key = keyOf(name);
      if (!key) return refused("Invalid storage path.");
      const { error } = await objects().upload(key, STAGED_TOMBSTONE, {
        upsert: true,
        contentType: "image/png",
        cacheControl: "0",
      });
      return { error: error ? { message: error.message } : null };
    },

    /**
     * Remove the caller's staged objects older than `maxAgeMs` — uploads
     * whose finish call never came (a closed tab, a lost connection). Returns
     * how many went. Best-effort: a failed list or remove removes nothing.
     */
    async removeOlderThan(maxAgeMs: number, now: number = Date.now()): Promise<number> {
      if (!isUuid(userId)) return 0;
      const { data, error } = await objects().list(userId, { limit: 100 });
      if (error || !data) return 0;
      const stale = data
        .filter((file) => {
          const created = Date.parse(file.created_at ?? "");
          return isValidFileName(file.name) && Number.isFinite(created) && now - created > maxAgeMs;
        })
        .map((file) => file.name);
      if (stale.length === 0) return 0;
      const { error: removeError } = await remove(stale);
      return removeError ? 0 : stale.length;
    },
  };
}

export type UserUploadStaging = ReturnType<typeof userUploadStaging>;
