import "server-only";

import { createClient } from "@/lib/supabase/server";
import { scanImageUrl } from "@/lib/moderation/image-scan";
import { userFolder } from "@/lib/media/user-storage";
import { finishPipChange } from "@/lib/pips/remove-pip";
import type { CustomPipSymbol } from "@/lib/pips/override";

// ---------------------------------------------------------------------------
// THE custom-pip write — one of the owner's six overrides (custom_pips,
// W U B R G C) set to a normalised 256 × 256 PNG. Every way a pip becomes an
// override goes through here: the manager's upload (saveCustomPipAction,
// lib/pips/actions.ts) and Pip Forge's "Use as a pip" (lib/tools/pip-forge/
// actions.ts). Plain module, not "use server": each caller has checked who is
// asking, counted the upload (checkUploadRateLimit) and made the PNG; it
// passes the owner it verified.
//
// The steps (unchanged from the upload's own):
//   1. stage the bytes under a pending name and SCAN them (versioned URL) —
//      a flagged picture never replaces the owner's approved pip;
//   2. write the canonical `{owner}/{SYMBOL}.png` (upsert: no orphans);
//   3. upsert the row with a `?v=` cache-buster (the owner's session, RLS);
//   4. finishPipChange — the RSC caches and the re-bake of the owner's cards.
// ---------------------------------------------------------------------------

export type WritePipResult = { ok: true; imageUrl: string } | { ok: false; error: string };

export async function writeCustomPip(
  ownerId: string,
  symbol: CustomPipSymbol,
  pngBytes: Buffer,
): Promise<WritePipResult> {
  const name = `${symbol}.png`;
  const pips = userFolder("custom-pips", ownerId);
  const supabase = await createClient();

  // Moderate BEFORE touching the canonical object. The canonical path is
  // deterministic and overwritten in place, so scanning after the upsert
  // meant a flagged image had already replaced the owner's approved pip —
  // and the rejection then deleted that object while the custom_pips row
  // kept pointing at it. Stage the bytes under a pending name, scan THAT
  // (versioned, so a cached copy of an older pending upload can't answer
  // for the new bytes), and only then write the real object.
  const pendingName = `${symbol}.pending.png`;
  const { error: stageError } = await pips.upload(pendingName, pngBytes, {
    cacheControl: "0",
    contentType: "image/png",
    upsert: true,
  });
  if (stageError) {
    return { ok: false, error: stageError.message };
  }
  const pendingUrl = `${pips.publicUrl(pendingName)}?v=${Date.now()}`;

  // NSFW auto-scan — fails open (a moderation hiccup never blocks uploads);
  // a positive flag drops the staged bytes and leaves the current pip alone.
  const scan = await scanImageUrl(pendingUrl);
  if (scan.flagged) {
    await pips.remove([pendingName]);
    return {
      ok: false,
      error: "That image was flagged by our content filter and can't be used.",
    };
  }

  const { error: uploadError } = await pips.upload(name, pngBytes, {
    cacheControl: "3600",
    contentType: "image/png",
    upsert: true,
  });
  await pips.remove([pendingName]);
  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  // Deterministic path + upsert means CDNs may hold the previous bytes —
  // version the URL the same way bake-render.ts versions card renders.
  const imageUrl = `${pips.publicUrl(name)}?v=${Date.now()}`;

  const { error: upsertError } = await supabase
    .from("custom_pips")
    .upsert(
      { owner_id: ownerId, symbol, image_url: imageUrl },
      { onConflict: "owner_id,symbol" },
    );
  if (upsertError) {
    return { ok: false, error: upsertError.message };
  }

  finishPipChange(ownerId, symbol);
  return { ok: true, imageUrl };
}
