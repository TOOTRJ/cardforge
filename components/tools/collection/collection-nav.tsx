import Link from "next/link";
import { Hammer, Layers, LibraryBig, PackagePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COLLECTION_VIEW_LABELS,
  COLLECTION_VIEWS,
  collectionViewHref,
  type CollectionView,
} from "@/lib/tools/collection/views";

const ICONS: Record<CollectionView, typeof Layers> = {
  collection: LibraryBig,
  add: PackagePlus,
  build: Hammer,
  decks: Layers,
};

/** The tool's four views as links (each its own address: back and a
 *  bookmark work), the current one marked for assistive tech. Scrolls
 *  inside itself on a narrow phone — never the page. */
export function CollectionNav({ current }: { current: CollectionView }) {
  return (
    <nav aria-label="Collection Deck Builder" className="-mx-1 overflow-x-auto px-1">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {COLLECTION_VIEWS.map((view) => {
          const Icon = ICONS[view];
          const active = view === current;
          return (
            <li key={view}>
              <Link
                href={collectionViewHref(view)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-11 items-center gap-2 rounded-t-md border-b-2 px-3 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
                  active
                    ? "border-primary-bright text-foreground"
                    : "border-transparent text-muted hover:border-border-strong hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {COLLECTION_VIEW_LABELS[view]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
