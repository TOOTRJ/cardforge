import { NextResponse, type NextRequest } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  ownerExportStamp,
  requireTier,
  UpgradeRequiredError,
} from "@/lib/billing/entitlements";
import { isSetsEnabled } from "@/lib/sets/flags";
import { renderCardImage } from "@/lib/render/card-image";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { buildSetPdf } from "@/lib/render/card-pdf";
import {
  isCardType,
  isColorIdentity,
  isRarity,
  type ArtPosition,
  type CardBackFace,
  type CardType,
  type ColorIdentity,
  type FrameStyle,
  type Rarity,
} from "@/types/card";
import type { Card as CardRow } from "@/types/supabase";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// /api/sets/[id]/export — Pro "whole-set export".
//
// Renders every card in the owner's set (clean, hi-res for Pro) and returns a
// single multi-page PDF (one card per page). Owner-only; capped to keep the
// serverless render time bounded.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_SET_EXPORT_CARDS = 60;

type RouteParams = { id: string };

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<RouteParams> },
) {
  if (!isSetsEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid set id" }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to export a set." }, { status: 401 });
  }

  // Pro-only feature.
  let entitlements;
  try {
    entitlements = await requireTier("pro");
  } catch (error) {
    if (error instanceof UpgradeRequiredError) {
      return NextResponse.json(
        { error: "Whole-set export is a Pro feature.", code: "UPGRADE_REQUIRED" },
        { status: 403 },
      );
    }
    throw error;
  }

  const supabase = await createClient();

  const { data: set } = await supabase
    .from("card_sets")
    .select("id, slug, title, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (!set) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (set.owner_id !== user.id) {
    return NextResponse.json({ error: "Not your set." }, { status: 403 });
  }

  const { data: items } = await supabase
    .from("card_set_items")
    .select("card_id, position")
    .eq("set_id", id)
    .order("position", { ascending: true });
  const orderedIds = (items ?? [])
    .map((row) => row.card_id)
    .slice(0, MAX_SET_EXPORT_CARDS);
  if (orderedIds.length === 0) {
    return NextResponse.json({ error: "This set has no cards." }, { status: 404 });
  }

  const { data: cards } = await supabase
    .from("cards")
    .select("*")
    .in("id", orderedIds);
  const byId = new Map((cards ?? []).map((card) => [card.id, card]));

  // The set owner's custom footer mark (paid perk) prints on the renders.
  const stamp = await ownerExportStamp(set.owner_id);

  const pngs: Uint8Array[] = [];
  for (const cardId of orderedIds) {
    const card = byId.get(cardId);
    if (!card) continue;
    try {
      const img = renderCardImage(
        { ...toPreviewData(card), profileOverrides: await getFrameProfileOverrides() },
        "hd", {
        brandMark: !entitlements.removeWatermark,
        watermarkText: stamp.footerText,
      });
      pngs.push(new Uint8Array(await img.arrayBuffer()));
    } catch {
      // Skip a single card that fails to render rather than failing the export.
    }
  }
  if (pngs.length === 0) {
    return NextResponse.json({ error: "Render failed." }, { status: 500 });
  }

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildSetPdf(pngs, set.title);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "PDF error";
    return NextResponse.json(
      { error: `PDF generation failed: ${detail}` },
      { status: 500 },
    );
  }

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${set.slug}.pdf"`,
      "Content-Length": String(pdfBytes.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

function toPreviewData(card: CardRow): CardPreviewData {
  return {
    title: card.title,
    cost: card.cost,
    cardType: isCardType(card.card_type) ? (card.card_type as CardType) : null,
    supertype: card.supertype,
    subtypes: card.subtypes,
    rarity: isRarity(card.rarity) ? (card.rarity as Rarity) : null,
    colorIdentity: (card.color_identity ?? []).filter(
      isColorIdentity,
    ) as ColorIdentity[],
    rulesText: card.rules_text,
    flavorText: card.flavor_text,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    defense: card.defense,
    artistCredit: card.artist_credit,
    artUrl: card.art_url,
    artPosition: (card.art_position as ArtPosition) ?? {},
    frameStyle: (card.frame_style as FrameStyle) ?? {},
    setIconUrl: card.set_icon_url,
    setIconCode: card.set_icon_code,
    backFace: (card.back_face as CardBackFace | null) ?? null,
  };
}
