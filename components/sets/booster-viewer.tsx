"use client";

// ---------------------------------------------------------------------------
// BoosterViewer
//
// Interactive virtual booster pack reveal. Cards start face-down in a fanned
// stack. The user clicks "Open pack" to start revealing cards one by one.
// Each reveal flips the top card face-up with a CSS transition.
//
// State machine:
//   sealed   → player sees a fanned stack, click to open
//   opening  → cards reveal one by one on each click
//   done     → all cards face-up, option to reshuffle
// ---------------------------------------------------------------------------

import { useState } from "react";
import Link from "next/link";
import { PackageOpen, RefreshCw, RotateCcw } from "lucide-react";
import { CardPreview } from "@/components/cards/card-preview";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ArtPosition, CardType, ColorIdentity, FrameStyle, Rarity } from "@/types/card";

export type BoosterCard = {
  id: string;
  slug: string;
  title: string;
  cost: string | null;
  cardType: CardType | null;
  supertype: string | null;
  subtypes: string[];
  rarity: Rarity | null;
  colorIdentity: ColorIdentity[];
  rulesText: string | null;
  flavorText: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  artistCredit: string | null;
  artUrl: string | null;
  artPosition: ArtPosition;
  frameStyle: FrameStyle;
};

type Phase = "sealed" | "opening" | "done";

export function BoosterViewer({
  setTitle,
  setSlug,
  cards,
}: {
  setTitle: string;
  setSlug: string;
  cards: BoosterCard[];
}) {
  const [phase, setPhase] = useState<Phase>("sealed");
  const [revealedCount, setRevealedCount] = useState(0);

  const totalCards = cards.length;
  const allRevealed = revealedCount >= totalCards;

  const handleOpen = () => {
    if (phase === "sealed") {
      setPhase("opening");
      setRevealedCount(1); // reveal first card immediately
    }
  };

  const handleNext = () => {
    if (allRevealed) {
      setPhase("done");
      return;
    }
    const next = revealedCount + 1;
    setRevealedCount(next);
    if (next >= totalCards) {
      setPhase("done");
    }
  };

  const handleReset = () => {
    setPhase("sealed");
    setRevealedCount(0);
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
          Booster Pack
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
          {setTitle}
        </h1>
        <p className="text-sm text-muted">
          {phase === "sealed"
            ? `${totalCards} card${totalCards !== 1 ? "s" : ""} sealed inside. Click to open.`
            : phase === "opening"
              ? `${revealedCount} of ${totalCards} revealed — click a card or the button to see the next.`
              : `All ${totalCards} cards revealed.`}
        </p>
      </div>

      {/* Sealed state — fanned card backs */}
      {phase === "sealed" ? (
        <SealedPack cardCount={totalCards} onOpen={handleOpen} />
      ) : (
        <>
          {/* Revealed grid */}
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {cards.slice(0, revealedCount).map((card, i) => (
              <div
                key={card.id}
                className="animate-in fade-in slide-in-from-bottom-4 duration-300"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <Link
                  href={`/card/${card.slug}`}
                  className="block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={`View ${card.title}`}
                >
                  <CardPreview
                    title={card.title}
                    cost={card.cost}
                    cardType={card.cardType}
                    supertype={card.supertype}
                    subtypes={card.subtypes}
                    rarity={card.rarity}
                    colorIdentity={card.colorIdentity}
                    rulesText={card.rulesText}
                    flavorText={card.flavorText}
                    power={card.power}
                    toughness={card.toughness}
                    loyalty={card.loyalty}
                    defense={card.defense}
                    artistCredit={card.artistCredit}
                    artUrl={card.artUrl}
                    artPosition={card.artPosition}
                    frameStyle={card.frameStyle}
                  />
                </Link>
                {card.rarity === "rare" || card.rarity === "mythic" ? (
                  <div className="mt-1.5 flex justify-center">
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                      card.rarity === "mythic"
                        ? "bg-orange-500/15 text-orange-400"
                        : "bg-amber-500/15 text-amber-300",
                    )}>
                      {card.rarity}
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            {!allRevealed && phase === "opening" ? (
              <Button size="lg" onClick={handleNext}>
                <PackageOpen className="h-4 w-4" aria-hidden />
                Reveal next card ({revealedCount + 1}/{totalCards})
              </Button>
            ) : null}
            {phase === "done" ? (
              <>
                <Button size="lg" onClick={handleReset}>
                  <RefreshCw className="h-4 w-4" aria-hidden />
                  Open another pack
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href={`/set/${setSlug}`}>
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    Back to set
                  </Link>
                </Button>
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SealedPack — decorative fanned card backs shown before opening
// ---------------------------------------------------------------------------

function SealedPack({
  cardCount,
  onOpen,
}: {
  cardCount: number;
  onOpen: () => void;
}) {
  // Show up to 5 fanned "card back" silhouettes
  const fanCount = Math.min(cardCount, 5);
  const angles = [-8, -4, 0, 4, 8].slice(0, fanCount);

  return (
    <div className="flex flex-col items-center gap-8 py-8">
      {/* Fanned stack */}
      <div className="relative flex h-72 w-48 items-center justify-center">
        {angles.map((deg, i) => (
          <div
            key={i}
            className="absolute h-64 w-44 rounded-frame border-2 border-primary/30 bg-linear-to-br from-elevated via-surface to-background shadow-[0_8px_30px_-10px_rgba(0,0,0,0.6)]"
            style={{
              transform: `rotate(${deg}deg) translateY(${i * 2}px)`,
              zIndex: i,
            }}
            aria-hidden
          >
            {/* Card back decoration */}
            <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
              <div className="h-16 w-16 rounded-full border-2 border-primary/40 bg-primary/10 flex items-center justify-center">
                <span className="font-display text-2xl font-bold text-primary/60">S</span>
              </div>
              <div className="flex flex-col gap-1.5 w-full items-center">
                {[...Array(4)].map((_, j) => (
                  <div
                    key={j}
                    className="h-1 rounded-full bg-primary/20"
                    style={{ width: `${70 - j * 12}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm text-muted">
          <span className="font-semibold text-foreground">{cardCount} cards</span>{" "}
          sealed inside
        </p>
        <Button size="lg" onClick={onOpen} className="gap-2">
          <PackageOpen className="h-5 w-5" aria-hidden />
          Open pack
        </Button>
      </div>
    </div>
  );
}
