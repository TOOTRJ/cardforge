import "server-only";

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Json } from "@/types/supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { userFolder } from "@/lib/media/user-storage";
import { cutOut, coverageShare, type RgbaImage, type ResolvedCutoutMode } from "./cutout";
import { fitSquare, legibilityScore, paintSymbol, SYMBOL_PX, WATERMARK_PX } from "./paint";
import {
  AUTO_FILE_LOOK,
  SYMBOL_FILE_VARIANTS,
  symbolFileName,
  symbolSourceName,
  symbolWatermarkName,
  type SourceExtension,
  type SymbolFileVariant,
} from "./naming";
import {
  cutoutSettingsSchema,
  SYMBOL_LIBRARY_MAX,
  WORKING_MAX_PX,
  type CutoutSettings,
  type StudioSymbol,
  type SymbolFiles,
} from "./model";
import type { SymbolStyle } from "./prompt";

// ---------------------------------------------------------------------------
// Set Symbol Studio — the server's half: the stored truth. Whatever the
// browser previewed, the files are cut and painted HERE from the source
// bytes (the same pure code, cutout.ts + paint.ts), written into the
// maker's own folders by the service role (lib/media/user-storage.ts), and
// the row written by the service role (0187: no API role inserts).
// ---------------------------------------------------------------------------

export const SET_SYMBOL_SLUG = "set-symbol-studio" as const;

const YEAR = "31536000";

export class SymbolCutError extends Error {
  constructor(
    message: string,
    readonly code: "empty" | "everything" | "unreadable",
  ) {
    super(message);
    this.name = "SymbolCutError";
  }
}

/** The source's pixels, upright, scaled to fit WORKING_MAX_PX (never up). */
export async function decodeWorking(bytes: Uint8Array): Promise<RgbaImage> {
  try {
    const { data, info } = await sharp(bytes, { animated: false, failOn: "none" })
      .rotate()
      .resize({ width: WORKING_MAX_PX, height: WORKING_MAX_PX, fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  } catch {
    throw new SymbolCutError("That doesn't look like a valid image.", "unreadable");
  }
}

async function png(img: RgbaImage): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

export type PaintedSymbol = {
  files: Record<SymbolFileVariant, Buffer>;
  watermark: Buffer;
  legibility: number;
  mode: ResolvedCutoutMode;
};

/** Cut `source` with `settings` and paint every file. Throws SymbolCutError
 *  when the cut leaves nothing, or removes nothing. */
export async function paintSymbolFiles(source: RgbaImage, settings: CutoutSettings): Promise<PaintedSymbol> {
  const { mask, mode } = cutOut(source, { mode: settings.mode, tolerance: settings.tolerance });
  const share = coverageShare(mask);
  if (share < 0.002) {
    throw new SymbolCutError(
      "Nothing was left after removing the background. Lower the tolerance or try another way to find it.",
      "empty",
    );
  }
  if (share > 0.97) {
    throw new SymbolCutError(
      "The background couldn't be told apart from the symbol. Try another way to find it, or raise the tolerance.",
      "everything",
    );
  }
  const small = fitSquare(source, mask, SYMBOL_PX);
  const large = fitSquare(source, mask, WATERMARK_PX);
  if (!small || !large) throw new SymbolCutError("Nothing was left after removing the background.", "empty");
  const keep = settings.ink === "colour";
  const looks: Record<SymbolFileVariant, RgbaImage> = {
    auto: paintSymbol(small, AUTO_FILE_LOOK),
    common: paintSymbol(small, "common"),
    uncommon: paintSymbol(small, "uncommon"),
    rare: paintSymbol(small, "rare"),
    mythic: paintSymbol(small, "mythic"),
    plain: paintSymbol(small, "plain", keep),
  };
  const files = Object.fromEntries(
    await Promise.all(SYMBOL_FILE_VARIANTS.map(async (variant) => [variant, await png(looks[variant])] as const)),
  ) as Record<SymbolFileVariant, Buffer>;
  return { files, watermark: await png(paintSymbol(large, "watermark")), legibility: legibilityScore(small), mode };
}

/** The source's extension for a sharp format, or null when it isn't one the
 *  studio keeps. */
export function sourceExtensionOf(format: string | undefined): SourceExtension | null {
  if (format === "png") return "png";
  if (format === "jpeg" || format === "jpg") return "jpg";
  if (format === "webp") return "webp";
  return null;
}

/**
 * Upload one version: the six set-covers files, the watermark (card-art)
 * and — when `source` is given — the source picture. All or nothing: a
 * failed write removes what this call wrote.
 */
export async function storeSymbolVersion(
  userId: string,
  version: string,
  painted: PaintedSymbol,
  source: { bytes: Uint8Array; ext: SourceExtension } | { url: string },
): Promise<SymbolFiles> {
  const covers = userFolder("set-covers", userId);
  const art = userFolder("card-art", userId);
  const wroteCovers: string[] = [];
  const wroteArt: string[] = [];
  const fail = async (message: string): Promise<never> => {
    await Promise.all([covers.remove(wroteCovers), art.remove(wroteArt)]);
    throw new Error(message);
  };

  let sourceUrl: string;
  if ("bytes" in source) {
    const name = symbolSourceName(version, source.ext);
    const { error } = await covers.upload(name, Buffer.from(source.bytes), {
      cacheControl: YEAR,
      contentType: source.ext === "jpg" ? "image/jpeg" : `image/${source.ext}`,
      upsert: false,
    });
    if (error) await fail(error.message);
    wroteCovers.push(name);
    sourceUrl = covers.publicUrl(name);
  } else {
    sourceUrl = source.url;
  }

  const urls: Partial<Record<SymbolFileVariant, string>> = {};
  for (const variant of SYMBOL_FILE_VARIANTS) {
    const name = symbolFileName(version, variant);
    const { error } = await covers.upload(name, painted.files[variant], {
      cacheControl: YEAR,
      contentType: "image/png",
      upsert: false,
    });
    if (error) await fail(error.message);
    wroteCovers.push(name);
    urls[variant] = covers.publicUrl(name);
  }
  const wmName = symbolWatermarkName(version);
  const { error: wmError } = await art.upload(wmName, painted.watermark, {
    cacheControl: YEAR,
    contentType: "image/png",
    upsert: false,
  });
  if (wmError) await fail(wmError.message);
  wroteArt.push(wmName);

  return {
    auto: urls.auto!,
    common: urls.common!,
    uncommon: urls.uncommon!,
    rare: urls.rare!,
    mythic: urls.mythic!,
    plain: urls.plain!,
    watermark: art.publicUrl(wmName),
    source: sourceUrl,
  };
}

/** Remove one version's files (a row write that failed after the upload). */
export async function removeSymbolVersion(userId: string, version: string, sourceName?: string): Promise<void> {
  const covers = userFolder("set-covers", userId);
  await Promise.all([
    covers.remove([...SYMBOL_FILE_VARIANTS.map((v) => symbolFileName(version, v)), ...(sourceName ? [sourceName] : [])]),
    userFolder("card-art", userId).remove([symbolWatermarkName(version)]),
  ]);
}

export function newSymbolVersion(): string {
  return randomUUID();
}

// --- rows ---------------------------------------------------------------------

type SymbolRow = {
  id: string;
  name: string;
  source: "ai" | "upload";
  prompt: string | null;
  cutout: Json;
  files: Json;
  legibility: number | string | null;
  created_at: string;
  updated_at: string;
};

export const SYMBOL_COLUMNS = "id, name, source, prompt, cutout, files, legibility, created_at, updated_at";

const FILE_KEYS = ["auto", "common", "uncommon", "rare", "mythic", "plain", "watermark", "source"] as const;

export function symbolFromRow(row: SymbolRow): StudioSymbol | null {
  const files = row.files as Record<string, unknown> | null;
  if (!files || typeof files !== "object") return null;
  for (const key of FILE_KEYS) if (typeof files[key] !== "string") return null;
  const settings = cutoutSettingsSchema.safeParse(row.cutout ?? {});
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    prompt: row.prompt,
    settings: settings.success ? settings.data : cutoutSettingsSchema.parse({}),
    files: files as unknown as SymbolFiles,
    legibility: row.legibility == null ? null : Number(row.legibility),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** How many symbols `userId` keeps (null when the count can't be read). */
export async function countSymbols(userId: string): Promise<number | null> {
  const { count, error } = await createAdminClient()
    .from("set_symbols")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  return error ? null : (count ?? 0);
}

export const LIBRARY_FULL_MESSAGE = `Your studio holds ${SYMBOL_LIBRARY_MAX} symbols. Delete one to make another.`;

export async function insertSymbolRow(input: {
  userId: string;
  name: string;
  source: "ai" | "upload";
  prompt: string | null;
  style: SymbolStyle | null;
  settings: CutoutSettings;
  version: string;
  files: SymbolFiles;
  legibility: number;
}): Promise<StudioSymbol | null> {
  const { data, error } = await createAdminClient()
    .from("set_symbols")
    .insert({
      owner_id: input.userId,
      name: input.name,
      source: input.source,
      prompt: input.prompt,
      style: input.style,
      cutout: input.settings as unknown as Json,
      version: input.version,
      files: input.files as unknown as Json,
      legibility: input.legibility,
    })
    .select(SYMBOL_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[set-symbol] insert failed:", error?.message);
    return null;
  }
  return symbolFromRow(data as SymbolRow);
}

/** The owner's row, read with the service role (the actions' own checks
 *  ran first). */
export async function readOwnSymbol(
  userId: string,
  id: string,
): Promise<(StudioSymbol & { version: string }) | null> {
  const { data } = await createAdminClient()
    .from("set_symbols")
    .select(`${SYMBOL_COLUMNS}, version, owner_id`)
    .eq("id", id)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!data) return null;
  const symbol = symbolFromRow(data as SymbolRow);
  return symbol ? { ...symbol, version: (data as { version: string }).version } : null;
}

export async function updateSymbolVersion(input: {
  userId: string;
  id: string;
  settings: CutoutSettings;
  version: string;
  files: SymbolFiles;
  legibility: number;
}): Promise<StudioSymbol | null> {
  const { data, error } = await createAdminClient()
    .from("set_symbols")
    .update({
      cutout: input.settings as unknown as Json,
      version: input.version,
      files: input.files as unknown as Json,
      legibility: input.legibility,
    })
    .eq("id", input.id)
    .eq("owner_id", input.userId)
    .select(SYMBOL_COLUMNS)
    .single();
  if (error || !data) return null;
  return symbolFromRow(data as SymbolRow);
}

/** A stored source picture's bytes — only a URL in the owner's own
 *  set-covers folder, under the symbol's own name pattern. */
export async function fetchOwnSource(userId: string, url: string): Promise<Uint8Array | null> {
  const covers = userFolder("set-covers", userId);
  const prefix = covers.publicUrl("x").slice(0, -1);
  if (!url.startsWith(prefix) || !/^sym-[0-9a-f-]{36}-source\.(png|jpg|webp)$/i.test(url.slice(prefix.length))) {
    return null;
  }
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}
