import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarketingHero } from "@/components/marketing/marketing-hero";
import { FeatureGrid } from "@/components/marketing/feature-grid";
import { CardPreviewPlaceholder } from "@/components/cards/card-preview-placeholder";
import { Button } from "@/components/ui/button";

const galleryPreview = [
  {
    title: "Sablethorn Pact",
    cost: "{2}{B}{B}",
    cardType: "enchantment" as const,
    rarity: "rare" as const,
    colorIdentity: "black" as const,
    artistCredit: "Anya Vale",
  },
  {
    title: "Verdant Reliquary",
    cost: "{1}{G}",
    cardType: "artifact" as const,
    rarity: "uncommon" as const,
    colorIdentity: "green" as const,
    artistCredit: "K. Mori",
  },
  {
    title: "Stormbound Herald",
    cost: "{2}{U}{R}",
    cardType: "creature" as const,
    rarity: "mythic" as const,
    colorIdentity: "multicolor" as const,
    artistCredit: "Lior Zane",
  },
  {
    title: "Quiet Pilgrim",
    cost: "{W}",
    cardType: "creature" as const,
    rarity: "common" as const,
    colorIdentity: "white" as const,
    artistCredit: "P. Rook",
  },
];

export default function HomePage() {
  return (
    <>
      <MarketingHero />
      <FeatureGrid />

      <section className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Gallery preview
            </span>
            <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Cards from the community
            </h2>
            <p className="max-w-2xl text-base leading-7 text-muted">
              Placeholder previews showcase the layout for the public gallery you’ll
              fill with real cards in the coming phases.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/gallery">
              View gallery
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {galleryPreview.map((card) => (
            <CardPreviewPlaceholder key={card.title} card={card} />
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-frame border border-border bg-linear-to-br from-surface via-surface to-elevated p-10 sm:p-14">
          <div className="absolute inset-0 bg-radial-glow" aria-hidden />
          <div className="relative flex flex-col items-start gap-5">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Ready to forge your first card?
            </h2>
            <p className="max-w-xl text-base leading-7 text-muted">
              Phase 1 ships the foundation. The full editor, auth, and exports
              arrive in the phases ahead. You can already explore the navigation
              and layout shell today.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/create">Open the creator</Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <Link href="/dashboard">Visit the dashboard</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
