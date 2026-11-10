import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { checkToolAccess } from "@/lib/tools/queries";
import { COLLECTION_TOOL_SLUG } from "@/lib/tools/collection/limits";
import { listOwnedCommanders, listScoringCards } from "@/lib/tools/collection/queries";
import { rankCommanders } from "@/lib/tools/collection/commander-scores";

// ---------------------------------------------------------------------------
// GET /api/tools/collection-builder/commander-scores — how well the caller's
// own cards support each commander they own (lib/tools/collection/
// commander-scores.ts): the build view's free "Best supported" sort and the
// build bar's numbers. Free, read-only, the caller's own rows (RLS + the
// tool's gate). A route, not a server action: the build page asks for it
// on load, and an action would queue the user's "Draft a deck" behind it.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase isn't configured." }, { status: 503, headers: NO_STORE });
  }
  const access = await checkToolAccess(COLLECTION_TOOL_SLUG);
  if (!access) {
    return NextResponse.json(
      { ok: false, error: "The Collection Deck Builder isn't open to you." },
      { status: 404, headers: NO_STORE },
    );
  }
  try {
    const [commanders, cards] = await Promise.all([listOwnedCommanders(), listScoringCards()]);
    const scores = rankCommanders(
      commanders.filter((c) => c.commanderLegal),
      cards,
    );
    return NextResponse.json({ ok: true, scores }, { headers: NO_STORE });
  } catch (error) {
    console.error("[collection] commander scores failed:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { ok: false, error: "Your commanders couldn't be ranked right now." },
      { status: 503, headers: NO_STORE },
    );
  }
}
