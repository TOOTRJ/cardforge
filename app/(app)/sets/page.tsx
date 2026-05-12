import type { Metadata } from "next";
import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listMySets } from "@/lib/sets/queries";

export const metadata: Metadata = {
  title: "Sets",
  description: "Organize your custom cards into sets and worlds.",
};

export default async function SetsPage() {
  const sets = await listMySets();

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Library"
        title="Custom sets"
        description="Group your cards into sets, decks, and worlds. Each set has its own visibility, cover, and analytics."
        actions={
          <Button asChild>
            <Link href="/sets/new">
              <Plus className="h-4 w-4" aria-hidden />
              New set
            </Link>
          </Button>
        }
      />

      <div className="mt-10">
        {sets.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No sets yet"
            description="Create your first set to group cards by theme, world, or playtest deck."
            action={
              <Button asChild>
                <Link href="/sets/new">Create a set</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((set) => (
              <SetTile key={set.id} set={set} />
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function SetTile({
  set,
}: {
  set: Awaited<ReturnType<typeof listMySets>>[number];
}) {
  return (
    <Link
      href={`/set/${set.slug}/edit`}
      className="group block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <SurfaceCard className="flex h-full flex-col gap-3 overflow-hidden p-0 transition-colors group-hover:border-border-strong">
        <div className="relative aspect-video w-full overflow-hidden bg-elevated">
          {set.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={set.cover_url}
              alt={`${set.title} cover`}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-elevated via-surface to-background">
              <Layers className="h-8 w-8 text-subtle" aria-hidden />
            </div>
          )}
          <div className="absolute left-3 top-3">
            <Badge variant={set.visibility === "public" ? "primary" : "outline"}>
              {visibilityLabel(set.visibility)}
            </Badge>
          </div>
        </div>

        <div className="flex flex-col gap-2 p-5">
          <h3 className="font-display text-lg font-semibold text-foreground">
            {set.title}
          </h3>
          {set.description ? (
            <p className="line-clamp-2 text-sm leading-6 text-muted">
              {set.description}
            </p>
          ) : (
            <p className="text-sm text-subtle italic">No description yet.</p>
          )}
          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>
              {set.cards_count} card{set.cards_count === 1 ? "" : "s"}
            </span>
            <span className="opacity-0 transition-opacity group-hover:opacity-100">
              Click to edit →
            </span>
          </div>
        </div>
      </SurfaceCard>
    </Link>
  );
}

function visibilityLabel(visibility: string): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "unlisted":
      return "Unlisted";
    default:
      return "Private";
  }
}
