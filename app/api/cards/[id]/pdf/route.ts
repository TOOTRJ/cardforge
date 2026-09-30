import { NextResponse, type NextRequest } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { recordActivity } from "@/lib/analytics/funnel-server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { renderCardPrint } from "@/lib/render/card-print";
import { parseBleedParam } from "@/lib/cards/print-export";
import {
  downloadBrandMark,
  getEntitlements,
  ownerExportStamp,
} from "@/lib/billing/entitlements";
import { buildCardPdf, type PdfLayout } from "@/lib/render/card-pdf";
import { rowToPreviewData, type CardRowForBake } from "@/lib/cards/bake-core";
import { getPipOverrides } from "@/lib/pips/queries";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { isUuid } from "@/lib/ids";

// ---------------------------------------------------------------------------
// /api/cards/[id]/pdf — Print-ready PDF download
//
// Query params (current):
//   ?layout=card                  → single card on a 2.5"×3.5" page (default)
//   ?layout=sheet&paper=letter    → 9-up US Letter sheet with crop marks
//   ?layout=sheet&paper=a4        → 9-up A4 sheet with crop marks
//   ?layout=card&bleed=1          → single card WITH a 1/8" bleed (TODO 6.1a):
//                                   a 2.75"×3.75" bleed box on a page with a
//                                   1/4" slug, crop marks on the trim lines,
//                                   TrimBox + BleedBox set. Single card only
//                                   (a sheet with bleed → 400; 6.15).
//
// Every PDF renders through the PRINT path (lib/render/card-print.ts, TODO
// 6.10): square corners, the art composited at full resolution under the
// HD layout — never the art's 1600 px inline copy.
//
// Legacy alias (preserved for existing share/embed links):
//   ?sheet=true                   ≡ ?layout=sheet&paper=letter
//
// Auth / visibility (mirrors the OG image route for WHO may see the card):
//   - public / unlisted cards → any viewer with the link
//   - private cards           → only the owning user
// but the PDF itself is a paid export: Plus+ for single cards, Pro for sheet
// layouts (enforced below). Responses are entitlement-scoped, so they are
// never shared-cached (Cache-Control: private, no-store).
// ---------------------------------------------------------------------------

type RouteParams = { id: string };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<RouteParams> },
) {
  const { id } = await params;

  if (!isUuid(id)) {
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
  const bleed = parseBleedParam(params2.get("bleed"));

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

  // The bleed is laid out for the single-card page only (TODO 6.1a); a 3×3
  // bleed sheet doesn't fit US Letter (8.25" × 11.25") — sheet options are
  // TODO 6.15.
  if (bleed && layout !== "card") {
    return NextResponse.json(
      { error: "Bleed is available on the single-card PDF only." },
      { status: 400 },
    );
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

  // The shared row → render-input mapper (same as the bake), so the print
  // carries the set icon, design watermark, face content and back face.
  const profileOverrides = await getFrameProfileOverrides();
  const previewData = rowToPreviewData(
    card as CardRowForBake,
    await getPipOverrides(card.owner_id),
    profileOverrides,
  );

  // The print source is the HD (1500×2100, 600 ppi) layout through the print
  // path (full-resolution art — TODO 6.10), plus the bleed when asked. The
  // stored bake is the always-watermarked display copy (layout v20); a PDF
  // is a paid feature and therefore clean, so it always renders live.
  const stamp = await ownerExportStamp(card.owner_id);
  const footerText = stamp.brandMark
    ? null
    : ((card as { footer_text?: string | null }).footer_text ?? stamp.footerText) || null;
  // The brand mark follows the VIEWER's plan only — see the png route. (PDF
  // is a paid feature, so this is always false; the rule is spelled out here
  // so the two routes can't drift.)
  const brandMark = downloadBrandMark(entitlements);
  let pngBytes: Uint8Array;
  try {
    // Print is always SQUARE (TODO 3.26): the card page and the 3×3 sheets
    // are cut along the rectangle and its crop marks, and the corner outside
    // the arc prints in the card's border colour (the border black, #101015
    // on a ring — lib/frames/square-corners.ts), never transparent. The
    // print path squares every render it makes.
    pngBytes = new Uint8Array(
      await renderCardPrint(previewData, {
        ppi: 600,
        bleed,
        brandMark,
        watermarkText: footerText,
      }),
    );
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
    pdfBytes = await buildCardPdf(pngBytes, layout, card.title, { bleed });
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
        : bleed
          ? `${card.slug}-bleed.pdf`
          : `${card.slug}.pdf`;

  // PDFs are entitlement-scoped downloads — never shared-cache them.
  const cacheControl = "private, no-store";

  // Funnel: a download (and, once per user, first_download) — signed-in
  // viewers only; anonymous downloads of public cards aren't attributed.
  const viewer = await getCurrentUser();
  if (viewer && isAdminConfigured()) {
    await recordActivity(createAdminClient(), {
      userId: viewer.id,
      kind: "download",
      props: { format: "pdf", layout: bleed ? `${layout}-bleed` : layout },
    });
  }

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
