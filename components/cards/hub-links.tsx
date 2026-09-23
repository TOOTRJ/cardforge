import Link from "next/link";
import { isIndexableTagHub, listTagHubs, listTypeHubs, TYPE_HUB_COPY } from "@/lib/cards/hubs";
import { CARD_TYPE_LABELS } from "@/types/card";

// Internal links to the browse hubs — at the TOP of the gallery landing
// (the "browse by" entry point), under the browse grid and on every hub, so
// crawlers (and people) can reach each hub from every other one. Server
// component; the counts are ISR-cached with the page.
export async function HubLinks({
  currentType,
  currentTag,
  placement = "bottom",
}: {
  currentType?: string;
  currentTag?: string;
  /** "top" drops the divider so the chips sit right under a header. */
  placement?: "top" | "bottom";
}) {
  const [types, tags] = await Promise.all([listTypeHubs(), listTagHubs()]);
  const typeLinks = types.filter((hub) => hub.count > 0 && hub.type !== currentType);
  const tagLinks = tags.filter(isIndexableTagHub).filter((hub) => hub.slug !== currentTag).slice(0, 12);
  if (typeLinks.length === 0 && tagLinks.length === 0) return null;
  return (
    <nav
      aria-label="Browse the gallery by type and tag"
      className={
        placement === "top"
          ? "mt-8 flex flex-col gap-5"
          : "mt-12 flex flex-col gap-5 border-t border-border/40 pt-8"
      }
    >
      {typeLinks.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted">Browse by card type</span>
          <div className="flex flex-wrap gap-2">
            {typeLinks.map((hub) => (
              <Link
                key={hub.type}
                href={`/gallery/type/${hub.type}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-elevated/50 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-gold/40 hover:text-foreground"
                title={TYPE_HUB_COPY[hub.type].title}
              >
                {CARD_TYPE_LABELS[hub.type]}
                <span className="text-subtle">{hub.count}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      {tagLinks.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted">Popular tags</span>
          <div className="flex flex-wrap gap-2">
            {tagLinks.map((hub) => (
              <Link
                key={hub.slug}
                href={`/gallery/tag/${hub.slug}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-elevated/50 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-gold/40 hover:text-foreground"
              >
                #{hub.tag}
                <span className="text-subtle">{hub.count}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </nav>
  );
}
