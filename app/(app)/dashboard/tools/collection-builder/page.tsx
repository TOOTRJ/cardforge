import type { Metadata } from "next";
import { ToolShell } from "@/components/tools/tool-shell";
import { CollectionNav } from "@/components/tools/collection/collection-nav";
import { CollectionMeter } from "@/components/tools/collection/collection-meter";
import { CollectionBrowser } from "@/components/tools/collection/collection-browser";
import { CollectionAdd } from "@/components/tools/collection/collection-add";
import { CollectionBuild } from "@/components/tools/collection/collection-build";
import { BuildableDecks } from "@/components/tools/collection/buildable-decks";
import { openTool } from "@/lib/tools/queries";
import { getFreshCreditBalance } from "@/lib/ai/rate-limit";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import {
  COLLECTION_COLOURS,
  COLLECTION_SORTS,
  COLLECTION_TYPES,
  getCollectionStats,
  listBuildableDecks,
  listCollectionPage,
  listOwnedCommanders,
  type CollectionColour,
  type CollectionSort,
  type CollectionType,
} from "@/lib/tools/collection/queries";
import { collectionViewOf } from "@/lib/tools/collection/views";

// ---------------------------------------------------------------------------
// /dashboard/tools/collection-builder — the Collection Deck Builder beta
// tool (migration 0185): the real cards a user owns, imported from the big
// collection apps or added one by one, and a Commander deck drafted from
// them (free by the rules, or with the AI for one credit), saved through
// the deck writers every import uses. Admins and testers while in beta
// (openTool: a 404 for anyone else). A collection never counts toward the
// saved-card limit — a slot is something you designed.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Collection Deck Builder",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CollectionBuilderPage({ searchParams }: { searchParams: SearchParams }) {
  const entry = await openTool("collection-builder");
  const params = await searchParams;
  const view = collectionViewOf(one(params.view));
  const stats = await getCollectionStats();

  let body: React.ReactNode;
  if (view === "add") {
    body = <CollectionAdd stats={stats} />;
  } else if (view === "build") {
    const [commanders, credits] = await Promise.all([listOwnedCommanders(), getFreshCreditBalance()]);
    body = (
      <CollectionBuild
        commanders={commanders}
        initialCommanderId={one(params.commander) ?? null}
        credits={credits}
        aiAvailable={isDesignAiConfigured()}
        collectionSize={stats.cards}
      />
    );
  } else if (view === "decks") {
    body = <BuildableDecks decks={stats.cards > 0 ? await listBuildableDecks() : []} collectionSize={stats.cards} />;
  } else {
    const colours = (one(params.colours) ?? "")
      .split(",")
      .filter((c): c is CollectionColour => (COLLECTION_COLOURS as readonly string[]).includes(c));
    const type = one(params.type);
    const sort = one(params.sort);
    const query = {
      q: one(params.q) ?? "",
      colours,
      type: (COLLECTION_TYPES as readonly string[]).includes(type ?? "") ? (type as CollectionType) : null,
      sort: (COLLECTION_SORTS as readonly string[]).includes(sort ?? "") ? (sort as CollectionSort) : "name",
      commandersOnly: one(params.commanders) === "1",
      page: Math.max(1, Number.parseInt(one(params.page) ?? "1", 10) || 1),
    };
    const page = await listCollectionPage(query);
    body = <CollectionBrowser page={page} query={query} collectionSize={stats.cards} />;
  }

  return (
    <ToolShell entry={entry}>
      <div className="flex min-w-0 flex-col gap-6">
        <CollectionMeter stats={stats} />
        <CollectionNav current={view} />
        <div className="min-w-0">{body}</div>
      </div>
    </ToolShell>
  );
}
