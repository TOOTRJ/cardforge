import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { breadcrumbJsonLd, JsonLd, type CrumbItem } from "@/components/seo/json-ld";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Breadcrumbs — the visible trail AND its BreadcrumbList JSON-LD, from ONE
// list, so what a reader sees and what a crawler reads can never disagree.
//
// The trail is the reader's path, not the URL (Google allows it): a guide at
// /articles/<slug> reads Home › Learn › Design guides › Title. The last item
// is the current page — text with aria-current, never a link. A long last
// item (an article title) truncates to one line; the H1 below says it whole.
// ---------------------------------------------------------------------------

export function Breadcrumbs({
  items,
  className,
}: {
  /** Home first, the current page last. */
  items: CrumbItem[];
  className?: string;
}) {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(items)} />
      <nav aria-label="Breadcrumb" className={cn("mb-8 text-sm", className)}>
        <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted">
          {items.map((item, index) => {
            const current = index === items.length - 1;
            return (
              <li key={item.path} className="flex min-w-0 max-w-full items-center gap-1.5">
                {current ? (
                  <span aria-current="page" className="block truncate text-subtle">
                    {item.name}
                  </span>
                ) : (
                  <>
                    <Link
                      href={item.path}
                      className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                    >
                      {item.name}
                    </Link>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden />
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
