import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CATEGORY_ICONS } from "@/components/content/category-icons";
import {
  categoryPath,
  type ArticleCategorySlug,
} from "@/lib/content/article-categories";
import type { CategoryShelf } from "@/lib/content/articles";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// CategoryLinks — a compact row of the /learn shelves with their guide
// counts: "Browse by topic" on /articles and "Other topics" under a category
// page (pass `current` to leave that one out). Plain links, one tab stop
// each; the counts are part of each link's name ("Design guides, 16 guides").
// ---------------------------------------------------------------------------

export function CategoryLinks({
  shelves,
  current,
  label,
  className,
}: {
  shelves: CategoryShelf[];
  current?: ArticleCategorySlug;
  /** The row's heading, also its navigation landmark's name. */
  label: string;
  className?: string;
}) {
  const shown = shelves.filter((shelf) => shelf.category.slug !== current);
  if (shown.length === 0) return null;
  const headingId = `category-links-${current ?? "all"}`;
  return (
    <nav aria-labelledby={headingId} className={cn("flex flex-col gap-3", className)}>
      <h2
        id={headingId}
        className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong"
      >
        {label}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map(({ category, articles }) => {
          const Icon = CATEGORY_ICONS[category.slug];
          return (
            <li key={category.slug}>
              <Link
                href={categoryPath(category.slug)}
                className="group flex h-full items-center gap-3 rounded-card border border-border/70 bg-surface/60 px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
              >
                <Icon className="h-4 w-4 shrink-0 text-gold" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-foreground group-hover:text-primary-bright">
                    {category.label}
                  </span>
                  <span className="text-xs text-subtle">
                    <span className="sr-only">, </span>
                    {articles.length} guide{articles.length === 1 ? "" : "s"}
                  </span>
                </span>
                <ArrowRight
                  className="h-3.5 w-3.5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-primary-bright"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
