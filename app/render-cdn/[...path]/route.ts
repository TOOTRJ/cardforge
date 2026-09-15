import { NextResponse, type NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// /render-cdn/<owner>/<object>?v=… — the card-renders bucket behind an
// immutable cache header.
//
// Supabase Storage's public endpoint answers browsers `cache-control:
// no-cache` (the object's own max-age is honoured edge-side only), so every
// gallery tile revalidated on every page view. This handler proxies the
// bucket and stamps a one-year immutable header — safe because every object
// under it is content-addressed by the `?v=` bake stamp — and `s-maxage`
// lets Vercel's CDN serve repeats without invoking the function.
// BakedCardThumbnail maps storage URLs onto this path (lib/cards/render-cdn.ts).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEGMENT = /^[A-Za-z0-9_\-.]+$/;
const IMMUTABLE = "public, max-age=31536000, s-maxage=31536000, immutable";

export async function GET(request: NextRequest, context: { params: Promise<unknown> }) {
  const { path } = ((await context.params) ?? {}) as { path?: string[] };
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!base || !Array.isArray(path) || path.length === 0) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (path.some((seg) => !SEGMENT.test(seg) || seg === "." || seg === "..")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const version = request.nextUrl.searchParams.get("v");
  const target = `${base}/storage/v1/object/public/card-renders/${path.join("/")}${
    version ? `?v=${encodeURIComponent(version)}` : ""
  }`;
  const upstream = await fetch(target, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    // Supabase answers a missing object with 400 ("Object not found").
    return new NextResponse("Not found", {
      status: upstream.status === 404 || upstream.status === 400 ? 404 : 502,
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }
  const type = upstream.headers.get("content-type") ?? "application/octet-stream";
  if (!type.startsWith("image/")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const headers = new Headers({ "Content-Type": type, "Cache-Control": IMMUTABLE });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  const etag = upstream.headers.get("etag");
  if (etag) headers.set("ETag", etag);
  return new NextResponse(upstream.body, { status: 200, headers });
}
