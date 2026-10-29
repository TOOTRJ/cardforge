"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddToDeckDialog } from "@/components/decks/add-to-deck-dialog";

// ---------------------------------------------------------------------------
// "Add to deck" on ANOTHER creator's PUBLIC card page and modal (TODO DK9.4,
// owner decision D3: a deck may hold another creator's public card by
// reference).
//
//   signed in    "Add to deck" — the shared picker (AddToDeckDialog), the
//                decks read only when it opens
//   signed out   "Sign in to add to a deck"
//
// A card that isn't public can't join a deck: the page's own Remix button
// reads "Remix into a deck" there instead (one button — the remix flow's
// "Add to a deck" box puts the new card in a deck on save). The card's owner
// gets neither (they have Edit card, whose box adds it at once).
// ---------------------------------------------------------------------------

export function AddToDeckButton({
  cardId,
  cardTitle,
  cardPath,
  signedIn,
}: {
  cardId: string;
  cardTitle: string;
  /** The card's page — where "Sign in" comes back to. */
  cardPath: string;
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  if (!signedIn) {
    return (
      <Button asChild variant="secondary">
        <Link href={`/login?redirectTo=${encodeURIComponent(cardPath)}`}>
          <Layers className="h-4 w-4" aria-hidden />
          Sign in to add to a deck
        </Link>
      </Button>
    );
  }
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Layers className="h-4 w-4" aria-hidden />
        Add to deck
      </Button>
      {/* Mounted while open: each opening reads the decks afresh. */}
      {open ? (
        <AddToDeckDialog
          open
          onOpenChange={setOpen}
          cards={[{ id: cardId, title: cardTitle }]}
          surface="gallery"
          signInPath={cardPath}
          // The page's "In decks" list may have changed.
          onChanged={() => router.refresh()}
        />
      ) : null}
    </>
  );
}
