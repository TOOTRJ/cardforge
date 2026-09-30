"use client";

import { createClient } from "@/lib/supabase/client";
import {
  finishCardArtUploadAction,
  startCardArtUploadAction,
  type UploadArtServerResult,
} from "@/lib/cards/upload-art-server";
import {
  CARD_ART_INCOMING_BUCKET,
  CARD_ART_TOO_LARGE_MESSAGE,
  CARD_ART_TYPE_MESSAGE,
  CARD_ART_UPLOAD_FAILED_MESSAGE,
  cardArtFileProblem,
} from "@/lib/cards/art-upload-limits";

// ---------------------------------------------------------------------------
// The browser half of a card-art upload (TODO 6.10; the server half and the
// why are in lib/cards/upload-art-server.ts): start → PUT → finish.
//
// This is the ONE browser module that touches Supabase Storage
// (tests/unit/media/storage-callers.test.ts): it only ever calls
// uploadToSignedUrl on the PRIVATE staging bucket, with the key and token
// the start action minted for one object in the caller's folder. The file
// becomes card art only through finishCardArtUploadAction, which sniffs,
// strips, scans and writes it with the service role.
// ---------------------------------------------------------------------------

type StagedPut = (path: string, token: string, file: File) => Promise<{ error: { message?: string; statusCode?: string | number; status?: number } | null }>;

/** The PUT to the signed URL (Supabase Storage enforces the staging bucket's
 *  20 MiB and MIME limits on it). */
const putStaged: StagedPut = async (path, token, file) => {
  const { error } = await createClient()
    .storage.from(CARD_ART_INCOMING_BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType: file.type, upsert: false });
  return { error: error as { message?: string; statusCode?: string | number } | null };
};

/** A storage refusal in words the uploader can toast. */
export function stagedUploadError(error: { message?: string; statusCode?: string | number; status?: number }): string {
  const status = Number(error.statusCode ?? error.status);
  const message = (error.message ?? "").toLowerCase();
  if (status === 413 || message.includes("maximum allowed size") || message.includes("too large")) {
    return CARD_ART_TOO_LARGE_MESSAGE;
  }
  if (status === 415 || message.includes("mime type")) return CARD_ART_TYPE_MESSAGE;
  return CARD_ART_UPLOAD_FAILED_MESSAGE;
}

/**
 * Upload one card-art file; resolves to the stored object's public URL or a
 * message to show. Never throws — a dropped connection is a message too.
 */
export async function uploadCardArtFile(
  file: File,
  deps: {
    start?: typeof startCardArtUploadAction;
    put?: StagedPut;
    finish?: typeof finishCardArtUploadAction;
  } = {},
): Promise<UploadArtServerResult> {
  const problem = cardArtFileProblem(file);
  if (problem) return { ok: false, error: problem };
  const start = deps.start ?? startCardArtUploadAction;
  const put = deps.put ?? putStaged;
  const finish = deps.finish ?? finishCardArtUploadAction;
  try {
    const started = await start({ size: file.size, type: file.type });
    if (!started.ok) return started;
    const { error } = await put(started.path, started.token, file);
    if (error) return { ok: false, error: stagedUploadError(error) };
    return await finish(started.name);
  } catch {
    return { ok: false, error: CARD_ART_UPLOAD_FAILED_MESSAGE };
  }
}
