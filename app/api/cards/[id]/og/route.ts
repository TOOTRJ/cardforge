import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isLandscapeRender,
  renderCardImage,
  type RenderPreset,
} from "@/lib/render/card-image";
import { fetchStoredRender, fitStoredRender } from "@/lib/render/stored-render";
import { isBillingEnabled } from "@/lib/billing/flags";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { rowToPreviewData, type CardRowForBake } from "@/lib/cards/bake-core";
import { getPipOverrides } from "@/lib/pips/queries";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { buildTypeLine } from "@/lib/cards/card-display";
import { cardAccentColor, renderCardSocialImage } from "@/lib/og/card-social";

// Cache aggressively at the CDN — the response is pure of card row + URL
// query. The bare URL keeps a short window so an edit shows within minutes;
// a `?v=` URL (the card page and oEmbed stamp it from `updated_at`) is
// self-versioning, so it can sit at the CDN for a day and stay warm for a
// week — every crawler re-fetch past the old 10-minute window used to be a
// fresh Satori render.
const CACHE_HEADER =
  "public, max-age=60, s-maxage=600, stale-while-revalidate=86400";
const VERSIONED_CACHE_HEADER =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

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
  const cacheHeader = request.nextUrl.searchParams.has("v")
    ? VERSIONED_CACHE_HEADER
    : CACHE_HEADER;

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

  // The share image is a DISPLAY surface: always watermarked, no custom
  // footer text (layout v20) — the same contract as the stored bake, so
  // when that bake is current we serve (or 2× downscale) its bytes instead
  // of re-running Satori (lib/render/stored-render.ts). Viewer-independent
  // by construction, which keeps the route CDN-cacheable.
  const stored = await fetchStoredRender(card);
  let portraitBytes: Buffer;
  if (stored) {
    portraitBytes = await fitStoredRender(stored, preset, isLandscapeRender(previewData));
  } else {
    const response = await renderCardImage(previewData, preset, {
      brandMark: isBillingEnabled(),
      watermarkText: null,
    });
    portraitBytes = Buffer.from(await response.arrayBuffer());
  }

  if (social) {
    return renderSocialComposite(card, previewData, portraitBytes, cacheHeader);
  }

  return new NextResponse(new Uint8Array(portraitBytes), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": cacheHeader,
      "Content-Disposition": `inline; filename="${card.slug}.png"`,
    },
  });
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
  portraitBytes: Buffer,
  cacheHeader: string,
) {
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
      "Cache-Control": cacheHeader,
      "Content-Disposition": `inline; filename="${card.slug}-social.jpg"`,
    },
  });
}
