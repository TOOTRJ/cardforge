import type { Metadata } from "next";
import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Sets",
  description: "Organize your custom cards into sets and worlds.",
};

const placeholderSets = [
  { slug: "frostbound-prologue", title: "Frostbound Prologue", count: 24, description: "An icebound starter set exploring oaths and wardens." },
  { slug: "embergate-rebellion", title: "Embergate Rebellion", count: 18, description: "Fire and rust collide along the trade routes." },
  { slug: "tideglass-archives", title: "Tideglass Archives", count: 12, description: "Deep-sea libraries filled with quiet revelation." },
];

export default function SetsPage() {
  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Library"
        title="Custom sets"
        description="Group cards into sets, worlds, and decks. The full set creator arrives in the Sets phase — the layout below previews the structure."
        actions={
          <Button disabled>
            <Plus className="h-4 w-4" aria-hidden />
            New set
          </Button>
        }
      />

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {placeholderSets.map((set) => (
          <Link key={set.slug} href={`/set/${set.slug}`} className="group">
            <SurfaceCard className="flex h-full flex-col gap-3 p-6 transition-colors group-hover:border-border-strong">
              <div className="flex items-center justify-between">
                <Badge variant="primary">{set.count} cards</Badge>
                <Layers className="h-4 w-4 text-subtle" aria-hidden />
              </div>
              <h3 className="font-display text-lg font-semibold text-foreground">
                {set.title}
              </h3>
              <p className="line-clamp-3 text-sm leading-6 text-muted">
                {set.description}
              </p>
            </SurfaceCard>
          </Link>
        ))}
      </div>

      <div className="mt-12">
        <EmptyState
          icon={Layers}
          title="No personal sets yet"
          description="Save a card, then group cards into a set to start a custom world. Set creation ships in a later phase."
          action={
            <Button asChild variant="outline">
              <Link href="/create">Create a card</Link>
            </Button>
          }
        />
      </div>
    </DashboardShell>
  );
}
