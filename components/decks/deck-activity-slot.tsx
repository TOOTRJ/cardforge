"use client";

import dynamic from "next/dynamic";

// ---------------------------------------------------------------------------
// Where the deck page puts the OWNER's activity panel (TODO DK7.4). The page
// renders this slot only for the deck's owner, so a visitor's page never
// references it; the panel itself is a separate chunk loaded after the page
// is interactive (no server render: it reads its numbers through a server
// action), with a placeholder of its height in the meantime.
// ---------------------------------------------------------------------------

const DeckActivityPanel = dynamic(() => import("./deck-activity-panel").then((m) => m.DeckActivityPanel), {
  ssr: false,
  loading: () => <div aria-hidden className="mt-14 h-96 max-w-7xl rounded-card border border-border/40 bg-surface/40" />,
});

export function DeckActivitySlot(props: { deckId: string; canView: boolean; isPrivate: boolean }) {
  return <DeckActivityPanel {...props} />;
}
