import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Covers the Scryfall client's rate-limit posture:
//   - endpoint-aware request gaps (500ms for /cards/search + /cards/named,
//     100ms for everything else)
//   - retry on 429/5xx honoring Retry-After, bailing when the wait exceeds
//     the budget
//   - image_status quality classification
//
// The client keeps a module-level throttle chain, so each test re-imports a
// fresh module instance via vi.resetModules().
// ---------------------------------------------------------------------------

type ClientModule = typeof import("@/lib/scryfall/client");

const CARD_BODY = { id: "f8ac5006-91bd-4803-93da-f87cf196dd2f", name: "Serra Angel" };

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

async function freshClient(): Promise<ClientModule> {
  vi.resetModules();
  return import("@/lib/scryfall/client");
}

/** Runs the promise to completion while draining fake timers. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

describe("scryfallFetch retry behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a 429 once when Retry-After fits the budget", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({}, { status: 429, headers: { "Retry-After": "1" } }),
      )
      .mockResolvedValueOnce(jsonResponse(CARD_BODY));
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();

    const card = await settle(client.getCardById("f8ac5006-91bd-4803-93da-f87cf196dd2f"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(card?.name).toBe("Serra Angel");
  });

  it("gives up immediately when Retry-After exceeds the wait budget", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({}, { status: 429, headers: { "Retry-After": "30" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();

    const card = await settle(client.getCardById("f8ac5006-91bd-4803-93da-f87cf196dd2f"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(card).toBeNull();
  });

  it("retries 5xx with backoff and stops after the retry cap", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();

    const card = await settle(client.getCardById("f8ac5006-91bd-4803-93da-f87cf196dd2f"));

    // 1 initial + 2 retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(card).toBeNull();
  });

  it("recovers when a 5xx clears before the retry cap", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(CARD_BODY));
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();

    const card = await settle(client.getCardById("f8ac5006-91bd-4803-93da-f87cf196dd2f"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(card?.name).toBe("Serra Angel");
  });

  it("does not retry a 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();

    const card = await settle(client.getCardById("f8ac5006-91bd-4803-93da-f87cf196dd2f"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(card).toBeNull();
  });
});

describe("endpoint-aware throttle gaps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function dispatchTimesFor(
    run: (client: ClientModule) => Promise<unknown>,
  ): Promise<number[]> {
    const times: number[] = [];
    const fetchMock = vi.fn().mockImplementation(() => {
      times.push(Date.now());
      return Promise.resolve(
        jsonResponse({
          object: "list",
          data: [CARD_BODY],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();
    await settle(run(client));
    return times;
  }

  it("spaces /cards/search requests at least 500ms apart", async () => {
    const times = await dispatchTimesFor(async (client) => {
      await client.searchCards({ query: "angel" });
      await client.searchCards({ query: "angel" });
    });
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(500);
  });

  it("spaces /cards/named requests at least 500ms apart", async () => {
    const times = await dispatchTimesFor(async (client) => {
      await client.getCardByName({ exact: "Serra Angel" });
      await client.getCardByName({ exact: "Serra Angel" });
    });
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(500);
  });

  it("spaces /cards/{id} requests at only 100ms", async () => {
    const times = await dispatchTimesFor(async (client) => {
      await client.getCardById("f8ac5006-91bd-4803-93da-f87cf196dd2f");
      await client.getCardById("f8ac5006-91bd-4803-93da-f87cf196dd2f");
    });
    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(100);
    expect(times[1] - times[0]).toBeLessThan(500);
  });

  it("does not throttle cards.scryfall.io CDN downloads", async () => {
    const times: number[] = [];
    const fetchMock = vi.fn().mockImplementation(() => {
      times.push(Date.now());
      return Promise.resolve(
        new Response(new Blob(["x"]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();

    await settle(
      (async () => {
        await client.fetchScryfallImage(
          "https://cards.scryfall.io/png/front/a/b/abc.png",
        );
        await client.fetchScryfallImage(
          "https://cards.scryfall.io/png/front/a/b/def.png",
        );
      })(),
    );

    expect(times).toHaveLength(2);
    expect(times[1] - times[0]).toBeLessThan(100);
  });
});

describe("assessPrintImageQuality", () => {
  it("classifies statuses", async () => {
    const client = await freshClient();
    const base = { id: "x", name: "X" };
    expect(
      client.assessPrintImageQuality({ ...base, image_status: "highres_scan" }),
    ).toBe("ok");
    expect(
      client.assessPrintImageQuality({ ...base, image_status: "lowres" }),
    ).toBe("lowres");
    expect(
      client.assessPrintImageQuality({ ...base, image_status: "placeholder" }),
    ).toBe("unusable");
    expect(
      client.assessPrintImageQuality({ ...base, image_status: "missing" }),
    ).toBe("unusable");
    // Absent / unknown statuses never block an import.
    expect(client.assessPrintImageQuality({ ...base })).toBe("ok");
    expect(
      client.assessPrintImageQuality({ ...base, image_status: "shiny_new" }),
    ).toBe("ok");
  });
});
