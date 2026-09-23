import type { Metadata } from "next";
import { DecksLanding } from "./decks-view";

export const metadata: Metadata = {
  title: "Community decks",
  description:
    "Browse public MTG decks rebuilt with custom cards — Commander, Standard, Modern and more, remixed by PipGlyph forgers.",
  alternates: { canonical: "/decks" },
};

// ISR: the /decks landing is viewer-independent (anonymous public-client
// read) and never reads searchParams, so it's CDN-cached and re-baked at
// most every 5 minutes, matching /gallery. Like-state degrades gracefully —
// the heart re-checks the session cookie at click time.
//
// Searching, the format filter and paging live on /decks/browse (the
// visible dynamic sibling); a landing request that still carries one of
// those params is 308'd there by proxy.ts (lib/routing/browse-params.ts).
// Reading searchParams here would make this route fully dynamic — don't.
export const revalidate = 300;

export default function PublicDecksPage() {
  return <DecksLanding />;
}
