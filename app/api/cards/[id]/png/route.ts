import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { recordActivity } from "@/lib/analytics/funnel-server";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isLandscapeRender,
  renderCardImage,
  squareCornerFillsOf,
  type RenderPreset,
} from "@/lib/render/card-image";
import {
  fetchStoredRender,
  fitStoredRender,
  flattenStoredCorners,
} from "@/lib/render/stored-render";
import { parseCornersParam } from "@/lib/cards/output-corners";
import {
  cardImageFilename,
  effectiveCorners,
  parseFormatParam,
} from "@/lib/cards/output-format";
import { encodeCardJpeg } from "@/lib/render/card-jpeg";
import { renderCardPrint } from "@/lib/render/card-print";
import {
  cardPrintFilename,
  isPrintRequest,
  parseBleedParam,
  parsePpiParam,
  parsePrintParam,
  PRINT_800_PPI_PAID_ONLY,
} from "@/lib/cards/print-export";
import { checkAnonLiveRenderLimit } from "@/lib/cards/anon-render-limit";
import { rateLimitedResponse } from "@/lib/api/responses";
import {
  downloadBrandMark,
  getEntitlements,
  ownerExportStamp,
} from "@/lib/billing/entitlements";
import { rowToPreviewData, type CardRowForBake } from "@/lib/cards/bake-core";
import { getPipOverrides } from "@/lib/pips/queries";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { isUuid } from "@/lib/ids";

// ---------------------------------------------------------------------------
// /api/cards/[id]/png — Download a rendered PNG (or JPEG) of a card
//
// Visibility mirrors /api/cards/[id]/pdf and /og (public/unlisted readable
// by anyone with the link, private owner-only), but the BYTES vary by the
// viewer's plan (resolution clamp + brand mark), so every response is
// `private, must-revalidate` with an ETag — never shared-cached at the CDN.
// Returns the rendered card image with Content-Disposition: attachment so
// browsers offer it as a download (the OG route is inline by design).
//
// Query params:
//   ?preset=hd       → 1500×2100 (default; honored only when the viewer's
//                      plan allows HD — free viewers are clamped to default)
//   ?preset=default  → 750×1050 (smaller, for sharing)
//   ?corners=round   → the card's rounded corner, transparent outside the arc
//                      (TODO 3.26) — what the download modal asks for first
//   ?corners=square  → the full rectangle, opaque, the corner in the border
//                      black — for printing. ALSO THE DEFAULT when the
//                      request names none (lib/cards/output-corners.ts): a
//                      deck-export tab or link from before 3.26 keeps getting
//                      the square bytes it always got.
//   ?format=jpeg     → a JPEG (TODO 6.18): ALWAYS the square card — JPEG has
//                      no alpha — so `corners` is ignored; the Square PNG's
//                      bytes re-encoded (lib/render/card-jpeg.ts: quality 92,
//                      sRGB, no metadata), named <slug>.jpg. Any other or no
//                      `format` is the PNG, exactly as before
//                      (lib/cards/output-format.ts).
//   ?ppi=800         → PRINT (TODO 6.1b): 2000×2800, the HD layout drawn at
//                      800 ppi with the art at full resolution (lib/render/
//                      card-print.ts, TODO 6.10). `preset` is ignored.
//   ?bleed=1         → PRINT (TODO 6.1a): + 1/8" on every side (1650×2250 at
//                      600 ppi, 2200×3000 at 800), the frame's edges extended
//                      by their declared recipe (lib/frames/edge-contract.ts).
//                      A print render is ALWAYS square (`corners` is
//                      ignored), always live, PNG only (`format=jpeg` → 400),
//                      named <slug>-800ppi.png / -bleed.png /
//                      -800ppi-bleed.png, and follows the clean-download
//                      entitlement: a watermarked viewer asking for the bleed
//                      (or for 800 ppi while PRINT_800_PPI_PAID_ONLY) gets
//                      403 UPGRADE_REQUIRED. `ppi=600` alone is the plain HD
//                      download, as before (lib/cards/print-export.ts).
//   ?print=1         → PRINT (TODO 6.15): the print render even at 600 ppi
//                      without a bleed — 1500×2100, the art at full
//                      resolution — what the Pro exports print from (deck and
//                      selection PDFs, their HD ZIP images;
//                      lib/decks/export-client.ts). Square, live, PNG only,
//                      named <slug>-print.png; clean-download only (a
//                      watermarked viewer → 403 UPGRADE_REQUIRED whatever
//                      PRINT_800_PPI_PAID_ONLY says: a free image is 750 px).
//
// Every viewer may pick either corner. A FREE viewer's square PNG is the
// stored round bake squared with the corner fills a live square render
// uses (squareCornerFillsOf — the border black, or #101015 on a ring; a few
// ms of sharp), except where art or frame design runs into a corner (an
// art-to-edge frame; Bloomburrow, LOTR, Tarkir draconic): the downscaled
// bake no longer carries those pixels, so that renders live. A paid
// viewer's is a live square render. The file is <slug>-square.png. A JPEG
// follows the same tier rules on the same square bytes.
//
// A SIGNED-OUT caller's live renders are rate-limited per network (TODO 7.8,
// lib/cards/anon-render-limit.ts): over the limit a live render answers 429 +
// Retry-After. Stored-bake serves, 304s and signed-in viewers are never
// counted.
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

  const presetParam = request.nextUrl.searchParams.get("preset");
  const requestedPreset: RenderPreset =
    presetParam === "default" ? "default" : "hd";
  const format = parseFormatParam(request.nextUrl.searchParams.get("format"));
  // A print render (800 ppi, the bleed, or `print`) — TODO 6.1a/6.1b/6.15.
  const print = {
    ppi: parsePpiParam(request.nextUrl.searchParams.get("ppi")),
    bleed: parseBleedParam(request.nextUrl.searchParams.get("bleed")),
    print: parsePrintParam(request.nextUrl.searchParams.get("print")),
  };
  const printMode = isPrintRequest(print);
  if (printMode && format === "jpeg") {
    return NextResponse.json(
      { error: "Print downloads (800 ppi, bleed) are PNG only." },
      { status: 400 },
    );
  }
  // A JPEG is always square; a PNG has the corner the request names — and
  // a print render is always square.
  const corners = printMode
    ? "square"
    : effectiveCorners(
        format,
        parseCornersParam(request.nextUrl.searchParams.get("corners")),
      );

  // The signed-in viewer, asked at most once: a private card's owner check,
  // a live render's anonymous limiter, and the funnel.
  let viewerLookup: ReturnType<typeof getCurrentUser> | undefined;
  const currentViewer = () => (viewerLookup ??= getCurrentUser());

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
    const user = await currentViewer();
    if (!user || user.id !== card.owner_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const pipOverrides = await getPipOverrides(card.owner_id);
  const profileOverrides = await getFrameProfileOverrides();
  // The ONE row → render-input mapper (shared with the save-time bake and
  // the admin rebake). A hand-rolled copy here used to drop the set icon,
  // the design watermark, structured face content and the back face, so a
  // downloaded PNG differed from the gallery render of the same card.
  const previewData = rowToPreviewData(
    card as CardRowForBake,
    pipOverrides,
    profileOverrides,
  );

  // Resolution AND the brand mark follow the VIEWER's plan: a free viewer
  // always downloads a watermarked, capped card — whoever made it — and a
  // paid viewer downloads clean HD (downloadBrandMark). The owner's stamp
  // only contributes their custom footer text, which prints on paid
  // downloads and nowhere else (display is always the plain mark).
  const entitlements = await getEntitlements();
  const preset: RenderPreset =
    entitlements.maxExportPreset === "hd" ? requestedPreset : "default";
  const stamp = await ownerExportStamp(card.owner_id);
  // This card's own footer mark (migration 0090) wins over the profile
  // default; "" means none. Only a paid owner's mark ever prints.
  const footerText = stamp.brandMark
    ? null
    : ((card as { footer_text?: string | null }).footer_text ?? stamp.footerText) || null;
  const watermark = downloadBrandMark(entitlements);

  // A print render follows the clean download's entitlement: the bleed
  // always, 800 ppi while PRINT_800_PPI_PAID_ONLY (the open 6.1b [decide]),
  // and the 600 ppi print render (`print`, the exports') always — a free
  // viewer's image is the 750 px one. So the ONLY print file a watermarked
  // viewer may have is the plain 800 ppi one, with the switch off.
  const freePrint = print.ppi === 800 && !print.bleed && !PRINT_800_PPI_PAID_ONLY;
  if (printMode && watermark && !freePrint) {
    return NextResponse.json(
      {
        error: print.bleed
          ? "Bleed downloads are a Plus feature."
          : print.ppi === 800
            ? "800 ppi downloads are a Plus feature."
            : "Print downloads are a Plus feature.",
        code: "UPGRADE_REQUIRED",
      },
      { status: 403 },
    );
  }

  // Output varies by the authenticated viewer's entitlement (watermark +
  // resolution), so it must NOT be shared-cached at the CDN — that would leak a
  // clean render to a free viewer (or a watermarked one to a paid viewer).
  // PRIVATE caching with mandatory revalidation is fine though, and it's
  // what makes the 304 path below work for repeat downloads.
  const cacheControl = "private, max-age=0, must-revalidate";

  // The render is fully determined by the card row (updated_at), the
  // owner's pip overrides, the renderer version, the requested corner and
  // the viewer's preset/watermark pair — fold them all into a weak ETag so a
  // repeat download of an unchanged card short-circuits to a 304 BEFORE the
  // expensive Satori render.
  const etag = `W/"${createHash("sha1")
    .update(
      [
        card.id,
        card.updated_at,
        // A watermarked download serves the stored bake, which a re-bake
        // replaces without touching updated_at (0108) — fold its stamps in
        // so a re-baked card never answers 304 with the old bytes.
        card.rendered_at ?? "",
        card.layout_version ?? "",
        preset,
        // Round and square are different bytes of the same card.
        corners,
        // …and so are a PNG and a JPEG. Folded in only for the JPEG, so every
        // PNG keeps the ETag it had (a repeat download still answers 304).
        ...(format === "jpeg" ? ["jpeg"] : []),
        // …and a print render (its own bytes; folded in only for one).
        ...(printMode ? [`print:${print.ppi}:${print.bleed ? "bleed" : "trim"}`] : []),
        watermark ? "wm" : "clean",
        // The owner's custom footer mark prints into the render — fold it in
        // so a changed mark busts the 304 path.
        footerText ?? "",
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

  let bytes: Uint8Array;
  try {
    let pngBytes: Uint8Array;
    // The stored bake is always watermarked with no footer text (layout
    // v20) — exactly what a FREE viewer downloads, so serve it (2×
    // downscaled) instead of re-rendering — lib/render/stored-render.ts.
    // It is served even when the owner hasn't accepted a newer (opt-in)
    // look, so the download matches the gallery image (TODO 0.21); only a
    // pending platform correction renders live. A paid viewer's clean
    // download has no stored source and always renders live with the
    // current layout (the download modal says so).
    //
    // The stored bake is ROUND (layout v31). A free square download
    // squares it with the live render's corner fills — unless a corner
    // keeps what was drawn there (art or frame design: a null fill), which
    // the downscaled bake no longer carries: that renders live. A JPEG is
    // the same square bytes, re-encoded below.
    //
    // A PRINT render (800 ppi, bleed) never serves the bake: it is always
    // live (TODO 6.1b "bake on demand, not stored").
    const squareFills = !printMode && corners === "square" ? squareCornerFillsOf(previewData) : null;
    const storedServes = !printMode && watermark && !squareFills?.includes(null);
    const stored = storedServes ? await fetchStoredRender(card) : null;
    if (stored) {
      const fitted = await fitStoredRender(stored, preset, isLandscapeRender(previewData));
      pngBytes = new Uint8Array(squareFills ? await flattenStoredCorners(fitted, squareFills) : fitted);
    } else {
      // A live render costs a Satori pass: a signed-out caller gets a
      // limited number of them (TODO 7.8). Signed-in viewers never count.
      if (!(await currentViewer())) {
        const limit = await checkAnonLiveRenderLimit(request);
        if (!limit.ok) return rateLimitedResponse(limit);
      }
      if (printMode) {
        // Square, the art at full resolution (lib/render/card-print.ts).
        pngBytes = new Uint8Array(
          await renderCardPrint(previewData, {
            ppi: print.ppi,
            bleed: print.bleed,
            brandMark: watermark,
            watermarkText: footerText,
          }),
        );
      } else {
        const imgResponse = await renderCardImage(previewData, preset, {
          brandMark: watermark,
          watermarkText: footerText,
          corners,
        });
        pngBytes = new Uint8Array(await imgResponse.arrayBuffer());
      }
    }
    bytes = format === "jpeg" ? new Uint8Array(await encodeCardJpeg(pngBytes)) : pngBytes;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Render error";
    return NextResponse.json(
      { error: `Render failed: ${detail}` },
      { status: 500 },
    );
  }

  // Funnel: a download (and, once per user, first_download) — signed-in
  // viewers only; anonymous downloads of public cards aren't attributed.
  const viewer = await currentViewer();
  if (viewer && isAdminConfigured()) {
    await recordActivity(createAdminClient(), {
      userId: viewer.id,
      kind: "download",
      props: {
        format,
        // A print render names its resolution (and the bleed) in the
        // allow-listed props (lib/analytics/funnel-events.ts).
        preset: printMode ? `${print.ppi}ppi` : preset,
        clean: !watermark,
        corners,
        ...(print.bleed ? { layout: "bleed" } : {}),
      },
    });
  }

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": format === "jpeg" ? "image/jpeg" : "image/png",
      // The header wins over the modal's download="" attribute, so the file
      // is named here: <slug>.png, <slug>-square.png (both corners can sit
      // side by side) or <slug>.jpg.
      "Content-Disposition": `attachment; filename="${
        printMode ? cardPrintFilename(card.slug, print) : cardImageFilename(card.slug, { format, corners })
      }"`,
      "Content-Length": String(bytes.byteLength),
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
