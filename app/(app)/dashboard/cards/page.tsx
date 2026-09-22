import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { FilePlus2 } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CardPreviewSkeleton } from "@/components/cards/card-preview-skeleton";
import { MyCardsBrowser } from "@/components/creator/my-cards-browser";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import {
  MY_CARDS_VIEW_COOKIE,
  parseMyCardsFilter,
  parseMyCardsSort,
  parseMyCardsView,
  type MyCardsFilter,
  type MyCardsSort,
  type MyCardsView,
} from "@/lib/cards/my-cards-view";
import {
  listLikedCardsByUser,
  listMyCards,
  listRemixParentLinks,
} from "@/lib/cards/queries";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "My cards",
  description: "Every card you've created, plus the ones you've liked.",
};

// The liked tab is a "saved for later" shelf, not a feed — well past the
// dashboard's old 24 so it doesn't silently drop older likes.
const LIKED_LIMIT = 200;

type PageProps = {
  searchParams: Promise<{ show?: string | string[]; sort?: string | string[] }>;
};

export default async function MyCardsPage({ searchParams }: PageProps) {
  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);
  // The remembered view comes from a cookie so the FIRST paint is already the
  // user's choice (localStorage would flash the default grid).
  const view = parseMyCardsView(cookieStore.get(MY_CARDS_VIEW_COOKIE)?.value);
  const filter = parseMyCardsFilter(params.show);
  const sort = parseMyCardsSort(params.sort);

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Library"
        title="My cards"
        description="Everything you've created — drafts, public cards and remixes — plus the cards you've liked."
        actions={
          <Button asChild>
            <Link href="/create">
              <FilePlus2 className="h-4 w-4" aria-hidden /> New card
            </Link>
          </Button>
        }
      />

      <Suspense fallback={<MyCardsSkeleton view={view} />}>
        <MyCardsLibrary view={view} filter={filter} sort={sort} />
      </Suspense>
    </DashboardShell>
  );
}

async function MyCardsLibrary({
  view,
  filter,
  sort,
}: {
  view: MyCardsView;
  filter: MyCardsFilter;
  sort: MyCardsSort;
}) {
  const viewer = await getCurrentUser();
  const [profileOverrides, myCards, likedCards] = await Promise.all([
    getFrameProfileOverrides(),
    listMyCards(),
    viewer
      ? listLikedCardsByUser(viewer.id, { limit: LIKED_LIMIT })
      : Promise.resolve([]),
  ]);
  const remixParents = await listRemixParentLinks(myCards);

  return (
    <MyCardsBrowser
      cards={myCards}
      likedCards={likedCards}
      remixParents={remixParents}
      profileOverrides={profileOverrides}
      initialView={view}
      initialFilter={filter}
      initialSort={sort}
    />
  );
}

function MyCardsSkeleton({ view }: { view: MyCardsView }) {
  return (
    <div className="mt-8 flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
      <Skeleton className="h-10 w-full" />
      {view === "list" ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : (
        <div
          className={
            view === "compact"
              ? "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
              : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          }
        >
          {Array.from({ length: view === "compact" ? 10 : 6 }).map((_, i) => (
            <CardPreviewSkeleton key={i} />
          ))}
        </div>
      )}
    </div>
  );
}
