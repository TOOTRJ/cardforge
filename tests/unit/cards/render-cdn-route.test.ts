import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/render-cdn/[...path]/route";
import { bakeObjectCardId } from "@/lib/cards/render-cdn";

// ---------------------------------------------------------------------------
// /render-cdn/<owner>/<card>.png|.thumb.webp — the card-renders proxy behind
// a one-year immutable header. Owner answer 2026-09-29: going private,
// hidden or deleted must purge the CDN copy, so every image it serves
// carries `Vercel-Cache-Tag: card-<id>` — the tag purgeCardCdnCache deletes
// (lib/cards/cache-purge.ts) — while a public card's caching stays exactly
// as it was. A name that is not a bake has no card to tag it with (it could
// never be purged), so it is not served at all.
// ---------------------------------------------------------------------------

const OWNER = "11111111-1111-4111-8111-111111111111";
const CARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const IMMUTABLE = "public, max-age=31536000, s-maxage=31536000, immutable";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () =>
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "4", etag: '"abc"' },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const get = (segments: string[], query = "?v=123") =>
  GET(new NextRequest(`https://www.pipglyph.com/render-cdn/${segments.join("/")}${query}`), {
    params: Promise.resolve({ path: segments }),
  });

describe("GET /render-cdn", () => {
  it.each([
    ["the HD PNG", `${CARD}.png`],
    ["the WebP thumb", `${CARD}.thumb.webp`],
  ])("serves %s with the card's cache tag and the unchanged immutable header", async (_label, file) => {
    const res = await get([OWNER, file]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Vercel-Cache-Tag")).toBe(`card-${CARD}`);
    expect(res.headers.get("Cache-Control")).toBe(IMMUTABLE);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("ETag")).toBe('"abc"');
    expect(fetchMock).toHaveBeenCalledWith(
      `https://auth.pipglyph.com/storage/v1/object/public/card-renders/${OWNER}/${file}?v=123`,
      { cache: "no-store" },
    );
  });

  it("the tag is the lower-case card id — what every purge passes (database ids)", async () => {
    const res = await get([OWNER.toUpperCase(), `${CARD.toUpperCase()}.png`]);
    expect(res.headers.get("Vercel-Cache-Tag")).toBe(`card-${CARD}`);
  });

  it.each([
    ["a non-bake name", [OWNER, "poster.png"]],
    ["a bake name in the wrong shape", [OWNER, `${CARD}.jpg`]],
    ["a nested path", [OWNER, "x", `${CARD}.png`]],
    ["a root file", [`${CARD}.png`]],
    ["an owner that isn't a uuid", ["someone", `${CARD}.png`]],
  ])("answers 404 for %s without fetching it (it could never be purged)", async (_label, segments) => {
    const res = await get(segments);
    expect(res.status).toBe(404);
    expect(res.headers.get("Vercel-Cache-Tag")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a missing object is a short-cached 404 with no tag; a non-image answer is refused", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("Object not found", { status: 400 }));
    const missing = await get([OWNER, `${CARD}.png`]);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(missing.headers.get("Vercel-Cache-Tag")).toBeNull();

    fetchMock.mockImplementationOnce(async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    const html = await get([OWNER, `${CARD}.png`]);
    expect(html.status).toBe(404);
    expect(html.headers.get("Vercel-Cache-Tag")).toBeNull();
  });

  it("traversal segments never reach the bucket", async () => {
    for (const segments of [[OWNER, ".."], ["..", `${CARD}.png`], [OWNER, "%2e%2e"]]) {
      expect((await get(segments)).status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("bakeObjectCardId", () => {
  it("is the card id of a bake's two names only", () => {
    expect(bakeObjectCardId(`${OWNER}/${CARD}.png`)).toBe(CARD);
    expect(bakeObjectCardId(`${OWNER}/${CARD}.thumb.webp`)).toBe(CARD);
    expect(bakeObjectCardId(`${OWNER}/${CARD}.webp`)).toBeNull();
    expect(bakeObjectCardId(`${OWNER}/${CARD}.png.bak`)).toBeNull();
    expect(bakeObjectCardId(`${CARD}.png`)).toBeNull();
    expect(bakeObjectCardId(`x/${OWNER}/${CARD}.png`)).toBeNull();
  });
});
