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
  parsePpiParam,
  parsePrintBleedParam,
  parsePrintParam,
  PRINT_800_PPI_PAID_ONLY,
} from "@/lib/cards/print-export";
import { checkAnonLiveRenderLimit, type AnonRenderLimitResult } from "@/lib/cards/anon-render-limit";
import { rateLimitedResponse } from "@/lib/api/responses";
import {
  downloadBrandMark,
  getEntitlements,
  ownerExportStamp,
} from "@/lib/billing/entitlements";
import { rowToPreviewData, type CardRowForBake } from "@/lib/cards/bake-core";
import { flippableBackOf } from "@/lib/cards/faces";
import { faceSlug, parseDownloadFaces, type CardFace } from "@/lib/cards/card-face";
import { composeFacesSideBySide } from "@/lib/render/faces-side-by-side";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getPipOverrides } from "@/lib/pips/queries";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { isUuid } from "@/lib/ids";
import { retiredFrameTemplate } from "@/lib/cards/card-display";

/** The override row a face's bake reads, for the ETag: its stored template,
 *  or — for a RETIRED one (TODO 4.54) — the frame it draws on, so a changed
 *  override of that frame busts the 304 path for such a row too. (Every
 *  other value keeps the key, and so the ETag, it always had.) */
function overrideKeyOf(face: CardPreviewData): string {
  const template = (face.frameStyle?.template as string | undefined) ?? "";
  return retiredFrameTemplate(template, face) ?? template;
}

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
//   ?bleed=mpc       → PRINT (TODO 6.1): MakePlayingCards' poker-size file —
//                      MPC's bleed on each axis (MPC_BLEED_IN: 822 × 1122 at
//                      300 dpi, so 1644 × 2244 at 600 ppi, 2192 × 2992 at
//                      800) instead of the 1/8", and ALWAYS PORTRAIT (a
//                      Battle or Split is turned into the card). The bleed's
//                      rules otherwise: square, live, PNG only, clean-only
//                      (403 UPGRADE_REQUIRED), named <slug>-mpc.png /
//                      -800ppi-mpc.png, its own ETag.
//   ?print=1         → PRINT (TODO 6.15): the print render even at 600 ppi
//                      without a bleed — 1500×2100, the art at full
//                      resolution — what the Pro exports print from (deck and
//                      selection PDFs, their HD ZIP images;
//                      lib/decks/export-client.ts). Square, live, PNG only,
//                      named <slug>-print.png; clean-download only (a
//                      watermarked viewer → 403 UPGRADE_REQUIRED whatever
//                      PRINT_800_PPI_PAID_ONLY says: a free image is 750 px).
//   ?face=back       → the BACK face of a double-faced card (TODO 5.3): the
//                      face the card page flips to (lib/cards/faces.ts
//                      flippableBackOf — a back with a body on its body, a
//                      legacy back as the page draws it), with every option
//                      above: a free viewer's download is the stored BACK
//                      bake (rendered_back_image_url, under the card's one
//                      hasServableStoredRender rule), a paid viewer's a live
//                      clean render; the print variants composite the back's
//                      art under the back's layout. Named <slug>-back…; the
//                      face joins the ETag only for the back, so every front
//                      download keeps the tag it had. A card with no back to
//                      flip to answers 404. No or any other `face` is the
//                      front, exactly as before.
//   ?faces=both      → BOTH faces in ONE PNG (TODO 5.3c, owner decision
//                      2026-10-05 — the way people share a double-faced
//                      card): the front on the left, the back on the right,
//                      a transparent gutter of 1/25 of a face's width
//                      between them (60 px at HD) on a transparent canvas
//                      (lib/render/faces-side-by-side.ts). Each half is
//                      exactly what `face=front` / `face=back` serves at the
//                      same options — the stored bakes for a free viewer
//                      (each face under its own hasServableStoredRender,
//                      else that face renders live, as today), live clean
//                      renders for a paid viewer, `corners` and the preset
//                      per face. Named <slug>-both.png / -both-square.png;
//                      `faces` joins the ETag the way `face` does. A card
//                      with no back to flip to answers 404 (flippableBackOf,
//                      the face=back rule); a print variant (ppi=800, bleed,
//                      print=1) or a JPEG with faces=both answers 400 — a
//                      print file and a JPEG are one face each, so no
//                      half-built print file ever ships. `face=back` wins
//                      over `faces=both` (the pdf route's reading).
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
    bleed: parsePrintBleedParam(request.nextUrl.searchParams.get("bleed")),
    print: parsePrintParam(request.nextUrl.searchParams.get("print")),
  };
  const printMode = isPrintRequest(print);
  if (printMode && format === "jpeg") {
    return NextResponse.json(
      { error: "Print downloads (800 ppi, bleed) are PNG only." },
      { status: 400 },
    );
  }
  // The face(s) asked for (TODO 5.3 / 5.3c): `face=back`, `faces=both`, or
  // the front. Both faces come as ONE PNG and never as a print file — a
  // print file (800 ppi, a bleed, MPC, the exports' print render) and a
  // JPEG are one face each — refused before any lookup, so no half-built
  // print file ever ships.
  const faces = parseDownloadFaces(
    request.nextUrl.searchParams.get("face"),
    request.nextUrl.searchParams.get("faces"),
  );
  if (faces === "both" && printMode) {
    return NextResponse.json(
      { error: "Print files are one face each — ask for face=front or face=back." },
      { status: 400 },
    );
  }
  if (faces === "both" && format === "jpeg") {
    return NextResponse.json(
      { error: "Both faces come as one PNG — ask for format=png, or face=front or face=back for a JPEG." },
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
  const frontData = rowToPreviewData(
    card as CardRowForBake,
    pipOverrides,
    profileOverrides,
  );
  // The face asked for (TODO 5.3): the back as the card page flips to it —
  // the same mapping the bake renders (lib/cards/faces.ts), so the download
  // is the gallery's back — or a 404 for a card with no back to flip to.
  // Both faces (5.3c) need the same back: a single-faced card has nothing
  // to put beside its front.
  const face: CardFace = faces === "back" ? "back" : "front";
  const backData = faces === "front" ? null : flippableBackOf(frontData);
  if (faces !== "front" && !backData) {
    return NextResponse.json({ error: "This card has no back face." }, { status: 404 });
  }
  // What a one-face download renders; a both-faces download renders the
  // front AND `backData`.
  const previewData = face === "back" && backData ? backData : frontData;

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
        error: print.bleed === "mpc"
          ? "MakePlayingCards files are a Plus feature."
          : print.bleed
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
        // (MPC's bleed is not the 1/8 in one: its own bytes, its own tag.)
        ...(printMode
          ? [`print:${print.ppi}:${print.bleed === "mpc" ? "mpc" : print.bleed ? "bleed" : "trim"}`]
          : []),
        // …and the BACK face (TODO 5.3): its own bytes, folded in only for
        // the back, so every front download keeps the tag it had — and
        // BOTH faces in one PNG (5.3c), their own bytes again.
        ...(face === "back" ? ["face:back"] : faces === "both" ? ["faces:both"] : []),
        watermark ? "wm" : "clean",
        // The owner's custom footer mark prints into the render — fold it in
        // so a changed mark busts the 304 path.
        footerText ?? "",
        CARD_LAYOUT_VERSION,
        JSON.stringify(pipOverrides ?? null),
        // Frame-layout overrides change baked geometry without a code
        // deploy — fingerprint the active template's override (both faces'
        // for a both-faces download: the back's body is its own template).
        JSON.stringify(
          profileOverrides[overrideKeyOf(previewData)] ?? null,
        ),
        ...(faces === "both" && backData
          ? [JSON.stringify(profileOverrides[overrideKeyOf(backData)] ?? null)]
          : []),
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

  /**
   * ONE face's finished PNG, exactly as its own download serves it — the
   * stored bake or a live render, the corner asked for, the viewer's preset
   * and mark. A both-faces download calls it twice and composes the two.
   */
  const renderFace = async (data: CardPreviewData, which: CardFace): Promise<Uint8Array> => {
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
    const squareFills = !printMode && corners === "square" ? squareCornerFillsOf(data) : null;
    const storedServes = !printMode && watermark && !squareFills?.includes(null);
    // The face's own bake: the back's for the back face (a legacy back has
    // none, so it renders live — the one the page shows).
    const stored = storedServes ? await fetchStoredRender(card, { face: which }) : null;
    if (stored) {
      const fitted = await fitStoredRender(stored, preset, isLandscapeRender(data));
      return new Uint8Array(squareFills ? await flattenStoredCorners(fitted, squareFills) : fitted);
    }
    // A live render costs a Satori pass: a signed-out caller gets a
    // limited number of them (TODO 7.8) — counted per render, so a
    // both-faces download of two live renders is two. Signed-in viewers
    // never count.
    if (!(await currentViewer())) {
      const limit = await checkAnonLiveRenderLimit(request);
      if (!limit.ok) throw new RateLimited(limit);
    }
    if (printMode) {
      // Square, the art at full resolution (lib/render/card-print.ts).
      return new Uint8Array(
        await renderCardPrint(data, {
          ppi: print.ppi,
          bleed: print.bleed,
          brandMark: watermark,
          watermarkText: footerText,
        }),
      );
    }
    const imgResponse = await renderCardImage(data, preset, {
      brandMark: watermark,
      watermarkText: footerText,
      corners,
    });
    return new Uint8Array(await imgResponse.arrayBuffer());
  };

  let bytes: Uint8Array;
  try {
    let pngBytes: Uint8Array;
    if (faces === "both" && backData) {
      // Both faces in one PNG (TODO 5.3c): each face exactly what its own
      // download would be, side by side on a transparent canvas.
      const frontPng = await renderFace(frontData, "front");
      const backPng = await renderFace(backData, "back");
      pngBytes = new Uint8Array(await composeFacesSideBySide(frontPng, backPng));
    } else {
      pngBytes = await renderFace(previewData, face);
    }
    bytes = format === "jpeg" ? new Uint8Array(await encodeCardJpeg(pngBytes)) : pngBytes;
  } catch (err) {
    if (err instanceof RateLimited) return rateLimitedResponse(err.denied);
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
        ...(print.bleed ? { layout: print.bleed === "mpc" ? "mpc" : "bleed" } : {}),
        // The back face names itself, and so do both faces in one image; a
        // front download's props are as before.
        ...(faces === "front" ? {} : { face: faces }),
      },
    });
  }

  // The file's slug: the card's, `<slug>-back` for the back face, or
  // `<slug>-both` for both faces in one image.
  const slug = faceSlug(card.slug, faces);
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": format === "jpeg" ? "image/jpeg" : "image/png",
      // The header wins over the modal's download="" attribute, so the file
      // is named here: <slug>.png, <slug>-square.png (both corners can sit
      // side by side) or <slug>.jpg — <slug>-back… for the back face,
      // <slug>-both… for both faces in one image.
      "Content-Disposition": `attachment; filename="${
        printMode ? cardPrintFilename(slug, print) : cardImageFilename(slug, { format, corners })
      }"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": cacheControl,
      ETag: etag,
    },
  });
}

/** The anonymous limiter's refusal, thrown out of a face render so the one
 *  response path answers it (429 + Retry-After) — never a 500. */
class RateLimited extends Error {
  constructor(readonly denied: Extract<AnonRenderLimitResult, { ok: false }>) {
    super(denied.message);
  }
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
