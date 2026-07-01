import Link from "next/link";
import { ArrowUpRight, Repeat2 } from "lucide-react";
import { GalleryCardTile } from "@/components/cards/gallery-card-tile";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { RemixWithParent } from "@/lib/cards/queries";

// ---------------------------------------------------------------------------
// DashboardRemixesSection — the cards the user has forged by remixing another
// card. Each tile carries the remix badge (→ the original) from GalleryCardTile
// plus an explicit "Remixed from <title>" caption. Read-only; distinct from the
// bulk-selectable "my cards" sections.
// ---------------------------------------------------------------------------

type DashboardRemixesSectionProps = {
  remixes: RemixWithParent[];
};

export function DashboardRemixesSection({
  remixes,
}: DashboardRemixesSectionProps) {
  return (
    <section className="mt-12" id="remixes">
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Your remixes
          </h2>
          <p className="max-w-2xl text-sm text-muted">
            Cards you forged from another card. Each links back to the original
            it was remixed from.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/gallery">Find cards to remix</Link>
        </Button>
      </header>

      {remixes.length === 0 ? (
        <EmptyState
          icon={Repeat2}
          title="No remixes yet"
          description="Open any card in the gallery and hit Remix to spin up your own take — it'll show up here."
          action={
            <Button asChild>
              <Link href="/gallery">Browse the gallery</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {remixes.map((card) => (
            <div key={card.id} className="flex flex-col gap-1.5">
              <GalleryCardTile card={card} isAuthed />
              {card.parent ? (
                <Link
                  href={card.parent.path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 truncate text-[11px] text-subtle transition-colors hover:text-foreground"
                >
                  <Repeat2 className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">
                    Remixed from {card.parent.title}
                  </span>
                  <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden />
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] text-subtle">
                  <Repeat2 className="h-3 w-3 shrink-0" aria-hidden />
                  Original no longer available
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
