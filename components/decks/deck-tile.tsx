import Link from "next/link";
import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import { Eye, Heart } from "lucide-react";
import { BRAND } from "@/lib/brand/constants";
import { ManaPip } from "@/components/cards/mana-pip";
import { QuickLikeButton } from "@/components/cards/quick-like-button";
import { DeckCardFan } from "@/components/decks/deck-card-fan";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard } from "@/components/ui/surface-card";
import { deckCoverOf, type DeckCoverColor } from "@/lib/decks/cover";
import { commanderBracket } from "@/lib/decks/deck-types";
import { madeOnPipGlyph, type DeckTileCounts } from "@/lib/decks/tile-counts";
import type { DeckTileArt } from "@/lib/decks/tile-art";
import { formatRelativeTime } from "@/lib/format/dates";
import { COLOR_IDENTITY_LABELS, COLOR_LETTER_IDENTITY, VISIBILITY_LABELS, type Visibility } from "@/types/card";
import { DECK_FORMAT_LABELS, type DeckFormat } from "@/types/deck";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// DeckTile — the ONE deck tile (TODO DK8.1): /decks and its browse, the
// format hubs, trending rows (/decks, the gallery), a profile's decks, My
// decks and a card's "Decks with this card" all draw this, never a tile of
// their own.
//
//   * the picture: the deck's cover (deckCoverOf — the owner's upload or a
//     default background, dark in both themes) with the first three cards
//     of its page's fan in front (lib/decks/tile-art.ts: 600 px bake thumbs
//     or Scryfall printings, never a private card or another creator's
//     card that isn't public). Decorative — the title names the deck;
//   * the title — the tile's ONE link, stretched over the whole tile by its
//     ::after, so the controls below it (the author's handle, the heart)
//     are its siblings, never inside it (no control in a link);
//   * format, bracket (Commander) and the deck's colours as pips;
//   * "N of M made on PipGlyph" from the stored counts (0143, tile-counts);
//   * the footer: the author (or, on the owner's own list, the deck's
//     visibility), likes and views.
//
// Server-safe (no hooks); the heart is the QuickLikeButton client island.
// The tile's picture box is the fan's query container (DeckCardFan "tile"),
// so it holds at 390 px and in a four-column row alike.
// ---------------------------------------------------------------------------

export type DeckTileDeck = DeckTileCounts & {
  id: string;
  slug: string;
  title: string;
  format: DeckFormat;
  bracket: number | null;
  visibility: string;
  owner_id: string;
  cover_url: string | null;
  cover_position?: unknown;
  likes_count: number;
  view_count: number;
  updated_at?: string;
  owner?: { username: string | null; display_name: string | null } | null;
  liked_by_viewer?: boolean;
};

/** No art read (yet): the neutral default cover, no fan. */
const NO_ART: DeckTileArt = { colors: null, fan: [] };

const PIP_ORDER: readonly DeckCoverColor[] = ["W", "U", "B", "R", "G", "M"];

/** The deck's colours as a tile names them, WUBRG first; null = unknown. */
export function deckTilePips(colors: readonly DeckCoverColor[] | null): { symbols: string[]; label: string } | null {
  if (!colors) return null;
  const symbols = PIP_ORDER.filter((c) => colors.includes(c));
  if (symbols.length === 0) return { symbols: ["C"], label: COLOR_IDENTITY_LABELS.colorless };
  const label = symbols
    .map((c) => (c === "M" ? COLOR_IDENTITY_LABELS.multicolor : COLOR_IDENTITY_LABELS[COLOR_LETTER_IDENTITY[c]]))
    .join(", ");
  return { symbols, label };
}

/** "Commander · Bracket 2" — the format, and the bracket a Commander deck
 *  states. */
export function deckTileFormatLine(deck: Pick<DeckTileDeck, "format" | "bracket">): string {
  const bracket = deck.format === "commander" ? commanderBracket(deck.bracket) : null;
  return bracket
    ? `${DECK_FORMAT_LABELS[deck.format]} · Bracket ${bracket.level}`
    : DECK_FORMAT_LABELS[deck.format];
}

/** The card line: the stored counts' "12 of 60 made on PipGlyph", or "No
 *  cards yet" for an empty deck (the owner's own list holds those). */
export function deckTileCardLine(deck: DeckTileCounts): string {
  const made = madeOnPipGlyph(deck);
  return made.total > 0 ? made.label : "No cards yet";
}

const compact = (n: number) => n.toLocaleString("en-US");

export function DeckTile({
  deck,
  art = NO_ART,
  variant = "public",
  headingLevel = "h3",
  sizes = "(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
  likeRedirect = "/decks",
}: {
  deck: DeckTileDeck;
  /** listDeckTileArt's answer for this deck (colours + fan). */
  art?: DeckTileArt;
  /** "owner" = My decks: the deck's visibility instead of the author, and
   *  the counts as text (no heart for one's own deck). */
  variant?: "public" | "owner";
  headingLevel?: "h2" | "h3";
  /** The cover's next/image `sizes` — the grid's column width. */
  sizes?: string;
  /** Where a signed-out heart returns after the login. */
  likeRedirect?: string;
}) {
  const cover = deckCoverOf(deck, art.colors);
  const pips = deckTilePips(art.colors);
  const Heading = headingLevel;
  const owner = variant === "owner";

  return (
    <SurfaceCard
      as="article"
      className="group relative flex h-full min-w-0 flex-col gap-0 overflow-hidden p-0 transition-colors hover:border-border-strong focus-within:border-border-strong"
    >
      {/* The picture is decorative: the title link names the deck. */}
      <div
        aria-hidden
        className="@container relative aspect-video w-full overflow-hidden"
        style={{ backgroundColor: BRAND.navy }}
      >
        <Image
          src={cover.src}
          alt=""
          fill
          sizes={sizes}
          className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          style={cover.objectPosition ? { objectPosition: cover.objectPosition } : undefined}
        />
        {art.fan.length > 0 ? (
          <>
            {/* A soft navy band under the cards (an upload is anyone's
                picture; a default is already dark there). */}
            <div
              className="absolute inset-x-0 bottom-0 h-3/4"
              style={{ backgroundImage: `linear-gradient(0deg, ${BRAND.navy}b3 0%, ${BRAND.navy}33 60%, transparent 100%)` }}
            />
            <DeckCardFan cards={art.fan} size="tile" className="absolute inset-x-0 bottom-[4%] mx-0" />
          </>
        ) : null}
      </div>
      {owner ? (
        <span className="absolute left-3 top-3 rounded-full border border-white/25 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur" style={{ backgroundColor: `${BRAND.navy}cc` }}>
          {VISIBILITY_LABELS[deck.visibility as Visibility] ?? deck.visibility}
        </span>
      ) : null}

      <div className="flex flex-1 flex-col gap-1.5 px-4 pb-3 pt-3.5">
        <Heading className="font-display text-base font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere]">
          <Link
            href={`/deck/${deck.slug}`}
            className="after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary-bright/60 focus-visible:after:ring-inset"
          >
            {deck.title}
          </Link>
        </Heading>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{deckTileFormatLine(deck)}</span>
          {pips ? (
            <span className="inline-flex items-center gap-0.5">
              <span className="sr-only">Colors: {pips.label}</span>
              <span aria-hidden className="inline-flex items-center gap-0.5">
                {pips.symbols.map((symbol) =>
                  symbol === "M" ? (
                    <span key={symbol} className="inline-block h-3.5 w-3.5 rounded-full border border-gold/60 bg-gold" />
                  ) : (
                    <ManaPip key={symbol} symbol={symbol} size="xs" />
                  ),
                )}
              </span>
            </span>
          ) : null}
        </p>
        <p className="text-xs text-subtle">{deckTileCardLine(deck)}</p>
      </div>

      {/* Siblings of the stretched link, lifted over it. The strip itself
          lets a click through to the link under it (no dead band along the
          tile's foot); only the author link and the heart take their own. */}
      <div className="pointer-events-none relative z-10 flex items-center justify-between gap-2 border-t border-border/40 px-4 py-2.5 text-xs">
        {owner ? (
          <span className="truncate text-muted">{deck.updated_at ? `Updated ${formatRelativeTime(deck.updated_at)}` : null}</span>
        ) : deck.owner?.username ? (
          <Link
            href={`/profile/${deck.owner.username}`}
            className="pointer-events-auto truncate font-mono text-muted transition-colors hover:text-foreground"
          >
            @{deck.owner.username}
          </Link>
        ) : (
          <span className="truncate text-muted">{deck.owner?.display_name?.trim() || "Anonymous forger"}</span>
        )}
        <div className="flex shrink-0 items-center gap-3 text-muted">
          {owner ? (
            <Stat icon={Heart} value={deck.likes_count} label={deck.likes_count === 1 ? "like" : "likes"} />
          ) : (
            <QuickLikeButton
              kind="deck"
              deckId={deck.id}
              deckSlug={deck.slug}
              ownerUsername={deck.owner?.username ?? null}
              initialLiked={deck.liked_by_viewer ?? false}
              initialCount={deck.likes_count}
              requiresSignIn
              redirectAfterLogin={likeRedirect}
              className="pointer-events-auto"
            />
          )}
          <Stat icon={Eye} value={deck.view_count} label={deck.view_count === 1 ? "view" : "views"} />
        </div>
      </div>
    </SurfaceCard>
  );
}

function Stat({ icon: Icon, value, label }: { icon: LucideIcon; value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {compact(value)}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** A tile's shape while a list streams in. */
export function DeckTileSkeleton({ className }: { className?: string }) {
  return (
    <SurfaceCard className={cn("flex flex-col gap-0 overflow-hidden p-0", className)}>
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="flex flex-col gap-2 px-4 pb-3 pt-3.5">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-3/5" />
      </div>
      <div className="flex items-center justify-between border-t border-border/40 px-4 py-2.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-14" />
      </div>
    </SurfaceCard>
  );
}

/** The deck grids and one-row strips (TODO WD3): 1 / 2 / 3 / 4 columns by
 *  the width of the box they sit in — the card grid's steps
 *  (components/cards/card-grid.tsx: 36 / 56 / 84rem), each a column fewer
 *  than a card grid's, so a tile stays ~280–450 px past a phone's single
 *  column: wide enough for its cover's fan and its title. 1, 2, 3 and 4 divide a 24-deck page. The grid
 *  sits inside an `@container` element (DeckGrid brings one). */
export const DECK_GRID_CLASS = "grid grid-cols-1 gap-5 @xl:grid-cols-2 @4xl:grid-cols-3 @min-[84rem]:grid-cols-4";

/** A one-row strip (trending) is the same grid with the tiles past the last
 *  column hidden — never wrapped (the card rows' rule). Visibility class for
 *  the strip's tile at `index`. */
export function deckRowTileClass(index: number): string {
  if (index >= 3) return "hidden @min-[84rem]:flex";
  if (index >= 2) return "hidden @4xl:flex";
  if (index >= 1) return "hidden @xl:flex";
  return "flex";
}

/** The covers' `sizes`: what a DeckGrid tile measures in ONE frame, at
 *  every window width, never less (tests/unit/components/card-grid.test.ts)
 *  — a grid passes the list of the frame it is in. This one is the WIDE
 *  page frame's (/decks, its browse and format hubs, a profile, the
 *  strips): window steps 608 / 944 / 1408 / 1920 px. */
export const DECK_GRID_SIZES =
  "(min-width: 1920px) 460px, (min-width: 1408px) calc((100vw - 124px) / 4), (min-width: 944px) calc((100vw - 88px) / 3), (min-width: 608px) calc((100vw - 52px) / 2), calc(100vw - 32px)";
/** The strips' tiles are the grid's. */
export const DECK_ROW_SIZES = DECK_GRID_SIZES;
/** A DeckGrid tile in the DASHBOARD's column (the wide frame less its
 *  220 px rail and 32 px gap from 1024 px): My Decks. Steps 608 / 944 /
 *  1024 (the rail: 2) / 1212 (3) / 1660 (4). */
export const DASHBOARD_DECK_GRID_SIZES =
  "(min-width: 1920px) 386px, (min-width: 1660px) calc((100vw - 376px) / 4), (min-width: 1212px) calc((100vw - 356px) / 3), (min-width: 1024px) calc((100vw - 336px) / 2), (min-width: 944px) calc((100vw - 88px) / 3), (min-width: 608px) calc((100vw - 52px) / 2), calc(100vw - 32px)";
/** A DeckGrid tile in a frame narrower than the wide page's — the card
 *  page's "Decks with this card" (1152 px frame) and its modal: generous,
 *  never less. */
export const DECK_NARROW_FRAME_SIZES = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";

/** DECK_GRID_CLASS in its own query container. */
export function DeckGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="@container">
      <div className={cn(DECK_GRID_CLASS, className)}>{children}</div>
    </div>
  );
}
