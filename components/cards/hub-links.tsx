import Link from "next/link";
import { CompactChipGroup } from "@/components/browse/compact-chip-group";
import { cn } from "@/lib/utils";
import { isIndexableTagHub, listTagHubs, listTypeHubs, TYPE_HUB_COPY } from "@/lib/cards/hubs";
import { CARD_TYPE_LABELS } from "@/types/card";

// Internal links to the browse hubs — at the TOP of the gallery landing
// (the "browse by" entry point), under the browse grid and on every hub, so
// crawlers (and people) can reach each hub from every other one. Server
// component; the counts are ISR-cached with the page.
//
// "top" is the landing's COMPACT bar (owner 2026-11-03: more cards above the
// fold): card types and tags side by side from lg, smaller chips, each group
// ONE line that scrolls sideways in its own box below lg (a fade on its end
// says there is more) and wraps from lg, where each group has half the page.
// "bottom" keeps the full labelled blocks.
export async function HubLinks({
  currentType,
  currentTag,
  placement = "bottom",
}: {
  currentType?: string;
  currentTag?: string;
  /** "top" = the landing's compact bar; "bottom" = the full blocks under a
   *  divider. */
  placement?: "top" | "bottom";
}) {
  const [types, tags] = await Promise.all([listTypeHubs(), listTagHubs()]);
  const typeLinks = types.filter((hub) => hub.count > 0 && hub.type !== currentType);
  const tagLinks = tags.filter(isIndexableTagHub).filter((hub) => hub.slug !== currentTag).slice(0, 12);
  if (typeLinks.length === 0 && tagLinks.length === 0) return null;

  const typeChips = typeLinks.map((hub) => ({
    key: hub.type,
    href: `/gallery/type/${hub.type}`,
    label: CARD_TYPE_LABELS[hub.type],
    count: hub.count,
    title: TYPE_HUB_COPY[hub.type].title,
  }));
  const tagChips = tagLinks.map((hub) => ({
    key: hub.slug,
    href: `/gallery/tag/${hub.slug}`,
    label: `#${hub.tag}`,
    count: hub.count,
    title: undefined,
  }));

  if (placement === "top") {
    return (
      <nav
        aria-label="Browse the gallery by type and tag"
        className={cn(
          "mt-3 grid grid-cols-1 gap-2 lg:gap-6",
          typeChips.length > 0 && tagChips.length > 0 && "lg:grid-cols-2",
        )}
      >
        {typeChips.length > 0 ? <CompactChipGroup label="Card types" chips={typeChips} /> : null}
        {tagChips.length > 0 ? <CompactChipGroup label="Popular tags" chips={tagChips} /> : null}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Browse the gallery by type and tag"
      className="mt-12 flex flex-col gap-5 border-t border-border/40 pt-8"
    >
      {typeChips.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted">Browse by card type</span>
          <div className="flex flex-wrap gap-2">
            {typeChips.map((chip) => (
              <Link key={chip.key} href={chip.href} className={HUB_CHIP_CLASS} title={chip.title}>
                {chip.label}
                <span className="text-subtle">{chip.count}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      {tagChips.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted">Popular tags</span>
          <div className="flex flex-wrap gap-2">
            {tagChips.map((chip) => (
              <Link key={chip.key} href={chip.href} className={HUB_CHIP_CLASS}>
                {chip.label}
                <span className="text-subtle">{chip.count}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </nav>
  );
}

const HUB_CHIP_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-elevated/50 px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-gold/40 hover:text-foreground";
