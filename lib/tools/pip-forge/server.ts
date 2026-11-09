import "server-only";

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Json } from "@/types/supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { userFolder } from "@/lib/media/user-storage";
import type { RgbaImage } from "@/lib/tools/set-symbol/cutout";
import { GLYPH_PX, glyphFromRgba, paintPip } from "./glyph";
import {
  colourCardSchema,
  inkFor,
  normaliseHex,
  PIP_LIBRARY_MAX,
  type ColourCard,
  type ForgedPip,
  type Legibility,
  type PipFiles,
} from "./model";

// ---------------------------------------------------------------------------
// Pip Forge — the server's half: the stored truth. The pip and its glyph are
// painted HERE (the pure lib/tools/pip-forge/glyph.ts), written into the
// maker's own set-covers folder by the service role
// (lib/media/user-storage.ts) and the row written by the service role (0188:
// no API role inserts).
//
//   set-covers/<user>/pip-<v>.png     the pip (256 px, the custom-pip format)
//   set-covers/<user>/glyph-<g>.png   the glyph alone (512 px), what a new
//                                     disc colour is painted from
//
// A recolour writes a NEW pip version (the glyph file stays) and removes the
// old pip file: nothing else draws it — an override is a COPY in the
// custom-pips bucket (lib/pips/write-pip.ts).
// ---------------------------------------------------------------------------

const YEAR = "31536000";

export function pipFileName(version: string): string {
  return `pip-${version}.png`;
}

export function glyphFileName(version: string): string {
  return `glyph-${version}.png`;
}

export function newPipVersion(): string {
  return randomUUID();
}

export async function encodePng(img: RgbaImage): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

/** A PNG's pixels (RGBA), or null when it can't be read. */
export async function decodePng(bytes: Uint8Array): Promise<RgbaImage | null> {
  try {
    const { data, info } = await sharp(bytes, { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  } catch {
    return null;
  }
}

/** Upload one file into the maker's set-covers folder (never overwrites). */
async function put(userId: string, name: string, bytes: Buffer): Promise<string> {
  const covers = userFolder("set-covers", userId);
  const { error } = await covers.upload(name, bytes, { cacheControl: YEAR, contentType: "image/png", upsert: false });
  if (error) throw new Error(error.message);
  return covers.publicUrl(name);
}

/** Store a new pip: its glyph and the pip painted on `disc`. All or
 *  nothing: a failed write removes what this call wrote. */
export async function storePipFiles(
  userId: string,
  version: string,
  glyph: RgbaImage,
  disc: string,
): Promise<PipFiles> {
  const [glyphBytes, pipBytes] = await Promise.all([encodePng(glyph), encodePng(paintPip(glyph, disc))]);
  let glyphUrl: string | null = null;
  try {
    glyphUrl = await put(userId, glyphFileName(version), glyphBytes);
    const pipUrl = await put(userId, pipFileName(version), pipBytes);
    return { pip: pipUrl, glyph: glyphUrl };
  } catch (error) {
    await removePipFiles(userId, [glyphFileName(version), pipFileName(version)]);
    throw error;
  }
}

/** Paint and store a new pip file for an existing glyph (a recolour). */
export async function storeRecolouredPip(userId: string, version: string, glyph: RgbaImage, disc: string): Promise<string> {
  return put(userId, pipFileName(version), await encodePng(paintPip(glyphFromRgba(glyph), disc)));
}

export async function removePipFiles(userId: string, names: string[]): Promise<void> {
  if (names.length === 0) return;
  await userFolder("set-covers", userId)
    .remove(names)
    .catch(() => undefined);
}

/** The object name of one of the maker's OWN forge files from its public
 *  URL — the only URLs the forge reads back — or null. */
export function ownPipFileName(userId: string, url: string, kind: "pip" | "glyph"): string | null {
  const covers = userFolder("set-covers", userId);
  const prefix = covers.publicUrl("x").slice(0, -1);
  if (!url.startsWith(prefix)) return null;
  const name = url.slice(prefix.length);
  const re = kind === "pip" ? /^pip-[0-9a-f-]{36}\.png$/i : /^glyph-[0-9a-f-]{36}\.png$/i;
  return re.test(name) ? name : null;
}

/** One of the maker's own forge files' bytes, or null. */
export async function fetchOwnPipFile(userId: string, url: string, kind: "pip" | "glyph"): Promise<Uint8Array | null> {
  if (!ownPipFileName(userId, url, kind)) return null;
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

// --- rows -----------------------------------------------------------------------

type PipRow = {
  id: string;
  name: string;
  prompt: string;
  idea: string | null;
  disc_color: string;
  files: Json;
  colour_card: Json;
  legibility_16: number | string;
  legibility_24: number | string;
  created_at: string;
  updated_at: string;
};

export const PIP_COLUMNS =
  "id, name, prompt, idea, disc_color, files, colour_card, legibility_16, legibility_24, created_at, updated_at";

export function pipFromRow(row: PipRow): ForgedPip | null {
  const files = row.files as Record<string, unknown> | null;
  if (!files || typeof files.pip !== "string" || typeof files.glyph !== "string") return null;
  const card = colourCardSchema.safeParse(row.colour_card);
  const disc = normaliseHex(row.disc_color);
  if (!card.success || !disc) return null;
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    idea: row.idea,
    disc,
    ink: inkFor(disc),
    files: { pip: files.pip, glyph: files.glyph },
    card: card.data,
    legibility: { at16: Number(row.legibility_16), at24: Number(row.legibility_24) },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** How many pips `userId` keeps (null when the count can't be read). */
export async function countPips(userId: string): Promise<number | null> {
  const { count, error } = await createAdminClient()
    .from("forged_pips")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
  return error ? null : (count ?? 0);
}

export const LIBRARY_FULL_MESSAGE = `Your forge holds ${PIP_LIBRARY_MAX} pips. Delete one to forge another.`;

export async function insertPipRow(input: {
  userId: string;
  name: string;
  prompt: string;
  idea: string | null;
  disc: string;
  version: string;
  files: PipFiles;
  card: ColourCard;
  legibility: Legibility;
}): Promise<ForgedPip | null> {
  const { data, error } = await createAdminClient()
    .from("forged_pips")
    .insert({
      owner_id: input.userId,
      name: input.name,
      prompt: input.prompt,
      idea: input.idea,
      disc_color: input.disc,
      version: input.version,
      files: input.files as unknown as Json,
      colour_card: input.card as unknown as Json,
      legibility_16: input.legibility.at16,
      legibility_24: input.legibility.at24,
    })
    .select(PIP_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[pip-forge] insert failed:", error?.message);
    return null;
  }
  return pipFromRow(data as PipRow);
}

/** The owner's row with its version, read with the service role (the
 *  actions' own checks ran first). */
export async function readOwnPip(userId: string, id: string): Promise<(ForgedPip & { version: string }) | null> {
  const { data } = await createAdminClient()
    .from("forged_pips")
    .select(`${PIP_COLUMNS}, version`)
    .eq("id", id)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!data) return null;
  const pip = pipFromRow(data as PipRow);
  return pip ? { ...pip, version: (data as { version: string }).version } : null;
}

/** Point the row at a new pip version in a new disc colour — only while it
 *  still holds `fromVersion` (two recolours at once: the second loses). */
export async function updatePipColour(input: {
  userId: string;
  id: string;
  fromVersion: string;
  version: string;
  disc: string;
  files: PipFiles;
}): Promise<ForgedPip | null> {
  const { data, error } = await createAdminClient()
    .from("forged_pips")
    .update({ disc_color: input.disc, version: input.version, files: input.files as unknown as Json })
    .eq("id", input.id)
    .eq("owner_id", input.userId)
    .eq("version", input.fromVersion)
    .select(PIP_COLUMNS)
    .maybeSingle();
  if (error || !data) return null;
  return pipFromRow(data as PipRow);
}

/** The stored glyph's size, for a sanity check on a fetched file. */
export const STORED_GLYPH_PX = GLYPH_PX;
