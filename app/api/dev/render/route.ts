import { NextResponse, type NextRequest } from "next/server";
import {
  renderCardImage,
  RENDER_PRESETS,
  type RenderPreset,
} from "@/lib/render/card-image";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// Dev-only render harness — bakes an arbitrary CardPreviewData payload through
// the REAL Satori pipeline (lib/render/card-image.tsx) without touching the
// database. Powers scripts/visual-audit.mjs (side-by-side comparisons against
// official Scryfall scans) and any future visual-regression tooling.
//
// Hard-disabled in production: the public bake paths (OG/PNG/PDF routes) stay
// the only way to render real cards.
//
//   POST /api/dev/render
//   { "card": <CardPreviewData>, "preset": "default" | "hd", "watermark": false }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: {
    card?: CardPreviewData;
    preset?: string;
    watermark?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const preset: RenderPreset =
    body.preset && body.preset in RENDER_PRESETS
      ? (body.preset as RenderPreset)
      : "default";

  return renderCardImage(body.card ?? {}, preset, {
    watermark: body.watermark ?? false,
  });
}
