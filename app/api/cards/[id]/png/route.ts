import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isLandscapeRender,
  renderCardImage,
  type RenderPreset,
} from "@/lib/render/card-image";
import { fetchStoredRender, fitStoredRender } from "@/lib/render/stored-render";
import {
  downloadBrandMark,
  getEntitlements,
  ownerExportStamp,
} from "@/lib/billing/entitlements";
import { rowToPreviewData, type CardRowForBake } from "@/lib/cards/bake-core";
import { getPipOverrides } from "@/lib/pips/queries";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";

// ---------------------------------------------------------------------------
// /api/cards/[id]/png — Download a rendered PNG of a card
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

  let pngBytes: Uint8Array;
  try {
    // The stored bake is always watermarked with no footer text (layout
    // v20) — exactly what a FREE viewer downloads, so serve it (2×
    // downscaled) instead of re-rendering — lib/render/stored-render.ts. A
    // paid viewer's clean download, and any card without a current bake,
    // render live.
    const stored = watermark ? await fetchStoredRender(card) : null;
    if (stored) {
      pngBytes = new Uint8Array(
        await fitStoredRender(stored, preset, isLandscapeRender(previewData)),
      );
    } else {
      const imgResponse = await renderCardImage(previewData, preset, {
        brandMark: watermark,
        watermarkText: footerText,
      });
      pngBytes = new Uint8Array(await imgResponse.arrayBuffer());
    }
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
