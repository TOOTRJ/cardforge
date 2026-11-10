import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { customSymbolCodesIn } from "@/lib/symbols/symbol-token";
import { unknownSymbolsMessage } from "@/lib/symbols/symbols";

// ---------------------------------------------------------------------------
// The card actions' check of the owner's own symbols (PR 3). `{*CODE}` on a
// card always means the CARD OWNER's symbol with that code; a code the owner
// has no symbol for draws a blank disc for every viewer (layout v76). Both
// card actions refuse a save that ADDS such a code to a field the card draws
// pips from — the creator's field error (lib/creator/form-schema.ts), held
// on the server for every save path (the AI jobs, the deck remix, imports).
//
// - A removed symbol is still the owner's (it keeps drawing): never refused.
// - An edit is asked only about codes its stored card didn't already name
//   (anywhere in the row): a code it was saved with — even one deleted since
//   (0193's in-use check is not a lock) — never blocks a retitle.
// - Nothing is read unless the save names a code: every other card costs
//   nothing. A failed read lets the save through (logged): the blank disc is
//   the documented fallback, a lost save is worse.
// ---------------------------------------------------------------------------

type DrawnTexts = {
  cost?: string | null;
  rules_text?: string | null;
  face_content?: unknown;
  back_face?: unknown;
};

type BackFaceTexts = { cost?: unknown; rules_text?: unknown; face_content?: unknown };

/** The fields a save writes that draw pips, with the creator's field key
 *  each refusal goes to (the rows answer for the rules text: the form shows
 *  them in its place). Only keys the payload holds. */
export function drawnSymbolFields(saved: DrawnTexts): Array<{ field: string; text: string }> {
  const out: Array<{ field: string; text: string }> = [];
  const push = (field: string, value: unknown) => {
    if (typeof value === "string") out.push({ field, text: value });
    else if (value !== null && value !== undefined) out.push({ field, text: JSON.stringify(value) });
  };
  push("cost", saved.cost);
  push("rules_text", saved.rules_text);
  push("rules_text", saved.face_content);
  const back = saved.back_face;
  if (back && typeof back === "object") {
    const face = back as BackFaceTexts;
    push("back_face.cost", face.cost);
    push("back_face.rules_text", face.rules_text);
    push("back_face.rules_text", face.face_content);
  }
  return out;
}

/** The first field of the save that adds a code its owner has no symbol for,
 *  and what it says — null when there is none (or the owner's symbols could
 *  not be read). `stored` = an edit's row as stored (null for a new card). */
export async function unknownSymbolFieldError(
  supabase: Pick<SupabaseClient, "from">,
  ownerId: string,
  saved: DrawnTexts,
  stored: Record<string, unknown> | null,
): Promise<{ field: string; message: string } | null> {
  const kept = new Set(stored ? customSymbolCodesIn(JSON.stringify(stored)) : []);
  const fields = drawnSymbolFields(saved)
    .map(({ field, text }) => ({ field, codes: customSymbolCodesIn(text).filter((code) => !kept.has(code)) }))
    .filter(({ codes }) => codes.length > 0);
  if (fields.length === 0) return null;

  const { data, error } = await supabase.from("custom_symbols").select("code").eq("owner_id", ownerId);
  if (error || !data) {
    console.error("[custom-symbols] the card check could not read the owner's symbols", error?.message);
    return null;
  }
  const own = new Set((data as Array<{ code: string }>).map((row) => row.code.toUpperCase()));
  for (const { field, codes } of fields) {
    const unknown = codes.filter((code) => !own.has(code));
    if (unknown.length > 0) return { field, message: unknownSymbolsMessage(unknown) };
  }
  return null;
}
