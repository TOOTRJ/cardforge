import { NextResponse, type NextRequest } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { requireTier, UpgradeRequiredError } from "@/lib/billing/entitlements";
import { budgetCopies, selectionManifestRequestSchema } from "@/lib/cards/print-selection";
import type { CardsExportManifest } from "@/lib/decks/export-client";
import { exportFacesOf } from "@/lib/cards/faces";

// ---------------------------------------------------------------------------
// POST /api/cards/export — the manifest of a "Print / download selected"
// export (TODO 6.15): My Cards' bulk action, on your own cards or on the
// ones you liked.
//
// The deck export's manifest (app/api/decks/[id]/download?part=manifest)
// for an id list: the browser (lib/decks/export-client.ts runCardsExport)
// then fetches each card's clean render from /api/cards/[id]/png and lays
// the PDF / ZIP out itself, so a big selection never sits on one function.
//
// Body: { cards: [{ id, copies }] } — 1–150 cards, 1–99 copies each.
// Answers the cards this viewer may print, in the order asked, with their
// copies budgeted to 150 physical cards (lib/cards/print-selection.ts), the
// faces each has (a double-faced card's back is fetched too, TODO 5.3), and
// the ids it skipped (gone, or private to someone else — RLS hides them).
//
// Entitlement: the deck export's — signed in (401), Pro (403
// UPGRADE_REQUIRED; allowBatchExport). The per-card renders are gated by the
// png route as always (a Pro viewer's are clean).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to print your cards." }, { status: 401 });
  }

  try {
    await requireTier("pro");
  } catch (error) {
    if (error instanceof UpgradeRequiredError) {
      return NextResponse.json(
        { error: "Printing a selection is a Pro feature.", code: "UPGRADE_REQUIRED" },
        { status: 403 },
      );
    }
    throw error;
  }

  const body = await request.json().catch(() => null);
  const parsed = selectionManifestRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid selection." },
      { status: 400 },
    );
  }

  const asked = budgetCopies(parsed.data.cards);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select("id, slug, title, visibility, owner_id, frame_style, back_face")
    .in(
      "id",
      asked.map((card) => card.id),
    );
  if (error) {
    return NextResponse.json({ error: "Couldn't read those cards." }, { status: 500 });
  }

  const rows = new Map((data ?? []).map((row) => [row.id, row]));
  const cards: CardsExportManifest["cards"] = [];
  const skipped: string[] = [];
  for (const { id, copies } of asked) {
    const row = rows.get(id);
    // RLS already hides another user's private card; the owner check is the
    // png route's, repeated so the manifest never lists what can't render.
    if (!row || (row.visibility === "private" && row.owner_id !== user.id)) {
      skipped.push(id);
      continue;
    }
    cards.push({ id: row.id, slug: row.slug, title: row.title, copies, faces: exportFacesOf(row) });
  }
  if (cards.length === 0) {
    return NextResponse.json({ error: "None of those cards can be printed." }, { status: 404 });
  }

  const manifest: CardsExportManifest = {
    cards,
    skipped,
    totalCopies: cards.reduce((n, card) => n + card.copies, 0),
  };
  return NextResponse.json(manifest, { headers: { "Cache-Control": "private, no-store" } });
}
