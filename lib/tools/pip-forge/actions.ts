"use server";

import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isAdminConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isUserStorageConfigured } from "@/lib/media/user-storage";
import { checkUploadRateLimit, uploadRateLimitFailure, type UploadLimitFields } from "@/lib/media/upload-rate-limit";
import { writeCustomPip } from "@/lib/pips/write-pip";
import type { CustomPipSymbol } from "@/lib/pips/override";
import { recordToolEvent } from "@/lib/tools/events";
import { checkToolAccess } from "@/lib/tools/queries";
import { GLYPH_PX, PIP_PX } from "./glyph";
import {
  deletePipSchema,
  normaliseHex,
  PIP_FORGE_SLUG,
  recolourPipSchema,
  renamePipSchema,
  usePipSchema,
  type ForgedPip,
} from "./model";
import {
  decodePng,
  fetchOwnPipFile,
  newPipVersion,
  ownPipFileName,
  pipFileName,
  readOwnPip,
  removePipFiles,
  storeRecolouredPip,
  updatePipColour,
} from "./server";

// ---------------------------------------------------------------------------
// Pip Forge's server actions (beta tool `pip-forge`). Each checks the
// viewer's access first (checkToolAccess) and records what it did
// (recordToolEvent — counts and choices only, never a prompt). Everything
// here is FREE: no model runs.
//
//   * recolour — a new disc colour painted from the stored glyph;
//   * use      — the pip becomes one of the six overrides (W U B R G C)
//                through THE custom-pip write (lib/pips/write-pip.ts: the
//                scan, the canonical object, the row, the re-bake) — the
//                manager's upload path, never a second one;
//   * rename / delete — the owner's row (RLS: 0188 grants the name alone).
//
// A write into storage counts as an upload (checkUploadRateLimit), as every
// user-folder writer does.
// ---------------------------------------------------------------------------

const NO_ACCESS = "Pip Forge isn't open to your account right now.";
const UNAVAILABLE = "Saving pips isn't available right now.";

export type PipResult = { ok: true; pip: ForgedPip } | ({ ok: false; error: string } & UploadLimitFields);
export type UsePipResult =
  | { ok: true; symbol: CustomPipSymbol; imageUrl: string }
  | ({ ok: false; error: string } & UploadLimitFields);
export type SimpleResult = { ok: true } | { ok: false; error: string };

function ready(): string | null {
  if (!isSupabaseConfigured() || !isUserStorageConfigured() || !isAdminConfigured()) return UNAVAILABLE;
  return null;
}

/** Paint the pip on a new disc colour (free): a new pip file, the glyph
 *  kept; the old pip file removed (an override is a copy of its own). */
export async function recolourPipAction(input: unknown): Promise<PipResult> {
  const notReady = ready();
  if (notReady) return { ok: false, error: notReady };
  const access = await checkToolAccess(PIP_FORGE_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = recolourPipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick a colour for the disc." };
  const disc = normaliseHex(parsed.data.disc)!;

  const current = await readOwnPip(access.userId, parsed.data.id);
  if (!current) return { ok: false, error: "That pip is gone." };
  if (current.disc === disc) return { ok: true, pip: current };
  const limit = await checkUploadRateLimit(access.userId);
  if (!limit.ok) return uploadRateLimitFailure(limit);

  const bytes = await fetchOwnPipFile(access.userId, current.files.glyph, "glyph");
  const glyph = bytes ? await decodePng(bytes) : null;
  if (!glyph || glyph.width !== GLYPH_PX || glyph.height !== GLYPH_PX) {
    return { ok: false, error: "The pip's glyph couldn't be read. Try again in a moment." };
  }

  const version = newPipVersion();
  try {
    const pipUrl = await storeRecolouredPip(access.userId, version, glyph, disc);
    const pip = await updatePipColour({
      userId: access.userId,
      id: current.id,
      fromVersion: current.version,
      version,
      disc,
      files: { pip: pipUrl, glyph: current.files.glyph },
    });
    if (!pip) {
      await removePipFiles(access.userId, [pipFileName(version)]);
      return { ok: false, error: "The pip changed while it was being painted. Try again." };
    }
    const old = ownPipFileName(access.userId, current.files.pip, "pip");
    if (old) await removePipFiles(access.userId, [old]);
    await recordToolEvent({
      slug: PIP_FORGE_SLUG,
      userId: access.userId,
      event: "recolour",
      access: access.via,
    });
    return { ok: true, pip };
  } catch (error) {
    await removePipFiles(access.userId, [pipFileName(version)]);
    console.error("[pip-forge] recolour failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "The pip couldn't be painted. Try again in a moment." };
  }
}

/** Make the pip one of the maker's six overrides (free). Every card they
 *  own draws it in place of that symbol. */
export async function setPipAsOverrideAction(input: unknown): Promise<UsePipResult> {
  const notReady = ready();
  if (notReady) return { ok: false, error: notReady };
  const access = await checkToolAccess(PIP_FORGE_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = usePipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick which symbol the pip replaces." };
  const limit = await checkUploadRateLimit(access.userId);
  if (!limit.ok) return uploadRateLimitFailure(limit);

  const pip = await readOwnPip(access.userId, parsed.data.id);
  if (!pip) return { ok: false, error: "That pip is gone." };
  const bytes = await fetchOwnPipFile(access.userId, pip.files.pip, "pip");
  if (!bytes) return { ok: false, error: "The pip's picture couldn't be read. Try again in a moment." };
  // The stored pip IS the custom-pip format (256 px PNG): checked, never
  // trusted blindly — a file of another size is refused, not resized.
  const pixels = await decodePng(bytes);
  if (!pixels || pixels.width !== PIP_PX || pixels.height !== PIP_PX) {
    return { ok: false, error: "The pip's picture couldn't be read. Try again in a moment." };
  }

  const written = await writeCustomPip(access.userId, parsed.data.symbol, Buffer.from(bytes));
  if (!written.ok) return { ok: false, error: written.error };
  await recordToolEvent({
    slug: PIP_FORGE_SLUG,
    userId: access.userId,
    event: "use_as_pip",
    access: access.via,
    props: { symbol: parsed.data.symbol },
  });
  return { ok: true, symbol: parsed.data.symbol, imageUrl: written.imageUrl };
}

export async function renamePipAction(input: unknown): Promise<SimpleResult> {
  const access = await checkToolAccess(PIP_FORGE_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = renamePipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Give the pip a name." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("forged_pips")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .eq("owner_id", access.userId)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "The name couldn't be saved. Try again in a moment." };
  return { ok: true };
}

/** Remove a pip from the forge, and its two files. An override made from it
 *  stays (it is a copy in the custom-pips bucket). */
export async function deletePipAction(input: unknown): Promise<SimpleResult> {
  const access = await checkToolAccess(PIP_FORGE_SLUG);
  if (!access) return { ok: false, error: NO_ACCESS };
  const parsed = deletePipSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That pip is already gone." };
  const current = isAdminConfigured() ? await readOwnPip(access.userId, parsed.data.id) : null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("forged_pips")
    .delete()
    .eq("id", parsed.data.id)
    .eq("owner_id", access.userId)
    .select("id");
  if (error) return { ok: false, error: "That pip couldn't be removed. Try again in a moment." };
  if (current && data?.length && isUserStorageConfigured()) {
    const names = [
      ownPipFileName(access.userId, current.files.pip, "pip"),
      ownPipFileName(access.userId, current.files.glyph, "glyph"),
    ].filter((n): n is string => n !== null);
    await removePipFiles(access.userId, names);
  }
  await recordToolEvent({ slug: PIP_FORGE_SLUG, userId: access.userId, event: "delete", access: access.via });
  return { ok: true };
}
