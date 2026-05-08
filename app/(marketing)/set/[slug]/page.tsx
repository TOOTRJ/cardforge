import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CardPreviewPlaceholder } from "@/components/cards/card-preview-placeholder";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug.replace(/-/g, " ") };
}

const setCards = Array.from({ length: 6 }, (_, i) => ({
  id: String(i),
  slug: `placeholder-card-${i + 1}`,
  title: `Placeholder Card ${i + 1}`,
  cost: i % 2 ? "{1}{G}" : "{2}{B}",
  cardType: (i % 3 === 0 ? "creature" : i % 3 === 1 ? "spell" : "artifact") as
    | "creature"
    | "spell"
    | "artifact",
  rarity: (i % 4 === 0 ? "common" : i % 4 === 1 ? "uncommon" : i % 4 === 2 ? "rare" : "mythic") as
    | "common"
    | "uncommon"
    | "rare"
    | "mythic",
  colorIdentity: (["green", "black", "blue", "red", "white"] as const)[i % 5],
}));

export default async function SetDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const title = slug
    .split("-")
    .map((s) => s[0]?.toUpperCase() + s.slice(1))
    .join(" ");

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/sets"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to sets
      </Link>

      <PageHeader
        eyebrow="Set"
        title={title}
        description="A placeholder custom set. The set creator and add/remove flows arrive in the Sets phase."
        actions={
          <>
            <Badge variant="primary">{setCards.length} cards</Badge>
            <Button asChild variant="outline">
              <Link href="/create">Add card</Link>
            </Button>
          </>
        }
      />

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {setCards.map((card) => (
          <Link key={card.id} href={`/card/${card.slug}`} className="block">
            <CardPreviewPlaceholder card={card} />
          </Link>
        ))}
      </div>
    </div>
  );
}
