import { NextResponse, type NextRequest } from "next/server";
import { cardCacheTag } from "@/lib/cards/cache-purge";
import { bakeObjectCardId } from "@/lib/cards/render-cdn";
import { createPublicClient } from "@/lib/supabase/public";

// ---------------------------------------------------------------------------
// /render-cdn/<owner>/<cardId>.png|.thumb.webp|.back.png|.back.thumb.webp?v=…
// — a card's bake (either face) from the card-renders bucket behind an
// immutable cache header.
//
// Supabase Storage's public endpoint answers browsers `cache-control:
// no-cache` (the object's own max-age is honoured edge-side only), so every
// gallery tile revalidated on every page view. This handler proxies the
// bucket and stamps a one-year immutable header — safe because every object
// under it is content-addressed by the `?v=` bake stamp — and `s-maxage`
// lets Vercel's CDN serve repeats without invoking the function.
// BakedCardThumbnail maps storage URLs onto this path (lib/cards/render-cdn.ts).
//
// Only a bake's four names are served (`bakeObjectCardId`: the front's PNG
// and thumb, the back face's `.back.*` pair — lib/cards/bake-core.ts
// renderObjectNames), and every image carries `Vercel-Cache-Tag:
// card-<cardId>` — ONE tag for both faces, the tag the card's share image
// already carries (/api/cards/[id]/og). Whatever takes a card out of public
// view (made private, deleted, hidden by moderation, the owner's account
// deleted, scripts/sweep-storage-orphans.mjs --private-renders) removes the
// objects and then calls purgeCardCdnCache (lib/cards/cache-purge.ts), which
// deletes every CDN copy under that tag — without it the CDN kept serving a
// private card's full image for a year from the old URL. The browser's own
// copy can't be recalled (immutable); the CDN's is what everyone else gets.
// Any other object in the bucket (a pre-0126 upload under another name)
// answers 404: it has no card to tag it with, so it could never be purged.
//
// The purge alone can't hold, so every MISS also asks the database (a
// cookie-free anonymous read — RLS shows public and unlisted cards only)
// whether that card is still shown, by that owner; a private, hidden or
// deleted card answers 404 without asking storage. Two reasons:
//   * Supabase's CDN keeps a removed object for up to 60 s — a request in
//     that window after the purge could refill Vercel's CDN from the stale
//     copy, for a year (until the next deploy) — Supabase docs, "Smart CDN";
//   * an object that outlived its card (an account deletion's storage
//     clean-up lists 1000 files per bucket; a remove that failed) must not
//     be served either.
// One primary-key read per miss, before the storage fetch; a CDN hit never
// reaches this function. A failed read is a 503 nobody caches.
//
// Storage that is BUSY is not storage that lacks the object (2026-11-10).
// Supabase's storage API answers 429 when it cannot get a database
// connection (its pooler full — that day, CI walking the whole frames
// bucket through a cold CDN); this handler turned every such answer into a
// 502 with the 60 s header a missing object gets, and a gallery kept its
// broken tiles until a reload. Now:
//   * "not found" — a 404, or Supabase's 400 whose body says "Object not
//     found" — keeps the short-cached 404;
//   * a 429 is a 503 `no-store` with `Retry-After` at once: storage has
//     said it is saturated, and a second knock from here would add to it;
//   * a 5xx, a timeout, a dropped connection or a 400 that does NOT say
//     "not found" is tried ONCE more after a short wait — after asking the
//     database again, because the wait and a second answer take seconds and
//     a card made private meanwhile must not be served from storage's CDN
//     copy — and is a 503 `no-store` if storage still has no answer;
//   * any other refusal is a 502 `no-store`.
// Nothing but an image and a real "not found" is ever cached, by a browser
// or a CDN, so the next request asks again (the page's own retry is
// components/cards/render-image-retry.tsx), and one log line names the
// status — which is how the next such day is read from Vercel's logs
// instead of Supabase's.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The slowest answer this handler gives: two waits for storage's headers,
// two capped error bodies, the pause between them and two database reads.
export const maxDuration = 30;

const SEGMENT = /^[A-Za-z0-9_\-.]+$/;
const IMMUTABLE = "public, max-age=31536000, s-maxage=31536000, immutable";
const NOT_FOUND_CACHE = "public, max-age=60";

/** Storage may take this long to START answering (its headers). Storage
 *  gives up on its own database queue after about two seconds; past this a
 *  hung socket would hold the function for its whole budget. The BODY has
 *  no clock: it streams at the reader's pace, and a slow phone taking a
 *  3 MB PNG must not have it cut off. */
const UPSTREAM_TIMEOUT_MS = 5_000;
/** An error answer's body (a line of JSON) may take this long to read. */
const ERROR_BODY_TIMEOUT_MS = 1_000;

const notFound = () =>
  new NextResponse("Not found", { status: 404, headers: { "Cache-Control": NOT_FOUND_CACHE } });

/** Storage (or the database) had no answer: nobody caches it, ask again. */
const unavailable = () =>
  new NextResponse("Unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } });

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type StorageAnswer =
  /** The bake. */
  | { kind: "ok"; response: Response }
  /** Storage says the object is not there. */
  | { kind: "missing" }
  /** Storage had no answer about the object; `retry` = worth one more try. */
  | { kind: "busy"; status: string; retry: boolean }
  /** Any other final refusal (a 401, a 403…). */
  | { kind: "refused"; status: string };

/** An error answer's body, read OUT rather than cancelled (cancelling a
 *  storage answer's body hung the request under Next's fetch) — and never
 *  waited on for long: "" when it does not come. */
async function errorBody(response: Response): Promise<string> {
  let clock: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      response.text().catch(() => ""),
      new Promise<string>((resolve) => {
        clock = setTimeout(() => resolve(""), ERROR_BODY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(clock);
  }
}

/** One request to storage for the bake, and what its answer means. */
async function askStorage(target: string): Promise<StorageAnswer> {
  // Not AbortSignal.timeout(): that would also end a body still streaming.
  const waiting = new AbortController();
  const clock = setTimeout(() => waiting.abort(new DOMException("storage did not answer in time", "TimeoutError")), UPSTREAM_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(target, { cache: "no-store", signal: waiting.signal });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { kind: "busy", status: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network", retry: true };
  } finally {
    clearTimeout(clock);
  }
  if (response.ok) return { kind: "ok", response };
  const body = await errorBody(response);
  if (response.status === 404) return { kind: "missing" };
  // Supabase answers a missing object 400 with "Object not found" in its
  // body. A 400 that says anything else — a full connection pool has
  // answered that way, and "Bucket not found" or a tenant that is not found
  // are storage's trouble, not the object's — says nothing about it.
  if (response.status === 400) return /object not found/i.test(body) ? { kind: "missing" } : { kind: "busy", status: "400", retry: true };
  if (response.status === 429) return { kind: "busy", status: "429", retry: false };
  if (response.status >= 500) return { kind: "busy", status: String(response.status), retry: true };
  return { kind: "refused", status: String(response.status) };
}

/** Is this card still shown to anyone (public or unlisted) and owned by
 *  `ownerId`? null when the database couldn't say. */
async function cardIsShown(cardId: string, ownerId: string): Promise<boolean | null> {
  try {
    const { data, error } = await createPublicClient()
      .from("cards")
      .select("id")
      .eq("id", cardId)
      .eq("owner_id", ownerId)
      .in("visibility", ["public", "unlisted"])
      .maybeSingle();
    if (error) return null;
    return data !== null;
  } catch {
    return null;
  }
}

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
  // The database first, storage only for a card that is still shown — not
  // both at once: cancelling the body of a storage answer we then refused
  // hung the request under Next's fetch (local smoke test, 2026-09-29).
  const shown = await cardIsShown(cardId, path[0].toLowerCase());
  if (shown === false) return notFound();
  if (shown === null) return unavailable();
  let answer = await askStorage(target);
  if (answer.kind === "busy" && answer.retry) {
    await wait(250 + Math.random() * 350);
    // The database again, right before storage is asked again (the header).
    const still = await cardIsShown(cardId, path[0].toLowerCase());
    if (still === false) return notFound();
    if (still === null) return unavailable();
    answer = await askStorage(target);
  }
  if (answer.kind === "missing") return notFound();
  if (answer.kind === "busy") {
    console.warn(`[render-cdn] storage had no answer for ${path.join("/")}: ${answer.status}`);
    return unavailable();
  }
  if (answer.kind === "refused") {
    // Not ours to explain — and never one to cache.
    console.warn(`[render-cdn] storage refused ${path.join("/")}: ${answer.status}`);
    return new NextResponse("Bad gateway", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  const upstream = answer.response;
  if (!upstream.body) return unavailable();
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
