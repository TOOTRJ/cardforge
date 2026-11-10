"use server";

import "server-only";

import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isUserStorageConfigured } from "@/lib/media/user-storage";
import { prepareUploadBytes } from "@/lib/media/upload-bytes";
import {
  checkUploadRateLimit,
  uploadRateLimitFailure,
  type UploadLimitFields,
} from "@/lib/media/upload-rate-limit";
import { scanImageBytes } from "@/lib/moderation/image-scan";
import { BLOCKED_CATEGORIES } from "@/lib/moderation/image-scan-core";
import { recordToolEvent } from "@/lib/tools/events";
import { checkToolAccess } from "@/lib/tools/queries";
import { PIP_FORGE_SLUG } from "@/lib/tools/pip-forge/model";
import { decodePng, fetchOwnPipFile, readOwnPip } from "@/lib/tools/pip-forge/server";
import {
  ownSymbolFileName,
  removeSymbolPictures,
  storeSymbolPicture,
  SYMBOL_PICTURE_PX,
} from "@/lib/symbols/write-symbol";
import { SYMBOL_COLUMNS, symbolFromRow, type SymbolRow } from "@/lib/symbols/queries";
import {
  CUSTOM_SYMBOLS_SLUG,
  LIVE_SYMBOL_CAP,
  SYMBOL_ROW_CAP,
  symbolDetailsSchema,
  symbolEditSchema,
  symbolFromForgeSchema,
  symbolIdSchema,
  symbolToken,
  type CustomSymbol,
  type SymbolDetails,
} from "@/lib/symbols/symbols";

// ---------------------------------------------------------------------------
// New mana symbols — the manager's writes (beta tool `custom-symbols`,
// migration 0193). Every action checks the viewer's access first
// (checkToolAccess: admins and testers while in beta) and records what it did
// (recordToolEvent — counts and choices, never a name or a picture).
//
// A picture follows every upload path's rules: the upload rate limit right
// after the checks that need no bytes, a byte sniff, prepareUploadBytes
// (upright, no camera metadata), the image scan BEFORE anything is stored,
// then a 256 px PNG into the maker's own custom-pips folder
// (lib/symbols/write-symbol.ts). The row is written with the maker's session,
// so 0193's RLS (the tool gate), its caps and 0127's media guard all hold in
// the database too.
//
// "Remove" deletes a symbol no card of the maker's names; one a card names is
// KEPT as removed (a tombstone: the cards keep drawing it, Restore brings it
// back) — the database's delete guard decides, so a save landing at the same
// moment can't leave a card naming a deleted symbol.
//
// Nothing is revalidated: the manager follows each action's answer, and no
// other page draws a symbol yet (PR 2 adds the renderers and their re-bake).
// A revalidated tool page would also count as an `open` on every write.
// ---------------------------------------------------------------------------

const NO_ACCESS = "New mana symbols isn't open to your account right now.";
const UNAVAILABLE = "Saving symbols isn't available right now.";
const MAX_BYTES = 4 * 1024 * 1024;
const UPLOAD_SCAN_TIMEOUT_MS = 20_000;
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);
const ALLOWED_DECLARED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type SymbolResult =
  | { ok: true; symbol: CustomSymbol }
  | ({ ok: false; error: string; field?: "code" | "name" | "manaValue" | "baseColor" | "file" } & UploadLimitFields);

export type RemoveSymbolResult =
  | { ok: true; outcome: "deleted" | "kept"; symbol: CustomSymbol | null }
  | { ok: false; error: string };

function ready(): string | null {
  if (!isSupabaseConfigured() || !isUserStorageConfigured()) return UNAVAILABLE;
  return null;
}

/** A database refusal in the maker's words. */
function writeError(error: { code?: string; message?: string } | null, code?: string): { error: string; field?: "code" } {
  const message = error?.message ?? "";
  if (error?.code === "23505") {
    return {
      error: code
        ? `You already have a symbol ${symbolToken(code)}. Pick another code (a removed one can be restored).`
        : "You already have a symbol with that code.",
      field: "code",
    };
  }
  if (message.includes("custom_symbol_limit")) {
    return { error: `You have ${LIVE_SYMBOL_CAP} symbols, the most you can keep. Remove one to make another.` };
  }
  if (message.includes("custom_symbol_row_limit")) {
    return {
      error: `You have ${SYMBOL_ROW_CAP} symbols counting removed ones. Delete a removed symbol no card uses to make another.`,
    };
  }
  if (error?.code === "42501") return { error: NO_ACCESS };
  return { error: "The symbol couldn't be saved. Try again in a moment." };
}

async function readOwnSymbol(ownerId: string, id: string): Promise<CustomSymbol | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_symbols")
    .select(SYMBOL_COLUMNS)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error || !data) return null;
  return symbolFromRow(data as SymbolRow, ownerId);
}

/** The early, friendly checks before any bytes: the code is free and there
 *  is room. The database checks both again on the write. */
async function roomFor(ownerId: string, code: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_symbols")
    .select("code, deleted_at")
    .eq("owner_id", ownerId);
  if (error || !data) return null; // the write decides
  if (data.some((row) => row.code === code)) {
    const removed = data.find((row) => row.code === code)?.deleted_at;
    return removed
      ? `You removed ${symbolToken(code)} earlier — restore it under "Removed symbols", or pick another code.`
      : `You already have a symbol ${symbolToken(code)}. Pick another code.`;
  }
  if (data.filter((row) => row.deleted_at === null).length >= LIVE_SYMBOL_CAP) {
    return `You have ${LIVE_SYMBOL_CAP} symbols, the most you can keep. Remove one to make another.`;
  }
  if (data.length >= SYMBOL_ROW_CAP) {
    return `You have ${SYMBOL_ROW_CAP} symbols counting removed ones. Delete a removed symbol no card uses to make another.`;
  }
  return null;
}

/** An uploaded file → the 256 px PNG to store, or the reason it can't be. */
async function pictureFromUpload(file: FormDataEntryValue | null): Promise<{ png: Buffer } | { error: string }> {
  if (!(file instanceof File)) return { error: "Choose a picture for the symbol." };
  if (file.size === 0) return { error: "That file is empty." };
  if (file.size > MAX_BYTES) return { error: "Pictures can be up to 4 MB." };
  if (file.type && !ALLOWED_DECLARED_TYPES.has(file.type)) return { error: "Use a PNG, JPEG or WebP picture." };

  const buffer = Buffer.from(await file.arrayBuffer());
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    return { error: "That doesn't look like a valid image." };
  }
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) return { error: "Use a PNG, JPEG or WebP picture." };

  let stored: Buffer;
  try {
    stored = await prepareUploadBytes(buffer, metadata, { maxBytes: MAX_BYTES });
  } catch {
    return { error: "That doesn't look like a valid image." };
  }

  // The upload scan, on the bytes BEFORE they are stored: a flagged picture
  // is never public. Fails open, like every upload scan.
  const scan = await scanImageBytes(stored, `image/${metadata.format}`, {
    categories: BLOCKED_CATEGORIES,
    timeoutMs: UPLOAD_SCAN_TIMEOUT_MS,
  });
  if (scan.flagged) return { error: "That image was flagged by our content filter and can't be used." };

  try {
    // Cover-crop to a square: an off-square picture still fills the pip.
    const png = await sharp(stored)
      .resize(SYMBOL_PICTURE_PX, SYMBOL_PICTURE_PX, { fit: "cover" })
      .png()
      .toBuffer();
    return { png };
  } catch {
    return { error: "That doesn't look like a valid image." };
  }
}

function detailsFrom(formData: FormData) {
  return symbolDetailsSchema.safeParse({
    code: formData.get("code") ?? "",
    name: formData.get("name") ?? "",
    manaValue: formData.get("manaValue") ?? "",
    baseColor: formData.get("baseColor") ?? "",
  });
}

function fieldOf(path: PropertyKey[] | undefined): "code" | "name" | "manaValue" | "baseColor" | undefined {
  const key = path?.[0];
  return key === "code" || key === "name" || key === "manaValue" || key === "baseColor" ? key : undefined;
}

async function insertSymbol(
  ownerId: string,
  details: SymbolDetails,
  png: Buffer,
  source: "upload" | "forge",
): Promise<SymbolResult> {
  const stored = await storeSymbolPicture(ownerId, png);
  if (!stored.ok) return { ok: false, error: stored.error, field: "file" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_symbols")
    .insert({
      owner_id: ownerId,
      code: details.code,
      name: details.name,
      mana_value: details.manaValue,
      base_color: details.baseColor,
      image_url: stored.imageUrl,
      source,
    })
    .select(SYMBOL_COLUMNS)
    .single();
  const symbol = data ? symbolFromRow(data as SymbolRow, ownerId) : null;
  if (error || !symbol) {
    await removeSymbolPictures(ownerId, [stored.fileName]);
    return { ok: false, ...writeError(error, details.code) };
  }
  return { ok: true, symbol };
}

/** A new symbol from an uploaded picture. */
export async function createSymbolAction(formData: FormData): Promise<SymbolResult> {
  const notReady = ready();
  if (notReady) return { ok: false, error: notReady };
  const access = await checkToolAccess(CUSTOM_SYMBOLS_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };

  const details = detailsFrom(formData);
  if (!details.success) {
    const issue = details.error.issues[0];
    return { ok: false, error: issue?.message ?? "Check the symbol's details.", field: fieldOf(issue?.path) };
  }
  const full = await roomFor(access.userId, details.data.code);
  if (full) return { ok: false, error: full, field: full.includes("code") ? "code" : undefined };

  // One symbol is one upload, counted before any bytes are read.
  const limit = await checkUploadRateLimit(access.userId);
  if (!limit.ok) return uploadRateLimitFailure(limit);

  const picture = await pictureFromUpload(formData.get("file"));
  if ("error" in picture) return { ok: false, error: picture.error, field: "file" };

  const result = await insertSymbol(access.userId, details.data, picture.png, "upload");
  if (result.ok) {
    await recordToolEvent({
      slug: CUSTOM_SYMBOLS_SLUG,
      userId: access.userId,
      event: "create",
      access: access.via,
      props: { source: "upload", mana_value: details.data.manaValue, coloured: details.data.baseColor !== null },
    });
  }
  return result;
}

/** A new symbol from one of the maker's forged pips (Pip Forge): the pip's
 *  own 256 px picture, copied into the symbol's file. Needs both tools. */
export async function createSymbolFromForgedPipAction(input: unknown): Promise<SymbolResult> {
  const notReady = ready();
  if (notReady) return { ok: false, error: notReady };
  const access = await checkToolAccess(CUSTOM_SYMBOLS_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  if (!(await checkToolAccess(PIP_FORGE_SLUG))) {
    return { ok: false, error: "Pip Forge isn't open to your account right now." };
  }

  const parsed = symbolFromForgeSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Check the symbol's details.", field: fieldOf(issue?.path) };
  }
  const full = await roomFor(access.userId, parsed.data.code);
  if (full) return { ok: false, error: full, field: full.includes("code") ? "code" : undefined };

  const limit = await checkUploadRateLimit(access.userId);
  if (!limit.ok) return uploadRateLimitFailure(limit);

  const pip = await readOwnPip(access.userId, parsed.data.forgedPipId);
  if (!pip) return { ok: false, error: "That forged pip is gone." };
  const bytes = await fetchOwnPipFile(access.userId, pip.files.pip, "pip");
  // The forge's file IS a 256 px PNG made by the server: checked, never
  // trusted blindly — a file of another size is refused, not resized.
  const pixels = bytes ? await decodePng(bytes) : null;
  if (!bytes || !pixels || pixels.width !== SYMBOL_PICTURE_PX || pixels.height !== SYMBOL_PICTURE_PX) {
    return { ok: false, error: "The pip's picture couldn't be read. Try again in a moment." };
  }

  const details: SymbolDetails = {
    code: parsed.data.code,
    name: parsed.data.name,
    manaValue: parsed.data.manaValue,
    baseColor: parsed.data.baseColor,
  };
  const result = await insertSymbol(access.userId, details, Buffer.from(bytes), "forge");
  if (result.ok) {
    await recordToolEvent({
      slug: CUSTOM_SYMBOLS_SLUG,
      userId: access.userId,
      event: "create",
      access: access.via,
      props: { source: "forge", mana_value: details.manaValue, coloured: details.baseColor !== null },
    });
  }
  return result;
}

/** A symbol's name and meaning (its code never changes). */
export async function updateSymbolAction(input: unknown): Promise<SymbolResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: UNAVAILABLE };
  const access = await checkToolAccess(CUSTOM_SYMBOLS_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = symbolEditSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Check the symbol's details.", field: fieldOf(issue?.path) };
  }
  const before = await readOwnSymbol(access.userId, parsed.data.id);
  if (!before) return { ok: false, error: "That symbol is gone." };
  if (before.deletedAt) return { ok: false, error: "Restore the symbol to change it." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_symbols")
    .update({ name: parsed.data.name, mana_value: parsed.data.manaValue, base_color: parsed.data.baseColor })
    .eq("id", parsed.data.id)
    .eq("owner_id", access.userId)
    .is("deleted_at", null)
    .select(SYMBOL_COLUMNS)
    .maybeSingle();
  const symbol = data ? symbolFromRow(data as SymbolRow, access.userId) : null;
  if (error || !symbol) return { ok: false, ...writeError(error ?? null) };
  await recordToolEvent({
    slug: CUSTOM_SYMBOLS_SLUG,
    userId: access.userId,
    event: "edit",
    access: access.via,
    props: {
      renamed: before.name !== symbol.name,
      meaning_changed: before.manaValue !== symbol.manaValue || before.baseColor !== symbol.baseColor,
    },
  });
  return { ok: true, symbol };
}

/** A new picture for a symbol: a new file, then the row, then the old file
 *  goes. */
export async function replaceSymbolPictureAction(formData: FormData): Promise<SymbolResult> {
  const notReady = ready();
  if (notReady) return { ok: false, error: notReady };
  const access = await checkToolAccess(CUSTOM_SYMBOLS_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const id = symbolIdSchema.safeParse({ id: formData.get("id") });
  if (!id.success) return { ok: false, error: "That symbol is gone." };
  const before = await readOwnSymbol(access.userId, id.data.id);
  if (!before) return { ok: false, error: "That symbol is gone." };
  if (before.deletedAt) return { ok: false, error: "Restore the symbol to change it." };

  const limit = await checkUploadRateLimit(access.userId);
  if (!limit.ok) return uploadRateLimitFailure(limit);

  const picture = await pictureFromUpload(formData.get("file"));
  if ("error" in picture) return { ok: false, error: picture.error, field: "file" };

  const stored = await storeSymbolPicture(access.userId, picture.png);
  if (!stored.ok) return { ok: false, error: stored.error, field: "file" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_symbols")
    .update({ image_url: stored.imageUrl })
    .eq("id", id.data.id)
    .eq("owner_id", access.userId)
    .is("deleted_at", null)
    .select(SYMBOL_COLUMNS)
    .maybeSingle();
  const symbol = data ? symbolFromRow(data as SymbolRow, access.userId) : null;
  if (error || !symbol) {
    await removeSymbolPictures(access.userId, [stored.fileName]);
    return { ok: false, ...writeError(error ?? null) };
  }
  const old = ownSymbolFileName(access.userId, before.imageUrl);
  if (old && old !== stored.fileName) await removeSymbolPictures(access.userId, [old]);
  await recordToolEvent({
    slug: CUSTOM_SYMBOLS_SLUG,
    userId: access.userId,
    event: "replace_picture",
    access: access.via,
  });
  return { ok: true, symbol };
}

/** Remove a symbol: deleted for good when no card of the maker's names it,
 *  else kept as removed (its cards keep drawing it). A removed symbol no card
 *  names any more is deleted for good the same way. */
export async function removeSymbolAction(input: unknown): Promise<RemoveSymbolResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: UNAVAILABLE };
  const access = await checkToolAccess(CUSTOM_SYMBOLS_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = symbolIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That symbol is already gone." };
  const before = await readOwnSymbol(access.userId, parsed.data.id);
  if (!before) return { ok: false, error: "That symbol is already gone." };

  const supabase = await createClient();
  const { data: deleted, error: deleteError } = await supabase
    .from("custom_symbols")
    .delete()
    .eq("id", parsed.data.id)
    .eq("owner_id", access.userId)
    .select("id");

  let outcome: "deleted" | "kept";
  let symbol: CustomSymbol | null = null;
  if (!deleteError && deleted?.length) {
    outcome = "deleted";
    const file = ownSymbolFileName(access.userId, before.imageUrl);
    if (file && isUserStorageConfigured()) await removeSymbolPictures(access.userId, [file]);
  } else if (deleteError?.message?.includes("custom_symbol_in_use")) {
    if (before.deletedAt) {
      return {
        ok: false,
        error: `A card still uses ${symbolToken(before.code)}, so it stays here for that card. Take it off your cards first.`,
      };
    }
    const { data, error } = await supabase
      .from("custom_symbols")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", parsed.data.id)
      .eq("owner_id", access.userId)
      .is("deleted_at", null)
      .select(SYMBOL_COLUMNS)
      .maybeSingle();
    symbol = data ? symbolFromRow(data as SymbolRow, access.userId) : null;
    if (error || !symbol) return { ok: false, error: "The symbol couldn't be removed. Try again in a moment." };
    outcome = "kept";
  } else {
    if (deleteError?.code === "42501") return { ok: false, error: NO_ACCESS };
    return { ok: false, error: "The symbol couldn't be removed. Try again in a moment." };
  }

  await recordToolEvent({
    slug: CUSTOM_SYMBOLS_SLUG,
    userId: access.userId,
    event: "remove",
    access: access.via,
    props: { kept: outcome === "kept", was_removed: before.deletedAt !== null },
  });
  return { ok: true, outcome, symbol };
}

/** Bring a removed symbol back (it counts toward the cap again). */
export async function restoreSymbolAction(input: unknown): Promise<SymbolResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: UNAVAILABLE };
  const access = await checkToolAccess(CUSTOM_SYMBOLS_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = symbolIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That symbol is gone." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_symbols")
    .update({ deleted_at: null })
    .eq("id", parsed.data.id)
    .eq("owner_id", access.userId)
    .not("deleted_at", "is", null)
    .select(SYMBOL_COLUMNS)
    .maybeSingle();
  const symbol = data ? symbolFromRow(data as SymbolRow, access.userId) : null;
  if (error || !symbol) {
    if (!error) return { ok: false, error: "That symbol is gone." };
    return { ok: false, ...writeError(error) };
  }
  await recordToolEvent({ slug: CUSTOM_SYMBOLS_SLUG, userId: access.userId, event: "restore", access: access.via });
  return { ok: true, symbol };
}
