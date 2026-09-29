import "server-only";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { createClient } from "@/lib/supabase/server";
import { isUserStorageConfigured, userFolder } from "@/lib/media/user-storage";
import { bakeAndPersistCardRender } from "@/lib/cards/bake-render";
import type { CustomPipSymbol } from "@/lib/pips/override";

// ---------------------------------------------------------------------------
// Removing a custom pip — the steps of the owner's "Remove"
// (deleteCustomPipAction, lib/pips/actions.ts), shared with the flagged-file
// rescan (lib/moderation/flagged-file.ts: a pip whose picture the moderation
// rescan flagged is removed the same way). Plain module, not "use server":
// every caller has checked who is asking and passes the owner it verified.
//
//   1. deleteCustomPipRow — the custom_pips row (the source of truth);
//   2. removeCustomPipObject — `{owner}/{SYMBOL}.png` in the owner's
//      custom-pips folder (service role, best-effort: a failure only leaves
//      an unreferenced file);
//   3. finishPipChange — refresh the RSC caches that feed overrides to the
//      editor/preview, then re-bake the owner's affected cards AFTER the
//      response (next/server `after`), so their stored renders stop drawing
//      the old icon.
// ---------------------------------------------------------------------------

type Client = SupabaseClient<Database>;

// How many of the owner's affected baked thumbnails the post-response sweep
// refreshes, newest first. Detail pages and exports always render live; a
// long tail of very old gallery thumbnails catches up on next save or via
// scripts/rebake-renders.mjs.
const REBAKE_SWEEP_CAP = 40;

/** Delete the owner's pip row for `symbol` — only while it still names
 *  `onlyIfImageUrl`, when given (a compare-and-set for a caller that decided
 *  from an earlier read). → how many rows went (null when the answer didn't
 *  say). */
export async function deleteCustomPipRow(
  client: Client,
  ownerId: string,
  symbol: CustomPipSymbol,
  options: { onlyIfImageUrl?: string } = {},
): Promise<{ error: string | null; deleted: number | null }> {
  let query = client.from("custom_pips").delete().eq("owner_id", ownerId).eq("symbol", symbol);
  if (options.onlyIfImageUrl !== undefined) query = query.eq("image_url", options.onlyIfImageUrl);
  const { data, error } = await query.select("id");
  if (error) return { error: error.message, deleted: null };
  return { error: null, deleted: Array.isArray(data) ? data.length : null };
}

/** Best-effort object cleanup — the row is the source of truth, so a failed
 *  remove (or no service-role storage) only leaves an unreferenced file. */
export async function removeCustomPipObject(ownerId: string, symbol: CustomPipSymbol): Promise<void> {
  if (!isUserStorageConfigured()) return;
  await userFolder("custom-pips", ownerId)
    .remove([`${symbol}.png`])
    .catch(() => {});
}

/**
 * Shared post-change plumbing: refresh the RSC caches that feed overrides to
 * the editor/preview, then sweep the owner's affected baked thumbnails AFTER
 * the response is sent (next/server `after`) so the click stays fast.
 * `cardsClient` reads the owner's card list (default: the request's own
 * client — the owner's session in the pip actions).
 */
export function finishPipChange(
  ownerId: string,
  symbol: CustomPipSymbol,
  options: { cardsClient?: Client } = {},
) {
  revalidatePath("/create");
  revalidatePath("/dashboard");
  revalidatePath("/settings");

  after(async () => {
    try {
      await rebakeCardsUsingSymbol(options.cardsClient ?? (await createClient()), ownerId, symbol);
    } catch (error) {
      console.error("[custom-pips] rebake sweep failed", error);
    }
  });
}

/**
 * Re-bake the owner's most recently updated cards whose front or back cost
 * uses the changed symbol as a pure color pip. Capped + best-effort: a
 * failure on one card never blocks the rest (bakeAndPersistCardRender
 * already swallows per-card render errors).
 */
async function rebakeCardsUsingSymbol(
  supabase: Client,
  ownerId: string,
  symbol: CustomPipSymbol,
): Promise<void> {
  const { data, error } = await supabase
    .from("cards")
    .select("id, cost, rules_text, back_face")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(400);
  if (error || !data) return;

  // The renderers draw custom pips in the cost AND inline in rules text
  // ({T}: Add {R}), on both faces — a sweep that only looked at the cost
  // left every rules-text pip on the old icon until the card was resaved.
  const token = `{${symbol}}`;
  const affected = data
    .filter((row) => {
      if (row.cost?.includes(token) || row.rules_text?.includes(token)) return true;
      const back = row.back_face as { cost?: string; rules_text?: string } | null;
      return (
        (typeof back?.cost === "string" && back.cost.includes(token)) ||
        (typeof back?.rules_text === "string" && back.rules_text.includes(token))
      );
    })
    .slice(0, REBAKE_SWEEP_CAP);

  for (const row of affected) {
    await bakeAndPersistCardRender(row.id, ownerId);
  }
}
