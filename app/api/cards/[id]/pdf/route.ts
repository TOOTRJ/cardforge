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
  type FrameStyle,
  type Rarity,
} from "@/types/card";
import { renderCardImage } from "@/lib/render/card-image";
import { getEntitlements } from "@/lib/billing/entitlements";
import { buildCardPdf, type PdfLayout } from "@/lib/render/card-pdf";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getPipOverrides } from "@/lib/pips/queries";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";

// ---------------------------------------------------------------------------
// /api/cards/[id]/pdf — Print-ready PDF download
//
// Query params (current):
//   ?layout=card                  → single card on a 2.5"×3.5" page (default)
//   ?layout=sheet&paper=letter    → 9-up US Letter sheet with crop marks
//   ?layout=sheet&paper=a4        → 9-up A4 sheet with crop marks
//
// Legacy alias (preserved for existing share/embed links):
//   ?sheet=true                   ≡ ?layout=sheet&paper=letter
//
// Auth / visibility rules (mirrors the OG image route):
//   - public cards    → accessible to everyone, cached at CDN
//   - unlisted cards  → accessible to anyone with the link (no CDN cache)
//   - private cards   → only the owning user can download
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

  const params2 = request.nextUrl.searchParams;
  const sheetParam = params2.get("sheet");
  const layoutParam = params2.get("layout");
  const paperParam = params2.get("paper");

  // Resolve the effective layout. Order of precedence:
  //   1. ?layout=<value> when valid
  //   2. legacy ?sheet=true → sheet
  //   3. default: single card
  let layout: PdfLayout = "card";
  if (layoutParam === "card") {
    layout = "card";
  } else if (layoutParam === "sheet" || layoutParam === "sheet-letter" || layoutParam === "sheet-a4") {
    layout = layoutParam;
  } else if (sheetParam === "true") {
    layout = "sheet";
  }

  // Paper only applies to sheet layouts; mirror it onto the layout name
  // so card-pdf.ts only has to look at one parameter.
  if ((layout === "sheet" || layout === "sheet-letter") && paperParam === "a4") {
    layout = "sheet-a4";
  } else if (layout === "sheet" && paperParam === "letter") {
    layout = "sheet-letter";
  }

  // Fetch the card row (RLS applies — anon can read public/unlisted).
  let card: Awaited<ReturnType<typeof fetchCard>>;
  try {
    card = await fetchCard(id);
  } catch {
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  if (!card) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // For private cards: require the current user to be the owner.
  if (card.visibility === "private") {
    const user = await getCurrentUser();
    if (!user || user.id !== card.owner_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // PDF export is a paid (Plus+) feature — clean, print-ready output; sheet
  // layouts (3×3) are Pro. Enforced here as defense-in-depth; the download UI
  // hides these options for free users.
  const entitlements = await getEntitlements();
  if (!entitlements.isPaid) {
    return NextResponse.json(
      {
        error: "PDF export is a Plus feature. Upgrade to download print-ready PDFs.",
        code: "UPGRADE_REQUIRED",
      },
      { status: 403 },
    );
  }
  if (layout !== "card" && !entitlements.allowBatchExport) {
    return NextResponse.json(
      { error: "Sheet layouts are a Pro feature.", code: "UPGRADE_REQUIRED" },
      { status: 403 },
    );
  }

  // Build the CardPreviewData shape the renderer expects.
  const profileOverrides = await getFrameProfileOverrides();
  const previewData: CardPreviewData = {
    profileOverrides,
    pipOverrides: await getPipOverrides(card.owner_id),
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
    // Pass the persisted frame style through so printed PDFs use the card's
    // actual frame template + finish (previously hard-coded to {}).
    frameStyle: (card.frame_style as FrameStyle) ?? {},
  };

  // Render PNG at HD quality (1500×2100) for crisp print output.
  let pngBytes: Uint8Array;
  try {
    const imgResponse = renderCardImage(previewData, "hd", {
      watermark: !entitlements.removeWatermark,
    });
    pngBytes = new Uint8Array(await imgResponse.arrayBuffer());
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Render error";
    return NextResponse.json(
      { error: `Render failed: ${detail}` },
      { status: 500 },
    );
  }

  // Build the PDF.
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildCardPdf(pngBytes, layout, card.title);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "PDF error";
    return NextResponse.json(
      { error: `PDF generation failed: ${detail}` },
      { status: 500 },
    );
  }

  const filename =
    layout === "sheet-a4"
      ? `${card.slug}-sheet-a4.pdf`
      : layout === "sheet" || layout === "sheet-letter"
        ? `${card.slug}-sheet.pdf`
        : `${card.slug}.pdf`;

  // PDFs are entitlement-scoped downloads — never shared-cache them.
  const cacheControl = "private, no-store";

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdfBytes.byteLength),
      "Cache-Control": cacheControl,
    },
  });
}

// ---------------------------------------------------------------------------
// DB fetch — extracted so it's easy to mock in tests later.
// ---------------------------------------------------------------------------

async function fetchCard(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cards")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data;
}
