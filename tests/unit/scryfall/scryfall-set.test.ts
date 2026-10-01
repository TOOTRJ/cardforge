import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sets from "./fixtures/collector-sets.json";

// ---------------------------------------------------------------------------
// getScryfallSet (TODO 4.9a): the collector-field import's one extra call.
//   • /sets/:code through the throttled client, with Next's data cache told
//     to keep it for a day (`next.revalidate`) instead of `no-store`;
//   • an in-process cache: a repeat within the instance makes no request,
//     and so do concurrent callers of one set;
//   • Scryfall's 404 is definitive (cached); an upstream failure is not, so
//     the next import retries;
//   • a malformed code never reaches the request path.
// The client keeps module-level state, so each test re-imports a fresh
// module (vi.resetModules), as client-retry.test.ts does.
// ---------------------------------------------------------------------------

type ClientModule = typeof import("@/lib/scryfall/client");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function freshClient(): Promise<ClientModule> {
  vi.resetModules();
  return import("@/lib/scryfall/client");
}

describe("getScryfallSet", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches /sets/:code once, cached for a day, and parses the set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sets.dmu));
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();

    const first = client.getScryfallSet("dmu");
    await vi.runAllTimersAsync();
    const dmu = await first;
    expect(dmu).toMatchObject({ code: "dmu", printed_size: 281 });
    expect(dmu?.parent_set_code).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { next?: { revalidate?: number } }];
    expect(url).toBe("https://api.scryfall.com/sets/dmu");
    expect(init.next).toEqual({ revalidate: client.SCRYFALL_SET_CACHE_SECONDS });
    expect(init.cache).toBeUndefined();
    expect(client.SCRYFALL_SET_CACHE_SECONDS).toBe(86_400);

    // A repeat (any case, surrounding space) answers from the instance cache.
    const again = client.getScryfallSet(" DMU ");
    await vi.runAllTimersAsync();
    expect((await again)?.code).toBe("dmu");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("concurrent callers of one set share a single request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sets.tdom));
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();

    const both = Promise.all([client.getScryfallSet("tdom"), client.getScryfallSet("tdom")]);
    await vi.runAllTimersAsync();
    const [a, b] = await both;
    expect(a?.parent_set_code).toBe("dom");
    expect(b?.parent_set_code).toBe("dom");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches Scryfall's 404 (no such set) but not an upstream failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ object: "error", status: 404 }, 404))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(sets.kld));
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();

    const missing = client.getScryfallSet("zzzz");
    await vi.runAllTimersAsync();
    expect(await missing).toBeNull();
    const missingAgain = client.getScryfallSet("zzzz");
    await vi.runAllTimersAsync();
    expect(await missingAgain).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 503 ×3 (the client's own retry budget) → null, NOT cached…
    const failed = client.getScryfallSet("kld");
    await vi.runAllTimersAsync();
    expect(await failed).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // …so the next call asks again and gets the set.
    const retried = client.getScryfallSet("kld");
    await vi.runAllTimersAsync();
    expect((await retried)?.printed_size).toBe(264);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("refuses a malformed code without a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();
    for (const bad of ["", "a", "../cards", "dmu/107", "x".repeat(11)]) {
      expect(await client.getScryfallSet(bad), bad).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("every card call stays uncached (no-store)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "f8ac5006-91bd-4803-93da-f87cf196dd2f", name: "Serra Angel" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();
    const card = client.getCardById("f8ac5006-91bd-4803-93da-f87cf196dd2f");
    await vi.runAllTimersAsync();
    expect((await card)?.name).toBe("Serra Angel");
    const init = fetchMock.mock.calls[0][1] as RequestInit & { next?: unknown };
    expect(init.cache).toBe("no-store");
    expect(init.next).toBeUndefined();
  });
});
