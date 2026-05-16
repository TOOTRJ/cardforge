import { NextResponse, type NextRequest } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
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

// ---------------------------------------------------------------------------
// /api/cards/[id]/png — Download a rendered PNG of a card
//
// Mirrors the visibility model of /api/cards/[id]/pdf and /og: public cards
// are CDN-cacheable, unlisted cards require the link (no cache), private
// cards require the owner. Returns the rendered card image with a
// Content-Disposition: attachment header so browsers offer it as a file
// download rather than rendering inline (the OG route is inline by design,
// this route is download by design).
//
// Query params:
//   ?preset=hd       → 1500×2100 (default, suitable for print)
//   ?preset=default  → 750×1050 (smaller, for sharing)
// ---------------------------------------------------------------------------

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
  const preset: RenderPreset = presetParam === "default" ? "default" : "hd";

  let card: Awaited<ReturnType<typeof fetchCard>>;
  try {
    card = await fetchCard(id);
  } catch {
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  if (!card) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (card.visibility === "private") {
    const user = await getCurrentUser();
    if (!user || user.id !== card.owner_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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

  let pngBytes: Uint8Array;
  try {
    const imgResponse = renderCardImage(previewData, preset);
    pngBytes = new Uint8Array(await imgResponse.arrayBuffer());
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Render error";
    return NextResponse.json(
      { error: `Render failed: ${detail}` },
      { status: 500 },
    );
  }

  const cacheControl =
    card.visibility === "public"
      ? "public, max-age=60, s-maxage=600, stale-while-revalidate=86400"
      : "private, no-store";

  return new NextResponse(Buffer.from(pngBytes), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${card.slug}.png"`,
      "Content-Length": String(pngBytes.byteLength),
      "Cache-Control": cacheControl,
    },
  });
}

async function fetchCard(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cards")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data;
}
