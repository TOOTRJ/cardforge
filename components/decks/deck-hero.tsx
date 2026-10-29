import type { ReactNode } from "react";
import Image from "next/image";
import { BRAND } from "@/lib/brand/constants";
import type { DeckCover } from "@/lib/decks/cover";
import type { FeaturableCard, FeaturedCard } from "@/lib/decks/featured";
import type { PreviewCardColumns } from "@/lib/cards/preview-data";
import { DeckCardFan } from "@/components/decks/deck-card-fan";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// DeckHero — the top of a deck page (TODO DK6.5): the deck's cover
// (deckCoverOf: the owner's upload or a default background), a scrim, the
// fan of featured cards and the title block, with the page's actions on a
// strip along the bottom.
//
// The picture is always dark (the defaults are made that way, and an upload
// gets a darkening layer behind the cards), so the title block is light text
// on a NAVY scrim in both themes — the scrim's colour is the brand navy
// (BRAND, never --color-background, which turns pale in light theme). The
// actions are the site's own buttons, so their strip is a theme SURFACE:
// they read as they do everywhere else, in either theme.
//
// Layout: title left, fan right from md up; on a phone the fan stands on
// top and the title under it, over a bottom-up scrim. The picture is
// decorative (alt ""): the h1 names the deck.
// ---------------------------------------------------------------------------

/** BRAND.navy as rgba at `alpha` (the scrim's stops). */
function navy(alpha: number): string {
  const hex = BRAND.navy.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

const SCRIM_SIDE = `linear-gradient(90deg, ${navy(0.94)} 0%, ${navy(0.82)} 34%, ${navy(0.42)} 62%, ${navy(0.14)} 100%)`;
const SCRIM_UP = `linear-gradient(0deg, ${navy(0.96)} 0%, ${navy(0.86)} 42%, ${navy(0.38)} 72%, ${navy(0.18)} 100%)`;
/** An upload is anyone's picture: one more layer behind the card band. */
const UPLOAD_BAND = `radial-gradient(ellipse 60% 75% at 72% 50%, ${navy(0.62)} 0%, ${navy(0.3)} 65%, transparent 100%)`;
const UPLOAD_BAND_PHONE = `radial-gradient(ellipse 85% 50% at 50% 26%, ${navy(0.6)} 0%, transparent 100%)`;

export function DeckHero({
  cover,
  title,
  titleAction,
  chips,
  byline,
  description,
  coverAction,
  featured,
  actions,
}: {
  cover: DeckCover;
  title: string;
  /** The owner's pencil beside the title. */
  titleAction?: ReactNode;
  /** Format / type / bracket / visibility pills (HeroChip). */
  chips?: ReactNode;
  /** Owner and counts, under the title. */
  byline?: ReactNode;
  description?: ReactNode;
  /** The owner's "Change cover" — top right of the picture. */
  coverAction?: ReactNode;
  featured: readonly FeaturedCard<FeaturableCard & PreviewCardColumns>[];
  /** Like, share, copy, export — the strip under the picture. */
  actions?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="deck-hero-title"
      className="relative isolate overflow-hidden rounded-frame border border-border/60"
      style={{ backgroundColor: BRAND.navy }}
    >
      <div className="relative">
        <Image
          src={cover.src}
          alt=""
          fill
          priority
          // The deck page is the wide frame (TODO WD5): up to 1920 px less its padding.
          sizes="(min-width: 1920px) 1856px, 100vw"
          className="-z-10 object-cover"
          style={cover.objectPosition ? { objectPosition: cover.objectPosition } : undefined}
        />
        <div aria-hidden className="absolute inset-0 -z-10 hidden md:block" style={{ backgroundImage: SCRIM_SIDE }} />
        <div aria-hidden className="absolute inset-0 -z-10 md:hidden" style={{ backgroundImage: SCRIM_UP }} />
        {cover.kind === "upload" ? (
          <>
            <div aria-hidden className="absolute inset-0 -z-10 hidden md:block" style={{ backgroundImage: UPLOAD_BAND }} />
            <div aria-hidden className="absolute inset-0 -z-10 md:hidden" style={{ backgroundImage: UPLOAD_BAND_PHONE }} />
          </>
        ) : null}

        {coverAction ? <div className="absolute right-3 top-3 z-20">{coverAction}</div> : null}

        {/* Under md the fan stands on top: with the owner's cover button in
            the corner it starts below that button, never under it. No
            taller than the fan needs (TODO DK5.1: the cards come first, so
            the hero leaves them room on the first screen). */}
        <div
          className={cn(
            "grid gap-5 px-5 pb-6 sm:px-8 sm:pb-8 md:min-h-[18rem] md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:items-center md:gap-8 md:pt-8 lg:min-h-[20rem] lg:px-10",
            coverAction ? "pt-14" : "pt-6 sm:pt-8",
          )}
        >
          <div className="flex min-w-0 flex-col gap-3 text-white">
            {chips ? <div className="flex flex-wrap items-center gap-2">{chips}</div> : null}
            <h1
              id="deck-hero-title"
              className="font-display text-3xl font-semibold tracking-tight text-white [overflow-wrap:anywhere] [text-shadow:0_2px_18px_rgba(0,0,0,0.45)] sm:text-4xl lg:text-5xl"
            >
              {title}
              {titleAction ? <span className="ml-2 inline-flex align-middle">{titleAction}</span> : null}
            </h1>
            {byline ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/80">{byline}</div> : null}
            {description ? (
              <div className="max-w-xl text-sm leading-6 text-white/80 [overflow-wrap:anywhere]">{description}</div>
            ) : null}
          </div>
          <DeckCardFan cards={featured} className="order-first md:order-none" />
        </div>
      </div>

      {actions ? (
        <div className="border-t border-border/60 bg-surface/95 px-4 py-3 sm:px-6">{actions}</div>
      ) : null}
    </section>
  );
}

/** The brand gold of the dark theme — the hero is dark in both themes, and
 *  the light theme's --color-gold is deepened for a pale page. */
const GOLD_CHIP = {
  borderColor: `${BRAND.gold}99`,
  backgroundColor: `${BRAND.gold}26`,
  color: BRAND.goldLight,
};

/** A pill on the hero's dark scrim (Badge's colours are theme tokens). */
export function HeroChip({
  children,
  tone = "plain",
  title,
}: {
  children: ReactNode;
  tone?: "plain" | "gold";
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm",
        tone === "plain" && "border-white/25 bg-white/10 text-white/90",
      )}
      style={tone === "gold" ? GOLD_CHIP : undefined}
    >
      {children}
    </span>
  );
}
