import Link from "next/link";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CardPreviewPlaceholder } from "@/components/cards/card-preview-placeholder";

// WUBRG pip labels for the decorative strip
const MANA_PIPS = [
  { key: "W", label: "White", cls: "mana-pip mana-w" },
  { key: "U", label: "Blue",  cls: "mana-pip mana-u" },
  { key: "B", label: "Black", cls: "mana-pip mana-b" },
  { key: "R", label: "Red",   cls: "mana-pip mana-r" },
  { key: "G", label: "Green", cls: "mana-pip mana-g" },
];

export function MarketingHero() {
  return (
    <section className="relative overflow-hidden border-b border-border/40">
      <div className="absolute inset-0 bg-radial-glow" aria-hidden />
      <div className="absolute inset-0 bg-grid opacity-[0.15]" aria-hidden />

      <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:px-8 lg:py-32">
        <div className="flex flex-col items-start gap-6">
          {/* Badge */}
          <Badge variant="primary" className="gap-1.5">
            <PenLine className="h-3 w-3" aria-hidden />
            Free · No account needed to preview
          </Badge>

          {/* Headline */}
          <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Design your own
            <span className="block bg-linear-to-r from-primary via-primary to-accent bg-clip-text text-transparent">
              Magic cards.
            </span>
          </h1>

          {/* Sub-copy — MTG vocabulary throughout */}
          <p className="max-w-xl text-base leading-7 text-muted sm:text-lg">
            Set mana costs, write oracle text, tune power and toughness —
            then share the result with your playgroup. Creatures, instants,
            enchantments, planeswalkers, full expansion sets. All of it.
          </p>

          {/* WUBRG pip strip */}
          <div className="flex items-center gap-2" aria-label="Supports all five Magic colors">
            {MANA_PIPS.map((pip) => (
              <span
                key={pip.key}
                className={pip.cls}
                title={pip.label}
                aria-label={pip.label}
              >
                {pip.key}
              </span>
            ))}
            <span className="ml-1 text-xs text-subtle">All five colors supported</span>
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/preview">Start forging</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/gallery">Browse gallery</Link>
            </Button>
          </div>

          {/* Legal micro-copy */}
          <p className="text-xs leading-5 text-subtle">
            Fan-made tool. Not affiliated with Wizards of the Coast.
            Original frames — no copyrighted assets used.
          </p>
        </div>

        {/* Hero card preview — two tilted placeholder cards */}
        <div className="relative">
          <div className="absolute -inset-8 -z-10 rounded-[2rem] bg-linear-to-br from-primary/20 via-accent/10 to-transparent blur-2xl" aria-hidden />
          <div className="grid grid-cols-2 gap-4 sm:gap-6">
            <CardPreviewPlaceholder
              className="rotate-[-4deg]"
              card={{
                title: "Cinderclaws Drake",
                cost: "{2}{R}{R}",
                cardType: "creature",
                rarity: "mythic",
                colorIdentity: "red",
                artistCredit: "You",
              }}
            />
            <CardPreviewPlaceholder
              className="mt-12 rotate-[4deg]"
              card={{
                title: "Veilwarden Sage",
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
