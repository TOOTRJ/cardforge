import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSetsEnabled } from "@/lib/sets/flags";
import { parseSetsParams, SetsView } from "../sets-view";

// ---------------------------------------------------------------------------
// /sets/browse — the dynamic twin of /sets.
//
// Reached via the proxy.ts rewrite whenever /sets is requested with a
// search/pagination param (the visitor's URL stays /sets?…). Reading
// searchParams makes THIS route dynamic per-request while the bare /sets
// stays static/ISR on the CDN.
//
// Direct hits are harmless: the canonical points at /sets, matching the
// posture every searched/paged sets variant always had.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Community sets",
  description:
    "Browse public card sets — full expansions, themed decks, and remix collections shared by PipGlyph forgers.",
  alternates: { canonical: "/sets" },
};

type SetsBrowsePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SetsBrowsePage({
  searchParams,
}: SetsBrowsePageProps) {
  if (!isSetsEnabled()) notFound();
  return <SetsView {...parseSetsParams(await searchParams)} />;
}
