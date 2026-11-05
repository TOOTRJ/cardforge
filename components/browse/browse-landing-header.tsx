import { BrowseSearchBox } from "@/components/browse/browse-search-box";

// ---------------------------------------------------------------------------
// The top of a static browse landing (/gallery, /decks): ONE header row
// (owner 2026-11-03, DK8.7; /decks wears it too since DK8.9) — the title with
// its one line under it, and the search beside it from md. No kicker line, no
// action button (the site header carries Create / New deck). A search is a
// navigation to the dynamic browse sibling (BrowseSearchBox), so the landing
// itself never reads searchParams.
// ---------------------------------------------------------------------------

export function BrowseLandingHeader({
  title,
  tagline,
  browsePath,
  placeholder,
  label,
  browseLabel,
}: {
  title: string;
  tagline: string;
  /** The dynamic sibling every search lands on. */
  browsePath: string;
  placeholder: string;
  /** Accessible name of the search field. */
  label: string;
  /** Label of the "see everything" button beside the field. */
  browseLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-gold/20 pb-4 md:flex-row md:items-center md:gap-8">
      <div className="flex min-w-0 flex-col gap-0.5 md:shrink-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        <p className="text-sm text-muted">{tagline}</p>
      </div>
      <div className="min-w-0 md:ml-auto md:w-full md:max-w-2xl">
        <BrowseSearchBox
          browsePath={browsePath}
          placeholder={placeholder}
          label={label}
          browseLabel={browseLabel}
          compact
        />
      </div>
    </div>
  );
}
