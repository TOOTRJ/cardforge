"use client";

import dynamic from "next/dynamic";

// ---------------------------------------------------------------------------
// The owner's editing parts of the deck page (TODO DK5 part 2) that load in
// a chunk of their own. ONLY a part that is not on screen when the page
// loads belongs here: a lazy part's controls do nothing until its chunk has
// loaded AND hydrated, so a "⋯" or an input drawn at load (the row menus,
// the add box, the phone's bar) is a static import — CI's e2e clicked a
// row's "⋯" right after a reload and the menu never opened (#681).
//
//   DeckBulkBar  the selection's actions — drawn only once the owner starts
//                selecting, long after the page is live
// ---------------------------------------------------------------------------

export const DeckBulkBar = dynamic(() => import("@/components/decks/deck-bulk-bar").then((mod) => mod.DeckBulkBar));
