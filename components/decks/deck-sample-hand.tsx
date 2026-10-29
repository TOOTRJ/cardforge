"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Check, Plus, RotateCcw, Shuffle } from "lucide-react";
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
import {
  canMulligan,
  drawCard,
  entryIdOfKey,
  freshSeed,
  isHandKept,
  keepHand,
  libraryKeys,
  mulligan,
  openingHand,
  seededRandom,
  type HandState,
  type Random,
} from "@/lib/decks/sample-hand";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The sample hand (TODO DK7.2): seven cards off the shuffled MAINBOARD, the
// London mulligan (lib/decks/sample-hand.ts — draw seven, then pick the
// cards that go to the bottom: one per mulligan, the first free in every
// commander format — a multiplayer game or a Brawl one, CR 103.5c), then a
// card at a time. A kept hand (Keep, or a card drawn) takes no more
// mulligans: Mulligan stays where it is, off (aria-disabled, its reason in
// its name — the focus never drops), and New hand starts again.
//
// The deck's own pictures, as the list draws them (DeckEntryTile's rule): a
// PipGlyph card through BakedCardThumbnail — its 600 px thumb, never the HD
// PNG — a printing on its own 5:7 tile with the one card corner, a
// visitor's private card the "Private card" face (the rows are the page's
// publicDeckItems: never its title or art). Nothing is shuffled — no
// picture loaded — until the reader asks for a hand. Every change is said
// once in a polite live region, each line its own ("Hand 3: …", "Drew
// Forest: 8 cards in hand." — a line said twice in a row is silence); the
// button that disappears (Keep) hands the focus to the one that follows
// (Draw a card).
// ---------------------------------------------------------------------------

type HandItem = DeckItem<DeckPageCard>;

const BUTTON =
  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60";
const BUTTON_ON = "border-border bg-background/60 text-foreground hover:border-border-strong";
const BUTTON_OFF = "cursor-not-allowed border-border/60 text-subtle";

function HandCardPicture({ row }: { row: DeckRow<HandItem> }) {
  const { entry, card } = row.item;
  if (row.isPrivate) return <PrivateCardFace name={row.privateName} />;
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
  freeMulliganFormat,
  seed,
}: {
  items: HandItem[];
  canManage: boolean;
  /** The format's name where the first mulligan is free (CR 103.5c,
   *  formatHasFreeMulligan: "Commander", "Brawl"…) — what the copy says;
   *  null where it isn't. */
  freeMulliganFormat: string | null;
  /** Tests replay a hand from a seed; the page seeds from crypto. */
  seed?: number;
}) {
  const freeMulligan = freeMulliganFormat !== null;
  const rows = useMemo(() => deckRowsOf(publicDeckItems(items, canManage), canManage), [items, canManage]);
  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const deck = useMemo(() => libraryKeys(deckLibraryOf(rows)), [rows]);
  const random = useRef<Random | null>(null);
  const rng = () => (random.current ??= seededRandom(seed ?? freshSeed()));
  const [hand, setHand] = useState<HandState | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [said, setSaid] = useState("");
  // Hands dealt so far: "Hand 3: …" — a second New hand never says the
  // line the first one did.
  const [deals, setDeals] = useState(0);
  const drawButton = useRef<HTMLButtonElement | null>(null);

  if (deck.length === 0) return null;

  const nameOf = (key: string) => {
    const row = rowById.get(entryIdOfKey(key));
    return row ? (row.privateName ?? row.name) : "a card";
  };
  const choosing = hand !== null && hand.toBottom > 0;
  const kept = hand !== null && isHandKept(hand);
  const mulliganOk = hand !== null && canMulligan(hand, deck.length, freeMulligan);
  const drawOk = hand !== null && !choosing && hand.library.length > 0;

  const newHand = () => {
    const next = openingHand(deck, rng());
    const deal = deals + 1;
    setDeals(deal);
    setHand(next);
    setChosen([]);
    setSaid(`Hand ${deal}: ${handSummary(next.hand, rowById)}.`);
  };
  const takeMulligan = () => {
    if (!hand) return;
    const next = mulligan(hand, deck, rng(), freeMulligan);
    setHand(next);
    setChosen([]);
    setSaid(
      `Mulligan ${next.mulligans}: seven new cards, ${handSummary(next.hand, rowById)}. ` +
        (next.toBottom > 0
          ? `Choose ${next.toBottom} to put on the bottom.`
          : `The first mulligan is free in ${freeMulliganFormat}: nothing goes to the bottom.`),
    );
  };
  // Picking past the owed count lets go of the earliest pick: with one card
  // owed, a pick MOVES the choice, as a radio button would.
  const toggle = (key: string) =>
    setChosen((current) => {
      if (current.includes(key)) return current.filter((k) => k !== key);
      const owed = hand?.toBottom ?? 0;
      return [...current, key].slice(-Math.max(1, owed));
    });
  const keep = () => {
    if (!hand || chosen.length !== hand.toBottom) return;
    const next = keepHand(hand, chosen);
    setHand(next);
    setChosen([]);
    setSaid(`Kept ${next.hand.length} cards: ${handSummary(next.hand, rowById)}. ${chosen.map(nameOf).join(", ")} on the bottom.`);
    // Keep goes away: the focus to what comes next.
    requestAnimationFrame(() => drawButton.current?.focus());
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
    : `${hand.mulligans > 0 ? `Mulligan ${hand.mulligans} · ` : ""}${kept ? "Kept · " : ""}${handSummary(hand.hand, rowById)} · ${hand.library.length} in the library`;

  return (
    <section
      aria-labelledby="deck-sample-hand-title"
      className="flex min-w-0 flex-col gap-4 rounded-card border border-border/70 bg-surface/80 p-4 sm:p-5"
    >
      <header className="flex flex-col gap-1">
        <h3 id="deck-sample-hand-title" className="text-sm font-semibold text-foreground">
          Sample hand
        </h3>
        <p className="text-xs leading-5 text-muted">
          Seven cards from the shuffled mainboard. A mulligan is the London one: seven new cards, then one to the bottom for each
          mulligan{freeMulliganFormat ? ` — the first is free in ${freeMulliganFormat}` : ""}. A kept hand takes no more
          mulligans.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={newHand} className={cn(BUTTON, "border-primary/60 bg-primary text-primary-foreground hover:bg-primary/90")}>
          {hand ? <RotateCcw className="h-4 w-4" aria-hidden /> : <Shuffle className="h-4 w-4" aria-hidden />}
          {hand ? "New hand" : "Draw a hand"}
        </button>
        {hand ? (
          <>
            <button
              type="button"
              aria-disabled={mulliganOk ? undefined : true}
              onClick={mulliganOk ? takeMulligan : undefined}
              className={cn(BUTTON, mulliganOk ? BUTTON_ON : BUTTON_OFF)}
            >
              <Shuffle className="h-4 w-4" aria-hidden />
              Mulligan
              {kept ? <span className="sr-only"> (the hand is kept: deal a new hand)</span> : null}
              {!kept && !mulliganOk ? <span className="sr-only"> (no card would be left to keep)</span> : null}
            </button>
            <button
              ref={drawButton}
              type="button"
              aria-disabled={drawOk ? undefined : true}
              onClick={drawOk ? draw : undefined}
              className={cn(BUTTON, drawOk ? BUTTON_ON : BUTTON_OFF)}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Draw a card
              {choosing ? <span className="sr-only"> (keep the hand first)</span> : null}
              {!choosing && hand.library.length === 0 ? <span className="sr-only"> (the library is empty)</span> : null}
            </button>
          </>
        ) : null}
        <p className="w-full text-xs leading-5 text-muted sm:ml-auto sm:w-auto">{status}</p>
      </div>

      {choosing && hand ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-chart-2/50 bg-chart-2/10 px-3 py-2 text-xs">
          <span className="text-foreground">
            Pick {hand.toBottom} card{hand.toBottom === 1 ? "" : "s"} to put on the bottom, then keep the rest.{" "}
            <span className="text-muted">
              {chosen.length} of {hand.toBottom} picked.
            </span>
          </span>
          <button
            type="button"
            aria-disabled={chosen.length === hand.toBottom ? undefined : true}
            onClick={chosen.length === hand.toBottom ? keep : undefined}
            className={cn(BUTTON, "h-8 text-xs sm:ml-auto", chosen.length === hand.toBottom ? BUTTON_ON : BUTTON_OFF)}
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            Keep {hand.hand.length - hand.toBottom} card{hand.hand.length - hand.toBottom === 1 ? "" : "s"}
            {chosen.length !== hand.toBottom ? (
              <span className="sr-only">
                {" "}
                (pick {hand.toBottom} for the bottom first; {chosen.length} picked)
              </span>
            ) : null}
          </button>
        </div>
      ) : null}

      {hand ? (
        <ul aria-label={`Hand, ${hand.hand.length} card${hand.hand.length === 1 ? "" : "s"}`} className="grid grid-cols-3 gap-2 min-[480px]:grid-cols-4 md:grid-cols-7 sm:gap-3">
          {hand.hand.map((key, index) => {
            const row = rowById.get(entryIdOfKey(key));
            if (!row) return null;
            const name = row.privateName ?? row.name;
            const bottom = chosen.includes(key);
            const drawn = index >= hand.hand.length - hand.drawn;
            return (
              <li key={key} className="min-w-0">
                {choosing ? (
                  <button
                    type="button"
                    aria-pressed={bottom}
                    aria-label={`${name}: put on the bottom`}
                    onClick={() => toggle(key)}
                    className={cn(
                      // A picked card drops a little, toward the bottom, and
                      // wears a ring — never a fade (its words would lose
                      // their contrast).
                      "relative block w-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
                      cardCornersClass(false),
                      bottom && "translate-y-2 ring-2 ring-chart-2 ring-offset-2 ring-offset-background",
                    )}
                  >
                    <HandCardPicture row={row} />
                    {bottom ? (
                      <span
                        aria-hidden
                        className="absolute inset-x-[8%] bottom-[8%] flex items-center justify-center gap-1 rounded-full border border-white/25 bg-black/80 px-2 py-1 text-[11px] font-semibold text-white"
                      >
                        <ArrowDownToLine className="h-3 w-3" aria-hidden />
                        Bottom
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <div className={cn("relative", drawn && cn(cardCornersClass(false), "ring-2 ring-chart-2 ring-offset-2 ring-offset-background"))}>
                    <HandCardPicture row={row} />
                    {drawn ? <span className="sr-only"> (drawn)</span> : null}
                  </div>
                )}
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
