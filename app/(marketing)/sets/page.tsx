import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, Layers, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SurfaceCard } from "@/components/ui/surface-card";
import { QuickLikeButton } from "@/components/cards/quick-like-button";
import { listPublicSets } from "@/lib/sets/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Community sets",
  description:
    "Browse public card sets — full expansions, themed decks, and remix collections shared by Spellwright forgers.",
  alternates: { canonical: "/sets" },
};

const PAGE_SIZE = 24;

type SetsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function PublicSetsPage({ searchParams }: SetsPageProps) {
  const params = await searchParams;
  const pageParam = firstString(params.page);
  const pageRaw = Number.parseInt(pageParam ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const configured = isSupabaseConfigured();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Public"
        title="Community sets"
        description="Full expansions, themed decks, and remix collections from the Spellwright community. Open a set to flip through its cards or import it into your own."
        actions={
          <Button asChild>
            <Link href="/dashboard/sets/new">Build a set</Link>
          </Button>
        }
      />

      <div className="mt-10">
        {!configured ? (
          <EmptyState
            icon={Sparkles}
            title="Sets are offline"
            description="Supabase isn't configured for this deployment. The sets browse will populate once env vars land."
          />
        ) : (
          <Suspense key={page} fallback={<SetsSkeletonGrid count={PAGE_SIZE} />}>
            <PublicSetsResults page={page} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

async function PublicSetsResults({ page }: { page: number }) {
  const [sets, viewer] = await Promise.all([
    listPublicSets({
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getCurrentUser(),
  ]);
  const isAuthed = Boolean(viewer);

  if (sets.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No public sets yet"
        description="Be the first to publish a public set — they'll show up here for everyone."
        action={
          <Button asChild>
            <Link href="/dashboard/sets/new">Build a set</Link>
          </Button>
        }
      />
    );
  }

  const hasMore = sets.length === PAGE_SIZE;
  const hasPrev = page > 1;

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {sets.map((set) => (
          <PublicSetTile key={set.id} set={set} isAuthed={isAuthed} />
        ))}
      </div>
      {hasPrev || hasMore ? (
        <div className="mt-10 flex items-center justify-between gap-3 border-t border-border/40 pt-6">
          <span className="text-xs text-subtle">Page {page}</span>
          <div className="flex items-center gap-2">
            {hasPrev ? (
              <Button asChild variant="outline" size="sm">
                <Link
                  href={page - 1 > 1 ? `/sets?page=${page - 1}` : "/sets"}
                  scroll
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Previous
                </Link>
              </Button>
            ) : null}
            {hasMore ? (
              <Button asChild size="sm">
                <Link href={`/sets?page=${page + 1}`} scroll>
                  Next
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function PublicSetTile({
  set,
  isAuthed,
}: {
  set: Awaited<ReturnType<typeof listPublicSets>>[number];
  isAuthed: boolean;
}) {
  const ownerLabel =
    set.owner?.display_name?.trim() || set.owner?.username || "Anonymous forger";

  // Avoid nesting <a> inside <a> (invalid HTML): the cover + title/description
  // are wrapped in one Link, then the owner chip is a sibling Link below.
  return (
    <SurfaceCard className="flex h-full flex-col gap-0 overflow-hidden p-0 transition-colors hover:border-border-strong">
      <Link
        href={`/set/${set.slug}`}
        className="group flex flex-1 flex-col rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Open ${set.title}`}
      >
        <div className="relative aspect-video w-full overflow-hidden bg-elevated">
          {set.cover_url ? (
            <Image
              src={set.cover_url}
              alt=""
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition-transform group-hover:scale-[1.03]"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-elevated via-surface to-background">
              <Layers className="h-10 w-10 text-subtle" aria-hidden />
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3 p-5 pb-3">
          <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
            {set.title}
          </h3>
          {set.description ? (
            <p className="line-clamp-2 text-sm leading-6 text-muted">
              {set.description}
            </p>
          ) : null}
        </div>
      </Link>
      <div className="flex items-center justify-between gap-2 border-t border-border/40 px-5 py-3 text-xs">
        {set.owner?.username ? (
          <Link
            href={`/profile/${set.owner.username}`}
            className="truncate font-mono text-muted transition-colors hover:text-foreground"
          >
            @{set.owner.username}
          </Link>
        ) : (
          <span className="truncate text-muted">{ownerLabel}</span>
        )}
        <div className="flex items-center gap-3 text-muted">
          <span>
            {set.cards_count} card{set.cards_count === 1 ? "" : "s"}
          </span>
          <QuickLikeButton
            kind="set"
            setId={set.id}
            setSlug={set.slug}
            ownerUsername={set.owner?.username ?? null}
            initialLiked={set.liked_by_viewer}
            initialCount={set.likes_count}
            requiresSignIn={!isAuthed}
            redirectAfterLogin={`/sets`}
          />
        </div>
      </div>
    </SurfaceCard>
  );
}

function SetsSkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <SurfaceCard key={i} className="flex flex-col gap-0 overflow-hidden p-0">
          <Skeleton className="aspect-video w-full rounded-none" />
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </SurfaceCard>
      ))}
    </div>
  );
}
