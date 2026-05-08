import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { CardPreviewPlaceholder } from "@/components/cards/card-preview-placeholder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CardPreview } from "@/types";

export const metadata: Metadata = {
  title: "Gallery",
  description: "Browse public custom cards forged by the CardForge community.",
};

const galleryCards: CardPreview[] = [
  { id: "1", slug: "emberbound-wyrm", title: "Emberbound Wyrm", cost: "{3}{R}{R}", cardType: "creature", rarity: "mythic", colorIdentity: "red", artistCredit: "Anya Vale" },
  { id: "2", slug: "tideglass-oracle", title: "Tideglass Oracle", cost: "{1}{U}{U}", cardType: "creature", rarity: "rare", colorIdentity: "blue", artistCredit: "K. Mori" },
  { id: "3", slug: "sablethorn-pact", title: "Sablethorn Pact", cost: "{2}{B}{B}", cardType: "enchantment", rarity: "rare", colorIdentity: "black", artistCredit: "Lior Zane" },
  { id: "4", slug: "verdant-reliquary", title: "Verdant Reliquary", cost: "{1}{G}", cardType: "artifact", rarity: "uncommon", colorIdentity: "green", artistCredit: "P. Rook" },
  { id: "5", slug: "stormbound-herald", title: "Stormbound Herald", cost: "{2}{U}{R}", cardType: "creature", rarity: "mythic", colorIdentity: "multicolor", artistCredit: "M. Ito" },
  { id: "6", slug: "quiet-pilgrim", title: "Quiet Pilgrim", cost: "{W}", cardType: "creature", rarity: "common", colorIdentity: "white", artistCredit: "Anya Vale" },
  { id: "7", slug: "shardlight-rite", title: "Shardlight Rite", cost: "{X}{W}", cardType: "spell", rarity: "rare", colorIdentity: "white", artistCredit: "K. Mori" },
  { id: "8", slug: "duskwater-haven", title: "Duskwater Haven", cost: "—", cardType: "land", rarity: "uncommon", colorIdentity: "colorless", artistCredit: "Lior Zane" },
];

const filters = ["All", "Creature", "Spell", "Artifact", "Enchantment", "Land", "Token"];

export default function GalleryPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Public"
        title="Community gallery"
        description="Discover custom cards forged by the CardForge community. Search, filter, and remix your favorites once accounts ship in a later phase."
        actions={
          <Button asChild>
            <Link href="/create">Forge your own</Link>
          </Button>
        }
      />

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            placeholder="Search cards (placeholder)"
            disabled
            className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-muted placeholder:text-subtle focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {filters.map((filter) => (
            <Badge key={filter} variant={filter === "All" ? "primary" : "outline"}>
              {filter}
            </Badge>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {galleryCards.map((card) => (
          <Link
            key={card.id}
            href={`/card/${card.slug}`}
            className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-frame"
          >
            <CardPreviewPlaceholder card={card} />
          </Link>
        ))}
      </div>
    </div>
  );
}
