import { redirect } from "next/navigation";
import { getCardById as getScryfallCardById } from "@/lib/scryfall/client";

// /go/scryfall/[id] — resolve a stored source_scryfall_id to the real card's
// Scryfall page and redirect there. We only persist the Scryfall UUID, not the
// pretty URL, so we look it up on click (cheap, and only when a user actually
// follows the link) rather than fetching on every card render.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const card = await getScryfallCardById(id).catch(() => null);
  redirect(card?.scryfall_uri ?? "https://scryfall.com");
}
