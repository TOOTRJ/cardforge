import type { Metadata } from "next";
import { CreatorsBrowse } from "../creators-view";
import { parseCreatorsParams } from "@/lib/creators/directory";

// ---------------------------------------------------------------------------
// /creators/browse — the creators directory's other sorts and pages.
//
// The visible dynamic sibling of the static /creators landing. Reading
// searchParams makes THIS route dynamic per-request while the landing stays
// on the CDN. Every sort and page link navigates within this route
// (creatorsHref) — see lib/routing/browse-params.ts for why the landing
// can't host them.
// ---------------------------------------------------------------------------

type SearchParams = Record<string, string | string[] | undefined>;

export const metadata: Metadata = {
  title: "Browse creators",
  description: "Every PipGlyph creator with a public card, by most cards, newest cards or most likes.",
  // Its first page in the default order IS /creators; every other sort and
  // page is a view of the same list. Out of the index, links still followed
  // (every profile is reachable from here).
  alternates: { canonical: "/creators" },
  robots: { index: false, follow: true },
};

export default async function CreatorsBrowsePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <CreatorsBrowse {...parseCreatorsParams(await searchParams)} />;
}
