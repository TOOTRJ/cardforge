import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CardPreviewPlaceholder } from "@/components/cards/card-preview-placeholder";

export function MarketingHero() {
  return (
    <section className="relative overflow-hidden border-b border-border/40">
      <div className="absolute inset-0 bg-radial-glow" aria-hidden />
      <div className="absolute inset-0 bg-grid opacity-[0.18]" aria-hidden />

      <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:px-8 lg:py-32">
        <div className="flex flex-col items-start gap-6">
          <Badge variant="primary" className="gap-1.5">
            <Sparkles className="h-3 w-3" aria-hidden />
            Phase 1 · Foundation
          </Badge>

          <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Forge custom trading cards
            <span className="block bg-linear-to-r from-primary via-primary to-accent bg-clip-text text-transparent">
              fast, beautiful, yours.
            </span>
          </h1>

          <p className="max-w-xl text-base leading-7 text-muted sm:text-lg">
            CardForge is a modern platform for designing, sharing, and remixing
            custom trading cards. Build a fantasy card in under sixty seconds — and
            grow it into a full set, world, or playtest deck.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/create">Start creating</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/gallery">Browse gallery</Link>
            </Button>
          </div>

          <p className="text-xs leading-5 text-subtle">
            No official MTG, Wizards of the Coast, or third-party assets are used.
            Original generic frames and tokens.
          </p>
        </div>

        <div className="relative">
          <div className="absolute -inset-8 -z-10 rounded-[2rem] bg-linear-to-br from-primary/20 via-accent/15 to-transparent blur-2xl" aria-hidden />
          <div className="grid grid-cols-2 gap-4 sm:gap-6">
            <CardPreviewPlaceholder
              className="rotate-[-4deg]"
              card={{
                title: "Emberbound Wyrm",
                cost: "{3}{R}",
                cardType: "creature",
                rarity: "mythic",
                colorIdentity: "red",
                artistCredit: "You",
              }}
            />
            <CardPreviewPlaceholder
              className="mt-12 rotate-[4deg]"
              card={{
                title: "Tideglass Oracle",
                cost: "{1}{U}{U}",
                cardType: "creature",
                rarity: "rare",
                colorIdentity: "blue",
                artistCredit: "You",
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
