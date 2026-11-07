"use server";

import sharp from "sharp";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isUserStorageConfigured } from "@/lib/media/user-storage";
import { prepareUploadBytes } from "@/lib/media/upload-bytes";
import { checkUploadRateLimit, uploadRateLimitFailure, type UploadLimitFields } from "@/lib/media/upload-rate-limit";
import { scanImageBytes } from "@/lib/moderation/image-scan";
import { BLOCKED_CATEGORIES } from "@/lib/moderation/image-scan-core";
import { recordToolEvent } from "@/lib/tools/events";
import { checkToolAccess } from "@/lib/tools/queries";
import {
  cutoutSettingsSchema,
  deleteSymbolSchema,
  recutSymbolSchema,
  renameSymbolSchema,
  symbolNameSchema,
  SYMBOL_LIBRARY_MAX,
  SYMBOL_UPLOAD_MAX_BYTES,
  type StudioSymbol,
} from "./model";
import { symbolSourceName } from "./naming";
import {
  countSymbols,
  decodeWorking,
  fetchOwnSource,
  insertSymbolRow,
  LIBRARY_FULL_MESSAGE,
  newSymbolVersion,
  paintSymbolFiles,
  readOwnSymbol,
  removeSymbolVersion,
  SET_SYMBOL_SLUG,
  sourceExtensionOf,
  storeSymbolVersion,
  SymbolCutError,
  updateSymbolVersion,
} from "./server";

// ---------------------------------------------------------------------------
// Set Symbol Studio's server actions (beta tool `set-symbol-studio`). Each
// checks the viewer's access first (checkToolAccess) and records what it
// did (recordToolEvent — counts and choices only, never a prompt). Bringing
// your own picture and re-cutting are FREE: no model runs (owner
// 2026-11-06: the background is keyed away by our own code). An upload
// follows every upload path's rules: the upload rate limit, a byte sniff,
// prepareUploadBytes (upright, no camera metadata), the image scan BEFORE
// anything is stored, then the files into the maker's own folders.
// ---------------------------------------------------------------------------

const NO_ACCESS = "Set Symbol Studio isn't open to your account right now.";
const UNAVAILABLE = "Saving symbols isn't available right now.";
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);
const UPLOAD_SCAN_TIMEOUT_MS = 20_000;

export type SymbolResult =
  | { ok: true; symbol: StudioSymbol }
  | ({ ok: false; error: string } & UploadLimitFields);

export type SimpleResult = { ok: true } | { ok: false; error: string };

function ready(): string | null {
  if (!isSupabaseConfigured()) return "Supabase is not configured.";
  if (!isUserStorageConfigured() || !isAdminConfigured()) return UNAVAILABLE;
  return null;
}

function parseSettings(raw: FormDataEntryValue | null) {
  try {
    return cutoutSettingsSchema.safeParse(typeof raw === "string" ? JSON.parse(raw) : {});
  } catch {
    return cutoutSettingsSchema.safeParse({});
  }
}

/** "Bring your own": a picture with its background removed, every look
 *  painted, saved as a new symbol. */
export async function uploadSymbolAction(formData: FormData): Promise<SymbolResult> {
  const notReady = ready();
  if (notReady) return { ok: false, error: notReady };
  const access = await checkToolAccess(SET_SYMBOL_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const limit = await checkUploadRateLimit(access.userId);
  if (!limit.ok) return uploadRateLimitFailure(limit);

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a picture first." };
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  if (file.size > SYMBOL_UPLOAD_MAX_BYTES) return { ok: false, error: "Pictures can be up to 8 MB." };
  const name = symbolNameSchema.safeParse(formData.get("name") ?? "");
  if (!name.success) return { ok: false, error: name.error.issues[0]?.message ?? "Give the symbol a name." };
  const settings = parseSettings(formData.get("settings"));
  if (!settings.success) return { ok: false, error: "Those cut-out settings aren't valid." };

  const kept = await countSymbols(access.userId);
  if (kept === null) return { ok: false, error: "Your symbols couldn't be read. Try again." };
  if (kept >= SYMBOL_LIBRARY_MAX) return { ok: false, error: LIBRARY_FULL_MESSAGE };

  const buffer = Buffer.from(await file.arrayBuffer());
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    return { ok: false, error: "That doesn't look like a valid image." };
  }
  const ext = sourceExtensionOf(metadata.format);
  if (!ext || !metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    return { ok: false, error: "Use a PNG, JPEG or WebP picture." };
  }
  let stored: Buffer;
  try {
    stored = await prepareUploadBytes(buffer, metadata, { maxBytes: SYMBOL_UPLOAD_MAX_BYTES });
  } catch {
    return { ok: false, error: "That doesn't look like a valid image." };
  }

  // The upload scan, on the bytes BEFORE they are stored: a flagged
  // picture is never public. Fails open, like every upload scan.
  const scan = await scanImageBytes(stored, `image/${ext === "jpg" ? "jpeg" : ext}`, {
    categories: BLOCKED_CATEGORIES,
    timeoutMs: UPLOAD_SCAN_TIMEOUT_MS,
  });
  if (scan.flagged) return { ok: false, error: "That image was flagged by our content filter and can't be used." };

  let version: string | null = null;
  try {
    const painted = await paintSymbolFiles(await decodeWorking(stored), settings.data);
    version = newSymbolVersion();
    const files = await storeSymbolVersion(access.userId, version, painted, { bytes: stored, ext });
    const symbol = await insertSymbolRow({
      userId: access.userId,
      name: name.data,
      source: "upload",
      prompt: null,
      style: null,
      settings: settings.data,
      version,
      files,
      legibility: painted.legibility,
    });
    if (!symbol) throw new Error("The symbol row was not written.");
    await recordToolEvent({
      slug: SET_SYMBOL_SLUG,
      userId: access.userId,
      event: "upload",
      access: access.via,
      props: { mode: painted.mode, ink: settings.data.ink, legibility: painted.legibility },
    });
    return { ok: true, symbol };
  } catch (error) {
    if (version) await removeSymbolVersion(access.userId, version, symbolSourceName(version, ext)).catch(() => undefined);
    if (error instanceof SymbolCutError) return { ok: false, error: error.message };
    console.error("[set-symbol] upload failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "The symbol couldn't be saved. Try again in a moment." };
  }
}

/** Cut a saved symbol again from its source with new settings: a NEW
 *  version (a card on the old one keeps it). Free. */
export async function recutSymbolAction(input: unknown): Promise<SymbolResult> {
  const notReady = ready();
  if (notReady) return { ok: false, error: notReady };
  const access = await checkToolAccess(SET_SYMBOL_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = recutSymbolSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Those cut-out settings aren't valid." };
  const limit = await checkUploadRateLimit(access.userId);
  if (!limit.ok) return uploadRateLimitFailure(limit);

  const current = await readOwnSymbol(access.userId, parsed.data.id);
  if (!current) return { ok: false, error: "That symbol is gone." };
  const bytes = await fetchOwnSource(access.userId, current.files.source);
  if (!bytes) return { ok: false, error: "The symbol's original picture couldn't be read. Try again in a moment." };

  let version: string | null = null;
  try {
    const painted = await paintSymbolFiles(await decodeWorking(bytes), parsed.data.settings);
    version = newSymbolVersion();
    const files = await storeSymbolVersion(access.userId, version, painted, { url: current.files.source });
    const symbol = await updateSymbolVersion({
      userId: access.userId,
      id: current.id,
      settings: parsed.data.settings,
      version,
      files,
      legibility: painted.legibility,
    });
    if (!symbol) throw new Error("The symbol row was not updated.");
    await recordToolEvent({
      slug: SET_SYMBOL_SLUG,
      userId: access.userId,
      event: "recut",
      access: access.via,
      props: { mode: painted.mode, ink: parsed.data.settings.ink, legibility: painted.legibility },
    });
    return { ok: true, symbol };
  } catch (error) {
    if (version) await removeSymbolVersion(access.userId, version).catch(() => undefined);
    if (error instanceof SymbolCutError) return { ok: false, error: error.message };
    console.error("[set-symbol] recut failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "The symbol couldn't be cut again. Try again in a moment." };
  }
}

export async function renameSymbolAction(input: unknown): Promise<SimpleResult> {
  const access = await checkToolAccess(SET_SYMBOL_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = renameSymbolSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Give the symbol a name." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("set_symbols")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .eq("owner_id", access.userId)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "The name couldn't be saved. Try again in a moment." };
  return { ok: true };
}

/** Remove a symbol from the studio. Cards that use its pictures keep them
 *  (each card holds its own URLs; the orphan sweep removes only files no
 *  row names). */
export async function deleteSymbolAction(input: unknown): Promise<SimpleResult> {
  const access = await checkToolAccess(SET_SYMBOL_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = deleteSymbolSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That symbol is already gone." };
  const supabase = await createClient();
  const { error } = await supabase.from("set_symbols").delete().eq("id", parsed.data.id).eq("owner_id", access.userId);
  if (error) return { ok: false, error: "That symbol couldn't be removed. Try again in a moment." };
  await recordToolEvent({ slug: SET_SYMBOL_SLUG, userId: access.userId, event: "delete", access: access.via });
  return { ok: true };
}
