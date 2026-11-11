import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { chainClient, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";

const db = vi.hoisted(() => ({
  answer: null as null | ((calls: unknown[]) => { data?: unknown; error?: { message: string } | null }),
  calls: [] as unknown[][],
}));
vi.mock("@/lib/supabase/public", () => ({
  createPublicClient: () =>
    chainClient((_table: string, calls: ChainCall[]): ChainAnswer => {
      db.calls.push(calls);
      return db.answer ? db.answer(calls) : {};
    }).client,
}));

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
  // The card is shown (public or unlisted) unless a test says otherwise.
  db.calls = [];
  db.answer = () => ({ data: { id: CARD } });
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
    ["the back face's PNG (TODO 5.0a)", `${CARD}.back.png`],
    ["the back face's thumb (TODO 5.0a)", `${CARD}.back.thumb.webp`],
  ])("serves %s with the card's cache tag and the unchanged immutable header", async (_label, file) => {
    const res = await get([OWNER, file]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Vercel-Cache-Tag")).toBe(`card-${CARD}`);
    expect(res.headers.get("Cache-Control")).toBe(IMMUTABLE);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("ETag")).toBe('"abc"');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://auth.pipglyph.com/storage/v1/object/public/card-renders/${OWNER}/${file}?v=123`,
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
  });

  it("the tag is the lower-case card id — what every purge passes (database ids)", async () => {
    const res = await get([OWNER.toUpperCase(), `${CARD.toUpperCase()}.png`]);
    expect(res.headers.get("Vercel-Cache-Tag")).toBe(`card-${CARD}`);
  });

  it.each([
    ["a non-bake name", [OWNER, "poster.png"]],
    ["a bake name in the wrong shape", [OWNER, `${CARD}.jpg`]],
    ["a face name that isn't the back's", [OWNER, `${CARD}.front.png`]],
    ["a doubled back name", [OWNER, `${CARD}.back.back.png`]],
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

describe("GET /render-cdn — a card that isn't shown any more", () => {
  // The purge (lib/cards/cache-purge.ts) runs right after the objects are
  // removed, but Supabase's CDN can answer a removed object for up to 60 s:
  // a request in that window refilled Vercel's CDN with the private image,
  // for a year. So every miss asks the database too.
  it("asks for THAT card, by THAT owner, public or unlisted — the anonymous read", async () => {
    await get([OWNER.toUpperCase(), `${CARD.toUpperCase()}.png`]);
    const calls = db.calls[0] as { method: string; args: unknown[] }[];
    expect(calls).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["id", CARD] },
        { method: "eq", args: ["owner_id", OWNER] },
        { method: "in", args: ["visibility", ["public", "unlisted"]] },
      ]),
    );
  });

  it("private, hidden, deleted or another owner's → a short-cached 404 with no tag, even while storage still serves the bytes", async () => {
    db.answer = () => ({ data: null });
    const res = await get([OWNER, `${CARD}.png`]);
    expect(res.status).toBe(404);
    expect(res.headers.get("Vercel-Cache-Tag")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(fetchMock).not.toHaveBeenCalled(); // storage would still have answered 200
  });

  it("a database that can't answer → 503, never cached, never the image", async () => {
    db.answer = () => ({ data: null, error: { message: "timeout" } });
    const res = await get([OWNER, `${CARD}.thumb.webp`]);
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Vercel-Cache-Tag")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// 2026-11-10: Supabase's storage API answered 429 for 45 minutes (its
// database pooler was full — CI walking the frames bucket through a cold
// CDN). This handler answered each one "502, cache for a minute", and a
// page of deck tiles stayed broken until a reload.
describe("GET /render-cdn — storage that is busy is not storage that lacks the bake", () => {
  const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
  const FILE = `${CARD}.thumb.webp`;
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });
  /** The request, with the handler's waits run for it. */
  const getThroughRetries = async (file = FILE) => {
    const pending = get([OWNER, file]);
    await vi.runAllTimersAsync();
    return pending;
  };

  it.each([
    ["a 503", async () => new Response("", { status: 503 })],
    ["a dropped connection", async () => Promise.reject(new TypeError("fetch failed"))],
    ["a timeout", async () => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }))],
    ["a 400 that does not say \"not found\" (a full connection pool has answered that way)", async () => new Response('{"message":"Too many connections"}', { status: 400 })],
  ])("tries once more after %s and serves the bake, tag and immutable header as ever", async (_label, first) => {
    fetchMock.mockImplementationOnce(first).mockImplementationOnce(async () => png());
    const res = await getThroughRetries();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(IMMUTABLE);
    expect(res.headers.get("Vercel-Cache-Tag")).toBe(`card-${CARD}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a 429 is storage saying it is saturated: no second knock from here — 503, never cached, Retry-After, one log line", async () => {
    fetchMock.mockImplementation(async () => new Response('{"statusCode":"429","message":"Too many connections issued to the database"}', { status: 429 }));
    const res = await getThroughRetries();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(res.headers.get("Vercel-Cache-Tag")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(`[render-cdn] storage had no answer for ${OWNER}/${FILE}: 429`);
  });

  it("still no answer on the second try → 503 `no-store`, two tries and no more, the last status in the log", async () => {
    fetchMock.mockImplementation(async () => new Response("", { status: 503 }));
    const res = await getThroughRetries();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toBe(`[render-cdn] storage had no answer for ${OWNER}/${FILE}: 503`);

    warn.mockClear();
    fetchMock.mockReset();
    fetchMock.mockImplementationOnce(async () => new Response("", { status: 502 })).mockImplementationOnce(async () => new Response("{}", { status: 429 }));
    expect((await getThroughRetries()).status).toBe(503);
    expect(warn.mock.calls[0][0]).toMatch(/: 429$/);
  });

  it("asks the database AGAIN before the second try: a card made private during the wait is a 404, and storage is not asked twice", async () => {
    fetchMock.mockImplementation(async () => new Response("", { status: 503 }));
    let reads = 0;
    db.answer = () => {
      reads += 1;
      return { data: reads === 1 ? { id: CARD } : null };
    };
    const res = await getThroughRetries();
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(res.headers.get("Vercel-Cache-Tag")).toBeNull();
    expect(reads).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a database that cannot answer before the second try → 503, and storage is not asked twice", async () => {
    fetchMock.mockImplementation(async () => new Response("", { status: 503 }));
    let reads = 0;
    db.answer = () => {
      reads += 1;
      return reads === 1 ? { data: { id: CARD } } : { data: null, error: { message: "timeout" } };
    };
    const res = await getThroughRetries();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the first try that works reads the database once (no extra read on the ordinary path)", async () => {
    await getThroughRetries();
    expect(db.calls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives storage a time to START answering — and puts no clock on a body that is streaming", async () => {
    // Storage never answers: the request is ended at the timeout, twice.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    const hung = await getThroughRetries();
    expect(hung.status).toBe(503);
    expect(warn.mock.calls[0][0]).toMatch(/: timeout$/);

    // Storage answers: its signal is never fired afterwards, however long the body takes.
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return png();
    });
    const res = await getThroughRetries();
    expect(res.status).toBe(200);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(signal?.aborted).toBe(false);
  });

  it("an error answer whose body never comes does not hold the request", async () => {
    const stalled = () =>
      ({
        ok: false,
        status: 503,
        headers: new Headers(),
        body: null,
        text: () => new Promise<string>(() => {}),
      }) as unknown as Response;
    fetchMock.mockImplementation(async () => stalled());
    const res = await getThroughRetries();
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("names a dropped connection in the log too", async () => {
    fetchMock.mockImplementation(async () => Promise.reject(new TypeError("fetch failed")));
    expect((await getThroughRetries()).status).toBe(503);
    expect(warn.mock.calls[0][0]).toMatch(/: network$/);
  });

  it.each([
    ["Supabase's 400", () => new Response('{"statusCode":"404","error":"not_found","message":"Object not found"}', { status: 400 })],
    ["a 404", () => new Response("", { status: 404 })],
  ])("\"not found\" (%s) is not retried: one fetch, the short-cached 404", async (_label, answer) => {
    fetchMock.mockImplementation(async () => answer());
    const res = await getThroughRetries();
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["a full connection pool", '{"message":"Too many connections"}'],
    ["a bucket that is not found (storage's trouble, not this object's)", '{"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}'],
    ["a tenant that is not found", '{"statusCode":"400","error":"TenantNotFound","message":"Missing tenant config"}'],
    ["no body at all", ""],
  ])("a 400 that does not say the OBJECT is not found (%s) is never cached as a 404", async (_label, body) => {
    fetchMock.mockImplementation(async () => new Response(body, { status: 400 }));
    const res = await getThroughRetries();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toMatch(/: 400$/);
  });

  it("states how long it may run — more than its slowest answer", async () => {
    const route = await import("@/app/render-cdn/[...path]/route");
    // Two waits for storage (5 s each), two capped error bodies (1 s each), the pause, two database reads.
    expect(route.maxDuration).toBeGreaterThanOrEqual(2 * 5 + 2 * 1 + 1 + 10);
  });

  it("any other refusal is a 502 nobody caches (it used to be cached for a minute)", async () => {
    fetchMock.mockImplementation(async () => new Response("", { status: 403 }));
    const res = await getThroughRetries();
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(`[render-cdn] storage refused ${OWNER}/${FILE}: 403`);
  });
});

describe("bakeObjectCardId", () => {
  it("is the card id of a bake's four names only (both faces, TODO 5.0a)", () => {
    expect(bakeObjectCardId(`${OWNER}/${CARD}.png`)).toBe(CARD);
    expect(bakeObjectCardId(`${OWNER}/${CARD}.thumb.webp`)).toBe(CARD);
    expect(bakeObjectCardId(`${OWNER}/${CARD}.back.png`)).toBe(CARD);
    expect(bakeObjectCardId(`${OWNER}/${CARD}.back.thumb.webp`)).toBe(CARD);
    expect(bakeObjectCardId(`${OWNER}/${CARD}.back.jpg`)).toBeNull();
    expect(bakeObjectCardId(`${OWNER}/${CARD}.webp`)).toBeNull();
    expect(bakeObjectCardId(`${OWNER}/${CARD}.png.bak`)).toBeNull();
    expect(bakeObjectCardId(`${CARD}.png`)).toBeNull();
    expect(bakeObjectCardId(`x/${OWNER}/${CARD}.png`)).toBeNull();
  });
});
