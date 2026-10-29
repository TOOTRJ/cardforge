import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HelpSectionIcon } from "@/components/content/help-icons";
import { HELP_SECTIONS, helpSectionEntries, helpSectionPath } from "@/lib/content/help";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// HelpSectionLinks — a compact row of the help sections with their answer
// counts, under a section page ("Other help topics"; pass `current` to leave
// that one out). The /learn shelves' CategoryLinks pattern: plain links, one
// tab stop each, the count part of each link's name.
// ---------------------------------------------------------------------------

export function HelpSectionLinks({
  current,
  label,
  className,
}: {
  current?: string;
  /** The row's heading, also its navigation landmark's name. */
  label: string;
  className?: string;
}) {
  const shown = HELP_SECTIONS.filter((section) => section.slug !== current);
  if (shown.length === 0) return null;
  const headingId = `help-links-${current ?? "all"}`;
  return (
    <nav aria-labelledby={headingId} className={cn("flex flex-col gap-3", className)}>
      <h2
        id={headingId}
        className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong"
      >
        {label}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {shown.map((section) => {
          const count = helpSectionEntries(section).length;
          return (
            <li key={section.slug}>
              <Link
                href={helpSectionPath(section.slug)}
                className="group flex h-full items-center gap-3 rounded-card border border-border/70 bg-surface/60 px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
              >
                <HelpSectionIcon slug={section.slug} className="h-4 w-4 shrink-0 text-gold" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-foreground group-hover:text-primary-bright">
                    {section.title}
                  </span>
                  <span className="text-xs text-subtle">
                    <span className="sr-only">, </span>
                    {count} answer{count === 1 ? "" : "s"}
                    {section.howTo ? " · a how-to" : ""}
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
