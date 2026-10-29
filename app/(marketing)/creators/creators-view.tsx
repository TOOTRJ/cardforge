import Link from "next/link";
import { ArrowLeft, ArrowRight, Users } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CreatorCard } from "@/components/creators/creator-card";
import { collectionPageJsonLd, JsonLd, type CrumbItem } from "@/components/seo/json-ld";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { listPublicCreators } from "@/lib/creators/queries";
import {
  CREATOR_SORT_LABELS,
  CREATOR_SORTS,
  CREATORS_BROWSE_PATH,
  CREATORS_PATH,
  creatorListEntries,
  creatorPageCount,
  creatorsHref,
  type CreatorsViewParams,
} from "@/lib/creators/directory";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The creators directory (TODO NV11) is two routes with one grid, the
// gallery's and the decks' split (lib/routing/browse-params.ts):
//
//   - /creators (CreatorsLanding) → static/ISR: the first page, most public
//     cards first. Never reads searchParams, so it stays on the CDN; it is
//     the indexable, canonical page (CollectionPage + ItemList JSON-LD).
//   - /creators/browse (CreatorsBrowse) → dynamic: every sort and page link
//     navigates within it; noindex (follow), canonical /creators.
//
// All reads are anonymous (public client, no cookies) — the numbers are the
// same for every viewer.
// ---------------------------------------------------------------------------

const FRAME = "mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16";

export const CREATORS_TITLE = "Creators";
export const CREATORS_DESCRIPTION =
  "The makers behind PipGlyph's public custom Magic cards — browse creators by how many cards they've published, their newest work or the likes it earned, and open a profile to see every card and deck.";

/** Community has no page of its own: its first page, the gallery, stands in
 *  for it in the trail (the header's Community group, TODO NV1). */
const TRAIL: CrumbItem[] = [
  { name: "Home", path: "/" },
  { name: "Community", path: "/gallery" },
  { name: "Creators", path: CREATORS_PATH },
];

/** /creators — the static landing. */
export async function CreatorsLanding() {
  return <CreatorsDirectory sort="cards" page={1} landing />;
}

/** /creators/browse — the dynamic sort + paging surface. */
export async function CreatorsBrowse(params: CreatorsViewParams) {
  return <CreatorsDirectory {...params} landing={false} />;
}

async function CreatorsDirectory({ sort, page, landing }: CreatorsViewParams & { landing: boolean }) {
  const [result, profileOverrides] = await Promise.all([
    listPublicCreators(sort, page),
    getFrameProfileOverrides(),
  ]);
  const pages = creatorPageCount(result.total);

  return (
    <div className={FRAME}>
      {landing ? (
        <JsonLd
          data={collectionPageJsonLd({
            name: "PipGlyph creators",
            description: CREATORS_DESCRIPTION,
            path: CREATORS_PATH,
            items: creatorListEntries(result.creators),
          })}
        />
      ) : null}
      <Breadcrumbs
        items={landing ? TRAIL : [...TRAIL, { name: "Browse", path: CREATORS_BROWSE_PATH }]}
      />
      <PageHeader
        eyebrow="Community"
        title={CREATORS_TITLE}
        description="Everyone who has published a card. Open a profile to see their cards, decks and remixes."
        actions={
          <Button asChild>
            <Link href="/create">Create a card</Link>
          </Button>
        }
      />

      <SortLinks current={sort} />

      <div className="mt-6">
        {result.error ? (
          <EmptyState
            icon={Users}
            title="The directory isn't available right now"
            description="Creators couldn't be loaded. Try again in a few minutes — their cards are still in the gallery."
            action={
              <Button asChild variant="outline">
                <Link href="/gallery">Open the gallery</Link>
              </Button>
            }
          />
        ) : result.creators.length === 0 ? (
          <EmptyState
            icon={Users}
            title={page > 1 ? "No creators on this page" : "No creators yet"}
            description={
              page > 1
                ? "This page is past the end of the list."
                : "Publish a public card and you'll be the first one here."
            }
            action={
              <Button asChild>
                <Link href={page > 1 ? CREATORS_PATH : "/create"}>
                  {page > 1 ? "Back to the first page" : "Create a card"}
                </Link>
              </Button>
            }
          />
        ) : (
          <>
            <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {result.creators.map((creator) => (
                <li key={creator.id} className="flex">
                  <CreatorCard creator={creator} profileOverrides={profileOverrides} />
                </li>
              ))}
            </ul>
            <Pager sort={sort} page={page} pages={pages} total={result.total} />
          </>
        )}
      </div>
    </div>
  );
}

function SortLinks({ current }: { current: CreatorsViewParams["sort"] }) {
  return (
    <nav aria-label="Sort creators" className="mt-8">
      <ul className="flex flex-wrap gap-2">
        {CREATOR_SORTS.map((sort) => {
          const active = sort === current;
          return (
            <li key={sort}>
              <Link
                href={creatorsHref({ sort, page: 1 })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                  active
                    ? "border-primary/40 bg-primary/15 text-primary-bright"
                    : "border-border/70 text-muted hover:border-border-strong hover:text-foreground",
                )}
              >
                {CREATOR_SORT_LABELS[sort]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Pager({
  sort,
  page,
  pages,
  total,
}: CreatorsViewParams & { pages: number; total: number }) {
  const hasPrev = page > 1;
  const hasNext = page < pages;
  return (
    <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-6">
      <span className="text-xs text-subtle">
        {total.toLocaleString("en-US")} {total === 1 ? "creator" : "creators"} · page {page} of {pages}
      </span>
      {hasPrev || hasNext ? (
        <div className="flex items-center gap-2">
          {hasPrev ? (
            <Button asChild variant="outline" size="sm">
              <Link href={creatorsHref({ sort, page: page - 1 })}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Previous
              </Link>
            </Button>
          ) : null}
          {hasNext ? (
            <Button asChild size="sm">
              <Link href={creatorsHref({ sort, page: page + 1 })}>
                Next
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
