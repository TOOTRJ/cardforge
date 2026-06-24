import { cn } from "@/lib/utils";
import type { TocItem } from "@/lib/content/articles";

// ---------------------------------------------------------------------------
// ArticleToc — "On this page" anchor nav. Server component, plain anchor
// links (no client JS). Hidden for short articles where it adds nothing.
// ---------------------------------------------------------------------------

export function ArticleToc({ items }: { items: TocItem[] }) {
  // Below three headings a TOC is just noise.
  if (items.length < 3) return null;

  return (
    <nav
      aria-label="On this page"
      className="my-8 rounded-frame border border-border bg-surface/60 p-5"
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle">
        On this page
      </p>
      <ul className="flex flex-col gap-1.5 text-sm">
        {items.map((item) => (
          <li key={item.id} className={cn(item.depth === 3 && "pl-4")}>
            <a
              href={`#${item.id}`}
              className="text-muted underline-offset-4 transition-colors hover:text-primary-bright hover:underline"
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
