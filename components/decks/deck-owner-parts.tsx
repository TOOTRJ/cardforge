"use client";

import dynamic from "next/dynamic";

// ---------------------------------------------------------------------------
// The owner's editing parts of the deck page (TODO DK5 part 2), each in a
// chunk of its own: a visitor's page never renders them, so a visitor never
// downloads them. Server-rendered for the owner as before (no `ssr: false`:
// the add box is in the HTML, nothing moves when its chunk arrives).
//
//   DeckAddBox     the search-and-add combobox
//   DeckBulkBar    the selection's actions
//   DeckMobileBar  the phone's bottom bar
//   EntryMenu      the "⋯" / Move-to menus (the owner's only)
// ---------------------------------------------------------------------------

export const DeckAddBox = dynamic(() => import("@/components/decks/deck-add-box").then((mod) => mod.DeckAddBox));

export const DeckBulkBar = dynamic(() => import("@/components/decks/deck-bulk-bar").then((mod) => mod.DeckBulkBar));

export const DeckMobileBar = dynamic(() => import("@/components/decks/deck-mobile-bar").then((mod) => mod.DeckMobileBar));

export const EntryMenu = dynamic(() => import("@/components/decks/deck-entry-menu").then((mod) => mod.EntryMenu));
