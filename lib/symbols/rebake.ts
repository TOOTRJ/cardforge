import "server-only";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { bakeAndPersistCardRender } from "@/lib/cards/bake-render";
import { customSymbolCodesIn } from "@/lib/symbols/symbol-token";

// ---------------------------------------------------------------------------
// The stored bakes a symbol's change leaves behind (layout v76): a card's
// stored PNG draws the picture its owner's symbol had when it was baked — the
// placeholder disc before the symbol existed, the old picture before a new
// one. After a symbol is MADE or its picture REPLACED, the owner's cards
// that name its code are re-baked after the response (next/server `after`),
// the way a custom pip's change re-bakes (lib/pips/remove-pip.ts
// finishPipChange). Renaming it, changing its meaning, removing it (it keeps
// drawing on the cards that name it) and restoring it draw nothing new.
//
// Capped and best-effort, newest first: detail pages and downloads render
// live; a long tail catches up on its next save.
// ---------------------------------------------------------------------------

const REBAKE_SWEEP_CAP = 40;
const SCANNED = 400;

/** True when a card row's drawn text names `{*code}` (any case): its cost,
 *  rules text, rows and back face — what 0193's in-use check reads. */
export function cardNamesSymbol(
  row: { cost?: string | null; rules_text?: string | null; face_content?: unknown; back_face?: unknown },
  code: string,
): boolean {
  const upper = code.toUpperCase();
  const texts = [row.cost, row.rules_text, JSON.stringify(row.face_content ?? null), JSON.stringify(row.back_face ?? null)];
  return texts.some((text) => customSymbolCodesIn(text).includes(upper));
}

/** Schedule the re-bake of the owner's cards that name `code`. The owner's
 *  session reads their own cards (every visibility: RLS). */
export function rebakeCardsNamingSymbol(ownerId: string, code: string): void {
  after(async () => {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("cards")
        .select("id, cost, rules_text, face_content, back_face")
        .eq("owner_id", ownerId)
        .order("updated_at", { ascending: false })
        .limit(SCANNED);
      if (error || !data) return;
      const affected = data.filter((row) => cardNamesSymbol(row, code)).slice(0, REBAKE_SWEEP_CAP);
      for (const row of affected) await bakeAndPersistCardRender(row.id, ownerId);
    } catch (error) {
      console.error("[custom-symbols] rebake sweep failed", error);
    }
  });
}
