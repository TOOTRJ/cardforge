// ---------------------------------------------------------------------------
// A fake of the PRIVATE card-art staging bucket (`card-art-incoming`,
// migration 0131) for tests whose admin-client mock serves storage: spread
// `stagingBucketApi(bucket)` into the object `storage.from(bucket)` returns,
// and run a card-art upload with `uploadCardArtViaStaging()` — start, the
// browser's PUT (the bytes land in `staged`), finish — the way
// lib/cards/art-upload-client.ts does in the browser.
// ---------------------------------------------------------------------------

export const STAGING_BUCKET = "card-art-incoming";

/** Staged objects by key (`{userId}/{uuid}.upload`) — what the browser PUT. */
export const staged = new Map<string, Uint8Array>();

/** Keys the start action minted a signed upload URL for, in order. */
export const signedKeys: string[] = [];

export function resetStaging(): void {
  staged.clear();
  signedKeys.length = 0;
}

/** The staging-only storage methods (createSignedUploadUrl, download, list,
 *  and a remove that drops the staged bytes); harmless on any other bucket. */
export function stagingBucketApi(bucket: string) {
  return {
    createSignedUploadUrl: async (key: string) => {
      signedKeys.push(key);
      return {
        data: { signedUrl: `https://storage.test/storage/v1/object/upload/sign/${bucket}/${key}?token=t`, path: key, token: `token:${key}` },
        error: null,
      };
    },
    download: async (key: string) => {
      const bytes = bucket === STAGING_BUCKET ? staged.get(key) : undefined;
      return bytes
        ? { data: new Blob([new Uint8Array(bytes)]), error: null }
        : { data: null, error: { message: "Object not found" } };
    },
    list: async () => ({ data: [], error: null }),
  };
}

/** Record a service-role write into the staging bucket (the finish action's
 *  tombstone, user-storage markConsumed). */
export function stageWrite(bucket: string, key: string, body: unknown): void {
  if (bucket === STAGING_BUCKET) staged.set(key, new Uint8Array(body as Uint8Array));
}

/** The 8 bytes a consumed staged object holds (lib/media/user-storage.ts). */
export const TOMBSTONE = new TextEncoder().encode("consumed");

/** Drop staged bytes when the staging bucket's remove is called. */
export function forgetStaged(bucket: string, keys: string[]): void {
  if (bucket === STAGING_BUCKET) for (const key of keys) staged.delete(key);
}

/** start → PUT → finish, as the browser runs a card-art upload. */
export async function uploadCardArtViaStaging(bytes: Uint8Array, type: string) {
  const { finishCardArtUploadAction, startCardArtUploadAction } = await import("@/lib/cards/upload-art-server");
  const started = await startCardArtUploadAction({ size: bytes.byteLength, type });
  if (!started.ok) return started;
  staged.set(started.path, bytes);
  return finishCardArtUploadAction(started.name);
}
