"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, RotateCcw, Shuffle } from "lucide-react";
import { ChartHelp } from "@/components/decks/deck-chart-card";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import { BlankCardFace, PrivateCardFace } from "@/components/decks/deck-entry-tile";
import { cardCornersClass } from "@/lib/cards/card-orientation";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import { isStoredRenderUrl } from "@/lib/cards/render-cdn";
import { deckLibraryOf } from "@/lib/decks/deck-charts";
import { deckRowsOf, type DeckRow } from "@/lib/decks/deck-view";
import { entryPrintingImage } from "@/lib/decks/entry-image";
import { publicDeckItems } from "@/lib/decks/private-card-name";
import type { DeckItem, DeckPageCard } from "@/lib/decks/queries";
import { BREAKDOWN_HELP } from "@/lib/decks/deck-help";
import {
  drawCard,
  entryIdOfKey,
  freshSeed,
  libraryKeys,
  openingHand,
  seededRandom,
  type HandState,
  type Random,
} from "@/lib/decks/sample-hand";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The sample hand (TODO DK7.2): seven cards off the shuffled MAINBOARD
// (lib/decks/sample-hand.ts), then a card at a time; New hand starts again.
// No mulligan (owner 2026-10-30, TODO DK11 (f)): a hand the reader doesn't
// like is a new hand.
//
// The deck's own pictures, as the list draws them (DeckEntryTile's rule): a
// PipGlyph card through BakedCardThumbnail — its 600 px thumb, never the HD
// PNG — a printing on its own 5:7 tile with the one card corner, a
// visitor's private card the "Private card" face (the rows are the page's
// publicDeckItems: never its title or art). Nothing is shuffled — no
// picture loaded — until the reader asks for a hand. Every change is said
// once in a polite live region, each line its own ("Hand 3: …", "Drew
// Forest: 8 cards in hand." — a line said twice in a row is silence). Draw a
// card stays where it is once the library is empty — off (aria-disabled,
// its reason in its name), so the focus never drops.
// ---------------------------------------------------------------------------

type HandItem = DeckItem<DeckPageCard>;

const BUTTON =
  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60";
const BUTTON_ON = "border-border bg-background/60 text-foreground hover:border-border-strong";
const BUTTON_OFF = "cursor-not-allowed border-border/60 text-subtle";

function HandCardPicture({ row }: { row: DeckRow<HandItem> }) {
  const { entry, card } = row.item;
  if (row.isPrivate) return <PrivateCardFace name={row.privateName} gone={row.isGone} />;
  const printing = entryPrintingImage(entry.image_url, "normal");
  const baked = Boolean(card && isStoredRenderUrl(card.rendered_image_url));
  if (card && (baked || !printing)) {
    return (
      <BakedCardThumbnail
        renderedImageUrl={card.rendered_image_url}
        renderedThumbUrl={card.rendered_thumb_url}
        title={card.title}
        alt={row.name}
        previewData={cardToPreviewData(card)}
        sizes="(min-width: 1280px) 170px, (min-width: 768px) 14vw, 25vw"
      />
    );
  }
  if (printing) {
    return (
      <span
        className={cn(
          "relative block aspect-[5/7] w-full overflow-hidden border border-border/40 bg-[#101015] shadow-[0_18px_60px_-30px_rgba(0,0,0,0.85)]",
          cardCornersClass(false),
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Scryfall's own CDN, sized by the URL */}
        <img src={printing} alt={row.name} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      </span>
    );
  }
  return <BlankCardFace name={row.name} />;
}

/** "3 lands, 4 spells". */
function handSummary(keys: readonly string[], rowById: ReadonlyMap<string, DeckRow<HandItem>>): string {
  const lands = keys.filter((key) => rowById.get(entryIdOfKey(key))?.bucket === "Land").length;
  const spells = keys.length - lands;
  return `${lands} land${lands === 1 ? "" : "s"}, ${spells} spell${spells === 1 ? "" : "s"}`;
}

export function DeckSampleHand({
  items,
  canManage,
  seed,
}: {
  items: HandItem[];
  canManage: boolean;
  /** Tests replay a hand from a seed; the page seeds from crypto. */
  seed?: number;
}) {
  const rows = useMemo(() => deckRowsOf(publicDeckItems(items, canManage), canManage), [items, canManage]);
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const deck = useMemo(() => libraryKeys(deckLibraryOf(rows)), [rows]);
  const random = useRef<Random | null>(null);
  const rng = () => (random.current ??= seededRandom(seed ?? freshSeed()));
  const [hand, setHand] = useState<HandState | null>(null);
  const [said, setSaid] = useState("");
  // Hands dealt so far: "Hand 3: …" — a second New hand never says the
  // line the first one did.
  const [deals, setDeals] = useState(0);

  if (deck.length === 0) return null;

  const nameOf = (key: string) => {
    const row = rowById.get(entryIdOfKey(key));
    return row ? (row.privateName ?? row.name) : "a card";
  };
  const drawOk = hand !== null && hand.library.length > 0;

  const newHand = () => {
    const next = openingHand(deck, rng());
    const deal = deals + 1;
    setDeals(deal);
    setHand(next);
    setSaid(`Hand ${deal}: ${handSummary(next.hand, rowById)}.`);
  };
  const draw = () => {
    if (!hand) return;
    const next = drawCard(hand);
    if (next === hand) return;
    setHand(next);
    // The hand's size makes each draw's line its own (two Forests in a row).
    setSaid(`Drew ${nameOf(next.hand[next.hand.length - 1])}: ${next.hand.length} cards in hand.`);
  };

  const status = !hand
    ? `A seven-card hand from the ${deck.length}-card mainboard.`
    : `${handSummary(hand.hand, rowById)} · ${hand.library.length} in the library`;

  return (
    <section
      aria-labelledby="deck-sample-hand-title"
      className="flex min-w-0 flex-col gap-4 rounded-card border border-border/70 bg-surface/80 p-4 sm:p-5"
    >
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <h3 id="deck-sample-hand-title" className="text-sm font-semibold text-foreground">
            Sample hand
          </h3>
          <ChartHelp help={BREAKDOWN_HELP.sampleHand} />
        </div>
        <p className="text-xs leading-5 text-muted">Seven cards from the shuffled mainboard, then a card at a time.</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={newHand} className={cn(BUTTON, "border-primary/60 bg-primary text-primary-foreground hover:bg-primary/90")}>
          {hand ? <RotateCcw className="h-4 w-4" aria-hidden /> : <Shuffle className="h-4 w-4" aria-hidden />}
          {hand ? "New hand" : "Draw a hand"}
        </button>
        {hand ? (
          <button
            type="button"
            aria-disabled={drawOk ? undefined : true}
            onClick={drawOk ? draw : undefined}
            className={cn(BUTTON, drawOk ? BUTTON_ON : BUTTON_OFF)}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Draw a card
            {!drawOk ? <span className="sr-only"> (the library is empty)</span> : null}
          </button>
        ) : null}
        <p className="w-full text-xs leading-5 text-muted sm:ml-auto sm:w-auto">{status}</p>
      </div>

      {hand ? (
        <ul aria-label={`Hand, ${hand.hand.length} card${hand.hand.length === 1 ? "" : "s"}`} className="grid grid-cols-3 gap-2 min-[480px]:grid-cols-4 md:grid-cols-7 sm:gap-3">
          {hand.hand.map((key, index) => {
            const row = rowById.get(entryIdOfKey(key));
            if (!row) return null;
            const drawn = index >= hand.hand.length - hand.drawn;
            return (
              <li key={key} className="min-w-0">
                <div className={cn("relative", drawn && cn(cardCornersClass(false), "ring-2 ring-chart-2 ring-offset-2 ring-offset-background"))}>
                  <HandCardPicture row={row} />
                  {drawn ? <span className="sr-only"> (drawn)</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul aria-hidden className="grid grid-cols-3 gap-2 min-[480px]:grid-cols-4 md:grid-cols-7 sm:gap-3">
          {Array.from({ length: 7 }, (_, i) => (
            <li key={i} className={cn("aspect-[5/7] border border-dashed border-border-strong/70 bg-elevated/40", cardCornersClass(false), i >= 3 && "max-[479px]:hidden", i >= 4 && "max-md:hidden")} />
          ))}
        </ul>
      )}

      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </section>
  );
}
