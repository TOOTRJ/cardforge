"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/ids";
import { checkToolAccess } from "@/lib/tools/queries";
import { recordToolEventLater } from "@/lib/tools/events";
import type { ToolAccessPath } from "@/lib/tools/access";
import { tableSheetTextSchema, winConditionLines, type TableSheetTextInput } from "@/lib/validation/table-sheet";
import { RULE0_TOOL_SLUG, type TableSheetRow } from "./model";
import { tableSheetFromRow } from "./queries";

// ---------------------------------------------------------------------------
// The Rule 0 table sheet's writes (migration 0190) — the deck OWNER's, while
// the tool is open to them: the access check here, and the table's RLS
// (has_tool_access + the deck is theirs) behind it. Free; the AI draft is
// its own route (/api/tools/rule0-sheet/draft).
//
// Recorded (tool_events, after the response): `save`, `share_on` /
// `share_off`, and a refusal as `save_failed` / `share_failed` with a
// `reason` — wherever the viewer is known by then (a field error is found
// before the access check, so it is not).
// ---------------------------------------------------------------------------

export type TableSheetActionResult =
  | { ok: true; sheet: TableSheetRow }
  | { ok: false; error: string; fieldErrors?: Partial<Record<keyof TableSheetTextInput, string>> };

const COLUMNS = "deck_id, game_plan, win_conditions, table_notes, shared, ai_drafted_at, updated_at";

type OwnedDeck = { id: string; slug: string; visibility: string };

type Viewer = { userId: string; via: ToolAccessPath | null };

/** The caller's own deck, or an error in words — with the viewer the tool
 *  let in, when the refusal came after that (for its tool event only). */
async function ownDeck(deckId: string): Promise<({ deck: OwnedDeck } & Viewer) | { error: string; viewer?: Viewer }> {
  if (!isUuid(deckId)) return { error: "That deck doesn't exist." };
  const access = await checkToolAccess(RULE0_TOOL_SLUG);
  if (!access) return { error: "The Rule 0 table sheet isn't open to you." };
  const supabase = await createClient();
  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, visibility, owner_id")
    .eq("id", deckId)
    .eq("owner_id", access.userId)
    .maybeSingle();
  if (!deck) {
    return { error: "Only the deck's owner can change its table sheet.", viewer: { userId: access.userId, via: access.via } };
  }
  return { deck: { id: deck.id, slug: deck.slug, visibility: deck.visibility }, userId: access.userId, via: access.via };
}

/** A refused write, for the tool's analytics: after the response. */
function recordRefusal(
  viewer: Viewer,
  event: "save_failed" | "share_failed",
  props: Record<string, string | boolean>,
): void {
  recordToolEventLater({ slug: RULE0_TOOL_SLUG, userId: viewer.userId, event, access: viewer.via, props });
}

/** Save the owner's game plan, win conditions and table notes. */
export async function saveTableSheetAction(deckId: string, input: TableSheetTextInput): Promise<TableSheetActionResult> {
  const parsed = tableSheetTextSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<keyof TableSheetTextInput, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof TableSheetTextInput | undefined;
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }
  const owned = await ownDeck(deckId);
  if ("error" in owned) {
    if (owned.viewer) recordRefusal(owned.viewer, "save_failed", { reason: "not_owner" });
    return { ok: false, error: owned.error };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deck_table_sheets")
    .upsert(
      {
        deck_id: owned.deck.id,
        owner_id: owned.userId,
        game_plan: parsed.data.gamePlan,
        win_conditions: parsed.data.winConditions,
        table_notes: parsed.data.tableNotes,
      },
      { onConflict: "deck_id" },
    )
    .select(COLUMNS)
    .single();
  if (error || !data) {
    console.error("[rule0] save failed:", error?.message);
    recordRefusal(owned, "save_failed", { reason: "write_failed" });
    return { ok: false, error: "The sheet didn't save. Try again in a moment." };
  }
  recordToolEventLater({
    slug: RULE0_TOOL_SLUG,
    userId: owned.userId,
    event: "save",
    access: owned.via,
    props: {
      plan: Boolean(parsed.data.gamePlan),
      win_conditions: winConditionLines(parsed.data.winConditions).length,
      notes: Boolean(parsed.data.tableNotes),
    },
  });
  return { ok: true, sheet: tableSheetFromRow(data) };
}

/** Share the sheet with anyone who can open the deck — or stop. A private
 *  deck's sheet can't be shared (nobody else can open the deck). */
export async function setTableSheetSharedAction(deckId: string, shared: boolean): Promise<TableSheetActionResult> {
  const owned = await ownDeck(deckId);
  if ("error" in owned) {
    if (owned.viewer) recordRefusal(owned.viewer, "share_failed", { reason: "not_owner", shared: shared === true });
    return { ok: false, error: owned.error };
  }
  if (shared && owned.deck.visibility === "private") {
    recordRefusal(owned, "share_failed", { reason: "private_deck", shared: true });
    return { ok: false, error: "This deck is private: make it unlisted or public first, so the people you share with can open it." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deck_table_sheets")
    .upsert({ deck_id: owned.deck.id, owner_id: owned.userId, shared: shared === true }, { onConflict: "deck_id" })
    .select(COLUMNS)
    .single();
  if (error || !data) {
    console.error("[rule0] share failed:", error?.message);
    recordRefusal(owned, "share_failed", { reason: "write_failed", shared: shared === true, visibility: owned.deck.visibility });
    return { ok: false, error: "That didn't save. Try again in a moment." };
  }
  recordToolEventLater({
    slug: RULE0_TOOL_SLUG,
    userId: owned.userId,
    event: shared ? "share_on" : "share_off",
    access: owned.via,
    props: { visibility: owned.deck.visibility },
  });
  return { ok: true, sheet: tableSheetFromRow(data) };
}
