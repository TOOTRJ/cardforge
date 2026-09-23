import type { Metadata } from "next";
import { DecksBrowse, parseDecksParams } from "../decks-view";
import { DECKS_FILTER_PARAMS, hasAnyParamKey } from "@/lib/routing/browse-params";

// ---------------------------------------------------------------------------
// /decks/browse — search, the format filter and paging for every public
// deck.
//
// The visible dynamic sibling of the static /decks landing. Reading
// searchParams makes THIS route dynamic per-request while the landing stays
// on the CDN. Every control on the page navigates within this route
// (useSearchParamPatch / pageHref) — see lib/routing/browse-params.ts for
// why the landing can't host them.
// ---------------------------------------------------------------------------

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const params = await searchParams;
  // The bare page is the one self-canonical, indexable variant; searched/
  // filtered/paged URLs canonicalize back to it and stay out of the index
  // while crawlers still follow the deck links they contain.
  const filtered = hasAnyParamKey(params, DECKS_FILTER_PARAMS);
  return {
    title: "Browse decks",
    description:
      "Search every public MTG deck rebuilt with custom cards on PipGlyph and filter by format — Commander, Standard, Modern and more.",
    alternates: { canonical: "/decks/browse" },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export default async function DecksBrowsePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <DecksBrowse {...parseDecksParams(await searchParams)} />;
}
