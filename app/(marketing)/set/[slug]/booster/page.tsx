import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSetBySlugPublic, listCardsInSet } from "@/lib/sets/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { BoosterViewer } from "@/components/sets/booster-viewer";
import type { ArtPosition, FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// /set/[slug]/booster — Virtual booster pack page
//
// Fetches the set and its cards server-side, then hands a serialized subset
// to the client-side BoosterViewer component for the reveal experience.
// Cards are sampled following an approximation of MTG booster distribution:
//   - 1 rare or mythic
//   - 3 uncommons
//   - up to 11 commons
//   - total capped at 15 cards (or the full set if smaller)
// ---------------------------------------------------------------------------

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isSupabaseConfigured()) return { title: "Booster Pack" };
  const set = await getSetBySlugPublic(slug);
  if (!set) return { title: "Booster Pack" };
  return {
    title: `Open a ${set.title} Booster`,
    description: `Crack a virtual booster pack from the ${set.title} set on Spellwright. See which cards you pull!`,
  };
}

// MTG-style booster distribution — approximate.
const BOOSTER_SIZE = 15;
const RARE_MYTHIC_SLOTS = 1;
const UNCOMMON_SLOTS = 3;

function sampleBooster(
  cards: Array<{
    id: string;
    title: string;
    cost: string | null;
    card_type: string | null;
    supertype: string | null;
    subtypes: string[];
    rarity: string | null;
    color_identity: string[];
    rules_text: string | null;
    flavor_text: string | null;
    power: string | null;
    toughness: string | null;
    loyalty: string | null;
    defense: string | null;
    artist_credit: string | null;
    art_url: string | null;
    art_position: unknown;
    frame_style: unknown;
    slug: string;
  }>,
): typeof cards {
  if (cards.length <= BOOSTER_SIZE) return shuffle(cards);

  const rareMythic = cards.filter(
    (c) => c.rarity === "rare" || c.rarity === "mythic",
  );
  const uncommons = cards.filter((c) => c.rarity === "uncommon");
  const commons = cards.filter(
    (c) => c.rarity === "common" || !c.rarity,
  );

  const booster: typeof cards = [];

  // Rare / mythic slot
  const rarePool = shuffle(rareMythic);
  booster.push(...rarePool.slice(0, RARE_MYTHIC_SLOTS));

  // Uncommon slots — fill from uncommons, fallback to rare/mythic
  const uncommonPool = shuffle(uncommons);
  booster.push(...uncommonPool.slice(0, UNCOMMON_SLOTS));

  // Common slots — fill remaining up to BOOSTER_SIZE
  const remaining = BOOSTER_SIZE - booster.length;
  const commonPool = shuffle(commons);
  booster.push(...commonPool.slice(0, remaining));

  // If we still don't have enough, pad from the full set
  if (booster.length < BOOSTER_SIZE) {
    const usedIds = new Set(booster.map((c) => c.id));
    const leftovers = shuffle(cards.filter((c) => !usedIds.has(c.id)));
    booster.push(...leftovers.slice(0, BOOSTER_SIZE - booster.length));
  }

  // Booster reveals commons first, rare last (like a real pack)
  return booster.reverse();
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async function BoosterPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  if (!isSupabaseConfigured()) notFound();

  const set = await getSetBySlugPublic(slug);
  if (!set) notFound();

  const items = await listCardsInSet(set.id);
  const allCards = items.map((item) => item.card);

  if (allCards.length === 0) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <p className="text-muted">
          This set has no cards yet — add some before opening a booster.
        </p>
        <Link
          href={`/set/${slug}`}
          className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to {set.title}
        </Link>
      </div>
    );
  }

  // Serialise only the fields the viewer needs (avoids passing the full card
  // object which has DB timestamps etc. that aren't serialisable cleanly).
  const boosterCards = sampleBooster(allCards).map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    cost: c.cost,
    cardType: c.card_type as Parameters<typeof BoosterViewer>[0]["cards"][number]["cardType"],
    supertype: c.supertype,
    subtypes: c.subtypes,
    rarity: c.rarity as Parameters<typeof BoosterViewer>[0]["cards"][number]["rarity"],
    colorIdentity: c.color_identity as Parameters<typeof BoosterViewer>[0]["cards"][number]["colorIdentity"],
    rulesText: c.rules_text,
    flavorText: c.flavor_text,
    power: c.power,
    toughness: c.toughness,
    loyalty: c.loyalty,
    defense: c.defense,
    artistCredit: c.artist_credit,
    artUrl: c.art_url,
    artPosition: c.art_position as ArtPosition,
    frameStyle: c.frame_style as FrameStyle,
  }));

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href={`/set/${slug}`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to {set.title}
      </Link>

      <BoosterViewer setTitle={set.title} cards={boosterCards} setSlug={slug} />
    </div>
  );
}
