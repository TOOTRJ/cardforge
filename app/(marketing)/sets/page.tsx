import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSetsEnabled } from "@/lib/sets/flags";
import { parseSetsParams, SetsView } from "./sets-view";

export const metadata: Metadata = {
  title: "Community sets",
  description:
    "Browse public card sets — full expansions, themed decks, and remix collections shared by PipGlyph forgers.",
  alternates: { canonical: "/sets" },
};

// ISR: the bare /sets route is viewer-independent (anonymous public-client
// read) and never reads searchParams, so it's CDN-cached and re-baked at
// most every 5 minutes, matching the homepage. Like-state degrades
// gracefully — the heart re-checks the session cookie at click time.
//
// Requests WITH q/page params are rewritten by proxy.ts to /sets/browse
// (see lib/routing/browse-params.ts), which renders them per-request —
// reading searchParams here would make this route fully dynamic again.
export const revalidate = 300;

export default function PublicSetsPage() {
  if (!isSetsEnabled()) notFound();
  return <SetsView {...parseSetsParams({})} />;
}
