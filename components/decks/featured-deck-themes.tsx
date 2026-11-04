import { Sparkles } from "lucide-react";
import {
  DeckGrid,
  DECK_ROW_SIZES,
  DeckTile,
  DeckTileSkeleton,
  deckRowTileClass,
} from "@/components/decks/deck-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { DECK_ROW_MAX, listFeaturedDeckThemes, type FeaturedDeckTheme } from "@/lib/decks/queries";
import { listDeckTileArt, type DeckTileArt } from "@/lib/decks/tile-art";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// "Featured themed decks" (owner request 2026-11-03) — the top of /decks and
// a section of the home page. An admin makes a THEME (a title and a line of
// blurb) in /admin/featured and pastes deck URLs into it; the visitor sees
// the live themes in the admin's order, each as one row of DeckTiles (the
// ONE deck tile) — tiles past the row's last column hidden, never wrapped.
//
// It must STAND OUT, and apart from the gold "Trending now" block under it:
// a violet (primary) glow panel with the "Staff picks" pill. Every deck
// shown is public, non-empty and a real creator's — the rule lives in
// migration 0167's list_featured_deck_themes, read by
// listFeaturedDeckThemes; nothing here filters again. Cookie-free reads, so
// /decks and the home page stay ISR. No live theme with a visible deck: no
// section at all.
// ---------------------------------------------------------------------------

export const FEATURED_DECK_THEMES_SURFACE_CLASS =
  "relative overflow-hidden rounded-2xl border border-primary/45 bg-[radial-gradient(110%_80%_at_100%_0%,color-mix(in_oklab,var(--color-primary)_24%,transparent),transparent_60%),radial-gradient(80%_70%_at_0%_100%,color-mix(in_oklab,var(--color-primary-bright)_12%,transparent),transparent_60%)] bg-surface/70 p-5 shadow-[0_30px_80px_-40px_color-mix(in_oklab,var(--color-primary)_60%,transparent)] sm:p-7";

const HEADING_ID = "featured-deck-themes-heading";

export function FeaturedDeckThemesSection({
  themes,
  art,
  action,
  likeRedirect,
}: {
  themes: readonly FeaturedDeckTheme[];
  art: ReadonlyMap<string, DeckTileArt>;
  /** Right-aligned slot — the home page's "All community decks". */
  action?: React.ReactNode;
  likeRedirect?: string;
}) {
  if (themes.length === 0) return null;
  return (
    <section aria-labelledby={HEADING_ID} className={FEATURED_DECK_THEMES_SURFACE_CLASS}>
      <div className="mb-6 flex flex-col items-start justify-between gap-3 md:flex-row md:items-end">
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-primary/50 bg-primary/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-bright">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Staff picks
          </span>
          <h2 id={HEADING_ID} className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Featured themed decks
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted">
            Hand-picked community decks built around a theme — open one to see its custom cards beside the real ones.
          </p>
        </div>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="flex flex-col gap-8">
        {themes.map((theme, index) => (
          <section
            key={theme.id}
            aria-labelledby={`featured-theme-${theme.id}`}
            className={cn("flex flex-col gap-4", index > 0 && "border-t border-border/50 pt-7")}
          >
            <div className="flex flex-col gap-1">
              <h3
                id={`featured-theme-${theme.id}`}
                className="font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl"
              >
                {theme.title}
              </h3>
              {theme.blurb ? <p className="max-w-2xl text-sm leading-6 text-muted">{theme.blurb}</p> : null}
            </div>
            <DeckGrid>
              {theme.decks.slice(0, DECK_ROW_MAX).map((deck, tile) => (
                <div key={deck.id} className={cn("min-w-0 flex-col", deckRowTileClass(tile))}>
                  <DeckTile
                    deck={deck}
                    art={art.get(deck.id)}
                    headingLevel="h4"
                    sizes={DECK_ROW_SIZES}
                    likeRedirect={likeRedirect}
                  />
                </div>
              ))}
            </DeckGrid>
          </section>
        ))}
      </div>
    </section>
  );
}

/** The section with its reads: the live themes, then ONE tile-art read for
 *  every deck in them (lib/decks/tile-art.ts — a page's decks at once). */
export async function FeaturedDeckThemes({
  maxThemes = 3,
  action,
  likeRedirect,
  frame,
}: {
  maxThemes?: number;
  action?: React.ReactNode;
  likeRedirect?: string;
  /** Wraps the section — never an empty wrapper when there is none (the
   *  home page's PageContainer). */
  frame?: (section: React.ReactNode) => React.ReactNode;
}) {
  const themes = await listFeaturedDeckThemes({ themes: maxThemes, decksPerTheme: DECK_ROW_MAX });
  if (themes.length === 0) return null;
  const decks = themes.flatMap((theme) => theme.decks);
  const art = await listDeckTileArt(decks, { anonymous: true });
  const section = <FeaturedDeckThemesSection themes={themes} art={art} action={action} likeRedirect={likeRedirect} />;
  return frame ? frame(section) : section;
}

/** The section's shape while it streams in: one theme's row. */
export function FeaturedDeckThemesSkeleton() {
  return (
    <div className={FEATURED_DECK_THEMES_SURFACE_CLASS}>
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="mb-4 h-5 w-40" />
      <DeckGrid>
        {Array.from({ length: DECK_ROW_MAX }).map((_, index) => (
          <DeckTileSkeleton key={index} className={deckRowTileClass(index)} />
        ))}
      </DeckGrid>
    </div>
  );
}
