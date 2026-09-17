import { cn } from "@/lib/utils";
import type { TocItem } from "@/lib/content/articles";
import { ArticleTocScrollSpy } from "@/components/content/article-toc-scrollspy";

// ---------------------------------------------------------------------------
// ArticleToc — "On this page" anchor nav. Server-rendered plain anchor links
// (real <a href="#id">, so search engines can surface them as "jump to"
// links); a tiny client island only highlights the section in view.
//
// Two placements share this one list (owner request 2026-09-17):
//   • "inline"  — the card above the body, phones/tablets only.
//   • "sidebar" — sticky in the empty column to the right of the article on
//                 large screens.
// Hidden for short articles where it adds nothing.
// ---------------------------------------------------------------------------

export function ArticleToc({
  items,
  variant = "inline",
}: {
  items: TocItem[];
  variant?: "inline" | "sidebar";
}) {
  // Below three headings a TOC is just noise.
  if (items.length < 3) return null;

  const sidebar = variant === "sidebar";
  return (
    <nav
      aria-label="On this page"
      data-article-toc={variant}
      className={cn(
        sidebar
          ? "border-l border-border/60 pl-5"
          : "my-8 rounded-frame border border-border bg-surface/60 p-5",
      )}
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle">
        On this page
      </p>
      <ul className={cn("flex flex-col text-sm", sidebar ? "gap-1" : "gap-1.5")}>
        {items.map((item) => (
          <li key={item.id} className={cn(item.depth === 3 && "pl-4")}>
            <a
              href={`#${item.id}`}
              data-toc-link={item.id}
              className={cn(
                "block text-muted underline-offset-4 transition-colors hover:text-primary-bright hover:underline",
                sidebar &&
                  "-ml-[calc(1.25rem+1px)] border-l border-transparent py-0.5 pl-5 leading-5 data-[active=true]:border-primary-bright data-[active=true]:text-foreground",
              )}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
      {sidebar ? <ArticleTocScrollSpy ids={items.map((i) => i.id)} /> : null}
    </nav>
  );
}
