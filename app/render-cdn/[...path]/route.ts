import { NextResponse, type NextRequest } from "next/server";
import { cardCacheTag } from "@/lib/cards/cache-purge";
import { bakeObjectCardId } from "@/lib/cards/render-cdn";

// ---------------------------------------------------------------------------
// /render-cdn/<owner>/<cardId>.png|.thumb.webp?v=… — a card's bake from the
// card-renders bucket behind an immutable cache header.
//
// Supabase Storage's public endpoint answers browsers `cache-control:
// no-cache` (the object's own max-age is honoured edge-side only), so every
// gallery tile revalidated on every page view. This handler proxies the
// bucket and stamps a one-year immutable header — safe because every object
// under it is content-addressed by the `?v=` bake stamp — and `s-maxage`
// lets Vercel's CDN serve repeats without invoking the function.
// BakedCardThumbnail maps storage URLs onto this path (lib/cards/render-cdn.ts).
//
// Only a bake's two names are served (`bakeObjectCardId`), and every image
// carries `Vercel-Cache-Tag: card-<cardId>` — the tag the card's share image
// already carries (/api/cards/[id]/og). Whatever takes a card out of public
// view (made private, deleted, hidden by moderation, the owner's account
// deleted, scripts/sweep-storage-orphans.mjs --private-renders) removes the
// objects and then calls purgeCardCdnCache (lib/cards/cache-purge.ts), which
// deletes every CDN copy under that tag — without it the CDN kept serving a
// private card's full image for a year from the old URL. The browser's own
// copy can't be recalled (immutable); the CDN's is what everyone else gets.
// Any other object in the bucket (a pre-0126 upload under another name)
// answers 404: it has no card to tag it with, so it could never be purged.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEGMENT = /^[A-Za-z0-9_\-.]+$/;
const IMMUTABLE = "public, max-age=31536000, s-maxage=31536000, immutable";
const NOT_FOUND_CACHE = "public, max-age=60";

const notFound = () =>
  new NextResponse("Not found", { status: 404, headers: { "Cache-Control": NOT_FOUND_CACHE } });

export async function GET(request: NextRequest, context: { params: Promise<unknown> }) {
  const { path } = ((await context.params) ?? {}) as { path?: string[] };
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!base || !Array.isArray(path) || path.length === 0) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (path.some((seg) => !SEGMENT.test(seg) || seg === "." || seg === "..")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const cardId = bakeObjectCardId(path.join("/"));
  if (!cardId) return notFound();
  const version = request.nextUrl.searchParams.get("v");
  const target = `${base}/storage/v1/object/public/card-renders/${path.join("/")}${
    version ? `?v=${encodeURIComponent(version)}` : ""
  }`;
  const upstream = await fetch(target, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    // Supabase answers a missing object with 400 ("Object not found").
    return new NextResponse("Not found", {
      status: upstream.status === 404 || upstream.status === 400 ? 404 : 502,
      headers: { "Cache-Control": NOT_FOUND_CACHE },
    });
  }
  const type = upstream.headers.get("content-type") ?? "application/octet-stream";
  if (!type.startsWith("image/")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const headers = new Headers({
    "Content-Type": type,
    "Cache-Control": IMMUTABLE,
    "Vercel-Cache-Tag": cardCacheTag(cardId),
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  const etag = upstream.headers.get("etag");
  if (etag) headers.set("ETag", etag);
  return new NextResponse(upstream.body, { status: 200, headers });
}
