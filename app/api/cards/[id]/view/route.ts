import { isUuid } from "@/lib/ids";
import { getCurrentUser } from "@/lib/supabase/server";
import { recordCardView } from "@/lib/cards/views";

// ---------------------------------------------------------------------------
// POST /api/cards/[id]/view — the card page's one view ping (TODO CP4,
// migration 0168; `CardViewBeacon`). Counted once per viewer, card and UTC
// day by lib/cards/views.ts: never a crawler, a prefetch, an empty user
// agent or the card's owner. Always 204, whatever happened: the page never
// waits on it and a caller learns nothing about the card from it.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (isUuid(id)) {
    const user = await getCurrentUser();
    await recordCardView({ cardId: id, viewerId: user?.id ?? null, headers: request.headers });
  }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
