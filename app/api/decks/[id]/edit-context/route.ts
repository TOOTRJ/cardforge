import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isUuid } from "@/lib/ids";
import {
  deckEditShared,
  deckEditTarget,
  entryIdForCard,
  ownDeckForInlineEditor,
} from "@/lib/decks/inline-editor-context";
import { parseDeckEditParam, type DeckEditContextResponse } from "@/lib/decks/inline-editor-shared";

// ---------------------------------------------------------------------------
// GET /api/decks/<deck id>/edit-context?edit=<entry id | new>[&card=<id>]
// [&shared=1] — what the deck's edit drawer opens (TODO DK5.18): the
// creator's props for that entry (lib/decks/inline-editor-context.ts),
// plus, with `shared=1`, the page-wide part (game system, verified frames,
// pips, entitlements, decks…) the drawer keeps for the rest of the visit.
// `card=<id>` (with `edit=new`): a card just made into this deck — the
// drawer stays on it, as the entry that holds it.
//
// The deck's OWNER only, and only while the admin switch allows them (a 404
// otherwise: the page never offers it). A route, not a server action: the
// drawer can cancel a stale open, and it never queues behind the deck
// editor's writes (as /api/decks/add-search). Never cached.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function refuse(status: number, error: string) {
  return NextResponse.json({ ok: false, error } satisfies DeckEditContextResponse, { status, headers: NO_STORE });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return refuse(503, "Supabase is not configured.");
  const { id } = await params;
  if (!isUuid(id)) return refuse(404, "Not found.");
  const search = request.nextUrl.searchParams;
  let target = parseDeckEditParam(search.get("edit"));
  if (!target) return refuse(400, "Nothing to edit.");

  const owned = await ownDeckForInlineEditor(id);
  if ("status" in owned) return refuse(owned.status, owned.error);

  // A card just made from "＋ Create new card": its entry in this deck.
  const madeCard = search.get("card");
  if (madeCard && isUuid(madeCard)) {
    const entryId = await entryIdForCard(owned.deck.id, madeCard);
    if (entryId) target = entryId;
  }

  const [resolved, shared] = await Promise.all([
    deckEditTarget(owned.deck, owned.userId, target),
    search.get("shared") === "1" ? deckEditShared(owned.userId) : Promise.resolve(undefined),
  ]);
  if ("status" in resolved) return refuse(resolved.status, resolved.error);
  if (shared === null) return refuse(503, "The card creator isn't set up on this server.");
  const body: DeckEditContextResponse = { ok: true, target: resolved, ...(shared ? { shared } : {}) };
  return NextResponse.json(body, { headers: NO_STORE });
}
