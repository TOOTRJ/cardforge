import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import errors from "./fixtures/named-errors.json";

// ---------------------------------------------------------------------------
// TODO 1.12 — getCardByNameResult says WHY /cards/named found no card. The
// error bodies are Scryfall's own, captured 2026-09-28
// (fixtures/named-errors.json): a fuzzy "bolt" is a 404 of type "ambiguous",
// an unknown exact name a plain 404, a request without a name a 400. Fetch
// is stubbed — no network in tests.
// ---------------------------------------------------------------------------

type ClientModule = typeof import("@/lib/scryfall/client");

const BOLT = { id: "77c6fa74-5543-42ac-9ead-0e890b188e99", name: "Lightning Bolt" };

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

/** Runs the promise to completion while draining fake timers (retries). */
async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("getCardByNameResult", () => {
  it("returns the card on a 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(BOLT));
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();
    const result = await settle(client.getCardByNameResult({ exact: "Lightning Bolt" }));
    expect(result).toMatchObject({ ok: true, card: { name: "Lightning Bolt" } });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://api.scryfall.com/cards/named?exact=Lightning+Bolt",
    );
  });

  it("tells an ambiguous fuzzy name (404, type ambiguous) from a missing one (plain 404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(errors.ambiguous, 404)));
    let client = await freshClient();
    expect(await settle(client.getCardByNameResult({ fuzzy: "bolt" }))).toEqual({
      ok: false,
      kind: "ambiguous",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(errors.not_found, 404)));
    client = await freshClient();
    expect(
      await settle(client.getCardByNameResult({ exact: "Zzyzx Qwerty Nonexistent" })),
    ).toEqual({ ok: false, kind: "not_found" });
  });

  it("reads Scryfall's 400 as a bad request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(errors.bad_request, 400)));
    const client = await freshClient();
    expect(await settle(client.getCardByNameResult({ exact: "x" }))).toEqual({
      ok: false,
      kind: "bad_request",
    });
  });

  it("sends nothing for an empty name", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = await freshClient();
    expect(await settle(client.getCardByNameResult({ fuzzy: "   " }))).toEqual({
      ok: false,
      kind: "bad_request",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls a 5xx after its retries, a network failure or an unreadable card upstream", async () => {
    const failing = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    vi.stubGlobal("fetch", failing);
    let client = await freshClient();
    expect(await settle(client.getCardByNameResult({ exact: "Lightning Bolt" }))).toEqual({
      ok: false,
      kind: "upstream",
    });
    // The client's retry budget still applies (two retries on a 5xx).
    expect(failing).toHaveBeenCalledTimes(3);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    client = await freshClient();
    expect(await settle(client.getCardByNameResult({ exact: "Lightning Bolt" }))).toEqual({
      ok: false,
      kind: "upstream",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ nope: true })));
    client = await freshClient();
    expect(await settle(client.getCardByNameResult({ exact: "Lightning Bolt" }))).toEqual({
      ok: false,
      kind: "upstream",
    });
  });

  it("a 404 with an unreadable body is still not found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 404 })));
    const client = await freshClient();
    expect(await settle(client.getCardByNameResult({ exact: "x" }))).toEqual({
      ok: false,
      kind: "not_found",
    });
  });
});

describe("getCardByName (the decklist importer's card-or-null)", () => {
  it("returns the card, or null for any failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(BOLT)));
    let client = await freshClient();
    expect((await settle(client.getCardByName({ exact: "Lightning Bolt" })))?.name).toBe(
      "Lightning Bolt",
    );

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(errors.ambiguous, 404)));
    client = await freshClient();
    expect(await settle(client.getCardByName({ fuzzy: "bolt" }))).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    client = await freshClient();
    expect(await settle(client.getCardByName({ exact: "Lightning Bolt" }))).toBeNull();
  });
});
