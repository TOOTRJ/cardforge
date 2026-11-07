import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { checkToolAccess } from "@/lib/tools/queries";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { renderCardPrint } from "@/lib/render/card-print";
import { isPrintRequest, parsePpiParam, parsePrintBleedParam, parsePrintParam, PRINT_800_PPI_PAID_ONLY } from "@/lib/cards/print-export";
import { downloadBrandMark, getEntitlements } from "@/lib/billing/entitlements";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import { isAllowedMediaUrl } from "@/lib/media/media-urls";
import { kitFaceSchema, kitItemStateSchema, kitPreviewData, kitSettingsSchema } from "@/lib/tools/token-kit/model";

// ---------------------------------------------------------------------------
// POST /api/tools/token-kit/render — ONE kit token's PNG, for the Token Kit's
// print / download (lib/decks/export-client.ts runKitExport). A kit token is
// not a card (no row, no bake), so the route renders from the token's FACE,
// the kit's SETTINGS and the token's STATE — parsed here, then turned into
// preview data by the SAME builder the page's previews read
// (kitPreviewData), against the server's own verified frames: a client never
// hands the renderer a CardPreviewData.
//
// It is /api/cards/[id]/png's live path, nothing else: the same query params
// (`preset`, `print=1`, `ppi=800`, `bleed=1|mpc`), the same renderers
// (renderCardImage / renderCardPrint — never a new one), and the same VIEWER
// rules — a free viewer's file is watermarked at the standard size, and a
// print render (the exports' 600 ppi, a bleed, MPC) is a clean download's
// (403 UPGRADE_REQUIRED otherwise). Always square (print). The picture is
// the viewer's own card-art object or none (isAllowedMediaUrl), so the
// renderer never fetches a host the maker named.
//
// Beta: the tool's access rule (checkToolAccess) is the gate; a 404 for
// anyone it doesn't let in, like the tool's page.
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  face: kitFaceSchema,
  settings: kitSettingsSchema,
  state: kitItemStateSchema.pick({ artUrl: true, artistCredit: true, artPosition: true }),
});

/** A kit token's file is a few KB of JSON; anything bigger isn't one. */
const MAX_BODY_BYTES = 16_000;

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const viewer = await getCurrentUser();
  if (!viewer) {
    return NextResponse.json({ error: "Sign in to download cards.", code: "SIGN_IN_REQUIRED" }, { status: 401 });
  }
  const access = await checkToolAccess("token-kit");
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "That token is too big to render." }, { status: 413 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "That token is too big to render." }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid token." }, { status: 400 });
  }
  const { face, settings, state } = parsed.data;
  // The viewer's own card-art object, or no picture (never a host the body
  // names).
  const artUrl = isAllowedMediaUrl("card-art", state.artUrl, viewer.id) ? state.artUrl : null;

  const params = request.nextUrl.searchParams;
  const print = {
    ppi: parsePpiParam(params.get("ppi")),
    bleed: parsePrintBleedParam(params.get("bleed")),
    print: parsePrintParam(params.get("print")),
  };
  const printMode = isPrintRequest(print);

  const entitlements = await getEntitlements();
  const watermark = downloadBrandMark(entitlements);
  // The png route's rule, word for word: the only print file a watermarked
  // viewer may have is the plain 800 ppi one while the switch is off.
  const freePrint = print.ppi === 800 && !print.bleed && !PRINT_800_PPI_PAID_ONLY;
  if (printMode && watermark && !freePrint) {
    return NextResponse.json(
      {
        error: print.bleed === "mpc"
          ? "MakePlayingCards files are a Plus feature."
          : print.bleed
            ? "Bleed downloads are a Plus feature."
            : "Print downloads are a Plus feature.",
        code: "UPGRADE_REQUIRED",
      },
      { status: 403 },
    );
  }
  const requested: RenderPreset = params.get("preset") === "default" ? "default" : "hd";
  const preset: RenderPreset = entitlements.maxExportPreset === "hd" ? requested : "default";

  const verifiedKeys = new Set(await getVerifiedFrameKeys());
  const built = kitPreviewData(face, settings, { ...state, artUrl }, verifiedKeys);
  if (!built) {
    return NextResponse.json({ error: "This token has no verified frame to print on yet." }, { status: 422 });
  }
  const data = { ...built.data, profileOverrides: await getFrameProfileOverrides() };

  let bytes: Uint8Array;
  try {
    if (printMode) {
      bytes = new Uint8Array(
        await renderCardPrint(data, { ppi: print.ppi, bleed: print.bleed, brandMark: watermark, watermarkText: null }),
      );
    } else {
      const image = await renderCardImage(data, preset, { brandMark: watermark, watermarkText: null, corners: "square" });
      bytes = new Uint8Array(await image.arrayBuffer());
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Render error";
    return NextResponse.json({ error: `Render failed: ${detail}` }, { status: 500 });
  }

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.byteLength),
      // The viewer's plan decides the bytes: never shared-cached.
      "Cache-Control": "private, no-store",
    },
  });
}
