import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { tagHubHref, type ArticleMeta } from "@/lib/content/articles";
import { formatCalendarDate } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// ArticleCard — one guide in a list (the /articles index, every tag hub and
// every /learn category share this). Tag badges link to their cluster hubs —
// or straight to the /learn category a retired hub 308s to (tagHubHref) —
// so they sit OUTSIDE the article link rather than nesting an <a> inside an
// <a> (invalid HTML); the title and the "Read the guide" affordance are the
// links into the article. A badge that would link to the page the card is
// drawn on (the "card design" badge on /learn/design, "oracle text" on its
// own hub) is plain text: pass that page as `currentPath`.
// ---------------------------------------------------------------------------

export function ArticleCard({
  article,
  currentPath,
}: {
  article: ArticleMeta;
  /** The listing page's own path — its badge is not a link. */
  currentPath?: string;
}) {
  return (
    <SurfaceCard className="p-0 transition-colors hover:border-border-strong">
      <div className="flex flex-col gap-3 p-6">
        <Link
          href={`/articles/${article.slug}`}
          className="group flex flex-col gap-3 rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
            <time dateTime={article.date}>{formatCalendarDate(article.date)}</time>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden />
              {article.readingMinutes} min read
            </span>
          </div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground group-hover:text-primary-bright sm:text-2xl">
            {article.title}
          </h2>
          <p className="max-w-2xl text-sm leading-7 text-muted">
            {article.description}
          </p>
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap gap-1.5">
            {article.tags.map((tag) => {
              const href = tagHubHref(tag);
              if (href === currentPath) {
                return (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                );
              }
              return (
                <Link
                  key={tag}
                  href={href}
                  className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                >
                  <Badge
                    variant="outline"
                    className="transition-colors hover:border-primary-bright/60 hover:text-foreground"
                  >
                    {tag}
                  </Badge>
                </Link>
              );
            })}
          </div>
          <Link
            href={`/articles/${article.slug}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-bright"
          >
            Read the guide
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </SurfaceCard>
  );
}

