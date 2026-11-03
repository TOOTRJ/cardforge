import { Shuffle } from "lucide-react";
import { DeckRowSection } from "@/components/decks/deck-row";
import { listSimilarDecks } from "@/lib/decks/queries";
import { listDeckTileArt } from "@/lib/decks/tile-art";
import { SIMILAR_DECKS_LIMIT } from "@/lib/decks/similar-decks";

// ---------------------------------------------------------------------------
// "Similar decks" (TODO DK5.16) — one row of DeckTiles at the foot of a
// PUBLIC deck's page: the same commander, or the same colours and shared
// cards (lib/decks/similar-decks.ts). Cookie-free reads only (the public
// client, anonymous tile art), so it never makes the page more
// viewer-dependent than it is; nothing similar → nothing drawn.
// ---------------------------------------------------------------------------

export async function SimilarDecksRow({ deckId, likeRedirect }: { deckId: string; likeRedirect?: string }) {
  const decks = await listSimilarDecks(deckId, SIMILAR_DECKS_LIMIT);
  if (decks.length === 0) return null;
  const art = await listDeckTileArt(decks, { anonymous: true });
  return (
    <div className="mt-14">
      <DeckRowSection
        id="similar-decks"
        icon={Shuffle}
        eyebrow="Keep exploring"
        heading="Similar decks"
        description="Public decks with the same commander, or the same colours and cards in common."
        decks={decks}
        art={art}
        likeRedirect={likeRedirect}
      />
    </div>
  );
}
