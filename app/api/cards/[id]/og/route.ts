import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isCardType,
  isColorIdentity,
  isRarity,
  type ArtPosition,
  type CardType,
  type ColorIdentity,
  type Rarity,
} from "@/types/card";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import type { CardPreviewData } from "@/components/cards/card-preview";

// Cache aggressively at the CDN — the renderer is pure of card row + URL
// query (preset). When a card is edited, its `updated_at` changes; we don't
// include that in the URL so the CDN cache can serve up to s-maxage seconds
// of stale content. Browsers re-validate every 60s.
const CACHE_HEADER =
  "public, max-age=60, s-maxage=600, stale-while-revalidate=86400";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteParams = { id: string };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> },
) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid card id" }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 },
    );
  }

  const presetParam = request.nextUrl.searchParams.get("preset");
  const preset: RenderPreset = presetParam === "hd" ? "hd" : "default";

  let card;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("cards")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    card = data;
  } catch {
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  if (!card) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const previewData: CardPreviewData = {
    title: card.title,
    cost: card.cost,
    cardType: isCardType(card.card_type) ? (card.card_type as CardType) : null,
    supertype: card.supertype,
    subtypes: card.subtypes,
    rarity: isRarity(card.rarity) ? (card.rarity as Rarity) : null,
    colorIdentity: card.color_identity.filter(isColorIdentity) as ColorIdentity[],
    rulesText: card.rules_text,
    flavorText: card.flavor_text,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    defense: card.defense,
    artistCredit: card.artist_credit,
    artUrl: card.art_url,
    artPosition: (card.art_position as ArtPosition) ?? {},
    frameStyle: {},
  };

  const response = renderCardImage(previewData, preset);
  response.headers.set("Cache-Control", CACHE_HEADER);
  response.headers.set("Content-Disposition", `inline; filename="${card.slug}.png"`);
  return response;
}
