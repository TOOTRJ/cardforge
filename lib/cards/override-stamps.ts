import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { backBodyOf } from "@/lib/cards/faces";
import { templateOfFrameStyle } from "@/lib/cards/layout-version";

// ---------------------------------------------------------------------------
// The frame-layout OVERLAP GUARD both stored-bake paths share — the save
// bake (lib/cards/bake-render.ts) and the re-bake batch
// (lib/cards/rebake-batch.ts). Rendering takes seconds; an admin can save a
// template's layout (frame_profile_overrides) meanwhile, and that save marks
// the template's cards stale. A bake that drew the OLD layout must never
// leave a CURRENT stamp behind it. So a bake:
//
//   1. reads the override STAMPS (each row's updated_at, uncached) BEFORE
//      the overrides themselves — a save landing between the two reads then
//      shows as a moved stamp, never as a new stamp beside an older layout;
//   2. before uploading, asks `overridesMoved` for every template it drew
//      (`templatesBakedFor`: the front's and, on a two-faced card, the back
//      body's) — moved = the render is superseded, nothing uploaded;
//   3. after its write, asks again — moved = the card is RE-MARKED (null
//      stamp, conditional on the render it just wrote) so the platform
//      re-bakes it.
//
// Fail safe: `readOverrideStamps` THROWS on a query error (the bake refuses,
// as on the overrides-read outage path); `overridesMoved` answers TRUE when
// it can't read (superseded before the upload, re-marked after the write).
// Neither ever lets a bake stamp itself current on a guess, and neither
// retries by itself: a re-mark is one later platform re-bake.
// ---------------------------------------------------------------------------

type StampClient = Pick<ReturnType<typeof createAdminClient>, "from">;

/** template → the override row's updated_at (uncached). Throws on a query
 *  error: an unread stamp must never read as "no override". */
export async function readOverrideStamps(supabase: StampClient): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("frame_profile_overrides").select("template, updated_at");
  if (error) throw new Error(`Frame layout override stamps could not be read: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.template as string, r.updated_at as string]));
}

/** True when any of `templates`' override rows moved since `stamps` was
 *  read (uncached) — and when it can't tell (a failed read is a move). */
export async function overridesMoved(
  supabase: StampClient,
  templates: readonly string[],
  stamps: ReadonlyMap<string, string>,
): Promise<boolean> {
  try {
    const now = await Promise.all(templates.map((t) => readOverrideStamp(supabase, t)));
    return templates.some((t, i) => now[i] !== (stamps.get(t) ?? null));
  } catch {
    return true;
  }
}

/** Part 3 of the guard, after a bake's write: when any of `templates`'
 *  layouts moved (or can't be read), re-mark the card — a null stamp, only
 *  while the row still holds the render this bake wrote (`rendered_at`) —
 *  so the platform re-bakes it ("marked" scope). True when it re-marked. */
export async function remarkIfLayoutMoved(
  supabase: StampClient,
  bake: { cardId: string; renderedAt: string; templates: readonly string[]; stamps: ReadonlyMap<string, string> },
): Promise<boolean> {
  if (!(await overridesMoved(supabase, bake.templates, bake.stamps))) return false;
  const { error } = await supabase
    .from("cards")
    .update({ layout_version: null })
    .eq("id", bake.cardId)
    .eq("rendered_at", bake.renderedAt);
  if (error) {
    console.warn(`[override-stamps] Could not re-mark card ${bake.cardId} after a layout save: ${error.message}`);
  }
  return true;
}

async function readOverrideStamp(supabase: StampClient, template: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("frame_profile_overrides")
    .select("updated_at")
    .eq("template", template)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.updated_at as string | undefined) ?? null;
}

/** Every template a stored bake of this row DRAWS: the front's (as the
 *  renderer normalizes it from the row) and the back body's when the card
 *  has one (TODO 5.3, read from the preview data the bake rendered). */
export function templatesBakedFor(
  row: { frame_style: unknown } & NonNullable<Parameters<typeof normalizeFrameTemplate>[1]>,
  faces: Pick<CardPreviewData, "frameStyle" | "backFace">,
): string[] {
  const front = normalizeFrameTemplate(templateOfFrameStyle(row.frame_style), row);
  const back = backBodyOf(faces)?.template;
  return back && back !== front ? [front, back] : [front];
}
