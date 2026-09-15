import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { ownerExportStamp } from "@/lib/billing/entitlements";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { rowToPreviewData, type CardRowForBake } from "@/lib/cards/bake-core";
import { getPipOverrides } from "@/lib/pips/queries";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { buildTypeLine } from "@/lib/cards/card-display";
import { cardAccentColor, renderCardSocialImage } from "@/lib/og/card-social";

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
  // `?variant=social` returns the 1200×630 landscape composite used as the
  // card page's og:image; the default is the raw portrait card render.
  // (A `v` query param may also be present purely as a CDN cache-buster —
  // the page metadata stamps it from `updated_at` so edited cards re-unfurl.)
  const social = request.nextUrl.searchParams.get("variant") === "social";

  let card;
  try {
    const supabase = await createClient();
    // Defense-in-depth: RLS already blocks anonymous reads of private cards,
    // but the OG endpoint is the canonical og:image target — once a URL is
    // public it gets crawled / cached by social platforms. If a card was
    // public, got indexed, then flipped to private, we don't want this route
    // (or its CDN tier) to keep rendering the private content. Restrict the
    // query to publicly-shareable visibility states so the *owner* hitting
    // this URL from their own session still can't render a private card's
    // OG image.
    const { data } = await supabase
      .from("cards")
      .select("*")
      .eq("id", id)
      .in("visibility", ["public", "unlisted"])
      .maybeSingle();
    card = data;
  } catch {
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  if (!card) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const profileOverrides = await getFrameProfileOverrides();
  // The shared row → render-input mapper (same as the bake), so the social
  // image carries the set icon, design watermark, face content and back face.
  const previewData = rowToPreviewData(
    card as CardRowForBake,
    await getPipOverrides(card.owner_id),
    profileOverrides,
  );

  // OG previews follow the card OWNER's plan — a paid creator's shared cards
  // render clean (with their optional custom footer mark), a free creator's
  // carry the brand mark. Owner-based (never viewer-based) keeps the route
  // CDN-cacheable: scrapers have no viewer.
  const stamp = await ownerExportStamp(card.owner_id);
  const response = await renderCardImage(previewData, preset, {
    brandMark: stamp.brandMark,
    watermarkText: stamp.footerText,
  });

  if (social) {
    return renderSocialComposite(card, previewData, response);
  }

  response.headers.set("Cache-Control", CACHE_HEADER);
  response.headers.set("Content-Disposition", `inline; filename="${card.slug}.png"`);
  return response;
}

// ---------------------------------------------------------------------------
// Social composite: the portrait render embedded whole on a 1200×630
// branded canvas (see lib/og/card-social.tsx for why). Re-encoded to JPEG —
// WhatsApp drops previews over 600 KB and the portrait PNG alone is ~780 KB;
// the JPEG composite lands well under that.
// ---------------------------------------------------------------------------

type SocialCard = {
  slug: string;
  title: string;
  owner_id: string;
  supertype: string | null;
  card_type: string | null;
  subtypes: string[];
  color_identity: string[];
};

async function renderSocialComposite(
  card: SocialCard,
  previewData: CardPreviewData,
  portraitResponse: Response,
) {
  const portraitBytes = Buffer.from(await portraitResponse.arrayBuffer());
  const cardImageDataUri = `data:image/png;base64,${portraitBytes.toString("base64")}`;

  let creatorHandle: string | null = null;
  try {
    const supabase = await createClient();
    const { data: owner } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", card.owner_id)
      .maybeSingle();
    creatorHandle = owner?.username ?? null;
  } catch {
    // Composite still renders without the handle.
  }

  const composite = renderCardSocialImage({
    title: card.title,
    typeLine: buildTypeLine({
      supertype: card.supertype,
      cardType: previewData.cardType,
      subtypes: card.subtypes,
    }),
    creatorHandle,
    cardImageDataUri,
    accent: cardAccentColor(card.color_identity),
  });

  const jpeg = await sharp(Buffer.from(await composite.arrayBuffer()))
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  return new NextResponse(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": CACHE_HEADER,
      "Content-Disposition": `inline; filename="${card.slug}-social.jpg"`,
    },
  });
}
