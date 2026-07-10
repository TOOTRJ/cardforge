import type { Metadata } from "next";
import { parseDecksParams, DecksView } from "../decks-view";

// ---------------------------------------------------------------------------
// /decks/browse — the dynamic twin of /decks.
//
// Reached via the proxy.ts rewrite whenever /decks is requested with a
// search/filter/pagination param (the visitor's URL stays /decks?…). Reading
// searchParams makes THIS route dynamic per-request while the bare /decks
// stays static/ISR on the CDN.
//
// Direct hits are harmless: the canonical points at /decks, matching the
// posture every searched/paged decks variant always had.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Community decks",
  description:
    "Browse public MTG decks rebuilt with custom cards — Commander, Standard, Modern and more, remixed by PipGlyph forgers.",
  alternates: { canonical: "/decks" },
};

type DecksBrowsePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DecksBrowsePage({
  searchParams,
}: DecksBrowsePageProps) {
  return <DecksView {...parseDecksParams(await searchParams)} />;
}
