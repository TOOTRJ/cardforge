import type { Metadata } from "next";
import { parseDecksParams, DecksView } from "./decks-view";

export const metadata: Metadata = {
  title: "Community decks",
  description:
    "Browse public MTG decks rebuilt with custom cards — Commander, Standard, Modern and more, remixed by PipGlyph forgers.",
  alternates: { canonical: "/decks" },
};

// ISR: the bare /decks route is viewer-independent (anonymous public-client
// read) and never reads searchParams, so it's CDN-cached and re-baked at
// most every 5 minutes, matching /sets and /gallery. Like-state degrades
// gracefully — the heart re-checks the session cookie at click time.
//
// Requests WITH q/format/sort/page params are rewritten by proxy.ts to
// /decks/browse (see lib/routing/browse-params.ts), which renders them
// per-request — reading searchParams here would make this route fully
// dynamic again.
export const revalidate = 300;

export default function PublicDecksPage() {
  return <DecksView {...parseDecksParams({})} />;
}
