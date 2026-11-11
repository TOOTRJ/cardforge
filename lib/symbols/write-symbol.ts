import "server-only";

import { randomUUID } from "node:crypto";
import { userFolder } from "@/lib/media/user-storage";

// ---------------------------------------------------------------------------
// THE custom-symbol picture write (migration 0193): a normalised 256 × 256
// PNG into the owner's custom-pips folder as `sym-<uuid>.png` — a NEW name
// every time, so a replaced picture never answers from a CDN copy and the
// storage orphan sweep never races a re-upload over the same name. Plain
// module, not "use server": its caller (lib/symbols/actions.ts) has checked
// the tool access, counted the upload (checkUploadRateLimit), sniffed,
// stripped and scanned the bytes, and passes the owner it verified.
//
// The row (custom_symbols.image_url) is written by the caller: a NEW symbol's
// by the server's role (0205 — nothing in the database checks that address,
// so it is only ever the URL this module returns), a replaced picture's with
// the owner's session, where 0193's RLS and 0127's media guard check it.
// ---------------------------------------------------------------------------

export const SYMBOL_PICTURE_PX = 256;

const SYMBOL_FILE_RE = /^sym-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;

export type StoredSymbolPicture = { ok: true; imageUrl: string; fileName: string } | { ok: false; error: string };

export async function storeSymbolPicture(ownerId: string, pngBytes: Buffer): Promise<StoredSymbolPicture> {
  const fileName = `sym-${randomUUID()}.png`;
  const folder = userFolder("custom-pips", ownerId);
  const { error } = await folder.upload(fileName, pngBytes, {
    // The name never changes bytes, so a long cache is safe.
    cacheControl: "31536000",
    contentType: "image/png",
    upsert: false,
  });
  if (error) return { ok: false, error: "The picture couldn't be saved. Try again in a moment." };
  return { ok: true, imageUrl: `${folder.publicUrl(fileName)}?v=${Date.now()}`, fileName };
}

/** The `sym-<uuid>.png` name of one of the OWNER's symbol pictures from its
 *  stored URL, or null for anything else (another folder, another file). */
export function ownSymbolFileName(ownerId: string, url: string | null | undefined): string | null {
  if (!url) return null;
  const folder = userFolder("custom-pips", ownerId);
  const prefix = folder.publicUrl("x").slice(0, -1);
  const bare = url.split("?")[0] ?? "";
  if (!bare.startsWith(prefix)) return null;
  const name = bare.slice(prefix.length);
  return SYMBOL_FILE_RE.test(name) ? name : null;
}

/** Best effort: the row is the source of truth, so a failed remove only
 *  leaves an unreferenced file for the orphan sweep. */
export async function removeSymbolPictures(ownerId: string, names: string[]): Promise<void> {
  const own = names.filter((name) => SYMBOL_FILE_RE.test(name));
  if (own.length === 0) return;
  await userFolder("custom-pips", ownerId)
    .remove(own)
    .catch(() => undefined);
}
