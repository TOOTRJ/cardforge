import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isCardType,
  isColorIdentity,
  isRarity,
  type ArtPosition,
  type CardType,
  type ColorIdentity,
  type FrameStyle,
  type Rarity,
} from "@/types/card";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { getEntitlements } from "@/lib/billing/entitlements";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getPipOverrides } from "@/lib/pips/queries";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";

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
  const requestedPreset: RenderPreset =
    presetParam === "default" ? "default" : "hd";

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

  const pipOverrides = await getPipOverrides(card.owner_id);
  const profileOverrides = await getFrameProfileOverrides();
  const previewData: CardPreviewData = {
    pipOverrides,
    profileOverrides,
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
    // Pass the persisted frame style through so downloaded PNGs use the card's
    // actual frame template + finish (previously hard-coded to {}, which forced
    // every download back to the default frame).
    frameStyle: (card.frame_style as FrameStyle) ?? {},
  };

  // The CURRENT viewer's entitlement decides watermark + max resolution.
  // Free: watermarked + capped to "default". Paid: clean + the requested preset.
  const entitlements = await getEntitlements();
  const preset: RenderPreset =
    entitlements.maxExportPreset === "hd" ? requestedPreset : "default";
  const watermark = !entitlements.removeWatermark;

  // Output varies by the authenticated viewer's entitlement (watermark +
  // resolution), so it must NOT be shared-cached at the CDN — that would leak a
  // clean render to a free viewer (or a watermarked one to a paid viewer).
  // PRIVATE caching with mandatory revalidation is fine though, and it's
  // what makes the 304 path below work for repeat downloads.
  const cacheControl = "private, max-age=0, must-revalidate";

  // The render is fully determined by the card row (updated_at), the
  // owner's pip overrides, the renderer version, and the viewer's
  // preset/watermark pair — fold them all into a weak ETag so a repeat
  // download of an unchanged card short-circuits to a 304 BEFORE the
  // expensive Satori render.
  const etag = `W/"${createHash("sha1")
    .update(
      [
        card.id,
        card.updated_at,
        preset,
        watermark ? "wm" : "clean",
        CARD_LAYOUT_VERSION,
        JSON.stringify(pipOverrides ?? null),
        // Frame-layout overrides change baked geometry without a code
        // deploy — fingerprint the active template's override.
        JSON.stringify(
          profileOverrides[
            (previewData.frameStyle?.template as string) ?? ""
          ] ?? null,
        ),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 27)}"`;

  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }

  let pngBytes: Uint8Array;
  try {
    const imgResponse = renderCardImage(previewData, preset, {
      brandMark: watermark,
    });
    pngBytes = new Uint8Array(await imgResponse.arrayBuffer());
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Render error";
    return NextResponse.json(
      { error: `Render failed: ${detail}` },
      { status: 500 },
    );
  }

  return new NextResponse(Buffer.from(pngBytes), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${card.slug}.png"`,
      "Content-Length": String(pngBytes.byteLength),
      "Cache-Control": cacheControl,
      ETag: etag,
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
