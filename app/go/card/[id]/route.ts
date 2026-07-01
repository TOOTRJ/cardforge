import { redirect } from "next/navigation";
import { getCardCanonicalPath } from "@/lib/cards/queries";

// /go/card/[id] — resolve a card id to its canonical public URL and redirect.
// Lets list surfaces (gallery tiles, remix badges) link to an "original" card
// by id alone, without every list query joining the parent's slug + owner.
// Falls back to the gallery when the card is missing or unreadable under RLS.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const path = await getCardCanonicalPath(id);
  redirect(path ?? "/gallery");
}
